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
