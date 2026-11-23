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


if __name__ == "__main__":
    unittest.main()
