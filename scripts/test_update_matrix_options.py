#!/usr/bin/env python3
"""Offline tests for update_matrix_options.py: python3 scripts/test_update_matrix_options.py"""

import datetime as dt
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

import update_matrix_options as umo

TODAY = dt.date(2026, 11, 23)
LAST = dt.date(2026, 11, 20)


def make_db(sessions=80, skew=lambda n: n, iv=lambda n: 0.2 + n / 1000, last=LAST, ticker="GC", **last_row):
    """A database with `sessions` weekdays for one market; values rise unless told otherwise."""
    db = sqlite3.connect(":memory:")
    db.execute("CREATE TABLE daily_metrics (symbol, date, dte, atm_iv, rr_25, futures_price, "
               "flip_strike, flip_quality, pc_oi_ratio)")
    db.execute("CREATE TABLE futures_eod (symbol, date, close)")
    day, days = last, []
    while len(days) < sessions:
        if day.weekday() < 5:
            days.append(day)
        day -= dt.timedelta(days=1)
    for n, day in enumerate(reversed(days)):
        row = {"dte": 30, "atm_iv": iv(n), "rr_25": skew(n), "futures_price": 100.0,
               "flip_strike": 90.0, "flip_quality": "ok", "pc_oi_ratio": 0.5}
        if n == sessions - 1:
            row.update(last_row)
        db.execute("INSERT INTO daily_metrics VALUES (?,?,?,?,?,?,?,?,?)", (
            f"{ticker}F27", day.isoformat(), row["dte"], row["atm_iv"], row["rr_25"],
            row["futures_price"], row["flip_strike"], row["flip_quality"], row["pc_oi_ratio"]))
        db.execute("INSERT INTO daily_metrics VALUES (?,?,?,?,?,?,?,?,?)", (
            f"{ticker}G27", day.isoformat(), 60, row["atm_iv"] - 0.05, 0.0, 100.0, 90.0, "ok", 1.0))
        db.execute("INSERT INTO futures_eod VALUES (?,?,?)",
                   (f"{ticker}F27", day.isoformat(), 100 + (n % 2)))
    return db


class BuildLayers(unittest.TestCase):
    def cells(self, db, today=TODAY):
        layers = umo.build_layers(db, today)
        return {layer_id: layer["cells"].get("GC") for layer_id, layer in layers.items()}, layers

    def test_highest_skew_and_iv(self):
        cells, layers = self.cells(make_db())
        self.assertEqual(cells["options"]["signal"], 1)
        self.assertEqual(cells["options"]["metric"], "RR p100")
        self.assertEqual(cells["vol"]["level"], 2)
        self.assertEqual(cells["vol"]["metric"], "IV p100")
        self.assertIn("above the gamma flip", cells["options"]["note"]["en"])
        self.assertIn("priced above the next one", cells["vol"]["note"]["en"])
        self.assertIn("20-day realised", cells["vol"]["note"]["en"])
        self.assertEqual(layers["options"]["report_date"], LAST.isoformat())
        self.assertEqual(set(layers["options"]["cells"]), {"GC"})

    def test_lowest_and_middle_skew(self):
        cells, _ = self.cells(make_db(skew=lambda n: -n, iv=lambda n: 0.5 - n / 1000))
        self.assertEqual((cells["options"]["signal"], cells["vol"]["level"]), (-1, 0))
        cells, _ = self.cells(make_db(skew=lambda n: n % 2, rr_25=0.5, futures_price=80.0))
        self.assertEqual(cells["options"]["signal"], 0)
        self.assertIn("below the gamma flip", cells["options"]["note"]["en"])

    def test_dearer_side_follows_the_sign_not_the_rank(self):
        # Always-positive skew at its low: leans to puts versus history, yet calls are still dearer.
        cells, _ = self.cells(make_db(skew=lambda n: 1 - n / 1000))
        self.assertEqual(cells["options"]["signal"], -1)
        self.assertIn("towards puts more than usual", cells["options"]["note"]["en"])
        self.assertIn("Calls are priced above puts", cells["options"]["note"]["en"])
        cells, _ = self.cells(make_db(skew=lambda n: n / 1000 - 1))
        self.assertEqual(cells["options"]["signal"], 1)
        self.assertIn("Puts are priced above calls", cells["options"]["note"]["en"])

    def test_thresholds(self):
        for rank, signal in ((75, 1), (74, 0), (26, 0), (25, -1)):
            # 100 sessions with distinct skews 0..99: the last one sits at the given percentile.
            db = make_db(sessions=100, skew=lambda n: n if n < 99 else -1, rr_25=rank - 1.5)
            cells, _ = self.cells(db)
            self.assertEqual((cells["options"]["metric"], cells["options"]["signal"]), (f"RR p{rank}", signal))

    def test_private_values_stay_out(self):
        _, layers = self.cells(make_db(futures_price=4321.5, flip_strike=4288.25))
        text = json.dumps(layers, ensure_ascii=False)
        for secret in ("4321", "4288", "GCF27", "flip_strike", "futures_price"):
            self.assertNotIn(secret, text)
        for layer in layers.values():
            self.assertEqual(set(layer), {"schema", "layer", "source", "report_date", "cells"})
            for cell in layer["cells"].values():
                self.assertLessEqual(len(cell["metric"]), 12)
                self.assertTrue(all(0 < len(v) <= umo.NOTE_MAX for v in cell["note"].values()))

    def test_short_history_and_missing_values(self):
        self.assertEqual(umo.build_layers(make_db(sessions=umo.MIN_HISTORY - 1), TODAY), {})
        cells, _ = self.cells(make_db(rr_25=None))
        self.assertNotIn("options", cells)
        self.assertEqual(cells["vol"]["metric"], "IV p100")
        cells, _ = self.cells(make_db(flip_quality="weak", pc_oi_ratio=None))
        self.assertNotIn("gamma", cells["options"]["note"]["en"])
        self.assertNotIn("Put/call", cells["options"]["note"]["en"])

    def test_stale_and_expiry_week(self):
        self.assertEqual(umo.build_layers(make_db(), LAST + dt.timedelta(days=umo.MAX_AGE_DAYS + 1)), {})
        self.assertIn("vol", umo.build_layers(make_db(), LAST + dt.timedelta(days=umo.MAX_AGE_DAYS)))
        # In the expiry week the next contract becomes the front one.
        cells, _ = self.cells(make_db(dte=umo.MIN_DTE - 1))
        self.assertIn("ratio: 1.0", cells["options"]["note"]["en"])
        self.assertNotIn("realised", cells["vol"]["note"]["en"])
        self.assertNotIn("priced above the next one", cells["vol"]["note"]["en"])

    def test_empty_database(self):
        db = make_db(sessions=0)
        self.assertEqual(umo.build_layers(db, TODAY), {})


class Files(unittest.TestCase):
    def test_prune_and_write(self):
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            (folder / "options.json").write_text(json.dumps({"report_date": "2026-11-10"}))
            (folder / "vol.json").write_text(json.dumps({"report_date": LAST.isoformat()}))
            umo.prune(TODAY, folder)
            self.assertEqual([p.name for p in folder.iterdir()], ["vol.json"])
            (folder / "options.json").write_text("not json")
            umo.prune(TODAY, folder)
            self.assertEqual([p.name for p in folder.iterdir()], ["vol.json"])
            layers = umo.build_layers(make_db(rr_25=None), TODAY)
            (folder / "options.json").write_text("{}")
            umo.write_layers(layers, folder)
            self.assertEqual([p.name for p in folder.iterdir()], ["vol.json"])
            self.assertEqual(json.loads((folder / "vol.json").read_text(encoding="utf-8"))["layer"], "vol")

    def test_signature_is_stable(self):
        request = umo.signed_request("bucket", "options_history.db", "KEY", "SECRET",
                                     dt.datetime(2026, 11, 23, 4, 40, tzinfo=dt.timezone.utc))
        self.assertEqual(request.full_url, "https://storage.yandexcloud.net/bucket/options_history.db")
        auth = request.get_header("Authorization")
        self.assertIn("Credential=KEY/20261123/ru-central1/s3/aws4_request", auth)
        self.assertNotIn("SECRET", auth)
        self.assertRegex(auth, r"Signature=[0-9a-f]{64}$")


if __name__ == "__main__":
    unittest.main()
