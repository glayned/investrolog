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
python3 scripts/sync_layers.py                 # pull validated public layers (sentiment, levels, flow) into next/layers/
python3 scripts/archive_matrix.py              # write today's snapshot of the matrix into next/archive/
```

`scripts/sync_trigger.py` is not run from this repository: it is a Yandex Cloud Function
(`matrix-sync-trigger`, timer at :05, :25 and :45) in the cloud that owns the layers bucket.
It starts `sync-layers.yml` when a layer file changed and `update-options.yml` at 04:45 and
08:45 UTC, because GitHub runs `schedule` workflows hours late. Settings: `GITHUB_TOKEN`
(fine-grained, Actions read and write on this repository only), `GITHUB_REPO`, `LAYERS_BUCKET`.
After editing the script, release a new function version; the workflow schedules stay as a fallback.

`scripts/subscribe_function.py` is not run from this repository either: it is a Yandex Cloud Function
(`matrix-subscribe`, public) in the cloud that holds the Postbox address of investrolog.pro. The form on
`/next/` posts to it; addresses are kept in the private bucket `investrolog-matrix-subscribers`
(`pending/` is deleted by a lifecycle rule after 30 days, `limits/` after a day) and never reach this
repository. Settings: `SUBSCRIBERS_BUCKET`, `TOKEN_SECRET`. Keep `TOKEN_SECRET` when
releasing a new version: links in letters already sent are signed with it.

`next/archive/YYYY-MM-DD.json` is the matrix as the page showed it at 22:00 UTC of that trading day:
the side of every layer per market, the consensus and the VIX regime, without the notes.
`sync-layers.yml` rewrites the file of the current day on every run; after the cut-off it is final.
There are no files for Saturdays and Sundays.
`next/archive/index.json` lists the archived days; the page reads it to compare the matrix with the last finished day
(the "changes since" strip and the amber corner of a cell that changed side).
