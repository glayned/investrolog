"""Collect email subscriptions for the matrix with confirmation by email.

The site is static, so the form on /next/ posts to this Yandex Cloud
Function. It is not run from this repository: it is released by hand, like
`sync_trigger.py`.

    POST ?action=subscribe    {"email", "lang", "website"}  -> confirmation email
    POST ?action=confirm      {"token"}                     -> address becomes active
    POST ?action=unsubscribe  {"token"}                     -> address is switched off

Links in letters lead to the site, and the page posts the token here. A
plain GET changes nothing, so a mail scanner that opens every link does not
confirm or cancel a subscription for the recipient.

Addresses live in a private bucket, one object per address, named by the
hash of the address: `pending/` until the link is followed, `subscribers/`
after. A lifecycle rule of the bucket deletes `pending/` objects after 30
days and the `limits/` counters after a day. Nothing about subscribers
reaches the repository or the site. The answer to `subscribe` is the same for a new and for a known
address, so the form cannot be used to learn who is subscribed.

Links carry no state: a token is the address hash, a purpose and an expiry
time signed with TOKEN_SECRET.

Environment: SUBSCRIBERS_BUCKET, TOKEN_SECRET, and optionally MAIL_FROM. The bucket and Postbox are called with the IAM token of the
function's service account.
"""

import base64
import datetime as dt
import hashlib
import hmac
import html
import http.client
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

STORAGE_URL = "https://storage.yandexcloud.net"
POSTBOX_URL = "https://postbox.cloud.yandex.net/v2/email/outbound-emails"
SITE = "https://investrolog.pro"
ORIGINS = (SITE, "https://www.investrolog.pro")
MAIL_FROM = "MarketMatrix <matrix@investrolog.pro>"
TIMEOUT_SEC = 10

EMAIL_MAX = 254
EMAIL_RE = re.compile(r"^[^\s@<>\"',;]+@[^\s@<>\"',;]+\.[^\s@<>\"',;.]{2,}$")
CONFIRM_TTL = dt.timedelta(hours=48)
# A second request for the same address inside this window sends nothing.
RESEND_AFTER = dt.timedelta(minutes=10)
# Requests from one network address per hour, and letters per day: the form
# must not become a way to flood strangers' inboxes or spend the Postbox quota.
PER_SOURCE_HOURLY = 5
DAILY_LETTERS = 150

TEXT = {
    "ru": {
        "confirm_subject": "Подтвердите подписку на матрицу",
        "confirm_title": "Подтвердите подписку",
        "confirm_lead": "Этот адрес оставили на investrolog.pro, чтобы получать матрицу сырьевых рынков на почту.",
        "confirm_button": "Подтвердить подписку",
        "confirm_note": "Ссылка действует 48 часов. Если адрес оставили не вы, ничего не делайте: без подтверждения писем не будет.",
        "known_subject": "Вы уже подписаны на матрицу",
        "known_title": "Вы уже подписаны",
        "known_lead": "Этот адрес снова оставили на investrolog.pro. Подписка действует, делать ничего не нужно.",
        "known_button": "Отписаться",
        "known_note": "Если подписка больше не нужна, нажмите кнопку выше.",
    },
    "en": {
        "confirm_subject": "Confirm your matrix subscription",
        "confirm_title": "Confirm your subscription",
        "confirm_lead": "This address was entered on investrolog.pro to receive the commodity matrix by email.",
        "confirm_button": "Confirm subscription",
        "confirm_note": "The link is valid for 48 hours. If this was not you, do nothing: without confirmation no emails will be sent.",
        "known_subject": "You are already subscribed to the matrix",
        "known_title": "You are already subscribed",
        "known_lead": "This address was entered on investrolog.pro again. The subscription is active, nothing else is needed.",
        "known_button": "Unsubscribe",
        "known_note": "If you no longer want the emails, use the button above.",
    },
}

LETTER = """<!doctype html><html lang="{lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>{subject}</title></head>
<body style="margin:0;background:#0b0b0c;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0b0c;"><tr><td align="center" style="padding:28px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;border:1px solid #2a2a2c;background:#111112;">
<tr><td style="padding:22px 26px 0;font:600 11px/1.4 'IBM Plex Mono',Consolas,monospace;letter-spacing:2px;color:#8a8a8a;">INVESTROLOG × DATAMATRIX</td></tr>
<tr><td style="padding:16px 26px 0;font:700 20px/1.25 Arial,Helvetica,sans-serif;color:#f2f2f2;">{title}</td></tr>
<tr><td style="padding:12px 26px 0;font:15px/1.6 Arial,Helvetica,sans-serif;color:#b8b8b8;">{lead}</td></tr>
<tr><td style="padding:22px 26px 0;"><a href="{link}" style="display:inline-block;padding:13px 22px;background:#f2f2f2;color:#0b0b0c;font:700 14px/1 Arial,Helvetica,sans-serif;text-decoration:none;">{button}</a></td></tr>
<tr><td style="padding:22px 26px 24px;font:13px/1.6 Arial,Helvetica,sans-serif;color:#8a8a8a;">{note}</td></tr>
<tr><td style="padding:14px 26px;border-top:1px solid #2a2a2c;font:11px/1.5 'IBM Plex Mono',Consolas,monospace;letter-spacing:.4px;color:#6f6f6f;">investrolog.pro/next</td></tr>
</table></td></tr></table></body></html>"""


class Refused(Exception):
    """A request that gets an HTTP error instead of a letter."""

    def __init__(self, status, code):
        super().__init__(code)
        self.status = status
        self.code = code


def normalize_email(value):
    """The address in the form it is stored and hashed, or None."""
    if not isinstance(value, str):
        return None
    email = value.strip()
    if not email or len(email) > EMAIL_MAX or not EMAIL_RE.match(email):
        return None
    local, _, domain = email.rpartition("@")
    return f"{local}@{domain.lower()}"


def address_id(email):
    # Mailbox names are case-insensitive in practice: one person, one record.
    return hashlib.sha256(email.lower().encode("utf-8")).hexdigest()


def _b64(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def make_token(secret, purpose, ident, expires=None):
    stamp = int(expires.timestamp()) if expires else 0
    payload = f"{purpose}.{ident}.{stamp}"
    sign = hmac.new(secret.encode("utf-8"), payload.encode("ascii"), hashlib.sha256).digest()
    return f"{payload}.{_b64(sign)}"


def read_token(secret, token, purpose, now):
    """(address hash, expiry stamp) from a valid token; None if forged, foreign or expired."""
    parts = token.split(".") if isinstance(token, str) else []
    if len(parts) != 4 or parts[0] != purpose:
        return None
    try:
        stamp = int(parts[2])
    except ValueError:
        return None
    payload = ".".join(parts[:3])
    sign = hmac.new(secret.encode("utf-8"), payload.encode("ascii"), hashlib.sha256).digest()
    if not hmac.compare_digest(_b64(sign), parts[3]):
        return None
    if stamp and now.timestamp() > stamp:
        return None
    if not re.fullmatch(r"[0-9a-f]{64}", parts[1]):
        return None
    return parts[1], stamp


def render_letter(kind, lang, link):
    text = TEXT[lang]
    fields = {name: text[f"{kind}_{name}"] for name in ("subject", "title", "lead", "button", "note")}
    page = LETTER.format(lang=lang, link=html.escape(link, quote=True),
                         **{name: html.escape(value) for name, value in fields.items()})
    plain = f"{fields['title']}\n\n{fields['lead']}\n\n{fields['button']}: {link}\n\n{fields['note']}\n"
    return fields["subject"], plain, page


class Bucket:
    """JSON objects in the private bucket."""

    def __init__(self, name, iam_token):
        self.base = f"{STORAGE_URL}/{urllib.parse.quote(name)}/"
        self.headers = {"X-YaCloud-SubjectToken": iam_token}

    def get(self, key):
        request = urllib.request.Request(self.base + key, headers=self.headers)
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_SEC) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return None
            raise

    def put(self, key, value):
        request = urllib.request.Request(
            self.base + key, method="PUT",
            data=json.dumps(value, ensure_ascii=False).encode("utf-8"),
            headers={**self.headers, "Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=TIMEOUT_SEC):
            pass

    def delete(self, key):
        request = urllib.request.Request(self.base + key, method="DELETE", headers=self.headers)
        with urllib.request.urlopen(request, timeout=TIMEOUT_SEC):
            pass


def send_letter(iam_token, sender, to, subject, plain, page):
    body = {
        "FromEmailAddress": sender,
        "Destination": {"ToAddresses": [to]},
        "Content": {"Simple": {
            "Subject": {"Data": subject, "Charset": "UTF-8"},
            "Body": {"Text": {"Data": plain, "Charset": "UTF-8"},
                     "Html": {"Data": page, "Charset": "UTF-8"}},
        }},
    }
    request = urllib.request.Request(
        POSTBOX_URL, method="POST", data=json.dumps(body).encode("utf-8"),
        headers={"X-YaCloud-SubjectToken": iam_token, "Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=TIMEOUT_SEC):
        pass


def _stamp(now):
    return now.strftime("%Y-%m-%dT%H:%M:%SZ")


def _count(bucket, key, limit):
    """Take one unit from a counter object; False when the limit is reached."""
    used = (bucket.get(key) or {}).get("count", 0)
    if used >= limit:
        return False
    bucket.put(key, {"count": used + 1})
    return True


def subscribe(payload, source, now, bucket, send, secret):
    """Handle the form. Returns silently for a trap hit and for a recent repeat."""
    if not isinstance(payload, dict):
        raise Refused(400, "invalid")
    if payload.get("website"):
        return  # the hidden field is filled in only by bots
    email = normalize_email(payload.get("email"))
    if not email:
        raise Refused(400, "invalid")
    lang = "en" if payload.get("lang") == "en" else "ru"

    origin = hashlib.sha256(f"{now:%Y-%m-%d}:{source}".encode("utf-8")).hexdigest()[:32]
    if not _count(bucket, f"limits/{now:%Y-%m-%dT%H}/{origin}.json", PER_SOURCE_HOURLY):
        raise Refused(429, "rate")

    ident = address_id(email)
    member = bucket.get(f"subscribers/{ident}.json")
    if member and member["status"] == "active":
        # The subscriber's record is not rewritten here: a write that races
        # with an unsubscribe would bring the subscription back.
        key = f"limits/known/{ident}.json"
        record = bucket.get(key) or {}
        kind, action, expires = "known", "unsubscribe", None
    else:
        key = f"pending/{ident}.json"
        record = bucket.get(key) or {"email": email, "created_at": _stamp(now)}
        kind, action, expires = "confirm", "confirm", now + CONFIRM_TTL
    last = record.get("last_letter_at")
    if last and now - dt.datetime.fromisoformat(last.replace("Z", "+00:00")) < RESEND_AFTER:
        return
    if not _count(bucket, f"limits/{now:%Y-%m-%d}/letters.json", DAILY_LETTERS):
        raise Refused(429, "rate")

    token = make_token(secret, action, ident, expires)
    link = f"{SITE}{'/next/en/' if lang == 'en' else '/next/'}?{action}={token}#subscribe"
    bucket.put(key, {**record, "lang": lang, "last_letter_at": _stamp(now)})
    try:
        send(email, *render_letter(kind, lang, link))
    except Exception:
        # The letter did not leave: a retry must not be told to check the inbox.
        bucket.put(key, {**record, "lang": lang})
        raise


def follow_link(action, token, now, bucket, secret):
    """Apply a link from a letter: "confirmed", "unsubscribed" or "expired"."""
    found = read_token(secret, token, action, now)
    if not found:
        return "expired"
    ident, stamp = found
    key = f"subscribers/{ident}.json"
    member = bucket.get(key)
    if action == "confirm":
        request = bucket.get(f"pending/{ident}.json")
        issued = dt.datetime.fromtimestamp(stamp, dt.timezone.utc) - CONFIRM_TTL
        # A link from before this request, e.g. one already used before an
        # unsubscribe, must not confirm the new request.
        if request and _stamp(issued) >= request["created_at"]:
            bucket.put(key, {"email": request["email"], "lang": request.get("lang", "ru"), "status": "active",
                             "created_at": request["created_at"], "confirmed_at": _stamp(now)})
            bucket.delete(f"pending/{ident}.json")
            return "confirmed"
        # A second click on a link that has already worked.
        if not request and member and member["status"] == "active":
            return "confirmed"
        return "expired"
    if not member:
        return "expired"
    if member["status"] != "unsubscribed":
        member.update(status="unsubscribed", unsubscribed_at=_stamp(now))
        bucket.put(key, member)
    return "unsubscribed"


def _header(event, name):
    for key, value in (event.get("headers") or {}).items():
        if key.lower() == name:
            return value
    return ""


def _answer(status, body, origin):
    headers = {"Content-Type": "application/json", "Cache-Control": "no-store", "Vary": "Origin"}
    if origin in ORIGINS:
        headers.update({"Access-Control-Allow-Origin": origin,
                        "Access-Control-Allow-Methods": "POST, OPTIONS",
                        "Access-Control-Allow-Headers": "Content-Type"})
    return {"statusCode": status, "headers": headers, "body": json.dumps(body)}


def handler(event, context):
    now = dt.datetime.now(dt.timezone.utc)
    method = event.get("httpMethod", "GET")
    query = event.get("queryStringParameters") or {}
    action = query.get("action", "")
    origin = _header(event, "origin")
    if method == "OPTIONS":
        return _answer(204, {}, origin)

    iam_token = context.token["access_token"]
    bucket = Bucket(os.environ["SUBSCRIBERS_BUCKET"], iam_token)
    secret = os.environ["TOKEN_SECRET"]

    if method != "POST" or action not in ("subscribe", "confirm", "unsubscribe"):
        return _answer(404, {"ok": False, "error": "unknown"}, origin)
    try:
        raw = event.get("body") or ""
        if event.get("isBase64Encoded"):
            raw = base64.b64decode(raw).decode("utf-8")
        payload = json.loads(raw)
    except ValueError:
        return _answer(400, {"ok": False, "error": "invalid"}, origin)
    try:
        if action != "subscribe":
            token = payload.get("token", "") if isinstance(payload, dict) else ""
            return _answer(200, {"ok": True, "result": follow_link(action, token, now, bucket, secret)}, origin)
        source = ((event.get("requestContext") or {}).get("identity") or {}).get("sourceIp", "")
        sender = os.environ.get("MAIL_FROM", MAIL_FROM)
        subscribe(payload, source, now, bucket,
                  lambda to, subject, plain, page: send_letter(iam_token, sender, to, subject, plain, page),
                  secret)
    except Refused as refused:
        return _answer(refused.status, {"ok": False, "error": refused.code}, origin)
    except (OSError, http.client.HTTPException, ValueError) as error:
        # No address in the log: only the kind of failure.
        print(f"{action} failed: {type(error).__name__}")
        return _answer(502, {"ok": False, "error": "unavailable"}, origin)
    return _answer(200, {"ok": True}, origin)
