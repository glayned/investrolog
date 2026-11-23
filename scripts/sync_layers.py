#!/usr/bin/env python3
"""Copy public matrix layer files from the layers bucket into next/layers/.

The matrix page only reads same-origin /next/layers/*.json. Each module
publishes its layer to a public bucket; this script fetches it, keeps
nothing but the fields the page uses, and writes it next to the site.
A layer that is missing, malformed or stale is removed, so its column
reads "no data" instead of showing an old signal.
"""

import argparse
import datetime as dt
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LAYERS_DIR = ROOT / "next" / "layers"
BUCKET_URL = "https://storage.yandexcloud.net/investrolog-matrix-layers/layers"
# Layer id -> days after report_date for which the file is still shown.
# MOEX is a previous-close reading: after a weekend it is up to 4 days old.
LAYERS = {"sentiment": 2, "levels": 3, "flow": 3, "moex": 5}
# Layers published as one file per ticker (<layer>/<ticker>.json): each
# instrument of the module is a separate process.
SPLIT_LAYERS = {"flow", "moex"}
# Context layers do not vote: their cells carry level 0..2 instead of a signal.
CONTEXT_LAYERS = {"moex"}
TICKERS = ("NG", "CL", "GC", "SI", "CC", "KC")
MAX_BYTES = 64 * 1024
METRIC_MAX = 12  # same limits as next/matrix.js
NOTE_MAX = 240
SOURCE_MAX = 24
# The "next on the calendar" strip: not a matrix column, a list of events.
CALENDAR_ID = "calendar"
CALENDAR_MAX_AGE_DAYS = 8  # published weekly on Sunday, refreshed every weekday morning
EVENTS_MAX = 40
# The VIX regime strip: not a matrix column, one reading for the whole page.
REGIME_ID = "vix"
REGIME_MAX_AGE_DAYS = 4  # published after each US close: Friday's reading is shown until Tuesday
REGIMES = {"calm", "neutral", "caution", "stress"}
CURVES = {"contango", "flat", "spot_stress", "backwardation"}
EVENT_TITLE_MAX = 60
EVENT_ASSET_MAX = 24


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": "InvestroLog-Layer-Sync/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        body = response.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise ValueError("layer file is too large")
    return json.loads(body.decode("utf-8"))


def clean_text(value, limit):
    """A plain string or a {ru, en} pair within the page's length limit."""
    if isinstance(value, str):
        return value if 0 < len(value) <= limit else None
    if isinstance(value, dict) and set(value) == {"ru", "en"}:
        if all(isinstance(v, str) and 0 < len(v) <= limit for v in value.values()):
            return {"ru": value["ru"], "en": value["en"]}
    return None


def clean_header(raw, layer_id, max_age_days, today):
    """(source, report_date) of a layer file with the expected id and age."""
    if not isinstance(raw, dict) or raw.get("schema") != 1 or raw.get("layer") != layer_id:
        raise ValueError("unexpected schema or layer id")
    report_date = dt.date.fromisoformat(str(raw.get("report_date")))
    age = (today - report_date).days
    if not -1 <= age <= max_age_days:
        raise ValueError(f"report_date {report_date} is stale or in the future")
    source = raw.get("source")
    if not isinstance(source, str) or not 0 < len(source) <= SOURCE_MAX:
        raise ValueError("bad source")
    return source, report_date


def clean_calendar(raw, layer_id, max_age_days, today):
    """Validated copy of the calendar file: a title, a market and a UTC time per event."""
    source, report_date = clean_header(raw, layer_id, max_age_days, today)
    events = raw.get("events")
    if not isinstance(events, list) or len(events) > EVENTS_MAX:
        raise ValueError("events must be a short list")
    clean_events = []
    for event in events:
        if not isinstance(event, dict):
            raise ValueError("bad event")
        title = clean_text(event.get("title"), EVENT_TITLE_MAX)
        asset = clean_text(event.get("asset"), EVENT_ASSET_MAX)
        at = event.get("at")
        if title is None or asset is None or not isinstance(at, str):
            raise ValueError("bad event")
        dt.datetime.strptime(at, "%Y-%m-%dT%H:%M:%SZ")
        clean_events.append({"title": title, "asset": asset, "at": at})
    return {
        "schema": 1,
        "layer": layer_id,
        "source": source,
        "report_date": report_date.isoformat(),
        "events": clean_events,
    }


def clean_regime(raw, layer_id, max_age_days, today):
    """Validated copy of the VIX regime file: a regime step, a curve shape and a percentile."""
    source, report_date = clean_header(raw, layer_id, max_age_days, today)
    regime, curve, rank = raw.get("regime"), raw.get("curve"), raw.get("vix_percentile")
    if regime not in REGIMES or curve not in CURVES:
        raise ValueError("bad regime or curve")
    if isinstance(rank, bool) or not isinstance(rank, int) or not 0 <= rank <= 100:
        raise ValueError("bad percentile")
    return {
        "schema": 1,
        "layer": layer_id,
        "source": source,
        "report_date": report_date.isoformat(),
        "regime": regime,
        "curve": curve,
        "vix_percentile": rank,
    }


CLEANERS = {CALENDAR_ID: clean_calendar, REGIME_ID: clean_regime}


def clean_layer(raw, layer_id, max_age_days, today):
    """Validated copy of a layer with only the fields the page reads."""
    source, report_date = clean_header(raw, layer_id, max_age_days, today)
    cells = raw.get("cells")
    if not isinstance(cells, dict):
        raise ValueError("cells must be an object")
    clean_cells = {}
    for ticker in TICKERS:
        cell = cells.get(ticker)
        if cell is None:
            continue
        field, allowed = ("level", (0, 1, 2)) if layer_id in CONTEXT_LAYERS else ("signal", (-1, 0, 1))
        if not isinstance(cell, dict) or cell.get(field) not in allowed:
            raise ValueError(f"bad cell for {ticker}")
        if isinstance(cell[field], bool):
            raise ValueError(f"bad {field} for {ticker}")
        clean = {field: cell[field]}
        for field, limit in (("metric", METRIC_MAX), ("note", NOTE_MAX)):
            if field in cell:
                text = clean_text(cell[field], limit)
                if text is None:
                    raise ValueError(f"bad {field} for {ticker}")
                clean[field] = text
        clean_cells[ticker] = clean
    if not clean_cells:
        raise ValueError("no cells")
    return {
        "schema": 1,
        "layer": layer_id,
        "source": source,
        "report_date": report_date.isoformat(),
        "cells": clean_cells,
    }


def fetch_split(base_url, layer_id, max_age_days, today):
    """One layer assembled from per-ticker files; stale or bad files are skipped.

    The page shows one date per layer, so the layer takes the oldest date
    among its cells: no cell is presented as fresher than it is.
    """
    cells, source, oldest = {}, None, None
    for ticker in TICKERS:
        try:
            raw = fetch(f"{base_url}/{layer_id}/{ticker}.json")
            if not isinstance(raw, dict) or raw.get("ticker") != ticker:
                raise ValueError("unexpected ticker")
            part = clean_layer(
                {**raw, "cells": {ticker: raw.get("cell")}}, layer_id, max_age_days, today)
        except (urllib.error.URLError, TimeoutError, ValueError, UnicodeDecodeError) as error:
            print(f"{layer_id}/{ticker}: skipped ({error})")
            continue
        cells.update(part["cells"])
        if oldest is None or part["report_date"] < oldest:
            source, oldest = part["source"], part["report_date"]
    if not cells:
        raise ValueError("no ticker files")
    return {"schema": 1, "layer": layer_id, "source": source, "report_date": oldest, "cells": cells}


def sync(layer_id, max_age_days, today, base_url=BUCKET_URL, layers_dir=LAYERS_DIR):
    """Write or remove one layer file. Returns a short status string."""
    path = layers_dir / f"{layer_id}.json"
    try:
        if layer_id in SPLIT_LAYERS:
            raw = fetch_split(base_url, layer_id, max_age_days, today)
        else:
            raw = fetch(f"{base_url}/{layer_id}.json")
        layer = CLEANERS.get(layer_id, clean_layer)(raw, layer_id, max_age_days, today)
    except (urllib.error.URLError, TimeoutError, ValueError, UnicodeDecodeError) as error:
        if path.exists():
            path.unlink()
            return f"removed ({error})"
        return f"absent ({error})"
    text = json.dumps(layer, ensure_ascii=False, indent=2) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return "unchanged"
    path.write_text(text, encoding="utf-8")
    return "updated"


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base-url", default=BUCKET_URL)
    args = parser.parse_args()
    today = dt.datetime.now(dt.timezone.utc).date()
    for layer_id, max_age_days in {
        **LAYERS, CALENDAR_ID: CALENDAR_MAX_AGE_DAYS, REGIME_ID: REGIME_MAX_AGE_DAYS,
    }.items():
        print(f"{layer_id}: {sync(layer_id, max_age_days, today, args.base_url)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
