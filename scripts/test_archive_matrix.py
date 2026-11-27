import datetime as dt
import itertools
import json
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import archive_matrix as am

UTC = dt.timezone.utc
MATRIX_JS = (am.ROOT / "next" / "matrix.js").read_text(encoding="utf-8")


def site(layers=None, demo=False):
    files = {
        "next/snapshot.json": {
            "schema": 1, "demo": demo,
            "layers": [
                {"id": "cot", "votes": True, "source": "/next/layers/cot.json"},
                {"id": "flow", "votes": True, "source": "/next/layers/flow.json"},
                {"id": "moex", "votes": False, "source": "/next/layers/moex.json"},
            ],
            "instruments": [{"id": "NG", "name": "Nat Gas"}, {"id": "GC", "name": "Gold"}],
            "regime_source": "/next/layers/vix.json",
        },
    }
    for layer_id, body in (layers or {}).items():
        files[f"next/layers/{layer_id}.json"] = {"schema": 1, "layer": layer_id, **body}
    return lambda path: json.dumps(files[path.lstrip("/")]) if path.lstrip("/") in files else None


class ArchiveDayTest(unittest.TestCase):
    def test_the_day_ends_at_the_cutoff(self):
        friday = dt.datetime(2026, 11, 27, 21, 59, tzinfo=UTC)
        self.assertEqual(am.archive_day(friday), dt.date(2026, 11, 27))
        self.assertEqual(am.archive_day(dt.datetime(2026, 11, 26, 22, 0, tzinfo=UTC)), dt.date(2026, 11, 27))

    def test_weekend_has_no_file(self):
        self.assertIsNone(am.archive_day(dt.datetime(2026, 11, 27, 22, 0, tzinfo=UTC)))
        self.assertIsNone(am.archive_day(dt.datetime(2026, 11, 29, 21, 59, tzinfo=UTC)))
        self.assertEqual(am.archive_day(dt.datetime(2026, 11, 29, 22, 0, tzinfo=UTC)), dt.date(2026, 11, 30))


class BuildTest(unittest.TestCase):
    NOW = dt.datetime(2026, 11, 25, 12, 0, tzinfo=UTC)

    def test_cells_consensus_and_regime(self):
        read = site({
            "cot": {"report_date": "2026-11-17",
                    "cells": {"NG": {"signal": 1, "metric": "p1", "note": "long text"}, "GC": {"signal": 0}}},
            "flow": {"report_date": "2026-11-24", "valid_until": "2026-11-27", "cells": {"NG": {"signal": -1}}},
            "moex": {"report_date": "2026-11-24", "cells": {"NG": {"level": 2, "metric": "x"}}},
            "vix": {"report_date": "2026-11-24", "valid_until": "2026-11-28", "regime": "stress",
                    "curve": "backwardation", "vix_percentile": 92, "source": "VIX"},
        })
        result = am.build(read, self.NOW)
        ng = result["markets"]["NG"]
        self.assertEqual(ng["cells"], {"cot": {"signal": 1, "metric": "p1"}, "flow": {"signal": -1},
                                       "moex": {"level": 2, "metric": "x"}})
        self.assertEqual(ng["consensus"], {"bull": 1, "bear": 1, "lead": 1, "total": 2,
                                           "dir": "flat", "aligned": False})
        self.assertEqual(result["markets"]["GC"]["cells"], {"cot": {"signal": 0}, "flow": None, "moex": None})
        self.assertEqual(result["layers"]["flow"], {"votes": True, "report_date": "2026-11-24"})
        self.assertEqual(result["regime"], {"report_date": "2026-11-24", "regime": "stress",
                                            "curve": "backwardation", "vix_percentile": 92})

    def test_expired_or_missing_layer_reads_as_no_data(self):
        read = site({"cot": {"report_date": "2026-11-17", "valid_until": "2026-11-24",
                             "cells": {"NG": {"signal": 1}}}})
        result = am.build(read, self.NOW)
        self.assertIsNone(result["markets"]["NG"]["cells"]["cot"])
        self.assertIsNone(result["layers"]["cot"]["report_date"])
        self.assertIsNone(result["regime"])
        self.assertEqual(result["markets"]["NG"]["consensus"]["total"], 0)

    def test_demo_snapshot_is_refused(self):
        with self.assertRaises(ValueError):
            am.build(site(demo=True), self.NOW)


class WriteTest(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.dir = Path(self.folder.name)

    def test_rewrites_only_when_the_matrix_changed(self):
        cot = {"report_date": "2026-11-17", "cells": {"NG": {"signal": 1}}}
        first = dt.datetime(2026, 11, 25, 12, 0, tzinfo=UTC)
        self.assertEqual(am.write(site({"cot": cot}), first, self.dir), "2026-11-25: updated")
        later = first + dt.timedelta(hours=1)
        self.assertEqual(am.write(site({"cot": cot}), later, self.dir), "2026-11-25: unchanged")
        saved = json.loads((self.dir / "2026-11-25.json").read_text(encoding="utf-8"))
        self.assertEqual(saved["captured_at"], "2026-11-25T12:00:00Z")
        cot["cells"]["NG"]["signal"] = -1
        self.assertEqual(am.write(site({"cot": cot}), later, self.dir), "2026-11-25: updated")

    def test_after_the_cutoff_the_finished_day_is_left_alone(self):
        cot = {"report_date": "2026-11-17", "cells": {"NG": {"signal": 1}}}
        am.write(site({"cot": cot}), dt.datetime(2026, 11, 25, 21, 45, tzinfo=UTC), self.dir)
        before = (self.dir / "2026-11-25.json").read_text(encoding="utf-8")
        cot["cells"]["NG"]["signal"] = -1
        am.write(site({"cot": cot}), dt.datetime(2026, 11, 25, 22, 5, tzinfo=UTC), self.dir)
        self.assertEqual((self.dir / "2026-11-25.json").read_text(encoding="utf-8"), before)
        self.assertTrue((self.dir / "2026-11-26.json").exists())

    def test_index_lists_the_archived_days(self):
        cot = {"report_date": "2026-11-17", "cells": {"NG": {"signal": 1}}}
        am.write(site({"cot": cot}), dt.datetime(2026, 11, 25, 12, 0, tzinfo=UTC), self.dir)
        am.write(site({"cot": cot}), dt.datetime(2026, 11, 26, 12, 0, tzinfo=UTC), self.dir)
        index = json.loads((self.dir / "index.json").read_text(encoding="utf-8"))
        self.assertEqual(index, {"schema": 1, "days": ["2026-11-25", "2026-11-26"]})

    def test_weekend_writes_nothing(self):
        status = am.write(site(), dt.datetime(2026, 11, 28, 12, 0, tzinfo=UTC), self.dir)
        self.assertEqual(status, "weekend")
        self.assertEqual(list(self.dir.iterdir()), [])


class SamePageRuleTest(unittest.TestCase):
    def test_min_aligned_matches_the_page(self):
        self.assertEqual(int(re.search(r"const ARCHIVE_CUTOFF_HOUR_UTC = (\d+);", MATRIX_JS).group(1)),
                         am.CUTOFF_HOUR_UTC)
        self.assertEqual(int(re.search(r"const MIN_ALIGNED = (\d+);", MATRIX_JS).group(1)), am.MIN_ALIGNED)

    @unittest.skipUnless(shutil.which("node"), "node is not installed")
    def test_consensus_matches_the_page_on_every_combination(self):
        source = re.search(r"    function consensus\(instrument, voting\) \{.*?\n    \}\n", MATRIX_JS, re.S).group(0)
        combos = list(itertools.product((1, -1, 0, None), repeat=6))
        script = (
            f"const MIN_ALIGNED = {am.MIN_ALIGNED};\n{source}\n"
            "const names = {1: 'bull', '-1': 'bear', 0: 'flat', null: 'na'};\n"
            "const out = JSON.parse(require('fs').readFileSync(0, 'utf8')).map(combo => {\n"
            "  const cells = {}; combo.forEach((s, i) => { cells[i] = { state: names[s] }; });\n"
            "  const c = consensus({ cells }, combo.map((_, i) => ({ id: i })));\n"
            "  return { bull: c.bull, bear: c.bear, lead: c.lead, total: c.total, dir: c.dir, aligned: c.aligned };\n"
            "});\nconsole.log(JSON.stringify(out));\n"
        )
        done = subprocess.run(["node", "-e", script], input=json.dumps(combos),
                              capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(done.stdout), [am.consensus(list(c)) for c in combos])

    @unittest.skipUnless(shutil.which("node"), "node is not installed")
    def test_the_page_compares_with_the_last_finished_day(self):
        source = re.search(r"    function previousDay\(days, now\) \{.*?\n    \}\n", MATRIX_JS, re.S).group(0)
        days = ["2026-11-19", "2026-11-20", "2026-11-23", "2026-11-24"]
        cases = [
            ("2026-11-20T21:59:00Z", days[:2], "2026-11-19"),  # Friday before the cut-off
            ("2026-11-20T22:00:00Z", days[:2], "2026-11-20"),  # Friday evening: the day is finished
            ("2026-11-22T12:00:00Z", days[:2], "2026-11-20"),  # Sunday
            ("2026-11-23T08:00:00Z", days[:2], "2026-11-20"),  # Monday before its first snapshot
            ("2026-11-23T21:59:00Z", days[:3], "2026-11-20"),  # Monday: its own file is not "previous"
            ("2026-11-23T22:00:00Z", days[:3], "2026-11-23"),
            ("2026-11-23T22:10:00Z", days, "2026-11-23"),      # Tuesday's file already exists
            ("2026-11-19T12:00:00Z", days[:1], None),          # nothing earlier
            ("2026-11-23T12:00:00Z", ["junk", 5, None], None),
            ("2026-11-23T12:00:00Z", None, None),
        ]
        script = (
            f"const ARCHIVE_CUTOFF_HOUR_UTC = {am.CUTOFF_HOUR_UTC};\n{source}\n"
            "const out = JSON.parse(require('fs').readFileSync(0, 'utf8'))"
            ".map(([now, days]) => previousDay(days, new Date(now)));\n"
            "console.log(JSON.stringify(out));\n"
        )
        done = subprocess.run(["node", "-e", script], input=json.dumps([c[:2] for c in cases]),
                              capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(done.stdout), [c[2] for c in cases])
        # The writer and the page agree on which day is still open
        for now, _, _ in cases:
            moment = dt.datetime.fromisoformat(now.replace("Z", "+00:00"))
            open_day = am.archive_day(moment)
            if open_day:
                self.assertNotEqual(str(open_day), json.loads(done.stdout)[[c[0] for c in cases].index(now)])


if __name__ == "__main__":
    unittest.main()
