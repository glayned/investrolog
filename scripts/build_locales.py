#!/usr/bin/env python3

import argparse
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE_PATH = ROOT / "index.html"
LOCALE_PATH = ROOT / "locales" / "en.json"
OUTPUT_PATH = ROOT / "en" / "index.html"


class VisibleTextParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.hidden_depth = 0
        self.text = []

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style"}:
            self.hidden_depth += 1

    def handle_endtag(self, tag):
        if tag in {"script", "style"}:
            self.hidden_depth -= 1

    def handle_data(self, data):
        if not self.hidden_depth:
            self.text.append(data)


def replace_once(html, source, target):
    count = html.count(source)
    if count != 1:
        raise ValueError(f"Expected one occurrence of {source!r}, found {count}")
    return html.replace(source, target)


def render_english(source, locale):
    html = source
    structural_replacements = (
        ('<html data-theme="dark" lang="ru">', '<html data-theme="dark" lang="en">'),
        (
            '<link href="https://investrolog.pro/" rel="canonical"/>',
            '<link href="https://investrolog.pro/en/" rel="canonical"/>',
        ),
        (
            '<meta content="https://investrolog.pro/" property="og:url"/>',
            '<meta content="https://investrolog.pro/en/" property="og:url"/>',
        ),
        (
            '<meta content="ru_RU" property="og:locale"/>',
            '<meta content="en_US" property="og:locale"/>',
        ),
        (
            '<meta content="en_US" property="og:locale:alternate"/>',
            '<meta content="ru_RU" property="og:locale:alternate"/>',
        ),
        (
            '<meta content="https://investrolog.pro/og.jpg" property="og:image"/>',
            '<meta content="https://investrolog.pro/og-en.jpg" property="og:image"/>',
        ),
        (
            '<meta content="https://investrolog.pro/og.jpg" name="twitter:image"/>',
            '<meta content="https://investrolog.pro/og-en.jpg" name="twitter:image"/>',
        ),
        ('"url": "https://investrolog.pro/"', '"url": "https://investrolog.pro/en/"'),
        ('"name": "Дмитрий Мальцев"', '"name": "Dmitry Maltsev"'),
        (
            '"alternateName": [\n        "Dmitry Maltsev",',
            '"alternateName": [\n        "Дмитрий Мальцев",',
        ),
        (
            '<a aria-current="page" class="language-link active" data-language-link href="/" hreflang="ru" lang="ru">RU</a>\n'
            '<a class="language-link" data-language-link href="/en/" hreflang="en" lang="en">EN</a>',
            '<a class="language-link" data-language-link href="/" hreflang="ru" lang="ru">RU</a>\n'
            '<a aria-current="page" class="language-link active" data-language-link href="/en/" hreflang="en" lang="en">EN</a>',
        ),
    )
    for source_text, target_text in structural_replacements:
        html = replace_once(html, source_text, target_text)

    metadata_replacements = {
        '<title>InvestroLog × DataMatrix — Dmitry Maltsev</title>':
            f'<title>{locale["title"]}</title>',
        '<meta content="InvestroLog × DataMatrix — исследовательский проект Дмитрия Мальцева: торговая система из модулей — COT, опционы и волатильность, алерты, Market Desk, сентимент, AI-ассистент. Python-разработка и AI-автоматизация рыночного анализа." name="description"/>':
            f'<meta content="{locale["description"]}" name="description"/>',
        '<meta content="InvestroLog × DataMatrix — Дмитрий Мальцев" property="og:title"/>':
            f'<meta content="{locale["og_title"]}" property="og:title"/>',
        '<meta content="Торговая система из модулей: COT, опционы, волатильность, алерты, сентимент. Python и AI-автоматизация рыночного анализа." property="og:description"/>':
            f'<meta content="{locale["og_description"]}" property="og:description"/>',
        '<meta content="InvestroLog × DataMatrix — Дмитрий Мальцев" property="og:image:alt"/>':
            f'<meta content="{locale["og_title"]}" property="og:image:alt"/>',
        '<meta content="InvestroLog × DataMatrix — Дмитрий Мальцев" name="twitter:title"/>':
            f'<meta content="{locale["og_title"]}" name="twitter:title"/>',
        '<meta content="Торговая система из модулей: COT, опционы, волатильность, алерты, сентимент. Python и AI-автоматизация рыночного анализа." name="twitter:description"/>':
            f'<meta content="{locale["og_description"]}" name="twitter:description"/>',
        '"description": "Дмитрий Мальцев — трейдер-исследователь, Python-разработчик и автор проекта InvestroLog × DataMatrix."':
            f'"description": "{locale["person_description"]}"',
        '"jobTitle": "Трейдер-исследователь, Python-разработчик, AI Automation Specialist"':
            f'"jobTitle": "{locale["job_title"]}"',
    }
    for source_text, target_text in metadata_replacements.items():
        html = replace_once(html, source_text, target_text)

    for source_text in sorted(locale["replacements"], key=len, reverse=True):
        if source_text not in html:
            raise ValueError(f"Translation source is missing: {source_text!r}")
        html = html.replace(source_text, locale["replacements"][source_text])

    return html


def validate(source, english):
    required_source = (
        'lang="ru"',
        'rel="canonical"',
        'hreflang="ru"',
        'hreflang="en"',
        'hreflang="x-default"',
        'href="/en/"',
        'src="/js/main.js',
        'href="/css/styles.css',
    )
    required_english = (
        'lang="en"',
        '<link href="https://investrolog.pro/en/" rel="canonical"/>',
        '<meta content="https://investrolog.pro/en/" property="og:url"/>',
        '<meta content="en_US" property="og:locale"/>',
        'href="/" hreflang="ru"',
        'href="/en/" hreflang="en"',
        'src="/js/main.js',
        'href="/css/styles.css',
    )
    for marker in required_source:
        if marker not in source:
            raise ValueError(f"RU page is missing required marker: {marker}")
    for marker in required_english:
        if marker not in english:
            raise ValueError(f"EN page is missing required marker: {marker}")
    for relative_asset in ('href="css/', 'src="js/', 'src="song.mp3"'):
        if relative_asset in source or relative_asset in english:
            raise ValueError(f"Locale-dependent asset path found: {relative_asset}")

    parser = VisibleTextParser()
    parser.feed(english)
    visible_cyrillic = re.findall(r"[А-Яа-яЁё]", " ".join(parser.text))
    if visible_cyrillic:
        raise ValueError("Visible Cyrillic text remains on the English page")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help="Fail if en/index.html is not the current generated output.",
    )
    args = parser.parse_args()

    source = SOURCE_PATH.read_text(encoding="utf-8")
    locale = json.loads(LOCALE_PATH.read_text(encoding="utf-8"))
    english = render_english(source, locale)
    validate(source, english)

    if args.check:
        if not OUTPUT_PATH.exists() or OUTPUT_PATH.read_text(encoding="utf-8") != english:
            print("en/index.html is stale; run python3 scripts/build_locales.py", file=sys.stderr)
            raise SystemExit(1)
        print("Localized pages and SEO markers are current.")
        return

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(english, encoding="utf-8")
    print(f"Generated {OUTPUT_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
