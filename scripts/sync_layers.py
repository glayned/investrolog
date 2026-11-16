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
LAYERS = {"sentiment": 2}
TICKERS = ("NG", "CL", "GC", "SI", "CC", "KC", "BTC")
MAX_BYTES = 64 * 1024
METRIC_MAX = 12  # same limits as next/matrix.js
NOTE_MAX = 240
SOURCE_MAX = 24


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


def clean_layer(raw, layer_id, max_age_days, today):
    """Validated copy of a layer with only the fields the page reads."""
    if not isinstance(raw, dict) or raw.get("schema") != 1 or raw.get("layer") != layer_id:
        raise ValueError("unexpected schema or layer id")
    report_date = dt.date.fromisoformat(str(raw.get("report_date")))
    age = (today - report_date).days
    if not -1 <= age <= max_age_days:
        raise ValueError(f"report_date {report_date} is stale or in the future")
    source = raw.get("source")
    if not isinstance(source, str) or not 0 < len(source) <= SOURCE_MAX:
        raise ValueError("bad source")
    cells = raw.get("cells")
    if not isinstance(cells, dict):
        raise ValueError("cells must be an object")
    clean_cells = {}
    for ticker in TICKERS:
        cell = cells.get(ticker)
        if cell is None:
            continue
        if not isinstance(cell, dict) or cell.get("signal") not in (-1, 0, 1):
            raise ValueError(f"bad cell for {ticker}")
        if isinstance(cell["signal"], bool):
            raise ValueError(f"bad signal for {ticker}")
        clean = {"signal": cell["signal"]}
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


def sync(layer_id, max_age_days, today, base_url=BUCKET_URL, layers_dir=LAYERS_DIR):
    """Write or remove one layer file. Returns a short status string."""
    path = layers_dir / f"{layer_id}.json"
    try:
        layer = clean_layer(fetch(f"{base_url}/{layer_id}.json"), layer_id, max_age_days, today)
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
    for layer_id, max_age_days in LAYERS.items():
        print(f"{layer_id}: {sync(layer_id, max_age_days, today, args.base_url)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
