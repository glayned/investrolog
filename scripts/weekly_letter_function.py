"""Send the weekly letter with the matrix to confirmed subscribers.

A Yandex Cloud Function released by hand together with
`subscribe_function.py`, whose bucket, tokens and Postbox call it reuses. It
has no public access: a timer or the owner invokes it.

    {}                          -> the finished week goes to every active subscriber
    {"test_to": "a@b.c"}        -> one letter to this address only, nothing is recorded
    {"test_to": ..., "lang": "en"}
    {"test_to": ..., "week": "2026-11-23"}  -> the week of that date instead of the last finished one

The letter is built from the public archive of daily snapshots
(`/next/archive/`): for each market the direction of the consensus column on
each trading day of the week, the days when the layers aligned, and the
volatility regime of the last day. All text comes from templates.

A marker `weekly/<monday>/<address hash>.json` is written before each letter,
so a second run for the same week sends only what the first one did not.

Environment: SUBSCRIBERS_BUCKET, TOKEN_SECRET, and optionally MAIL_FROM.
"""

import datetime as dt
import html
import json
import os
import re
import time
import urllib.parse
import urllib.request

import subscribe_function as sub

ARCHIVE_URL = f"{sub.SITE}/next/archive"
MARKETS = ("NG", "CL", "GC", "SI", "CC", "KC")
MOSCOW = dt.timezone(dt.timedelta(hours=3))
# Postbox accepts one letter a second and 200 a day; signups need a share of the day.
SEND_PAUSE_SEC = 1.1
RUN_LETTERS = 150

BULL, BEAR, FLAT = "#3ecf7a", "#ef5b4c", "#6f6f6f"
TINT = {"bull": "#172c21", "bear": "#301b1a"}
MONO = "'IBM Plex Mono',Consolas,'Courier New',monospace"
SANS = "Arial,Helvetica,sans-serif"
ARROW = {"bull": "▲", "bear": "▼", "flat": "–"}

TEXT = {
    "ru": {
        "subject": "Матрица за неделю: {dates}",
        "title": "Матрица за неделю",
        "months": ("января", "февраля", "марта", "апреля", "мая", "июня",
                   "июля", "августа", "сентября", "октября", "ноября", "декабря"),
        "days": ("Пн", "Вт", "Ср", "Чт", "Пт"),
        "last": ("Понедельник", "Вторник", "Среда", "Четверг", "Пятница"),
        "market": "Рынок",
        "names": {"NG": "Газ", "CL": "Нефть", "GC": "Золото", "SI": "Серебро", "CC": "Какао", "KC": "Кофе"},
        "dirs": {"bull": "в рост", "bear": "в снижение"},
        "aligned": "Слои сошлись: {items}.",
        "never": "За неделю слои не сошлись ни по одному рынку.",
        "holds": "На конец недели согласие держится: {items}.",
        "gone": "К концу недели согласия нет ни по одному рынку.",
        "legend": "Число — сколько слоёв из тех, что с данными, смотрят в одну сторону. Согласие — от 4, без голосов против.",
        "regime": "Режим волатильности",
        "regimes": {"calm": "спокойный", "neutral": "нейтральный", "caution": "настороженный", "stress": "стресс"},
        "rank": "VIX на {rank}-м перцентиле",
        "button": "Открыть матрицу",
        "note": "Не является инвестиционной рекомендацией.",
        "why": "Вы получили письмо, потому что подписались на investrolog.pro/next.",
        "unsubscribe": "Отписаться",
        "page": "/next/",
    },
    "en": {
        "subject": "Matrix for the week: {dates}",
        "title": "Matrix for the week",
        "months": ("January", "February", "March", "April", "May", "June",
                   "July", "August", "September", "October", "November", "December"),
        "days": ("Mon", "Tue", "Wed", "Thu", "Fri"),
        "last": ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday"),
        "market": "Market",
        "names": {"NG": "Nat gas", "CL": "Crude", "GC": "Gold", "SI": "Silver", "CC": "Cocoa", "KC": "Coffee"},
        "dirs": {"bull": "up", "bear": "down"},
        "aligned": "Layers aligned: {items}.",
        "never": "No market had its layers aligned this week.",
        "holds": "At the end of the week consensus holds: {items}.",
        "gone": "By the end of the week no market has consensus.",
        "legend": "The number is how many layers with data point the same way. Consensus needs 4 or more, none against.",
        "regime": "Volatility regime",
        "regimes": {"calm": "calm", "neutral": "neutral", "caution": "cautious", "stress": "stress"},
        "rank": "VIX at percentile {rank}",
        "button": "Open the matrix",
        "note": "Not investment advice.",
        "why": "You are receiving this because you subscribed at investrolog.pro/next.",
        "unsubscribe": "Unsubscribe",
        "page": "/next/en/",
    },
}


def week_start(now):
    """Monday of the last finished trading week, by the Moscow calendar."""
    today = now.astimezone(MOSCOW).date()
    monday = today - dt.timedelta(days=today.weekday())
    return monday if today.weekday() >= 5 else monday - dt.timedelta(days=7)


def _consensus(raw):
    """The consensus of one market on one day, or None when the snapshot has none."""
    if not isinstance(raw, dict) or raw.get("dir") not in ARROW:
        return None
    lead, total = raw.get("lead"), raw.get("total")
    if type(lead) is not int or type(total) is not int or not 0 <= lead <= total or total == 0:
        return None
    aligned = raw.get("aligned") is True and raw["dir"] != "flat"
    return {"dir": raw["dir"], "lead": lead, "total": total, "aligned": aligned}


def read_week(fetch, monday):
    """Snapshots of the week: `{"monday", "days": [per-day dict or None] * 5, "regime"}`, or None without data."""
    index = fetch("index.json") or {}
    known = set(index.get("days") or [])
    days, regime = [], None
    for offset in range(5):
        date = (monday + dt.timedelta(days=offset)).isoformat()
        snapshot = fetch(f"{date}.json") if date in known else None
        if not isinstance(snapshot, dict) or snapshot.get("date") != date:
            days.append(None)
            continue
        markets = snapshot.get("markets") if isinstance(snapshot.get("markets"), dict) else {}
        days.append({market: _consensus((markets.get(market) or {}).get("consensus")) for market in MARKETS})
        regime = snapshot.get("regime")
    if not any(days):
        return None
    return {"monday": monday, "days": days, "regime": regime if isinstance(regime, dict) else None}


def _dates(monday, text):
    friday = monday + dt.timedelta(days=4)
    months = text["months"]
    if monday.month == friday.month:
        return f"{monday.day}–{friday.day} {months[monday.month - 1]}"
    return f"{monday.day} {months[monday.month - 1]} – {friday.day} {months[friday.month - 1]}"


def _summary(week, text):
    """Two sentences: where the layers aligned during the week, and what is left at its end."""
    last = max(index for index, day in enumerate(week["days"]) if day)
    during, at_end = [], []
    for market in MARKETS:
        for side in ("bull", "bear"):
            hit = [index for index, day in enumerate(week["days"])
                   if day and day[market] and day[market]["aligned"] and day[market]["dir"] == side]
            if not hit:
                continue
            name = text["names"][market].lower()
            when = ", ".join(text["days"][index].lower() for index in hit)
            during.append(f"{name}\u00a0— {text['dirs'][side]} ({when})")
            if last in hit:
                at_end.append(f"{name}\u00a0— {text['dirs'][side]}")
    if not during:
        return text["never"]
    end = text["holds"].format(items="; ".join(at_end)) if at_end else text["gone"]
    return f"{text['aligned'].format(items='; '.join(during))} {end}"


def _regime(week, text):
    regime = week["regime"] or {}
    name = text["regimes"].get(regime.get("regime"))
    if not name:
        return None
    rank = regime.get("vix_percentile")
    if type(rank) is int and 0 <= rank <= 100:
        return f"{name} · {text['rank'].format(rank=rank)}"
    return name


def render_weekly(week, lang, unsubscribe_link):
    """Subject, plain text and HTML of the letter for one recipient."""
    text = TEXT[lang]
    dates = _dates(week["monday"], text)
    subject = text["subject"].format(dates=dates)
    summary = _summary(week, text)
    regime = _regime(week, text)
    last = max(index for index, day in enumerate(week["days"]) if day)
    site = f"{sub.SITE}{text['page']}"
    label = f"font:600 10px/1 {MONO};letter-spacing:1.4px;color:{FLAT};text-transform:uppercase;"
    line = "border-top:1px solid #222224;"

    rows, plain_rows = [], []
    for market in MARKETS:
        cells, plain_cells = [], []
        for day in week["days"]:
            state = day[market] if day else None
            if not state:
                cells.append(f'<td align="center" style="padding:0 1px;"><div style="width:26px;height:26px;border:1px solid #111112;color:#3a3a3c;font:12px/24px {SANS};">·</div></td>')
                plain_cells.append(" · ")
                continue
            color = {"bull": BULL, "bear": BEAR}.get(state["dir"], FLAT)
            frame = f"border:1px solid {color};background:{TINT[state['dir']]};" if state["aligned"] else "border:1px solid #111112;"
            cells.append(f'<td align="center" style="padding:0 1px;"><div style="width:26px;height:26px;{frame}color:{color};font:12px/24px {SANS};">{ARROW[state["dir"]]}</div></td>')
            plain_cells.append(f"[{ARROW[state['dir']]}]" if state["aligned"] else f" {ARROW[state['dir']]} ")
        state = week["days"][last][market]
        color = {"bull": BULL, "bear": BEAR}.get(state["dir"], FLAT) if state else FLAT
        score = f"{ARROW[state['dir']]}&nbsp;{state['lead']}/{state['total']}" if state else "·"
        rows.append(
            f'<tr><td style="padding:9px 0;{line}"><span style="font:600 13px/1 {MONO};color:#f2f2f2;letter-spacing:.6px;">{market}</span>'
            f'<br><span style="font:12px/1.5 {SANS};color:#8a8a8a;">{html.escape(text["names"][market])}</span></td>'
            f'<td style="padding:9px 0;{line}"><table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr>{"".join(cells)}</tr></table></td>'
            f'<td align="right" style="padding:9px 0;{line}font:600 13px/1 {MONO};color:{color};white-space:nowrap;">{score}</td></tr>')
        plain_score = f"{ARROW[state['dir']]} {state['lead']}/{state['total']}" if state else "·"
        plain_rows.append(f"{market}  {' '.join(plain_cells)}  {plain_score}")
    heads = "".join(
        f'<td align="center" style="padding:0 1px;"><div style="width:28px;font:10px/1 {MONO};color:{FLAT};letter-spacing:.4px;">{name.upper()}</div></td>'
        for name in text["days"])
    regime_block = "" if not regime else (
        f'<tr><td style="padding:18px 22px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #2a2a2c;">'
        f'<tr><td style="padding:12px 14px;"><div style="{label}">{text["regime"]}</div>'
        f'<div style="padding-top:7px;font:14px/1.4 {SANS};color:#f2f2f2;">{html.escape(regime)}</div></td></tr></table></td></tr>')
    link = html.escape(unsubscribe_link, quote=True)
    page = f"""<!doctype html><html lang="{lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>{html.escape(subject)}</title></head>
<body style="margin:0;background:#0b0b0c;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0b0c;"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;border:1px solid #2a2a2c;background:#111112;">
<tr><td style="padding:22px 22px 0;font:600 11px/1.4 {MONO};letter-spacing:2px;color:#8a8a8a;">INVESTROLOG × DATAMATRIX</td></tr>
<tr><td style="padding:16px 22px 0;font:700 20px/1.25 {SANS};color:#f2f2f2;">{text["title"]}</td></tr>
<tr><td style="padding:6px 22px 0;font:12px/1.4 {MONO};letter-spacing:.4px;color:#8a8a8a;">{dates} {week["monday"].year}</td></tr>
<tr><td style="padding:14px 22px 0;font:15px/1.6 {SANS};color:#d6d6d6;">{html.escape(summary)}</td></tr>
<tr><td style="padding:20px 22px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="padding-bottom:8px;{label}">{text["market"]}</td><td style="padding-bottom:8px;"><table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr>{heads}</tr></table></td><td align="right" style="padding-bottom:8px;{label}">{text["last"][last]}</td></tr>
{"".join(rows)}</table></td></tr>
<tr><td style="padding:12px 22px 0;font:12px/1.6 {SANS};color:#8a8a8a;">{text["legend"]}</td></tr>
{regime_block}
<tr><td style="padding:22px 22px 0;"><a href="{site}" style="display:inline-block;padding:13px 22px;background:#f2f2f2;color:#0b0b0c;font:700 14px/1 {SANS};text-decoration:none;">{text["button"]}</a></td></tr>
<tr><td style="padding:20px 22px 22px;font:12px/1.6 {SANS};color:{FLAT};">{text["note"]}</td></tr>
<tr><td style="padding:14px 22px;border-top:1px solid #2a2a2c;font:12px/1.6 {SANS};color:{FLAT};">{text["why"]} <a href="{link}" style="color:#8a8a8a;">{text["unsubscribe"]}</a></td></tr>
</table></td></tr></table></body></html>"""
    plain = "\n".join([
        f"{text['title']} · {dates} {week['monday'].year}", "", summary, "",
        f"    {' '.join(f'{name:^3}' for name in text['days'])}  {text['last'][last]}", *plain_rows, "", text["legend"],
        *([f"{text['regime']}: {regime}"] if regime else []), "",
        f"{text['button']}: {site}", text["note"], "", text["why"],
        f"{text['unsubscribe']}: {unsubscribe_link}", ""])
    return subject, plain, page


def unsubscribe_link(secret, ident, lang):
    token = sub.make_token(secret, "unsubscribe", ident)
    return f"{sub.SITE}{TEXT[lang]['page']}?unsubscribe={token}#subscribe"


def send_week(week, bucket, list_keys, send, secret, pause=lambda: None, limit=RUN_LETTERS):
    """Send the week to every active subscriber once. Returns the counts of the run."""
    done = {"sent": 0, "already": 0, "inactive": 0, "failed": 0, "left": 0}
    prefix = f"weekly/{week['monday'].isoformat()}/"
    for key in list_keys("subscribers/"):
        ident = key.rsplit("/", 1)[-1].removesuffix(".json")
        if bucket.get(f"{prefix}{ident}.json"):
            done["already"] += 1
            continue
        if done["sent"] + done["failed"] >= limit:
            done["left"] += 1
            continue
        member = bucket.get(key)
        if not member or member.get("status") != "active" or not sub.normalize_email(member.get("email")):
            done["inactive"] += 1
            continue
        lang = "en" if member.get("lang") == "en" else "ru"
        link = unsubscribe_link(secret, ident, lang)
        bucket.put(f"{prefix}{ident}.json", {"sent_at": sub._stamp(dt.datetime.now(dt.timezone.utc))})
        try:
            send(member["email"], *render_weekly(week, lang, link), link)
            done["sent"] += 1
        except Exception:
            # The letter did not leave: the next run tries this address again.
            bucket.delete(f"{prefix}{ident}.json")
            done["failed"] += 1
        pause()
    return done


def _fetch_archive(name):
    try:
        with urllib.request.urlopen(f"{ARCHIVE_URL}/{name}", timeout=sub.TIMEOUT_SEC) as response:
            return json.loads(response.read())
    except (OSError, ValueError):
        return None


def _list_keys(bucket_name, iam_token, prefix):
    """Every object key under the prefix, page by page."""
    token = None
    while True:
        query = {"list-type": "2", "prefix": prefix}
        if token:
            query["continuation-token"] = token
        request = urllib.request.Request(
            f"{sub.STORAGE_URL}/{urllib.parse.quote(bucket_name)}?{urllib.parse.urlencode(query)}",
            headers={"X-YaCloud-SubjectToken": iam_token})
        with urllib.request.urlopen(request, timeout=sub.TIMEOUT_SEC) as response:
            listing = response.read().decode("utf-8")
        yield from (html.unescape(key) for key in re.findall(r"<Key>([^<]+)</Key>", listing))
        found = re.search(r"<NextContinuationToken>([^<]+)</NextContinuationToken>", listing)
        if not found:
            return
        token = html.unescape(found.group(1))


def handler(event, context):
    now = dt.datetime.now(dt.timezone.utc)
    event = event if isinstance(event, dict) else {}
    iam_token = context.token["access_token"]
    secret = os.environ["TOKEN_SECRET"]
    sender = os.environ.get("MAIL_FROM", sub.MAIL_FROM)
    monday = week_start(now)
    if "test_to" in event and event.get("week"):
        try:
            monday = dt.date.fromisoformat(event["week"])
        except (TypeError, ValueError):
            return {"ok": False, "error": "invalid week"}
        monday -= dt.timedelta(days=monday.weekday())
    week = read_week(_fetch_archive, monday)
    if not week:
        return {"ok": False, "error": "no snapshots for the week"}

    def send(to, subject, plain, page, link):
        sub.send_letter(iam_token, sender, to, subject, plain, page,
                        headers=[{"Name": "List-Unsubscribe", "Value": f"<{link}>"}])

    test_to = sub.normalize_email(event.get("test_to"))
    if "test_to" in event:
        if not test_to:
            return {"ok": False, "error": "invalid test_to"}
        lang = "en" if event.get("lang") == "en" else "ru"
        link = unsubscribe_link(secret, sub.address_id(test_to), lang)
        send(test_to, *render_weekly(week, lang, link), link)
        return {"ok": True, "week": week["monday"].isoformat(), "test": True}

    bucket_name = os.environ["SUBSCRIBERS_BUCKET"]
    done = send_week(week, sub.Bucket(bucket_name, iam_token),
                     lambda prefix: _list_keys(bucket_name, iam_token, prefix),
                     send, secret, pause=lambda: time.sleep(SEND_PAUSE_SEC))
    return {"ok": True, "week": week["monday"].isoformat(), **done}
