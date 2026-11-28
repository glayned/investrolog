#!/usr/bin/env python3
"""Generate the English page of the /next/ prototype (next/en/index.html).

Copy shared with the production page comes from locales/en.json; copy that
exists only in the prototype comes from locales/next.en.json.
"""

import argparse
import json
import re
import sys

from build_locales import ROOT, replace_once


SOURCE_PATH = ROOT / "next" / "index.html"
SHARED_LOCALE_PATH = ROOT / "locales" / "en.json"
LOCALE_PATH = ROOT / "locales" / "next.en.json"
OUTPUT_PATH = ROOT / "next" / "en" / "index.html"
CYRILLIC_RE = re.compile(r"[\u0400-\u04FF]+[^<>\n\"]*")
STRUCTURAL_REPLACEMENTS = (
    ('<html data-theme="dark" lang="ru">', '<html data-theme="dark" lang="en">'),
    (
        '<a aria-current="page" class="language-link active" data-language-link href="/next/" hreflang="ru" lang="ru">RU</a>\n'
        '<a class="language-link" data-language-link href="/next/en/" hreflang="en" lang="en">EN</a>',
        '<a class="language-link" data-language-link href="/next/" hreflang="ru" lang="ru">RU</a>\n'
        '<a aria-current="page" class="language-link active" data-language-link href="/next/en/" hreflang="en" lang="en">EN</a>',
    ),
    ('<a href="/next/privacy/">', '<a href="/next/en/privacy/">'),
    ('<a class="btn" href="/about/">', '<a class="btn" href="/en/about/">'),
)


def render_english(source, shared, own):
    html = source
    for source_text, target_text in STRUCTURAL_REPLACEMENTS:
        html = replace_once(html, source_text, target_text)

    for source_text in own:
        if source_text not in html:
            raise ValueError(f"Translation source is missing: {source_text!r}")
    replacements = {key: value for key, value in shared.items() if key in html}
    replacements.update(own)
    for source_text in sorted(replacements, key=len, reverse=True):
        html = html.replace(source_text, replacements[source_text])

    leftover = CYRILLIC_RE.search(html)
    if leftover:
        raise ValueError(f"Untranslated text remains on the English page: {leftover.group(0)!r}")
    return html


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help="Fail if next/en/index.html is not the current generated output.",
    )
    args = parser.parse_args()

    source = SOURCE_PATH.read_text(encoding="utf-8")
    shared = json.loads(SHARED_LOCALE_PATH.read_text(encoding="utf-8"))["replacements"]
    own = json.loads(LOCALE_PATH.read_text(encoding="utf-8"))["replacements"]
    english = render_english(source, shared, own)

    if args.check:
        if not OUTPUT_PATH.exists() or OUTPUT_PATH.read_text(encoding="utf-8") != english:
            print("next/en/index.html is stale; run python3 scripts/build_next_locales.py", file=sys.stderr)
            raise SystemExit(1)
        print("The English prototype page is current.")
        return

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(english, encoding="utf-8")
    print(f"Generated {OUTPUT_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
