import datetime as dt
import unittest

import sync_trigger as st

UTC = dt.timezone.utc
LISTING = b"""<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>bucket</Name><Prefix>layers/</Prefix><KeyCount>2</KeyCount>
  <Contents><Key>layers/sentiment.json</Key><LastModified>2026-11-23T10:20:12.345Z</LastModified><Size>1626</Size></Contents>
  <Contents><Key>layers/flow/NG.json</Key><LastModified>2026-11-23T10:00:01.000Z</LastModified><Size>400</Size></Contents>
</ListBucketResult>"""


def at(hour, minute, second=0):
    return dt.datetime(2026, 11, 23, hour, minute, second, tzinfo=UTC)


class SyncTriggerTest(unittest.TestCase):
    def setUp(self):
        self.modified = st.parse_listing(LISTING)

    def test_listing(self):
        self.assertEqual(self.modified["layers/flow/NG.json"], at(10, 0, 1))
        self.assertEqual(len(self.modified), 2)
        self.assertEqual(st.parse_listing(b"<ListBucketResult><KeyCount>0</KeyCount></ListBucketResult>"), {})

    def test_change_is_seen_by_the_next_tick_only(self):
        flow = {"layers/flow/NG.json": self.modified["layers/flow/NG.json"]}
        self.assertEqual(st.changed_keys(flow, at(10, 5)), ["layers/flow/NG.json"])
        self.assertEqual(st.changed_keys(flow, at(10, 25)), [])
        self.assertEqual(st.changed_keys(self.modified, at(10, 25)), ["layers/sentiment.json"])
        self.assertEqual(st.changed_keys(self.modified, at(10, 45)), [])

    def test_every_write_falls_into_some_tick(self):
        ticks = [at(10, 5), at(10, 25), at(10, 45), at(11, 5)]
        for second in range(0, 3600, 7):
            written = at(10, 5) + dt.timedelta(seconds=second)
            self.assertTrue(
                any(st.changed_keys({"k": written}, tick) for tick in ticks if tick >= written))

    def test_workflows(self):
        self.assertEqual(st.workflows_due(self.modified, at(10, 25)), [st.SYNC_WORKFLOW])
        self.assertEqual(st.workflows_due(self.modified, at(10, 45)), [])
        self.assertEqual(st.workflows_due({}, at(4, 45, 30)), [st.OPTIONS_WORKFLOW])
        self.assertEqual(st.workflows_due({}, at(8, 46)), [st.OPTIONS_WORKFLOW])
        for hour, minute in ((4, 5), (4, 25), (5, 45), (9, 5)):
            self.assertEqual(st.workflows_due({}, at(hour, minute)), [])

    def test_failed_listing_does_not_hold_back_options(self):
        self.assertEqual(st.workflows_due(None, at(4, 45)), [st.OPTIONS_WORKFLOW])
        self.assertEqual(st.workflows_due(None, at(10, 25)), [])


class HandlerTest(unittest.TestCase):
    """The handler with the network calls replaced."""

    class Context:
        token = {"access_token": "iam"}

    def setUp(self):
        self.saved = st.list_layers, st.dispatch, st.dt, dict(st.os.environ)
        st.os.environ.update(LAYERS_BUCKET="bucket", GITHUB_REPO="o/r", GITHUB_TOKEN="t")
        self.started = []
        st.dispatch = lambda repo, workflow, token: self.started.append(workflow)

    def tearDown(self):
        st.list_layers, st.dispatch, st.dt, env = self.saved
        st.os.environ.clear()
        st.os.environ.update(env)

    def clock(self, now):
        class Clock(dt.datetime):
            @classmethod
            def now(cls, tz=None):
                return now

        class Module:
            datetime, timezone, timedelta = Clock, dt.timezone, dt.timedelta

        st.dt = Module

    def test_failed_listing_still_starts_options_and_reports(self):
        def fail(bucket, token):
            raise OSError("storage is down")

        st.list_layers = fail
        self.clock(at(8, 45))
        with self.assertRaises(RuntimeError):
            st.handler({}, self.Context())
        self.assertEqual(self.started, [st.OPTIONS_WORKFLOW])

    def test_one_failed_dispatch_does_not_stop_the_other(self):
        def dispatch(repo, workflow, token):
            if workflow == st.SYNC_WORKFLOW:
                raise RuntimeError("GitHub answered 500")
            self.started.append(workflow)

        st.dispatch = dispatch
        st.list_layers = lambda bucket, token: {"layers/moex/NG.json": at(4, 30)}
        self.clock(at(4, 45))
        with self.assertRaises(RuntimeError):
            st.handler({}, self.Context())
        self.assertEqual(self.started, [st.OPTIONS_WORKFLOW])

    def test_quiet_tick_starts_nothing(self):
        st.list_layers = lambda bucket, token: {"layers/moex/NG.json": at(4, 30)}
        self.clock(at(10, 25))
        self.assertEqual(st.handler({}, self.Context())["statusCode"], 200)
        self.assertEqual(self.started, [])


if __name__ == "__main__":
    unittest.main()
