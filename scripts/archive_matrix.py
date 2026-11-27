#!/usr/bin/env python3
"""Keep one snapshot of the matrix per trading day in next/archive/.

A day's file holds what the page showed at the 22:00 UTC cut-off: the side
of every layer for every market, the consensus and the VIX regime. Every
run rewrites the file of the current day; once the cut-off passes, runs
write the next day's file and the finished one is never touched again.
Saturdays and Sundays get no file.

Only what the page already publishes is stored, without the notes.
"""

import datetime as dt
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_DIR = ROOT / "next" / "archive"
SNAPSHOT = "next/snapshot.json"
CUTOFF_HOUR_UTC = 22
MIN_ALIGNED = 4  # same as next/matrix.js
METRIC_MAX = 12
SIDES = {1: "bull", -1: "bear", 0: "flat"}


def read_site_file(path):
    """Text of a file of the site by its path from the root, or None."""
    try:
        return (ROOT / path.lstrip("/")).read_text(encoding="utf-8")
    except OSError:
        return None


def archive_day(now):
    """The trading day a snapshot taken at `now` belongs to, or None on a weekend."""
    day = now.date() + dt.timedelta(days=1 if now.hour >= CUTOFF_HOUR_UTC else 0)
    return day if day.weekday() < 5 else None


def load(read, path):
    try:
        raw = json.loads(read(path) or "")
    except ValueError:
        return None
    return raw if isinstance(raw, dict) else None


def shown(raw, layer_id, today):
    """True if the page would show this layer file on `today`."""
    if not raw or raw.get("schema") != 1 or raw.get("layer") != layer_id:
        return False
    try:
        dt.date.fromisoformat(str(raw.get("report_date")))
    except ValueError:
        return False
    until = raw.get("valid_until")
    return not (isinstance(until, str) and until < today.isoformat())


def metric(value):
    if isinstance(value, str):
        return value if 0 < len(value) <= METRIC_MAX else None
    if isinstance(value, dict) and all(isinstance(v, str) for v in value.values()):
        return value or None
    return None


def cell(raw, votes):
    """The archived cell, or None where the page reads "no data"."""
    if not isinstance(raw, dict):
        return None
    field, allowed = ("signal", (-1, 0, 1)) if votes else ("level", (0, 1, 2))
    value = raw.get(field)
    if isinstance(value, bool) or not isinstance(value, int) or value not in allowed:
        return None
    result = {field: value}
    label = metric(raw.get("metric"))
    if label:
        result["metric"] = label
    return result


def consensus(signals):
    """Mirror of consensus() in next/matrix.js; `signals` holds 1, -1, 0 or None per voting layer."""
    bull, bear = signals.count(1), signals.count(-1)
    lead = max(bull, bear)
    return {
        "bull": bull,
        "bear": bear,
        "lead": lead,
        "total": sum(s is not None for s in signals),
        "dir": "bull" if bull > bear else "bear" if bear > bull else "flat",
        "aligned": lead >= MIN_ALIGNED and min(bull, bear) == 0,
    }


def build(read, now):
    """The snapshot of the matrix as the page shows it at `now`, without date fields."""
    snapshot = load(read, SNAPSHOT)
    if not snapshot or snapshot.get("demo") is not False:
        raise ValueError("snapshot.json is missing or holds demo data")
    today = now.date()
    layers, files = {}, {}
    for layer in snapshot["layers"]:
        raw = load(read, layer["source"]) if layer.get("source") else None
        files[layer["id"]] = raw if shown(raw, layer["id"], today) and isinstance(raw.get("cells"), dict) else None
        layers[layer["id"]] = {
            "votes": layer.get("votes") is True,
            "report_date": files[layer["id"]]["report_date"] if files[layer["id"]] else None,
        }
    markets = {}
    for instrument in snapshot["instruments"]:
        cells = {}
        for layer_id, info in layers.items():
            source = files[layer_id]["cells"] if files[layer_id] else {}
            cells[layer_id] = cell(source.get(instrument["id"]), info["votes"])
        votes = [cells[i]["signal"] if cells[i] else None for i, info in layers.items() if info["votes"]]
        markets[instrument["id"]] = {"cells": cells, "consensus": consensus(votes)}
    regime = load(read, snapshot.get("regime_source") or "")
    if shown(regime, "vix", today):
        regime = {k: regime.get(k) for k in ("report_date", "regime", "curve", "vix_percentile")}
    else:
        regime = None
    return {"layers": layers, "regime": regime, "markets": markets}


def write(read, now, archive_dir=ARCHIVE_DIR):
    """Write the file of the current trading day. Returns a short status string."""
    day = archive_day(now)
    if day is None:
        return "weekend"
    body = build(read, now)
    path = archive_dir / f"{day.isoformat()}.json"
    try:
        previous = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        previous = None
    if previous and {k: previous.get(k) for k in body} == body:
        return f"{day}: unchanged"
    # captured_at is the moment this state of the matrix was first seen.
    document = {
        "schema": 1,
        "date": day.isoformat(),
        "captured_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        **body,
    }
    archive_dir.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return f"{day}: updated"


def main():
    print(write(read_site_file, dt.datetime.now(dt.timezone.utc)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
