#!/usr/bin/env python3
"""Build the COT layer of the consensus matrix (next/layers/cot.json) from CFTC data.

A market that cannot be computed is left out of the layer and renders as
"no data" on the page, so one bad contract never blocks the others.
"""

import json
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from update_cot import LOOKBACK_WEEKS, fetch_json, percentile_rank


LAYER_PATH = Path(__file__).resolve().parents[1] / "next" / "layers" / "cot.json"
# Same reading as cot_terminal: crowded speculative positioning is a contrarian signal.
CROWDED_SHORT_MAX = 20
CROWDED_LONG_MIN = 80
REPORTS = {
    "disaggregated": {
        "url": "https://publicreporting.cftc.gov/resource/72hh-3qpy.json",
        "long": "m_money_positions_long_all",
        "short": "m_money_positions_short_all",
        "group": {"ru": "управляющих", "en": "Managed money"},
    },
    "tff": {
        "url": "https://publicreporting.cftc.gov/resource/gpe5-46if.json",
        "long": "lev_money_positions_long",
        "short": "lev_money_positions_short",
        "group": {"ru": "хедж-фондов", "en": "Leveraged funds"},
    },
}
CONTRACTS = {
    "NG": ("023651", "disaggregated"),
    "CL": ("067651", "disaggregated"),
    "GC": ("088691", "disaggregated"),
    "SI": ("084691", "disaggregated"),
    "CC": ("073732", "disaggregated"),
    "KC": ("083731", "disaggregated"),
    "BTC": ("133741", "tff"),
}


def fetch_history(code, report, today):
    cutoff = today - timedelta(days=6 * 366)
    rows = fetch_json(report["url"], {
        "$select": f"report_date_as_yyyy_mm_dd,{report['long']},{report['short']}",
        "$where": (
            f"cftc_contract_market_code='{code}' AND "
            f"report_date_as_yyyy_mm_dd >= '{cutoff.isoformat()}T00:00:00.000'"
        ),
        "$order": "report_date_as_yyyy_mm_dd DESC",
        "$limit": "400",
    })
    history = {}
    for row in rows:
        report_date = date.fromisoformat(row["report_date_as_yyyy_mm_dd"][:10])
        if report_date in history:
            raise ValueError(f"duplicate report for {report_date}")
        history[report_date] = int(row[report["long"]]) - int(row[report["short"]])
    latest = sorted(history.items(), reverse=True)[:LOOKBACK_WEEKS]
    if len(latest) != LOOKBACK_WEEKS:
        raise ValueError(f"expected {LOOKBACK_WEEKS} reports, received {len(latest)}")
    return latest


def build_cell(percentile, group):
    if percentile <= CROWDED_SHORT_MAX:
        signal = 1
        note = {
            "ru": (f"Нетто-позиция {group['ru']} у нижней границы пятилетнего диапазона: "
                   "шорты перегружены, это аргумент в пользу отскока."),
            "en": (f"{group['en']} net position is near the bottom of its five-year range: "
                   "shorts are crowded, which argues for a rebound."),
        }
    elif percentile >= CROWDED_LONG_MIN:
        signal = -1
        note = {
            "ru": (f"Нетто-позиция {group['ru']} у верхней границы пятилетнего диапазона: "
                   "лонги перегружены, это аргумент в пользу разворота вниз."),
            "en": (f"{group['en']} net position is near the top of its five-year range: "
                   "longs are crowded, which argues for a reversal down."),
        }
    else:
        signal = 0
        note = {
            "ru": f"Нетто-позиция {group['ru']} внутри пятилетнего диапазона, перекоса нет.",
            "en": f"{group['en']} net position is inside its five-year range, no skew.",
        }
    return {"signal": signal, "metric": f"p{percentile}", "note": note}


def build_layer(today):
    computed = {}
    for symbol, (code, report_type) in CONTRACTS.items():
        report = REPORTS[report_type]
        try:
            history = fetch_history(code, report, today)
        except Exception as error:  # one contract must not block the rest
            print(f"{symbol}: skipped ({error})")
            continue
        percentile = percentile_rank([position for _, position in history])
        computed[symbol] = (history[0][0], build_cell(percentile, report["group"]))

    if not computed:
        raise RuntimeError("No COT contract could be computed")
    report_date = Counter(day for day, _ in computed.values()).most_common(1)[0][0]
    cells = {}
    for symbol, (day, cell) in computed.items():
        if day == report_date:
            cells[symbol] = cell
        else:
            print(f"{symbol}: skipped (report {day}, expected {report_date})")
    return {
        "schema": 1,
        "layer": "cot",
        "source": "CFTC",
        "report_date": report_date.isoformat(),
        "cells": cells,
    }


def main():
    layer = build_layer(datetime.now(timezone.utc).date())
    payload = json.dumps(layer, ensure_ascii=False, indent=2) + "\n"
    LAYER_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not LAYER_PATH.exists() or LAYER_PATH.read_text(encoding="utf-8") != payload:
        LAYER_PATH.write_text(payload, encoding="utf-8")
    values = " · ".join(f"{symbol} {cell['metric']}" for symbol, cell in layer["cells"].items())
    print(f"COT layer {layer['report_date']}: {values}")


if __name__ == "__main__":
    main()
