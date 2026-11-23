import datetime as dt
import http.client
import http.server
import json
import tempfile
import threading
import unittest
import urllib.error
from pathlib import Path

import sync_layers as sl

TODAY = dt.date(2026, 11, 23)
BASE = "https://bucket.example/layers"


def layer(layer_id, date=TODAY, cells=None):
    return {"schema": 1, "layer": layer_id, "source": "Module", "report_date": date.isoformat(),
            "cells": cells or {"NG": {"signal": 1, "metric": "m", "note": "n"}}}


def part(layer_id, ticker, date=TODAY, signal=1):
    return {"schema": 1, "layer": layer_id, "ticker": ticker, "source": "Module",
            "report_date": date.isoformat(), "cell": {"signal": signal}}


def not_found(url):
    return urllib.error.HTTPError(url, 404, "Not Found", None, None)


class SyncTest(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.dir = Path(self.folder.name)
        self.saved = sl.fetch
        self.responses = {}

        def fetch(url):
            answer = self.responses.get(url, not_found(url))
            if isinstance(answer, Exception):
                raise answer
            return answer

        sl.fetch = fetch

    def tearDown(self):
        sl.fetch = self.saved
        self.folder.cleanup()

    def sync(self, layer_id, max_age_days=2, today=TODAY):
        return sl.sync(layer_id, max_age_days, today, BASE, self.dir)

    def read(self, layer_id):
        return json.loads((self.dir / f"{layer_id}.json").read_text(encoding="utf-8"))

    def test_written_file_carries_the_last_day_it_may_be_shown(self):
        self.responses[f"{BASE}/sentiment.json"] = layer("sentiment")
        self.assertEqual(self.sync("sentiment"), "updated")
        self.assertEqual(self.read("sentiment")["valid_until"], "2026-11-25")
        self.assertEqual(self.sync("sentiment"), "unchanged")

    def test_missing_malformed_or_stale_file_is_removed(self):
        for answer in (not_found("x"), {"schema": 2}, layer("sentiment", TODAY - dt.timedelta(days=3))):
            self.responses[f"{BASE}/sentiment.json"] = layer("sentiment")
            self.sync("sentiment")
            self.responses[f"{BASE}/sentiment.json"] = answer
            self.assertTrue(self.sync("sentiment").startswith("removed"))
            self.assertFalse((self.dir / "sentiment.json").exists())
        self.assertTrue(self.sync("sentiment").startswith("absent"))

    def test_silent_bucket_keeps_the_copy_until_it_is_stale(self):
        self.responses[f"{BASE}/sentiment.json"] = layer("sentiment")
        self.sync("sentiment")
        before = (self.dir / "sentiment.json").read_text(encoding="utf-8")
        self.responses[f"{BASE}/sentiment.json"] = sl.Unavailable("HTTP 503")
        self.assertTrue(self.sync("sentiment").startswith("kept"))
        self.assertEqual((self.dir / "sentiment.json").read_text(encoding="utf-8"), before)
        late = TODAY + dt.timedelta(days=3)
        self.assertTrue(self.sync("sentiment", today=late).startswith("removed"))
        self.assertTrue(self.sync("sentiment", today=late).startswith("absent"))

    def test_split_layer_keeps_the_cell_of_a_ticker_that_did_not_answer(self):
        yesterday = TODAY - dt.timedelta(days=1)
        self.responses[f"{BASE}/flow/NG.json"] = part("flow", "NG", yesterday)
        self.responses[f"{BASE}/flow/CL.json"] = part("flow", "CL", yesterday, signal=-1)
        self.sync("flow", 3, yesterday)
        self.responses[f"{BASE}/flow/NG.json"] = part("flow", "NG", TODAY, signal=0)
        self.responses[f"{BASE}/flow/CL.json"] = sl.Unavailable("TimeoutError")
        self.assertEqual(self.sync("flow", 3), "updated")
        result = self.read("flow")
        self.assertEqual(result["cells"], {"NG": {"signal": 0}, "CL": {"signal": -1}})
        # The kept cell is a day old, so the layer may not claim today's date.
        self.assertEqual(result["report_date"], yesterday.isoformat())

    def test_split_layer_drops_a_removed_ticker_and_a_stale_kept_cell(self):
        old = TODAY - dt.timedelta(days=3)
        self.responses[f"{BASE}/flow/NG.json"] = part("flow", "NG", old)
        self.responses[f"{BASE}/flow/CL.json"] = part("flow", "CL", old)
        self.sync("flow", 3, old)
        self.responses[f"{BASE}/flow/NG.json"] = part("flow", "NG", TODAY)
        del self.responses[f"{BASE}/flow/CL.json"]  # 404: the module took the file down
        self.sync("flow", 3)
        self.assertEqual(set(self.read("flow")["cells"]), {"NG"})
        self.responses[f"{BASE}/flow/NG.json"] = sl.Unavailable("HTTP 500")
        late = TODAY + dt.timedelta(days=4)  # the copy on the site is stale by now
        self.assertTrue(self.sync("flow", 3, late).startswith("removed"))


class FetchTest(unittest.TestCase):
    def setUp(self):
        self.saved = sl.urllib.request.urlopen

    def tearDown(self):
        sl.urllib.request.urlopen = self.saved

    def answer(self, error):
        def urlopen(request, timeout):
            raise error

        sl.urllib.request.urlopen = urlopen

    def test_only_404_means_the_file_is_gone(self):
        self.answer(not_found("x"))
        with self.assertRaises(urllib.error.HTTPError):
            sl.fetch("https://x")
        for error in (urllib.error.HTTPError("x", 503, "Unavailable", None, None),
                      urllib.error.URLError("no route"), TimeoutError(),
                      ConnectionResetError(), http.client.IncompleteRead(b"{")):
            self.answer(error)
            with self.assertRaises(sl.Unavailable):
                sl.fetch("https://x")

    def test_response_cut_short_is_not_a_malformed_file(self):
        class Response:
            def __init__(self, body, declared):
                self.body, self.headers = body, {"Content-Length": declared}

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def read(self, amount):
                return self.body[:amount]

        whole = json.dumps(layer("sentiment")).encode("utf-8")
        sl.urllib.request.urlopen = lambda request, timeout: Response(whole[:40], str(len(whole)))
        with self.assertRaises(sl.Unavailable):
            sl.fetch("https://x")
        sl.urllib.request.urlopen = lambda request, timeout: Response(whole, str(len(whole)))
        self.assertEqual(sl.fetch("https://x")["layer"], "sentiment")
        big = b" " * (sl.MAX_BYTES + 10)
        sl.urllib.request.urlopen = lambda request, timeout: Response(big, str(len(big)))
        with self.assertRaises(ValueError):
            sl.fetch("https://x")


class DisconnectTest(unittest.TestCase):
    """A real server that promises a whole file and hangs up after the first bytes."""

    def test_sync_keeps_the_fresh_copy_when_the_connection_drops(self):
        whole = json.dumps(layer("sentiment")).encode("utf-8")
        sent = []

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.send_header("Content-Length", str(len(whole)))
                self.end_headers()
                self.wfile.write(whole if sent else whole[:40])
                sent.append(self.path)

            def log_message(self, *args):
                pass

        server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{server.server_address[1]}"
        try:
            with tempfile.TemporaryDirectory() as folder:
                copy = Path(folder) / "sentiment.json"
                # First request is cut short and nothing is on the site yet: no file appears.
                self.assertTrue(sl.sync("sentiment", 2, TODAY, base, Path(folder)).startswith("absent"))
                self.assertEqual(sl.sync("sentiment", 2, TODAY, base, Path(folder)), "updated")
                before = copy.read_text(encoding="utf-8")
                sent.clear()
                self.assertEqual(
                    sl.sync("sentiment", 2, TODAY, base, Path(folder)), "kept (truncated response)")
                self.assertEqual(copy.read_text(encoding="utf-8"), before)
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    unittest.main()
