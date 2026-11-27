"""Tests for the weekly letter: the week it covers, its text, and who receives it."""

import datetime as dt
import json
import pathlib
import unittest

import subscribe_function as sub
import weekly_letter_function as weekly

ARCHIVE = pathlib.Path(__file__).resolve().parent.parent / "next" / "archive"
SECRET = "test-secret"
MONDAY = dt.date(2026, 11, 23)


def utc(*parts):
    return dt.datetime(*parts, tzinfo=dt.timezone.utc)


def state(direction, lead=2, total=5, aligned=False):
    return {"dir": direction, "lead": lead, "total": total, "aligned": aligned,
            "bull": lead if direction == "bull" else 0, "bear": lead if direction == "bear" else 0}


def snapshot(date, **markets):
    return {"schema": 1, "date": date, "regime": {"regime": "stress", "vix_percentile": 92},
            "markets": {market: {"consensus": markets.get(market, state("flat", 1))} for market in weekly.MARKETS}}


def archive(*snapshots):
    files = {f"{item['date']}.json": item for item in snapshots}
    files["index.json"] = {"schema": 1, "days": [item["date"] for item in snapshots]}
    return files.get


class FakeBucket:
    def __init__(self, objects=None):
        self.objects = dict(objects or {})

    def get(self, key):
        value = self.objects.get(key)
        return json.loads(json.dumps(value)) if value is not None else None

    def put(self, key, value):
        self.objects[key] = value

    def delete(self, key):
        self.objects.pop(key, None)

    def keys(self, prefix):
        return sorted(key for key in self.objects if key.startswith(prefix))


def member(email, status="active", lang="ru"):
    return f"subscribers/{sub.address_id(email)}.json", {"email": email, "lang": lang, "status": status}


class WeekStart(unittest.TestCase):
    def test_weekend_run_covers_the_week_that_just_ended(self):
        self.assertEqual(weekly.week_start(utc(2026, 11, 28, 7)), MONDAY)   # Saturday 10:00 Moscow
        self.assertEqual(weekly.week_start(utc(2026, 11, 29, 20)), MONDAY)  # Sunday evening

    def test_weekday_run_covers_the_previous_week(self):
        self.assertEqual(weekly.week_start(utc(2026, 11, 30, 7)), MONDAY)
        self.assertEqual(weekly.week_start(utc(2026, 12, 4, 20)), MONDAY)

    def test_the_day_is_taken_by_moscow_time(self):
        # Friday 22:00 UTC is already Saturday in Moscow.
        self.assertEqual(weekly.week_start(utc(2026, 11, 27, 22)), MONDAY)
        self.assertEqual(weekly.week_start(utc(2026, 11, 27, 20)), MONDAY - dt.timedelta(days=7))


class ReadWeek(unittest.TestCase):
    def test_missing_days_stay_empty(self):
        week = weekly.read_week(archive(snapshot("2026-11-23"), snapshot("2026-11-25")), MONDAY)
        self.assertEqual([bool(day) for day in week["days"]], [True, False, True, False, False])

    def test_no_snapshots_means_no_letter(self):
        self.assertIsNone(weekly.read_week(archive(snapshot("2026-11-16")), MONDAY))
        self.assertIsNone(weekly.read_week(lambda name: None, MONDAY))

    def test_a_snapshot_with_another_date_inside_is_ignored(self):
        files = {"index.json": {"days": ["2026-11-23"]}, "2026-11-23.json": snapshot("2026-11-20")}
        self.assertIsNone(weekly.read_week(files.get, MONDAY))

    def test_broken_consensus_becomes_an_empty_cell(self):
        for broken in (None, {}, {"dir": "up", "lead": 1, "total": 5}, {"dir": "bull", "lead": 6, "total": 5},
                       {"dir": "bull", "lead": "2", "total": 5}, {"dir": "bull", "lead": 0, "total": 0}):
            week = weekly.read_week(archive(snapshot("2026-11-23", NG=broken)), MONDAY)
            self.assertIsNone(week["days"][0]["NG"])
            self.assertIsNotNone(week["days"][0]["CL"])

    def test_flat_is_never_aligned(self):
        week = weekly.read_week(archive(snapshot("2026-11-23", NG=state("flat", 4, 5, aligned=True))), MONDAY)
        self.assertFalse(week["days"][0]["NG"]["aligned"])


class Letter(unittest.TestCase):
    def week(self, *snapshots):
        return weekly.read_week(archive(*snapshots), MONDAY)

    def render(self, week, lang="ru"):
        return weekly.render_weekly(week, lang, "https://investrolog.pro/next/?unsubscribe=T#subscribe")

    def test_quiet_week(self):
        subject, plain, page = self.render(self.week(snapshot("2026-11-27")))
        self.assertEqual(subject, "Матрица за неделю: 23–27 ноября")
        self.assertIn("За неделю слои не сошлись ни по одному рынку.", plain)
        self.assertIn("За неделю слои не сошлись ни по одному рынку.", page)

    def test_alignment_that_is_gone_by_the_end(self):
        week = self.week(snapshot("2026-11-24", NG=state("bull", 4, 5, True), CC=state("bull", 4, 5, True)),
                         snapshot("2026-11-27"))
        _, plain, _ = self.render(week)
        self.assertIn("Слои сошлись: газ\u00a0— в рост (вт); какао\u00a0— в рост (вт). "
                      "К концу недели согласия нет ни по одному рынку.", plain)
        _, plain, _ = self.render(week, "en")
        self.assertIn("Layers aligned: nat gas\u00a0— up (tue); cocoa\u00a0— up (tue). "
                      "By the end of the week no market has consensus.", plain)

    def test_alignment_that_holds(self):
        week = self.week(snapshot("2026-11-25", GC=state("bear", 5, 5, True)),
                         snapshot("2026-11-26", GC=state("bear", 4, 5, True)))
        _, plain, _ = self.render(week)
        self.assertIn("Слои сошлись: золото\u00a0— в снижение (ср, чт). "
                      "На конец недели согласие держится: золото\u00a0— в снижение.", plain)

    def test_last_column_is_named_after_the_last_day_with_data(self):
        _, _, page = self.render(self.week(snapshot("2026-11-23"), snapshot("2026-11-26", CL=state("bear", 3, 5))))
        self.assertIn(">Четверг</td>", page)
        self.assertNotIn(">Пятница</td>", page)
        self.assertIn("▼&nbsp;3/5", page)

    def test_week_across_two_months(self):
        monday = dt.date(2026, 11, 30)
        week = weekly.read_week(archive(snapshot("2026-12-01")), monday)
        self.assertEqual(self.render(week)[0], "Матрица за неделю: 30 ноября – 4 декабря")
        self.assertEqual(self.render(week, "en")[0], "Matrix for the week: 30 November – 4 December")

    def test_regime_block_is_dropped_without_a_known_regime(self):
        raw = snapshot("2026-11-27")
        raw["regime"] = {"regime": "panic"}
        _, plain, page = self.render(self.week(raw))
        self.assertNotIn("Режим волатильности", plain)
        self.assertNotIn("Режим волатильности", page)
        _, plain, _ = self.render(self.week(snapshot("2026-11-27")))
        self.assertIn("Режим волатильности: стресс · VIX на 92-м перцентиле", plain)

    def test_links(self):
        _, plain, page = self.render(self.week(snapshot("2026-11-27")), "en")
        self.assertIn('href="https://investrolog.pro/next/en/"', page)
        self.assertIn('href="https://investrolog.pro/next/?unsubscribe=T#subscribe"', page)
        self.assertIn("Unsubscribe: https://investrolog.pro/next/?unsubscribe=T#subscribe", plain)

    def test_real_archive_renders(self):
        def fetch(name):
            path = ARCHIVE / name
            return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None
        days = fetch("index.json")["days"]
        monday = dt.date.fromisoformat(days[-1])
        monday -= dt.timedelta(days=monday.weekday())
        week = weekly.read_week(fetch, monday)
        for lang in ("ru", "en"):
            subject, plain, page = self.render(week, lang)
            self.assertTrue(subject and plain)
            self.assertEqual(page.count("<tr>") + page.count("<tr "), page.count("</tr>"))


class Sending(unittest.TestCase):
    def setUp(self):
        self.week = weekly.read_week(archive(snapshot("2026-11-27")), MONDAY)
        self.sent = []

    def send(self, to, subject, plain, page, link):
        self.sent.append((to, subject, link))

    def run_week(self, bucket, send=None, **options):
        return weekly.send_week(self.week, bucket, bucket.keys, send or self.send, SECRET, **options)

    def test_only_active_subscribers_get_the_letter(self):
        bucket = FakeBucket([member("a@example.com"), member("b@example.com", "unsubscribed"),
                             member("c@example.com", lang="en")])
        bucket.put(f"pending/{sub.address_id('d@example.com')}.json", {"email": "d@example.com"})
        done = self.run_week(bucket)
        self.assertEqual(sorted(to for to, _, _ in self.sent), ["a@example.com", "c@example.com"])
        self.assertEqual((done["sent"], done["inactive"]), (2, 1))
        subjects = {to: subject for to, subject, _ in self.sent}
        self.assertTrue(subjects["c@example.com"].startswith("Matrix for the week"))
        self.assertTrue(subjects["a@example.com"].startswith("Матрица за неделю"))

    def test_second_run_sends_nothing(self):
        bucket = FakeBucket([member("a@example.com")])
        self.run_week(bucket)
        done = self.run_week(bucket)
        self.assertEqual(len(self.sent), 1)
        self.assertEqual((done["sent"], done["already"]), (0, 1))

    def test_another_week_is_sent_again(self):
        bucket = FakeBucket([member("a@example.com")])
        self.run_week(bucket)
        self.week = weekly.read_week(archive(snapshot("2026-12-01")), dt.date(2026, 11, 30))
        self.run_week(bucket)
        self.assertEqual(len(self.sent), 2)

    def test_failed_letter_is_retried_by_the_next_run(self):
        bucket = FakeBucket([member("a@example.com"), member("b@example.com")])

        def flaky(to, *rest):
            if to == "a@example.com":
                raise OSError("postbox is down")
            self.send(to, *rest)
        done = self.run_week(bucket, send=flaky)
        self.assertEqual((done["sent"], done["failed"]), (1, 1))
        done = self.run_week(bucket)
        self.assertEqual((done["sent"], done["already"]), (1, 1))
        self.assertEqual(sorted(to for to, _, _ in self.sent), ["a@example.com", "b@example.com"])

    def test_run_stops_at_the_limit_and_reports_the_rest(self):
        bucket = FakeBucket([member(f"u{n}@example.com") for n in range(5)])
        done = self.run_week(bucket, limit=3)
        self.assertEqual((done["sent"], done["left"]), (3, 2))
        done = self.run_week(bucket, limit=3)
        self.assertEqual((done["sent"], done["already"], done["left"]), (2, 3, 0))

    def test_unsubscribe_link_of_the_letter_works(self):
        key, record = member("a@example.com", lang="en")
        bucket = FakeBucket([(key, record)])
        self.run_week(bucket)
        link = self.sent[0][2]
        self.assertTrue(link.startswith("https://investrolog.pro/next/en/?unsubscribe="))
        token = link.split("unsubscribe=")[1].split("#")[0]
        self.assertEqual(sub.follow_link("unsubscribe", token, utc(2027, 6, 1), bucket, SECRET), "unsubscribed")
        self.sent.clear()
        self.week = weekly.read_week(archive(snapshot("2026-12-01")), dt.date(2026, 11, 30))
        self.run_week(bucket)
        self.assertEqual(self.sent, [])

    def test_record_without_a_valid_address_is_skipped(self):
        bucket = FakeBucket({"subscribers/x.json": {"status": "active", "email": "broken"}})
        self.assertEqual(self.run_week(bucket)["inactive"], 1)
        self.assertEqual(self.sent, [])

    def test_run_stops_before_the_deadline_and_leaves_no_marker(self):
        bucket = FakeBucket([member(f"u{n}@example.com") for n in range(3)])
        clock = iter([True, False, False])
        done = self.run_week(bucket, has_time=lambda: next(clock))
        self.assertEqual((done["sent"], done["left"]), (1, 2))
        self.assertEqual((self.run_week(bucket)["sent"], len(self.sent)), (2, 3))


class Calling(unittest.TestCase):
    TIMER = {"messages": [{"event_metadata": {"event_type": weekly.TIMER_EVENT}, "details": {"trigger_id": "t"}}]}

    def test_only_a_timer_or_an_explicit_command_sends_to_everyone(self):
        self.assertEqual(weekly._request(self.TIMER), {"send": "all"})
        self.assertEqual(weekly._request({"send": "all"}).get("send"), "all")
        for event in ({}, None, "x", {"messages": []}, {"messages": [{"event_metadata": {"event_type": "other"}}]}):
            self.assertNotEqual(weekly._request(event).get("send"), "all")

    def test_https_call_is_unwrapped(self):
        wrapped = {"httpMethod": "POST", "body": '{"test_to": "a@example.com"}', "isBase64Encoded": False}
        self.assertEqual(weekly._request(wrapped), {"test_to": "a@example.com"})
        packed = {"httpMethod": "POST", "body": "eyJ0ZXN0X3RvIjogImFAZXhhbXBsZS5jb20ifQ==", "isBase64Encoded": True}
        self.assertEqual(weekly._request(packed), {"test_to": "a@example.com"})
        for body in ("", "not json", "[]", None):
            self.assertEqual(weekly._request({"httpMethod": "POST", "body": body}), {})

    def test_unknown_call_sends_nothing(self):
        for event in ({}, {"httpMethod": "POST", "body": ""}, {"lang": "en"}):
            self.assertEqual(weekly.handler(event, None)["ok"], False)


if __name__ == "__main__":
    unittest.main()
