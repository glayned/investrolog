(() => {
    'use strict';

    const SNAPSHOT_URL = '/next/snapshot.json';
    const FETCH_TIMEOUT_MS = 8000;
    const MIN_ALIGNED = 4;
    const MAX_EVENTS = 3;
    const TERMINAL_URL = 'https://t.me/investrolog';
    const HORIZONS = { weeks: 'Недели', days: 'Дни', minutes: 'Минуты', context: 'Фон' };
    const STATE_LABELS = { bull: 'бычий', bear: 'медвежий', flat: 'нейтрально', na: 'нет данных' };
    const VOL_LABELS = ['спокойно', 'повышена', 'стресс'];
    const DIRECTION_WORDS = { bull: 'вверх', bear: 'вниз' };
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

    /* ── Snapshot validation: anything malformed degrades to "нет данных" ── */
    function text(value, max) {
        return typeof value === 'string' && value.length <= max ? value.trim() : '';
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
        const cell = { state: 'na', level: null, metric: '', note: '' };
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
                about: text(l.about, 240),
                closed: text(l.closed, 240),
                url: httpsUrl(l.url)
            }));
        const voting = layers.filter(l => l.votes);
        const instruments = raw.instruments
            .filter(i => i && text(i.id, 8) && text(i.name, 40))
            .map(i => {
                const cells = {};
                for (const layer of layers) cells[layer.id] = normalizeCell((i.cells || {})[layer.id], layer);
                const instrument = { id: text(i.id, 8), name: text(i.name, 40), cells };
                instrument.consensus = consensus(instrument, voting);
                return instrument;
            });
        if (!voting.length || !instruments.length) throw new Error('Snapshot has no layers or instruments');

        const generated = new Date(raw.generated_at);
        const events = (Array.isArray(raw.events) ? raw.events : [])
            .map(e => ({ title: text(e && e.title, 60), asset: text(e && e.asset, 24), at: new Date(e && e.at) }))
            .filter(e => e.title && !Number.isNaN(e.at.getTime()))
            .sort((a, b) => a.at - b.at);

        return {
            demo: raw.demo === true,
            generatedAt: Number.isNaN(generated.getTime()) ? null : generated,
            layers, voting, instruments, events
        };
    }

    function consensus(instrument, voting) {
        const states = voting.map(layer => instrument.cells[layer.id].state);
        const bull = states.filter(s => s === 'bull').length;
        const bear = states.filter(s => s === 'bear').length;
        const lead = Math.max(bull, bear);
        return {
            states, bull, bear, lead,
            total: voting.length,
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
        return cell.state === 'ctx' ? VOL_LABELS[cell.level] : STATE_LABELS[cell.state];
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
            headRow.append(el('span', { class: 'cmx-col' },
                el('span', { class: 'cmx-long', text: layer.label }),
                el('span', { class: 'cmx-short', text: layer.short })));
        }
        headRow.append(el('span', { class: 'cmx-col', text: 'Согласие' }));

        const rows = instruments.map((instrument, index) => {
            const c = instrument.consensus;
            const row = el('div', { class: `cmx-row${c.aligned ? ' is-aligned' : ''}`, 'data-r': String(index) });
            row.append(el('button', {
                class: 'cmx-btn cmx-name', type: 'button', 'data-kind': 'row',
                'aria-label': `${instrument.name}: рынок целиком`
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
                'aria-label': `${instrument.name}, согласие: ${scoreText(c)} ${DIRECTION_WORDS[c.dir] || ''}${c.aligned ? ', слои сошлись' : ''}`
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
        if (!visible) statusEl.textContent = 'Сегодня слои нигде не сошлись — это тоже информация.';
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
            el('a', { class: 'btn', href: TERMINAL_URL, target: '_blank', rel: 'noopener noreferrer', text: 'Открыть Терминал' }),
            moduleUrl && el('a', { class: 'btn', href: moduleUrl, target: '_blank', rel: 'noopener noreferrer', text: 'О модуле' }));
        return el('div', { class: 'cmx-closed' },
            el('span', { class: 'cmx-detail-kicker', text: 'В Терминале' }),
            el('p', { text: body }), links);
    }

    function verdict(c) {
        const verb = c.lead === 1 ? 'смотрит' : 'смотрят';
        if (c.aligned) return `${c.lead} из ${c.total} слоёв ${verb} ${DIRECTION_WORDS[c.dir]}, против — ни одного.`;
        if (c.bull && c.bear) return `Слои расходятся: ${c.bull} вверх, ${c.bear} вниз.`;
        if (c.lead) return `${c.lead} из ${c.total} слоёв ${verb} ${DIRECTION_WORDS[c.dir]} — для согласия нужно не меньше ${MIN_ALIGNED}.`;
        return 'Ни один слой не даёт направления.';
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
            ? el('span', { class: 'cmx-state is-aligned', 'data-s': c.dir }, glyph(), el('span', { text: 'слои сошлись' }))
            : el('span', { class: 'cmx-state', text: 'согласия нет' });
        return [
            el('div', null,
                el('span', { class: 'cmx-detail-kicker', text: `${instrument.id} · рынок целиком` }),
                el('h3', { class: 'cmx-detail-title' }, el('span', { text: instrument.name }), chip),
                el('p', { class: 'cmx-detail-text', text: verdict(c) }),
                lines),
            closedBlock('Уровни, стопы и план «если – то» по этому рынку, алерты в момент события.', null)
        ];
    }

    function renderCellDetail(instrument, layer) {
        const cell = instrument.cells[layer.id];
        const chip = el('span', { class: 'cmx-state', 'data-s': cell.state }, mark(cell),
            el('span', { text: [stateLabel(cell), cell.metric].filter(Boolean).join(' · ') }));
        const note = cell.state === 'na' ? 'Этот слой пока не покрывает рынок.' : cell.note;
        const closed = layer.closed ? layer.closed.charAt(0).toUpperCase() + layer.closed.slice(1) + '.' : '';
        return [
            el('div', null,
                el('span', { class: 'cmx-detail-kicker', text: `${HORIZONS[layer.horizon]} · ${layer.label}` }),
                el('h3', { class: 'cmx-detail-title' }, el('span', { text: instrument.name }), chip),
                note && el('p', { class: 'cmx-detail-text', text: note }),
                layer.about && el('p', { class: 'cmx-detail-about', text: layer.about })),
            closedBlock(closed || 'Полный разбор слоя и алерты в момент события.', layer.url)
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
    const stampFormat = new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: MSK
    });
    const eventFormat = new Intl.DateTimeFormat('ru-RU', {
        weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: MSK
    });

    function countdown(ms) {
        const minutes = Math.floor(ms / 60000);
        const d = Math.floor(minutes / 1440), h = Math.floor((minutes % 1440) / 60), m = minutes % 60;
        if (d) return `через ${d} д ${h} ч`;
        if (h) return `через ${h} ч ${m} мин`;
        return `через ${Math.max(m, 1)} мин`;
    }

    function renderEvents() {
        const box = document.getElementById('cmxEvents');
        const list = document.getElementById('cmxEventsList');
        if (!box || !list) return;
        const now = Date.now();
        const upcoming = snapshot.events.filter(e => e.at.getTime() > now).slice(0, MAX_EVENTS);
        list.replaceChildren(...upcoming.map(e => el('li', null,
            el('b', { text: e.title }),
            ` ${e.asset ? `· ${e.asset} ` : ''}· ${eventFormat.format(e.at)} МСК · `,
            el('span', { class: 'cmx-in', text: countdown(e.at.getTime() - now) }))));
        box.hidden = upcoming.length === 0;
    }

    function renderMeta() {
        const demo = document.getElementById('cmxDemo');
        const stamp = document.getElementById('cmxStamp');
        if (demo) demo.hidden = !snapshot.demo;
        if (stamp) stamp.textContent = snapshot.generatedAt ? `Снимок · ${stampFormat.format(snapshot.generatedAt)} МСК` : '';
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
                ? 'Прототип: форма ещё не подключена, адрес никуда не отправлен.'
                : 'Проверьте адрес почты.';
            if (!valid) input.focus();
        });
    }

    async function loadSnapshot() {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
            const response = await fetch(SNAPSHOT_URL, { signal: controller.signal, cache: 'no-cache' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return normalizeSnapshot(await response.json());
        } finally {
            clearTimeout(timer);
        }
    }

    loadSnapshot().then(data => {
        snapshot = data;
        renderMeta();
        renderMatrix();
        const aligned = dataRows().find(row => row.classList.contains('is-aligned'));
        select((aligned || dataRows()[0]).querySelector('.cmx-name'));
        applyFilter();
        renderEvents();
        if (snapshot.events.length) setInterval(renderEvents, 60000);
    }).catch(error => {
        console.warn('Consensus matrix:', error);
        statusEl.hidden = false;
        statusEl.textContent = 'Снимок рынка временно недоступен. Свежие данные — в Терминале.';
    });
})();
