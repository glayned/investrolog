#!/usr/bin/env python3
"""Generate the About pages (about/index.html, en/about/index.html).

Each page is the production page of its language with the hero (logo title
and sessions clock) replaced by a compact intro, so skills, projects,
contacts and the order form stay in one place.
"""

import argparse
import re
import sys

from build_locales import ROOT


BASE = "https://investrolog.pro"
HERO_RE = re.compile(r'<section class="hero">.*?</section>', re.S)
SUBTITLE_RE = re.compile(r'<p class="subtitle">.*?</p>', re.S)
DESCRIPTION_RE = re.compile(r'<p class="description">.*?</p>', re.S)
STYLE = (
    "<style>.hero h1{font-family:var(--font-sans);letter-spacing:-1px}"
    ".hero-eyebrow a{color:inherit;text-decoration:none}"
    ".hero-eyebrow a:hover{color:var(--text-primary)}"
    "@media (max-width:380px){.code-text{font-size:12px}.header-controls{gap:6px}}</style>"
)
ORDER_BUTTON_RE = re.compile(r'<button class="btn" onclick="openOrderModal\(\)".*?</button>', re.S)
PAGES = {
    "ru": {
        "source": ROOT / "index.html",
        "output": ROOT / "about" / "index.html",
        "home": "/",
        "heading": "О проекте",
        "projects_label": "Проекты",
        "terminal_label": "Терминал",
        "title": "О проекте — InvestroLog × DataMatrix",
        "description": "О проекте InvestroLog × DataMatrix и его авторе Дмитрии Мальцеве: навыки, рабочие модули торговой системы, контакты и разработка на заказ.",
    },
    "en": {
        "source": ROOT / "en" / "index.html",
        "output": ROOT / "en" / "about" / "index.html",
        "home": "/en/",
        "heading": "About",
        "projects_label": "Projects",
        "terminal_label": "Terminal",
        "title": "About — InvestroLog × DataMatrix",
        "description": "About InvestroLog × DataMatrix and its author Dmitry Maltsev: capabilities, working modules of the trading system, contacts and custom development.",
    },
}
TERMINAL_URL = "https://t.me/DiTradeApp"


def sub_once(pattern, replacement, html):
    html, count = re.subn(pattern, lambda _: replacement, html, flags=re.S)
    if count != 1:
        raise ValueError(f"Expected one match of {pattern!r}, found {count}")
    return html


def find_once(pattern, html):
    matches = pattern.findall(html)
    if len(matches) != 1:
        raise ValueError(f"Expected one match of {pattern.pattern!r}, found {len(matches)}")
    return matches[0]


def render_intro(hero, page):
    return "\n".join((
        '<section class="hero">',
        '<div class="hero-content">',
        f'<p class="hero-eyebrow"><a href="{page["home"]}">← InvestroLog × DataMatrix</a></p>',
        f'<h1>{page["heading"]}</h1>',
        find_once(SUBTITLE_RE, hero),
        find_once(DESCRIPTION_RE, hero),
        '<div class="cta-buttons">',
        f'<a class="btn" href="#projects">{page["projects_label"]}</a>',
        f'<a class="btn" href="{TERMINAL_URL}" rel="noopener noreferrer" target="_blank">{page["terminal_label"]}</a>',
        find_once(ORDER_BUTTON_RE, hero),
        '</div>',
        '</div>',
        '</section>',
    ))


def render(source, lang):
    page = PAGES[lang]
    url = f'{BASE}{page["home"]}about/'
    html = sub_once(HERO_RE.pattern, render_intro(find_once(HERO_RE, source), page), source)

    html = sub_once(r"<title>.*?</title>", f'<title>{page["title"]}</title>', html)
    for attribute, value in (
        ('name="description"', page["description"]),
        ('property="og:title"', page["title"]),
        ('property="og:description"', page["description"]),
        ('property="og:url"', url),
        ('property="og:image:alt"', page["title"]),
        ('name="twitter:title"', page["title"]),
        ('name="twitter:description"', page["description"]),
    ):
        html = sub_once(rf'<meta content="[^"]*" {attribute}/>', f'<meta content="{value}" {attribute}/>', html)

    html = sub_once(r'<link href="[^"]*" rel="canonical"/>', f'<link href="{url}" rel="canonical"/>', html)
    for hreflang, path in (("ru", "/about/"), ("en", "/en/about/"), ("x-default", "/about/")):
        html = sub_once(
            rf'<link href="[^"]*" hreflang="{hreflang}" rel="alternate"/>',
            f'<link href="{BASE}{path}" hreflang="{hreflang}" rel="alternate"/>',
            html,
        )
        if hreflang != "x-default":
            html = sub_once(
                rf'data-language-link href="[^"]*" hreflang="{hreflang}"',
                f'data-language-link href="{path}" hreflang="{hreflang}"',
                html,
            )
    html = sub_once(r"</head>", f"{STYLE}\n</head>", html)
    if lang == "ru":
        html = sub_once(r"l\.replace\('/en/'\+", "l.replace('/en/about/'+", html)
        html = sub_once(
            r"a===l\.origin\+'/en/'\)return",
            "a===l.origin+'/en/'||a===l.origin+'/en/about/')return",
            html,
        )
    return html


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help="Fail if the About pages are not the current generated output.",
    )
    args = parser.parse_args()

    for lang, page in PAGES.items():
        output = page["output"]
        html = render(page["source"].read_text(encoding="utf-8"), lang)
        if args.check:
            if not output.exists() or output.read_text(encoding="utf-8") != html:
                print(f"{output.relative_to(ROOT)} is stale; run python3 scripts/build_about.py", file=sys.stderr)
                raise SystemExit(1)
            continue
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(html, encoding="utf-8")
        print(f"Generated {output.relative_to(ROOT)}")
    if args.check:
        print("The About pages are current.")


if __name__ == "__main__":
    main()
