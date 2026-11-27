"""Tests for the pure rules of next/matrix.js, run through node."""
import json
import re
import shutil
import subprocess
import unittest
from pathlib import Path

MATRIX_JS = (Path(__file__).resolve().parents[1] / "next" / "matrix.js").read_text(encoding="utf-8")


@unittest.skipUnless(shutil.which("node"), "node is not installed")
class EmptyCalendarDayTest(unittest.TestCase):
    def test_only_a_calendar_written_today_says_the_day_is_empty(self):
        source = re.search(r"    function emptyDay\(events, writtenOn, now\) \{.*?\n    \}\n", MATRIX_JS, re.S).group(0)
        pce = "2026-11-27T13:30:00Z"
        cases = [
            ([], "2026-11-27", "2026-11-27T12:00:00Z", "none"),
            ([], "2026-11-26", "2026-11-27T12:00:00Z", None),       # yesterday's file stays silent
            ([], None, "2026-11-27T12:00:00Z", None),               # no calendar at all
            ([pce], "2026-11-27", "2026-11-27T12:00:00Z", None),    # a release is still ahead
            ([pce], "2026-11-27", "2026-11-27T13:30:00Z", "done"),  # the last release of the day is out
            (["2026-11-26T13:30:00Z"], "2026-11-27", "2026-11-27T12:00:00Z", "none"),
            # 20:30 UTC of the 26th is still the 26th in Moscow, 21:30 UTC is already the 27th
            (["2026-11-26T20:30:00Z"], "2026-11-27", "2026-11-27T05:10:00Z", "none"),
            (["2026-11-26T21:30:00Z"], "2026-11-27", "2026-11-27T05:10:00Z", "done"),
            # after Moscow midnight the file of the past Moscow day no longer speaks for "today"
            ([], "2026-11-27", "2026-11-27T20:59:00Z", "none"),
            ([], "2026-11-27", "2026-11-27T21:00:00Z", None),
            ([pce], "2026-11-27", "2026-11-27T21:30:00Z", None),
        ]
        script = (
            "const mskDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' });\n"
            f"{source}\n"
            "const out = JSON.parse(require('fs').readFileSync(0, 'utf8')).map(([events, day, now]) =>\n"
            "  emptyDay(events.map(at => ({ at: new Date(at) })), day, new Date(now).getTime()));\n"
            "console.log(JSON.stringify(out));\n"
        )
        done = subprocess.run(["node", "-e", script], input=json.dumps([c[:3] for c in cases]),
                              capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(done.stdout), [c[3] for c in cases])


if __name__ == "__main__":
    unittest.main()
