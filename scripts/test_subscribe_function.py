import datetime as dt
import json
import re
import unittest
import urllib.parse

import subscribe_function as sf

SECRET = "test-secret"
URL = "https://functions.example/f1"
NOW = dt.datetime(2026, 11, 27, 12, 0, tzinfo=dt.timezone.utc)


class FakeBucket:
    def __init__(self):
        self.objects = {}
        self.puts = 0

    def get(self, key):
        value = self.objects.get(key)
        return json.loads(value) if value else None

    def put(self, key, value):
        self.puts += 1
        self.objects[key] = json.dumps(value)

    def delete(self, key):
        del self.objects[key]


class Flow(unittest.TestCase):
    def setUp(self):
        self.bucket = FakeBucket()
        self.letters = []

    def send(self, to, subject, plain, page):
        self.letters.append((to, subject, plain, page))

    def submit(self, email="Trader@Example.com", now=NOW, source="1.2.3.4", **extra):
        sf.subscribe({"email": email, **extra}, source, now, self.bucket, self.send, SECRET, URL)

    def record(self, email="trader@example.com"):
        return self.bucket.get(f"subscribers/{sf.address_id(email)}.json")

    def request(self, email="trader@example.com"):
        return self.bucket.get(f"pending/{sf.address_id(email)}.json")

    def link(self, letter=-1):
        found = re.search(r"https://functions\.example/f1\?\S+", self.letters[letter][2]).group(0)
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(found).query)
        return query["action"][0], query["token"][0]

    def follow(self, now=NOW, letter=-1):
        action, token = self.link(letter)
        return sf.follow_link(action, token, now, self.bucket, SECRET)

    def test_new_address_gets_one_confirmation_letter(self):
        self.submit(lang="en")
        self.assertEqual(len(self.letters), 1)
        to, subject, plain, page = self.letters[0]
        self.assertEqual(to, "Trader@example.com")
        self.assertEqual(subject, "Confirm your matrix subscription")
        self.assertIn("action=confirm", plain)
        self.assertIn("Confirm subscription", page)
        self.assertIsNone(self.record())
        self.assertEqual(self.request()["email"], "Trader@example.com")

    def test_russian_is_the_default_language(self):
        self.submit()
        self.assertEqual(self.letters[0][1], "Подтвердите подписку на матрицу")

    def test_confirmation_activates_the_address(self):
        self.submit()
        self.assertEqual(self.follow(), ("confirmed", "ru"))
        self.assertEqual(self.record()["status"], "active")
        self.assertIsNone(self.request())
        # A second click, or a mail scanner, changes nothing.
        self.assertEqual(self.follow(), ("confirmed", "ru"))

    def test_link_expires_after_48_hours(self):
        self.submit()
        self.assertEqual(self.follow(NOW + dt.timedelta(hours=47, minutes=59))[0], "confirmed")
        self.setUp()
        self.submit()
        self.assertEqual(self.follow(NOW + dt.timedelta(hours=48, minutes=1))[0], "expired")
        self.assertIsNone(self.record())

    def test_forged_and_foreign_tokens_are_refused(self):
        self.submit()
        action, token = self.link()
        for bad in (token[:-2] + "xx", token.replace("confirm", "unsubscribe", 1), "", "a.b.c.d",
                    sf.make_token("other-secret", "confirm", sf.address_id("trader@example.com"), NOW + sf.CONFIRM_TTL)):
            self.assertEqual(sf.follow_link("confirm", bad, NOW, self.bucket, SECRET)[0], "expired")
        self.assertEqual(sf.follow_link("unsubscribe", token, NOW, self.bucket, SECRET)[0], "expired")
        self.assertIsNone(self.record())

    def test_repeat_inside_ten_minutes_sends_nothing(self):
        self.submit()
        self.submit(now=NOW + dt.timedelta(minutes=9))
        self.assertEqual(len(self.letters), 1)
        self.submit(now=NOW + dt.timedelta(minutes=11))
        self.assertEqual(len(self.letters), 2)

    def test_known_address_gets_the_same_answer_and_an_unsubscribe_letter(self):
        self.submit()
        self.follow()
        self.submit(now=NOW + dt.timedelta(hours=1))  # no exception: the form answers as for a new address
        self.assertEqual(self.letters[-1][1], "Вы уже подписаны на матрицу")
        self.assertEqual(self.record()["status"], "active")
        self.assertEqual(self.follow(NOW + dt.timedelta(days=400))[0], "unsubscribed")
        self.assertEqual(self.record()["status"], "unsubscribed")

    def test_unsubscribed_address_can_subscribe_again_but_old_link_is_dead(self):
        self.submit()
        self.follow()
        self.submit(now=NOW + dt.timedelta(hours=1))
        self.follow()
        self.assertEqual(self.follow(letter=0)[0], "expired")
        self.submit(now=NOW + dt.timedelta(hours=2))
        self.assertEqual(self.follow(NOW + dt.timedelta(hours=2))[0], "confirmed")
        self.assertEqual(self.record()["status"], "active")

    def test_case_and_spaces_do_not_make_a_second_record(self):
        self.submit("  trader@EXAMPLE.com ")
        self.submit("TRADER@example.com", now=NOW + dt.timedelta(minutes=30))
        records = [key for key in self.bucket.objects if key.startswith("pending/")]
        self.assertEqual(len(records), 1)

    def test_bad_addresses_are_refused_without_a_record(self):
        for bad in ("", "trader", "trader@", "@example.com", "a b@example.com", "a@b", "a@b.c",
                    "a@example.com, b@example.com", "x" * 250 + "@example.com", None, 5):
            with self.assertRaises(sf.Refused) as caught:
                self.submit(bad)
            self.assertEqual(caught.exception.status, 400, bad)
        self.assertEqual(self.bucket.objects, {})
        self.assertEqual(self.letters, [])

    def test_filled_trap_field_is_dropped_silently(self):
        self.submit(website="http://spam")
        self.assertEqual(self.bucket.objects, {})
        self.assertEqual(self.letters, [])

    def test_one_source_is_limited_per_hour(self):
        for n in range(sf.PER_SOURCE_HOURLY):
            self.submit(f"t{n}@example.com")
        with self.assertRaises(sf.Refused) as caught:
            self.submit("more@example.com")
        self.assertEqual(caught.exception.status, 429)
        self.submit("other@example.com", source="5.6.7.8")
        self.submit("later@example.com", now=NOW + dt.timedelta(hours=1))
        self.assertEqual(len(self.letters), sf.PER_SOURCE_HOURLY + 2)

    def test_letters_are_capped_per_day(self):
        for n in range(sf.DAILY_LETTERS):
            self.submit(f"t{n}@example.com", source=f"s{n}")
        with self.assertRaises(sf.Refused):
            self.submit("more@example.com", source="fresh")
        self.assertIsNone(self.request("more@example.com"))
        self.submit("more@example.com", source="fresh", now=NOW + dt.timedelta(days=1))
        self.assertEqual(len(self.letters), sf.DAILY_LETTERS + 1)

    def test_source_address_is_not_stored(self):
        self.submit(source="203.0.113.77")
        self.assertNotIn("203.0.113.77", json.dumps(self.bucket.objects))

    def test_failed_send_is_reported_to_the_caller(self):
        def broken(*_):
            raise OSError("postbox down")
        with self.assertRaises(OSError):
            sf.subscribe({"email": "t@example.com"}, "s", NOW, self.bucket, broken, SECRET, URL)


class Letter(unittest.TestCase):
    def test_link_is_escaped_and_both_languages_render(self):
        for lang in ("ru", "en"):
            for kind in ("confirm", "known"):
                subject, plain, page = sf.render_letter(kind, lang, "https://f/?action=x&token=a.b")
                self.assertTrue(subject)
                self.assertIn("https://f/?action=x&amp;token=a.b", page)
                self.assertIn("https://f/?action=x&token=a.b", plain)
                self.assertNotIn("{", page)

    def test_landing_pages(self):
        self.assertEqual(sf.landing("confirmed", "ru"), "https://investrolog.pro/next/?subscription=confirmed#subscribe")
        self.assertEqual(sf.landing("expired", "en"), "https://investrolog.pro/next/en/?subscription=expired#subscribe")


class Http(unittest.TestCase):
    def test_cors_only_for_the_site(self):
        ours = sf._answer(200, {}, "https://investrolog.pro")["headers"]
        self.assertEqual(ours["Access-Control-Allow-Origin"], "https://investrolog.pro")
        self.assertNotIn("Access-Control-Allow-Origin", sf._answer(200, {}, "https://evil.example")["headers"])

    def test_preflight_needs_no_cloud_access(self):
        answer = sf.handler({"httpMethod": "OPTIONS", "headers": {"Origin": "https://investrolog.pro"}}, None)
        self.assertEqual(answer["statusCode"], 204)


if __name__ == "__main__":
    unittest.main()
