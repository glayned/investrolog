#!/usr/bin/env python3
"""Build the Options and Vol layers of the consensus matrix from the options database.

The database is private: it is downloaded with a read-only key, read, and
deleted. Only derived values reach next/layers/: a percentile, a side and
short wording. Strikes, gamma flip, max pain, expected-move bounds, open
interest and prices never leave this script.

A market that cannot be computed is left out and renders as "no data".
A layer whose data is older than MAX_AGE_DAYS is removed, also when the
download fails, so a stale reading is never shown.
"""

import datetime as dt
import hashlib
import hmac
import json
import math
import os
import sqlite3
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

LAYERS_DIR = Path(__file__).resolve().parents[1] / "next" / "layers"
S3_HOST = "storage.yandexcloud.net"
S3_REGION = "ru-central1"
DB_KEY = "options_history.db"
DB_MAX_BYTES = 2 * 1024 ** 3
SOURCE = "InvestroLog Options"
TICKERS = ("NG", "CL", "GC", "SI", "CC", "KC")
# The reading is a previous-close one: after a weekend with a holiday it is up to 5 days old.
MAX_AGE_DAYS = 5
MIN_HISTORY = 60  # sessions needed before a percentile means anything
# The expiry week distorts ATM IV and skew, so the front contract needs this many days left.
MIN_DTE = 5
SKEW_UP_MIN = 75  # risk-reversal percentile from which the Options cell votes up
SKEW_DOWN_MAX = 25
VOL_ELEVATED_MIN = 50  # IV percentile: level 1 from here, level 2 from VOL_STRESS_MIN
VOL_STRESS_MIN = 80
HV_DAYS = 20
TERM_GAP = 0.01  # front IV above the next contract by a volatility point reads as backwardation
NOTE_MAX = 240  # same limit as next/matrix.js


def sign(key, message):
    return hmac.new(key, message.encode("utf-8"), hashlib.sha256).digest()


def signed_request(bucket, key, access_key, secret_key, now):
    """A SigV4-signed GET for one object of a private bucket."""
    stamp, day = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
    path = "/" + urllib.parse.quote(f"{bucket}/{key}")
    empty = hashlib.sha256(b"").hexdigest()
    headers = f"host:{S3_HOST}\nx-amz-content-sha256:{empty}\nx-amz-date:{stamp}\n"
    signed = "host;x-amz-content-sha256;x-amz-date"
    canonical = f"GET\n{path}\n\n{headers}\n{signed}\n{empty}"
    scope = f"{day}/{S3_REGION}/s3/aws4_request"
    to_sign = f"AWS4-HMAC-SHA256\n{stamp}\n{scope}\n{hashlib.sha256(canonical.encode()).hexdigest()}"
    signing_key = b"AWS4" + secret_key.encode("utf-8")
    for part in (day, S3_REGION, "s3", "aws4_request"):
        signing_key = sign(signing_key, part)
    signature = hmac.new(signing_key, to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    return urllib.request.Request(f"https://{S3_HOST}{path}", headers={
        "x-amz-date": stamp,
        "x-amz-content-sha256": empty,
        "Authorization": (f"AWS4-HMAC-SHA256 Credential={access_key}/{scope}, "
                          f"SignedHeaders={signed}, Signature={signature}"),
    })


def download(request, target):
    with urllib.request.urlopen(request, timeout=60) as response, open(target, "wb") as out:
        total = 0
        while chunk := response.read(1024 * 1024):
            total += len(chunk)
            if total > DB_MAX_BYTES:
                raise ValueError("database is too large")
            out.write(chunk)


def percentile(values, current):
    """Share of the history at or below the current value, 0..100."""
    return round(100 * sum(v <= current for v in values) / len(values))


def front_series(db, ticker):
    """One row per session: the nearest contract with at least MIN_DTE days left."""
    rows = db.execute(
        "SELECT date, symbol, dte, atm_iv, rr_25, futures_price, flip_strike, flip_quality, pc_oi_ratio "
        "FROM daily_metrics WHERE substr(symbol, 1, length(symbol) - 3) = ? "
        "AND dte >= ? AND atm_iv > 0 ORDER BY date, dte", (ticker, MIN_DTE)).fetchall()
    by_date = {}
    for row in rows:
        by_date.setdefault(row["date"], []).append(row)
    return [(rows[0], rows[1] if len(rows) > 1 else None) for rows in by_date.values()]


def realised_vol(db, symbol, date):
    """Annualised volatility of the last HV_DAYS daily log returns, or None."""
    closes = [row[0] for row in db.execute(
        "SELECT close FROM futures_eod WHERE symbol = ? AND date <= ? AND close > 0 "
        "ORDER BY date DESC LIMIT ?", (symbol, date, HV_DAYS + 1))]
    if len(closes) < HV_DAYS + 1:
        return None
    returns = [math.log(a / b) for a, b in zip(closes, closes[1:])]
    mean = sum(returns) / len(returns)
    variance = sum((r - mean) ** 2 for r in returns) / (len(returns) - 1)
    return math.sqrt(variance * 252)


def fit(parts):
    """Join note sentences per language, dropping trailing ones that do not fit."""
    note = {}
    for lang in ("ru", "en"):
        sentences = [p[lang] for p in parts]
        while len(" ".join(sentences)) > NOTE_MAX:
            sentences.pop()
        note[lang] = " ".join(sentences)
    return note


def options_cell(series):
    front = series[-1][0]
    skews = [row["rr_25"] for row, _ in series if row["rr_25"] is not None]
    if front["rr_25"] is None or len(skews) < MIN_HISTORY:
        return None
    rank = percentile(skews, front["rr_25"])
    signal = 1 if rank >= SKEW_UP_MIN else -1 if rank <= SKEW_DOWN_MAX else 0
    lead = {
        1: {"ru": "Скос в пользу колов: рынок переплачивает за движение вверх.",
            "en": "Skew favours calls: the market pays extra for a move up."},
        -1: {"ru": "Скос в пользу путов: рынок переплачивает за защиту от падения.",
             "en": "Skew favours puts: the market pays extra for downside protection."},
        0: {"ru": "Скос около своей нормы.", "en": "Skew is near its usual level."},
    }[signal]
    parts = [lead, {
        "ru": f"Risk reversal 25Δ — {rank}-й перцентиль за {len(skews)} торг. дн.",
        "en": f"25Δ risk reversal is at percentile {rank} of {len(skews)} sessions.",
    }]
    if front["flip_quality"] == "ok" and front["flip_strike"] and front["futures_price"]:
        parts.append({
            "ru": "Цена выше gamma flip: длинная гамма, движения гасятся.",
            "en": "Price is above the gamma flip: long gamma, moves get dampened.",
        } if front["futures_price"] >= front["flip_strike"] else {
            "ru": "Цена ниже gamma flip: короткая гамма, движения усиливаются.",
            "en": "Price is below the gamma flip: short gamma, moves get amplified.",
        })
    if front["pc_oi_ratio"] is not None:
        ratio = f"{front['pc_oi_ratio']:.1f}"
        parts.append({"ru": f"Путов к колам по открытому интересу: {ratio}.",
                      "en": f"Put/call open interest ratio: {ratio}."})
    return {"signal": signal, "metric": f"RR p{rank}", "note": fit(parts)}


def vol_cell(db, series):
    front, following = series[-1]
    if len(series) < MIN_HISTORY:
        return None
    rank = percentile([row["atm_iv"] for row, _ in series], front["atm_iv"])
    level = 2 if rank >= VOL_STRESS_MIN else 1 if rank >= VOL_ELEVATED_MIN else 0
    implied = round(front["atm_iv"] * 100)
    parts = [{
        "ru": f"ATM IV {implied}% — {rank}-й перцентиль за {len(series)} торг. дн.",
        "en": f"ATM IV {implied}% is at percentile {rank} of {len(series)} sessions.",
    }]
    realised = realised_vol(db, front["symbol"], front["date"])
    if realised is not None:
        parts.append({"ru": f"Историческая за {HV_DAYS} дн. — {round(realised * 100)}%.",
                      "en": f"{HV_DAYS}-day realised is {round(realised * 100)}%."})
    if following is not None and front["atm_iv"] - following["atm_iv"] >= TERM_GAP:
        parts.append({
            "ru": "Ближний контракт дороже следующего: рынок платит за риск ближайших дней.",
            "en": "The front contract is priced above the next one: the market pays for near-term risk.",
        })
    return {"level": level, "metric": f"IV p{rank}", "note": fit(parts)}


def build_layers(db, today):
    """{layer id: layer file} for the layers that have at least one fresh cell."""
    db.row_factory = sqlite3.Row
    cells, dates = {"options": {}, "vol": {}}, {"options": [], "vol": []}
    for ticker in TICKERS:
        try:
            series = front_series(db, ticker)
            if not series:
                raise ValueError("no sessions")
            date = dt.date.fromisoformat(series[-1][0]["date"])
            if not -1 <= (today - date).days <= MAX_AGE_DAYS:
                raise ValueError(f"last session {date} is stale or in the future")
            built = {"options": options_cell(series), "vol": vol_cell(db, series)}
        except (ValueError, TypeError, sqlite3.Error) as error:
            print(f"{ticker}: skipped ({error})")
            continue
        for layer_id, cell in built.items():
            if cell is not None:
                cells[layer_id][ticker] = cell
                dates[layer_id].append(date)
    # One date per layer: the oldest among its cells, so none looks fresher than it is.
    return {
        layer_id: {"schema": 1, "layer": layer_id, "source": SOURCE,
                   "report_date": min(dates[layer_id]).isoformat(), "cells": layer_cells}
        for layer_id, layer_cells in cells.items() if layer_cells
    }


def prune(today, layers_dir=LAYERS_DIR):
    """Remove layer files that are unreadable or older than MAX_AGE_DAYS."""
    for layer_id in ("options", "vol"):
        path = layers_dir / f"{layer_id}.json"
        if not path.exists():
            continue
        try:
            date = dt.date.fromisoformat(json.loads(path.read_text(encoding="utf-8"))["report_date"])
            if (today - date).days <= MAX_AGE_DAYS:
                continue
        except (ValueError, KeyError, TypeError):
            pass
        path.unlink()
        print(f"{layer_id}: removed (stale)")


def write_layers(layers, layers_dir=LAYERS_DIR):
    for layer_id in ("options", "vol"):
        path = layers_dir / f"{layer_id}.json"
        if layer_id not in layers:
            if path.exists():
                path.unlink()
            print(f"{layer_id}: no data")
            continue
        path.write_text(json.dumps(layers[layer_id], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"{layer_id}: {len(layers[layer_id]['cells'])} markets, {layers[layer_id]['report_date']}")


def main():
    today = dt.datetime.now(dt.timezone.utc).date()
    prune(today)
    try:
        bucket, access_key, secret_key = (os.environ[name] for name in (
            "OPTIONS_DB_S3_BUCKET", "OPTIONS_DB_S3_ACCESS_KEY_ID", "OPTIONS_DB_S3_SECRET_ACCESS_KEY"))
    except KeyError as error:
        print(f"Options database access is not configured: {error} is missing.")
        return 1
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "options.db"
        try:
            download(signed_request(bucket, DB_KEY, access_key, secret_key,
                                    dt.datetime.now(dt.timezone.utc)), path)
            db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
            try:
                layers = build_layers(db, today)
            finally:
                db.close()
        except (urllib.error.URLError, TimeoutError, ValueError, sqlite3.Error) as error:
            # HTTPError text carries no credentials; the request headers are never printed.
            print(f"Options database is unavailable: {error}")
            return 1
    write_layers(layers)
    return 0


if __name__ == "__main__":
    sys.exit(main())
