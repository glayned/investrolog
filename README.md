InvestroLog × DataMatrix 
проект о трейдинге, опционах, волатильности:
https://investrolog.pro

Матрица данных и рыночных реакций:
https://t.me/investrolog

Алгоритмы × Музыка:
трейдинг, словно симфония чисел

(c) Дмитрий Мальцев

## Localized pages

- `/` is the canonical Russian page and the source for shared markup.
- `/en/` is a generated static English page.
- English copy is maintained in `locales/en.json`.

Rebuild after changing shared markup or localized copy:

```bash
python3 scripts/build_locales.py
```

Verify that the committed English page is current:

```bash
python3 scripts/build_locales.py --check
```

## Home page prototype (`/next/`)

- `/next/` is the Russian prototype page; `/next/en/` is generated from it.
- Prototype-only English copy is in `locales/next.en.json`; copy shared with the production page is reused from `locales/en.json`.
- Matrix data: `next/snapshot.json` (demo layers) and `next/layers/cot.json` (real CFTC data).

```bash
python3 scripts/build_next_locales.py          # rebuild /next/en/
python3 scripts/build_next_locales.py --check  # verify it is current
python3 scripts/update_matrix_cot.py           # refresh the COT layer from CFTC
python3 scripts/sync_layers.py                 # pull validated public layers (sentiment) into next/layers/
```
