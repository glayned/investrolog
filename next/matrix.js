(() => {
    'use strict';

    const SNAPSHOT_URL = '/next/snapshot.json';
    const FETCH_TIMEOUT_MS = 8000;
    const MIN_ALIGNED = 4;
    const MAX_EVENTS = 3;
    const TERMINAL_URL = 'https://t.me/investrolog';
    const LANG = document.documentElement.lang === 'en' ? 'en' : 'ru';
    const STRINGS = {
        ru: {
            locale: 'ru-RU',
            horizons: { weeks: 'Недели', days: 'Дни', minutes: 'Минуты', context: 'Фон' },
            states: { bull: 'бычий', bear: 'медвежий', flat: 'нейтрально', na: 'нет данных' },
            vol: ['спокойно', 'повышена', 'стресс'],
            direction: { bull: 'вверх', bear: 'вниз' },
            consensus: 'Согласие',
            wholeMarket: 'рынок целиком',
            aligned: 'слои сошлись',
            notAligned: 'согласия нет',
            noneAligned: 'Сегодня слои нигде не сошлись — это тоже информация.',
            inTerminal: 'В Терминале',
            openTerminal: 'Открыть Терминал',
            aboutModule: 'О модуле',
            rowClosed: 'Уровни, стопы и план «если – то» по этому рынку, алерты в момент события.',
            cellClosed: 'Полный разбор слоя и алерты в момент события.',
            notCovered: 'Этот слой пока не покрывает рынок.',
            demo: 'демо',
            demoBadge: 'Демо-данные',
            demoExcept: labels => `Демо, кроме ${labels}`,
            report: date => `отчёт ${date}`,
            snapshot: stamp => `Снимок · ${stamp} МСК`,
            eventTime: time => `${time} МСК`,
            verdictAligned: (c, dir) => `${c.lead} из ${c.total} слоёв с данными ${c.lead === 1 ? 'смотрит' : 'смотрят'} ${dir}, против — ни одного.`,
            verdictSplit: c => `Слои расходятся: ${c.bull} вверх, ${c.bear} вниз.`,
            verdictShort: (c, dir, min) => `${c.lead} из ${c.total} слоёв с данными ${c.lead === 1 ? 'смотрит' : 'смотрят'} ${dir} — для согласия нужно не меньше ${min}.`,
            verdictNone: 'Ни один слой не даёт направления.',
            verdictNoData: 'По этому рынку пока нет данных ни в одном слое, который входит в счёт согласия.',
            inDays: (d, h) => `через ${d} д ${h} ч`,
            inHours: (h, m) => `через ${h} ч ${m} мин`,
            inMinutes: m => `через ${m} мин`,
            subscribeStub: 'Прототип: форма ещё не подключена, адрес никуда не отправлен.',
            subscribeInvalid: 'Проверьте адрес почты.',
            unavailable: 'Снимок рынка временно недоступен. Свежие данные — в Терминале.',
            regimeTitle: 'Режим волатильности',
            regimes: { calm: 'спокойный', neutral: 'нейтральный', caution: 'настороженный', stress: 'стресс' },
            curves: {
                contango: 'кривая VIX в контанго', flat: 'кривая VIX плоская',
                spot_stress: 'стресс на споте VIX', backwardation: 'кривая VIX в бэквордации'
            },
            regimeRank: rank => `VIX на ${rank}-м перцентиле`,
            regimeDate: date => `на закрытие ${date}`
        },
        en: {
            locale: 'en-GB',
            horizons: { weeks: 'Weeks', days: 'Days', minutes: 'Minutes', context: 'Regime' },
            states: { bull: 'bullish', bear: 'bearish', flat: 'neutral', na: 'no data' },
            vol: ['calm', 'elevated', 'stress'],
            direction: { bull: 'up', bear: 'down' },
            consensus: 'Consensus',
            wholeMarket: 'whole market',
            aligned: 'layers aligned',
            notAligned: 'no consensus',
            noneAligned: 'No market has its layers aligned today — that is information too.',
            inTerminal: 'In the Terminal',
            openTerminal: 'Open the Terminal',
            aboutModule: 'About the module',
            rowClosed: 'Levels, stops and an if–then plan for this market, alerts at the moment of the event.',
            cellClosed: 'Full breakdown of the layer and alerts at the moment of the event.',
            notCovered: 'This layer does not cover the market yet.',
            demo: 'demo',
            demoBadge: 'Demo data',
            demoExcept: labels => `Demo, except ${labels}`,
            report: date => `report of ${date}`,
            snapshot: stamp => `Snapshot · ${stamp} MSK`,
            eventTime: time => `${time} MSK`,
            verdictAligned: (c, dir) => `${c.lead} of ${c.total} layers with data ${c.lead === 1 ? 'points' : 'point'} ${dir}, none against.`,
            verdictSplit: c => `Layers disagree: ${c.bull} up, ${c.bear} down.`,
            verdictShort: (c, dir, min) => `${c.lead} of ${c.total} layers with data ${c.lead === 1 ? 'points' : 'point'} ${dir} — consensus needs at least ${min}.`,
            verdictNone: 'No layer gives a direction.',
            verdictNoData: 'No layer that counts toward consensus has data for this market yet.',
            inDays: (d, h) => `in ${d}d ${h}h`,
            inHours: (h, m) => `in ${h}h ${m}m`,
            inMinutes: m => `in ${m}m`,
            subscribeStub: 'Prototype: the form is not connected yet, your address was not sent anywhere.',
            subscribeInvalid: 'Check the email address.',
            unavailable: 'The market snapshot is temporarily unavailable. Fresh data is in the Terminal.',
            regimeTitle: 'Volatility regime',
            regimes: { calm: 'calm', neutral: 'neutral', caution: 'cautious', stress: 'stress' },
            curves: {
                contango: 'VIX curve in contango', flat: 'VIX curve flat',
                spot_stress: 'stress in spot VIX', backwardation: 'VIX curve in backwardation'
            },
            regimeRank: rank => `VIX at percentile ${rank}`,
            regimeDate: date => `as of the ${date} close`
        }
    };
    const T = STRINGS[LANG];
    const HORIZONS = T.horizons;
    const STATE_LABELS = T.states;
    const VOL_LABELS = T.vol;
    const DIRECTION_WORDS = T.direction;
    const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const MSK = 'Europe/Moscow';

    const grid = document.getElementById('cmx');
    const statusEl = document.getElementById('cmxStatus');
    const detailEl = document.getElementById('cmxDetail');
    if (!grid || !statusEl || !detailEl) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let snapshot = null;
    let filter = 'all';

    function el(tag, props, ...children) {
        const node = document.createElement(tag);
        for (const [key, value] of Object.entries(props || {})) {
            if (value === null || value === undefined || value === false) continue;
            if (key === 'class') node.className = value;
            else if (key === 'text') node.textContent = value;
            else node.setAttribute(key, value === true ? '' : value);
        }
        for (const child of children) if (child) node.append(child);
        return node;
    }

    /* ── Snapshot validation: anything malformed degrades to "no data" ── */
    /* Text may be a plain string or {ru, en}; a missing translation falls back to Russian */
    function text(value, max) {
        const localized = value && typeof value === 'object' ? value[LANG] || value.ru : value;
        return typeof localized === 'string' && localized.length <= max ? localized.trim() : '';
    }

    /* Labels of a context layer's three levels; without them the volatility wording is used */
    function scale(value) {
        const labels = value && typeof value === 'object' ? value[LANG] || value.ru : null;
        return Array.isArray(labels) && labels.length === 3 && labels.every(l => text(l, 16))
            ? labels.map(l => text(l, 16))
            : null;
    }

    function layerPath(value) {
        return typeof value === 'string' && /^\/next\/layers\/[a-z0-9_-]+\.json$/.test(value) ? value : null;
    }

    function httpsUrl(value) {
        try {
            const url = new URL(value);
            return url.protocol === 'https:' ? url.href : null;
        } catch (_) {
            return null;
        }
    }

    function normalizeCell(raw, layer) {
        const cell = { state: 'na', level: null, metric: '', note: '', scale: layer.scale };
        if (!raw || typeof raw !== 'object') return cell;
        if (layer.votes) {
            cell.state = { 1: 'bull', '-1': 'bear', 0: 'flat' }[raw.signal] || 'na';
            if (typeof raw.signal !== 'number') cell.state = 'na';
        } else if ([0, 1, 2].includes(raw.level)) {
            cell.state = 'ctx';
            cell.level = raw.level;
        }
        if (cell.state !== 'na') {
            cell.metric = text(raw.metric, 12);
            cell.note = text(raw.note, 240);
        }
        return cell;
    }

    function normalizeSnapshot(raw) {
        if (!raw || raw.schema !== 1 || !Array.isArray(raw.layers) || !Array.isArray(raw.instruments)) {
            throw new Error('Unsupported snapshot format');
        }
        const layers = raw.layers
            .filter(l => l && text(l.id, 24) && text(l.label, 24) && HORIZONS[l.horizon])
            .map(l => ({
                id: text(l.id, 24),
                label: text(l.label, 24),
                short: text(l.short, 6) || text(l.label, 24),
                horizon: l.horizon,
                votes: l.votes === true,
                scale: scale(l.scale),
                about: text(l.about, 240),
                closed: text(l.closed, 240),
                url: httpsUrl(l.url),
                source: layerPath(l.source),
                live: null
            }));
        const voting = layers.filter(l => l.votes);
        const instruments = raw.instruments
            .filter(i => i && text(i.id, 8) && text(i.name, 40))
            .map(i => {
                const cells = {};
                for (const layer of layers) cells[layer.id] = normalizeCell((i.cells || {})[layer.id], layer);
                return { id: text(i.id, 8), name: text(i.name, 40), cells, consensus: null };
            });
        if (!voting.length || !instruments.length) throw new Error('Snapshot has no layers or instruments');

        const generated = new Date(raw.generated_at);
        return {
            demo: raw.demo === true,
            generatedAt: Number.isNaN(generated.getTime()) ? null : generated,
            layers, voting, instruments,
            eventsSource: layerPath(raw.events_source),
            events: [],
            regimeSource: layerPath(raw.regime_source),
            regime: null
        };
    }

    /* The calendar file is public schedule only: a title, a market and a UTC time */
    function normalizeEvents(raw) {
        if (!raw || raw.schema !== 1 || raw.layer !== 'calendar' || !Array.isArray(raw.events)) return [];
        return raw.events
            .map(e => ({ title: text(e && e.title, 60), asset: text(e && e.asset, 24), at: new Date(e && e.at) }))
            .filter(e => e.title && !Number.isNaN(e.at.getTime()))
            .sort((a, b) => a.at - b.at);
    }

    /* The VIX file is one reading for the whole page: a regime step, a curve shape and a percentile */
    function normalizeRegime(raw) {
        if (!raw || raw.schema !== 1 || raw.layer !== 'vix' || typeof raw.report_date !== 'string') return null;
        const reportDate = new Date(`${raw.report_date}T00:00:00Z`);
        const rank = raw.vix_percentile;
        const known = (labels, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(labels, key);
        if (Number.isNaN(reportDate.getTime()) || !known(T.regimes, raw.regime)
            || !known(T.curves, raw.curve) || !Number.isInteger(rank) || rank < 0 || rank > 100) return null;
        return { regime: raw.regime, curve: raw.curve, rank, reportDate };
    }

    /* A layer with its own file replaces that column; if the file is missing the column reads "no data" */
    function applyLayer(data, layer, raw) {
        const reportDate = raw && typeof raw.report_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.report_date)
            ? new Date(`${raw.report_date}T00:00:00Z`)
            : null;
        const valid = reportDate && !Number.isNaN(reportDate.getTime())
            && reportDate.toISOString().slice(0, 10) === raw.report_date
            && raw.schema === 1 && raw.layer === layer.id
            && raw.cells && typeof raw.cells === 'object';
        for (const instrument of data.instruments) {
            instrument.cells[layer.id] = normalizeCell(valid ? raw.cells[instrument.id] : null, layer);
        }
        if (valid) layer.live = { source: text(raw.source, 24), reportDate };
    }

    function liveLabel(layer) {
        return [layer.live.source, T.report(reportFormat.format(layer.live.reportDate))].filter(Boolean).join(', ');
    }

    /* Counted over the layers that have data; MIN_ALIGNED on one side still means at least that many have it */
    function consensus(instrument, voting) {
        const states = voting.map(layer => instrument.cells[layer.id].state);
        const bull = states.filter(s => s === 'bull').length;
        const bear = states.filter(s => s === 'bear').length;
        const lead = Math.max(bull, bear);
        return {
            states, bull, bear, lead,
            total: states.filter(s => s !== 'na').length,
            dir: bull > bear ? 'bull' : bear > bull ? 'bear' : 'flat',
            aligned: lead >= MIN_ALIGNED && Math.min(bull, bear) === 0
        };
    }

    /* ── Building blocks ── */
    function glyph() { return el('span', { class: 'cmx-glyph', 'aria-hidden': 'true' }); }

    function meter(level) {
        return el('span', { class: 'cmx-meter', 'data-level': String(level), 'aria-hidden': 'true' },
            el('i'), el('i'), el('i'));
    }

    function mark(cell) { return cell.state === 'ctx' ? meter(cell.level) : glyph(); }

    function stateLabel(cell) {
        return cell.state === 'ctx' ? (cell.scale || VOL_LABELS)[cell.level] : STATE_LABELS[cell.state];
    }

    function scoreText(c) { return `${c.lead}/${c.total}`; }

    /* ── Matrix ── */
    function renderMatrix() {
        const { layers, instruments } = snapshot;
        const horizonRow = el('div', { class: 'cmx-row', 'aria-hidden': 'true' }, el('span'));
        for (let i = 0; i < layers.length;) {
            let span = 1;
            while (i + span < layers.length && layers[i + span].horizon === layers[i].horizon) span++;
            const head = el('span', { class: 'cmx-horizon', text: HORIZONS[layers[i].horizon] });
            head.style.gridColumn = `span ${span}`;
            horizonRow.append(head);
            i += span;
        }

        const headRow = el('div', { class: 'cmx-row', 'aria-hidden': 'true' }, el('span'));
        for (const layer of layers) {
            headRow.append(el('span', { class: `cmx-col${layer.live ? ' is-live' : ''}` },
                el('span', { class: 'cmx-long', text: layer.label }),
                el('span', { class: 'cmx-short', text: layer.short })));
        }
        headRow.append(el('span', { class: 'cmx-col', text: T.consensus }));

        const rows = instruments.map((instrument, index) => {
            const c = instrument.consensus;
            const row = el('div', { class: `cmx-row${c.aligned ? ' is-aligned' : ''}`, 'data-r': String(index) });
            row.append(el('button', {
                class: 'cmx-btn cmx-name', type: 'button', 'data-kind': 'row',
                'aria-label': `${instrument.name}: ${T.wholeMarket}`
            }, el('span', { class: 'cmx-ticker', text: instrument.id }),
               el('span', { class: 'cmx-fullname', text: instrument.name })));

            for (const layer of layers) {
                const cell = instrument.cells[layer.id];
                row.append(el('button', {
                    class: 'cmx-btn cmx-cell', type: 'button', 'data-kind': 'cell',
                    'data-layer': layer.id, 'data-s': cell.state,
                    'aria-label': `${instrument.name}, ${layer.label}: ${stateLabel(cell)}${cell.metric ? `, ${cell.metric}` : ''}`
                }, mark(cell), cell.metric && el('span', { class: 'cmx-metric', text: cell.metric })));
            }

            const bar = el('span', { class: 'cmx-bar', 'aria-hidden': 'true' });
            for (const state of c.states) bar.append(el('i', { 'data-s': state }));
            row.append(el('button', {
                class: 'cmx-btn cmx-sum', type: 'button', 'data-kind': 'row',
                'aria-label': `${instrument.name}, ${T.consensus}: ${scoreText(c)} ${DIRECTION_WORDS[c.dir] || ''}${c.aligned ? `, ${T.aligned}` : ''}`
            }, bar, el('span', { class: 'cmx-score' },
                el('span', { text: scoreText(c) }),
                el('span', { class: 'cmx-score-dir', 'data-s': c.dir }, glyph()))));
            return row;
        });

        grid.replaceChildren(horizonRow, headRow, ...rows);
    }

    function dataRows() { return [...grid.querySelectorAll('.cmx-row[data-r]')]; }

    function applyFilter() {
        let visible = 0;
        for (const row of dataRows()) {
            row.hidden = filter === 'aligned' && !snapshot.instruments[Number(row.dataset.r)].consensus.aligned;
            if (!row.hidden) visible++;
        }
        statusEl.hidden = visible > 0;
        if (!visible) statusEl.textContent = T.noneAligned;
        document.querySelectorAll('.cmx-filter-btn').forEach(btn => {
            btn.setAttribute('aria-pressed', String(btn.dataset.filter === filter));
        });
        const active = grid.querySelector('.cmx-btn.is-active');
        const firstVisible = dataRows().find(row => !row.hidden);
        const target = active && !active.parentElement.hidden
            ? active
            : firstVisible && firstVisible.querySelector('.cmx-name');
        if (!target) detailEl.hidden = true;
        else if (target !== active || detailEl.hidden) select(target);
    }

    /* ── Reading panel ── */
    function closedBlock(body, moduleUrl) {
        const links = el('div', { class: 'cmx-closed-links' },
            el('a', { class: 'btn', href: TERMINAL_URL, target: '_blank', rel: 'noopener noreferrer', text: T.openTerminal }),
            moduleUrl && el('a', { class: 'btn', href: moduleUrl, target: '_blank', rel: 'noopener noreferrer', text: T.aboutModule }));
        return el('div', { class: 'cmx-closed' },
            el('span', { class: 'cmx-detail-kicker', text: T.inTerminal }),
            el('p', { text: body }), links);
    }

    function verdict(c) {
        if (c.aligned) return T.verdictAligned(c, DIRECTION_WORDS[c.dir]);
        if (c.bull && c.bear) return T.verdictSplit(c);
        if (c.lead) return T.verdictShort(c, DIRECTION_WORDS[c.dir], MIN_ALIGNED);
        return c.total ? T.verdictNone : T.verdictNoData;
    }

    function renderRowDetail(instrument) {
        const c = instrument.consensus;
        const lines = el('ul', { class: 'cmx-lines' });
        for (const layer of snapshot.layers) {
            const cell = instrument.cells[layer.id];
            const body = cell.state === 'na'
                ? STATE_LABELS.na
                : [cell.metric, cell.note || stateLabel(cell)].filter(Boolean).join(' — ');
            lines.append(el('li', { class: 'cmx-line' },
                el('span', { class: 'cmx-line-label', text: layer.label }),
                el('span', { class: 'cmx-line-mark', 'data-s': cell.state }, mark(cell)),
                el('span', { text: body })));
        }
        const chip = c.aligned
            ? el('span', { class: 'cmx-state is-aligned', 'data-s': c.dir }, glyph(), el('span', { text: T.aligned }))
            : el('span', { class: 'cmx-state', text: T.notAligned });
        return [
            el('div', null,
                el('span', { class: 'cmx-detail-kicker', text: `${instrument.id} · ${T.wholeMarket}` }),
                el('h3', { class: 'cmx-detail-title' }, el('span', { text: instrument.name }), chip),
                el('p', { class: 'cmx-detail-text', text: verdict(c) }),
                lines),
            closedBlock(T.rowClosed, null)
        ];
    }

    function renderCellDetail(instrument, layer) {
        const cell = instrument.cells[layer.id];
        const chip = el('span', { class: 'cmx-state', 'data-s': cell.state }, mark(cell),
            el('span', { text: [stateLabel(cell), cell.metric].filter(Boolean).join(' · ') }));
        const note = cell.state === 'na' ? T.notCovered : cell.note;
        const origin = layer.live ? liveLabel(layer) : snapshot.demo ? T.demo : '';
        const closed = layer.closed ? layer.closed.charAt(0).toUpperCase() + layer.closed.slice(1) + '.' : '';
        return [
            el('div', null,
                el('span', { class: 'cmx-detail-kicker', text: [HORIZONS[layer.horizon], layer.label, origin].filter(Boolean).join(' · ') }),
                el('h3', { class: 'cmx-detail-title' }, el('span', { text: instrument.name }), chip),
                note && el('p', { class: 'cmx-detail-text', text: note }),
                layer.about && el('p', { class: 'cmx-detail-about', text: layer.about })),
            closedBlock(closed || T.cellClosed, layer.url)
        ];
    }

    function select(button) {
        const row = button.parentElement;
        const instrument = snapshot.instruments[Number(row.dataset.r)];
        if (!instrument) return;
        grid.querySelectorAll('.cmx-btn.is-active').forEach(b => b.classList.remove('is-active'));
        button.classList.add('is-active');
        const layer = button.dataset.kind === 'cell' && snapshot.layers.find(l => l.id === button.dataset.layer);
        detailEl.replaceChildren(...(layer ? renderCellDetail(instrument, layer) : renderRowDetail(instrument)));
        detailEl.hidden = false;
    }

    /* ── Stamp + events ── */
    const stampFormat = new Intl.DateTimeFormat(T.locale, {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: MSK
    });
    const reportFormat = new Intl.DateTimeFormat(T.locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
    const eventFormat = new Intl.DateTimeFormat(T.locale, {
        weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: MSK
    });

    function countdown(ms) {
        const minutes = Math.floor(ms / 60000);
        const d = Math.floor(minutes / 1440), h = Math.floor((minutes % 1440) / 60), m = minutes % 60;
        if (d) return T.inDays(d, h);
        if (h) return T.inHours(h, m);
        return T.inMinutes(Math.max(m, 1));
    }

    function renderEvents() {
        const box = document.getElementById('cmxEvents');
        const list = document.getElementById('cmxEventsList');
        if (!box || !list) return;
        const now = Date.now();
        const upcoming = snapshot.events.filter(e => e.at.getTime() > now).slice(0, MAX_EVENTS);
        list.replaceChildren(...upcoming.map(e => el('li', null,
            el('b', { text: e.title }),
            ` ${e.asset ? `· ${e.asset} ` : ''}· ${T.eventTime(eventFormat.format(e.at))} · `,
            el('span', { class: 'cmx-in', text: countdown(e.at.getTime() - now) }))));
        box.hidden = upcoming.length === 0;
    }

    function renderRegime() {
        const r = snapshot.regime;
        if (!r) return;
        grid.before(el('p', { class: 'cmx-regime', 'data-regime': r.regime },
            el('span', { class: 'cmx-regime-title', text: T.regimeTitle }),
            el('b', { text: T.regimes[r.regime] }),
            ` · ${T.curves[r.curve]} · ${T.regimeRank(r.rank)} · ${T.regimeDate(reportFormat.format(r.reportDate))}`));
    }

    function renderMeta() {
        const demo = document.getElementById('cmxDemo');
        const stamp = document.getElementById('cmxStamp');
        const live = snapshot.layers.filter(layer => layer.live);
        if (demo) {
            demo.hidden = !snapshot.demo;
            demo.textContent = live.length ? T.demoExcept(live.map(layer => layer.label).join(', ')) : T.demoBadge;
        }
        if (!stamp) return;
        if (live.length) stamp.textContent = live.map(layer => `${layer.label}: ${liveLabel(layer)}`).join(' · ');
        else stamp.textContent = snapshot.generatedAt ? T.snapshot(stampFormat.format(snapshot.generatedAt)) : '';
    }

    /* ── Wiring ── */
    grid.addEventListener('click', event => {
        const button = event.target.closest('.cmx-btn');
        if (!button || !snapshot) return;
        select(button);
        detailEl.scrollIntoView({ block: 'nearest', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    });

    grid.addEventListener('keydown', event => {
        const step = ARROWS[event.key];
        const button = step && event.target.closest('.cmx-btn');
        if (!button) return;
        const rows = dataRows().filter(row => !row.hidden);
        const r = rows.indexOf(button.parentElement) + step[1];
        const c = [...button.parentElement.children].indexOf(button) + step[0];
        const next = rows[r] && rows[r].children[c];
        if (next) {
            event.preventDefault();
            next.focus();
        }
    });

    document.querySelectorAll('.cmx-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!snapshot || btn.dataset.filter === filter) return;
            filter = btn.dataset.filter;
            applyFilter();
        });
    });

    const subscribeForm = document.getElementById('subscribe');
    if (subscribeForm) {
        subscribeForm.addEventListener('submit', event => {
            event.preventDefault();
            const input = document.getElementById('subscribeEmail');
            const status = document.getElementById('subscribeStatus');
            const valid = input.value.trim() !== '' && input.checkValidity();
            status.classList.toggle('is-error', !valid);
            status.textContent = valid
                ? T.subscribeStub
                : T.subscribeInvalid;
            if (!valid) input.focus();
        });
    }

    async function fetchJson(url) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
            const response = await fetch(url, { signal: controller.signal, cache: 'no-cache' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } finally {
            clearTimeout(timer);
        }
    }

    async function loadSnapshot() {
        const data = normalizeSnapshot(await fetchJson(SNAPSHOT_URL));
        await Promise.all(data.layers.filter(layer => layer.source).map(async layer => {
            const raw = await fetchJson(layer.source).catch(error => {
                console.warn(`Consensus matrix: layer ${layer.id}:`, error);
                return null;
            });
            applyLayer(data, layer, raw);
        }));
        for (const instrument of data.instruments) instrument.consensus = consensus(instrument, data.voting);
        if (data.eventsSource) {
            data.events = normalizeEvents(await fetchJson(data.eventsSource).catch(error => {
                console.warn('Consensus matrix: calendar:', error);
                return null;
            }));
        }
        if (data.regimeSource) {
            data.regime = normalizeRegime(await fetchJson(data.regimeSource).catch(error => {
                console.warn('Consensus matrix: VIX regime:', error);
                return null;
            }));
        }
        return data;
    }

    loadSnapshot().then(data => {
        snapshot = data;
        renderMeta();
        renderRegime();
        renderMatrix();
        const aligned = dataRows().find(row => row.classList.contains('is-aligned'));
        select((aligned || dataRows()[0]).querySelector('.cmx-name'));
        applyFilter();
        renderEvents();
        if (snapshot.events.length) setInterval(renderEvents, 60000);
    }).catch(error => {
        console.warn('Consensus matrix:', error);
        statusEl.hidden = false;
        statusEl.textContent = T.unavailable;
    });
})();
