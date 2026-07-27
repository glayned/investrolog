
/* ════════════════════════════════════════
   TYPING SOUND
════════════════════════════════════════ */
let audioContext;
let userInteracted = false;
['pointerdown', 'keydown'].forEach(ev =>
    window.addEventListener(ev, () => { userInteracted = true; }, { once: true, capture: true })
);

function initAudio() {
    if (!userInteracted) return;
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === 'suspended') {
        audioContext.resume().catch(() => {});
    }
}

function playTypingSound() {
    if (!audioContext || audioContext.state !== 'running') return;
    const osc1 = audioContext.createOscillator();
    const osc2 = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    osc1.connect(gain); osc2.connect(gain);
    gain.connect(filter); filter.connect(audioContext.destination);
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(110 + Math.random() * 50, audioContext.currentTime);
    osc1.frequency.exponentialRampToValueAtTime(40, audioContext.currentTime + 0.06);
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(550 + Math.random() * 200, audioContext.currentTime);
    osc2.frequency.exponentialRampToValueAtTime(120, audioContext.currentTime + 0.025);
    gain.gain.setValueAtTime(0, audioContext.currentTime);
    gain.gain.linearRampToValueAtTime(0.013, audioContext.currentTime + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.002, audioContext.currentTime + 0.08);
    osc1.start(audioContext.currentTime); osc1.stop(audioContext.currentTime + 0.08);
    osc2.start(audioContext.currentTime); osc2.stop(audioContext.currentTime + 0.03);
}

/* ════════════════════════════════════════
   CODE ANIMATION (logo click)
════════════════════════════════════════ */
let isAnimating = false;

function triggerCodeAnimation() {
    if (isAnimating) return;
    isAnimating = true;
    initAudio();

    const logoIcon = document.querySelector('.logo-icon');
    const codeText = document.getElementById('codeText');
    const code = `def analyze(report):\n    signals = parse(report)\n    return signals`;

    logoIcon.classList.add('hidden');
    codeText.textContent = '';
    codeText.style.display = 'inline-block';
    codeText.style.visibility = 'visible';
    codeText.style.opacity = '1';

    let i = 0;
    const iv = setInterval(() => {
        if (i < code.length) {
            codeText.textContent += code[i];
            if (code[i] !== ' ' && code[i] !== '\n') playTypingSound();
            i++;
        } else {
            clearInterval(iv);
            setTimeout(() => {
                codeText.style.transition = 'opacity 0.5s ease';
                codeText.style.opacity = '0';
                setTimeout(() => {
                    codeText.textContent = '';
                    codeText.style.display = 'none';
                    codeText.style.visibility = 'hidden';
                    codeText.style.transition = 'none';
                    logoIcon.classList.remove('hidden');
                    isAnimating = false;
                }, 500);
            }, 4000);
        }
    }, 45);
}

/* ════════════════════════════════════════
   MOTION / DISPLAY HELPERS
════════════════════════════════════════ */
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
function motionAllowed() { return !reducedMotionQuery.matches && !document.hidden; }
function getDpr() { return Math.min(window.devicePixelRatio || 1, 2); }

/* ════════════════════════════════════════
   PARTICLES
════════════════════════════════════════ */
const LINK_DIST = 110;
const LINK_DIST_SQ = LINK_DIST * LINK_DIST;
const MAX_PARTICLES = 220;

class Particle {
    constructor(w, h) {
        this.reset(w, h);
    }
    reset(w, h) {
        this.x = Math.random() * w;
        this.y = Math.random() * h;
        this.baseX = this.x;
        this.baseY = this.y;
        this.size = Math.random() * 2.2 + 0.8;
        this.speedX = (Math.random() - 0.5) * 0.4;
        this.speedY = (Math.random() - 0.5) * 0.4;
    }
    update(mouse, w, h) {
        if (mouse.x != null && mouse.y != null) {
            const dx = mouse.x - this.x, dy = mouse.y - this.y;
            const d = Math.sqrt(dx*dx + dy*dy);
            if (d > 0 && d < mouse.radius) {
                const f = (mouse.radius - d) / mouse.radius;
                this.x -= (dx/d) * f * 3;
                this.y -= (dy/d) * f * 3;
            }
        }
        this.x += (this.baseX - this.x) * 0.05;
        this.y += (this.baseY - this.y) * 0.05;
        this.baseX += this.speedX;
        this.baseY += this.speedY;
        if (this.baseX < 0 || this.baseX > w) {
            this.baseX = Math.max(0, Math.min(this.baseX, w));
            this.speedX *= -1;
        }
        if (this.baseY < 0 || this.baseY > h) {
            this.baseY = Math.max(0, Math.min(this.baseY, h));
            this.speedY *= -1;
        }
    }
    draw(ctx, isDark) {
        ctx.fillStyle = isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.55)';
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI*2);
        ctx.fill();
    }
}

class ParticlesSystem {
    constructor() {
        this.canvas = document.getElementById('particles-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.particles = [];
        this.mouse = { x: null, y: null, radius: 140 };
        this.running = false;
        this.resize();
        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => this.resize(), 150);
        });
        window.addEventListener('mousemove', e => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; });
        window.addEventListener('mouseout', e => {
            if (!e.relatedTarget) { this.mouse.x = null; this.mouse.y = null; }
        });
        document.addEventListener('visibilitychange', () => this.start());
        reducedMotionQuery.addEventListener('change', () => {
            if (reducedMotionQuery.matches) this.drawFrame(false); else this.start();
        });
        new MutationObserver(() => { if (!this.running) this.drawFrame(false); })
            .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        if (reducedMotionQuery.matches) this.drawFrame(false); else this.start();
    }
    resize() {
        const dpr = getDpr();
        this.w = window.innerWidth;
        this.h = window.innerHeight;
        this.canvas.width = this.w * dpr;
        this.canvas.height = this.h * dpr;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const target = Math.min(MAX_PARTICLES, Math.floor((this.w * this.h) / 16000));
        while (this.particles.length < target) this.particles.push(new Particle(this.w, this.h));
        if (this.particles.length > target) this.particles.length = target;
        if (reducedMotionQuery.matches) this.drawFrame(false);
    }
    start() {
        if (this.running || !motionAllowed()) return;
        this.running = true;
        requestAnimationFrame(() => this.tick());
    }
    tick() {
        if (!motionAllowed()) { this.running = false; return; }
        this.drawFrame(true);
        requestAnimationFrame(() => this.tick());
    }
    drawFrame(update) {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.w, this.h);
        // Spatial hash: only compare particles in neighbouring cells → ~O(n)
        const cell = LINK_DIST;
        const cols = Math.max(1, Math.ceil(this.w / cell));
        const grid = new Map();
        this.particles.forEach((p, i) => {
            if (update) p.update(this.mouse, this.w, this.h);
            p.draw(ctx, isDark);
            const key = Math.floor(p.x / cell) + Math.floor(p.y / cell) * cols;
            const bucket = grid.get(key);
            if (bucket) bucket.push(i); else grid.set(key, [i]);
        });
        ctx.lineWidth = 0.5;
        this.particles.forEach((p, i) => {
            const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell);
            for (let ny = cy; ny <= cy + 1; ny++) {
                for (let nx = cx - 1; nx <= cx + 1; nx++) {
                    if (ny === cy && nx < cx) continue; // visit each pair once
                    const bucket = grid.get(nx + ny * cols);
                    if (!bucket) continue;
                    for (const j of bucket) {
                        if (j <= i && ny === cy && nx === cx) continue;
                        const q = this.particles[j];
                        const dx = q.x - p.x, dy = q.y - p.y;
                        const d2 = dx*dx + dy*dy;
                        if (d2 < LINK_DIST_SQ) {
                            const op = (1 - Math.sqrt(d2)/LINK_DIST) * 0.25;
                            ctx.strokeStyle = isDark ? `rgba(255,255,255,${op})` : `rgba(0,0,0,${op})`;
                            ctx.beginPath();
                            ctx.moveTo(p.x, p.y);
                            ctx.lineTo(q.x, q.y);
                            ctx.stroke();
                        }
                    }
                }
            }
        });
    }
}

/* ════════════════════════════════════════
   PROJECT CANVAS ANIMATIONS
════════════════════════════════════════ */
const PROJECT_ANIMATIONS = {
    cot: animateCOT,
    vix: animateVIX,
    options: animateOptions,
    ng: animateNG
};

function sizeProjectCanvas(canvas) {
    const dpr = getDpr();
    const parent = canvas.parentElement;
    canvas._w = parent.offsetWidth;
    canvas._h = parent.offsetHeight;
    canvas.width = canvas._w * dpr;
    canvas.height = canvas._h * dpr;
    canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
}

function startProjectCanvas(canvas) {
    if (canvas._running) return;
    if (!canvas._inView || !motionAllowed()) return;
    canvas._running = true;
    requestAnimationFrame(canvas._tick);
}

function initProjectCanvases() {
    const canvases = [...document.querySelectorAll('.proj-canvas')];
    const io = new IntersectionObserver(entries => {
        entries.forEach(e => {
            e.target._inView = e.isIntersecting;
            startProjectCanvas(e.target);
        });
    }, { rootMargin: '80px' });

    canvases.forEach(canvas => {
        const animate = PROJECT_ANIMATIONS[canvas.dataset.type];
        if (!animate) return;
        sizeProjectCanvas(canvas);
        const drawFrame = animate(canvas);
        canvas._draw = drawFrame;
        canvas._inView = false;
        canvas._running = false;
        canvas._tick = () => {
            if (!canvas._inView || !motionAllowed()) { canvas._running = false; return; }
            drawFrame();
            requestAnimationFrame(canvas._tick);
        };
        drawFrame(); // static first frame (also covers prefers-reduced-motion)
        io.observe(canvas);
    });

    document.addEventListener('visibilitychange', () => canvases.forEach(startProjectCanvas));
    reducedMotionQuery.addEventListener('change', () => canvases.forEach(startProjectCanvas));
}

function animateCOT(canvas) {
    const ctx = canvas.getContext('2d');
    const bars = 20;
    let t = 0;

    return function draw() {
        const W = canvas._w, H = canvas._h;
        ctx.clearRect(0, 0, W, H);
        const bw = W / (bars * 1.6);
        const gap = W / bars;
        for (let i = 0; i < bars; i++) {
            const x = i * gap + gap * 0.3;
            const h = (0.35 + 0.45 * Math.abs(Math.sin(i * 0.7 + t))) * H * 0.7;
            // Continuous red↔green crossfade: colour follows the full sine wave,
            // eased with smoothstep, so each bar drifts gradually between colours
            const s = Math.sin(i * 0.9 + t * 0.15);
            const m = 0.5 + 0.5 * s;
            const mix = m * m * (3 - 2 * m);
            const rC = Math.round(231 + (46 - 231) * mix);
            const gC = Math.round(76 + (204 - 76) * mix);
            const bC = Math.round(60 + (113 - 60) * mix);
            ctx.fillStyle = `rgba(${rC},${gC},${bC},0.6)`;
            ctx.fillRect(x, H - h - H*0.1, bw, h);
            ctx.strokeStyle = `rgb(${rC},${gC},${bC})`;
            ctx.lineWidth = 1;
            ctx.strokeRect(x, H - h - H*0.1, bw, h);
        }
        // Moving average line
        ctx.beginPath();
        ctx.strokeStyle = '#f39c1299';
        ctx.lineWidth = 1.5;
        for (let i = 0; i < W; i++) {
            const y = H * 0.45 + Math.sin(i * 0.04 + t) * H * 0.12;
            if (i === 0) ctx.moveTo(i, y); else ctx.lineTo(i, y);
        }
        ctx.stroke();
        t += 0.006;
    };
}

function animateVIX(canvas) {
    const ctx = canvas.getContext('2d');
    let t = 0;

    return function draw() {
        const W = canvas._w, H = canvas._h;
        ctx.clearRect(0, 0, W, H);
        // Contango curve
        ctx.beginPath();
        const grad = ctx.createLinearGradient(0, 0, W, 0);
        grad.addColorStop(0, '#3498db');
        grad.addColorStop(1, '#9b59b6');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 2;
        for (let x = 0; x < W; x++) {
            const pct = x / W;
            const base = H * 0.65;
            const curve = -pct * H * 0.35 + Math.sin(pct * 6 + t) * H * 0.04;
            const y = base + curve;
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        // Fill under curve
        ctx.beginPath();
        const gradFill = ctx.createLinearGradient(0, 0, 0, H);
        gradFill.addColorStop(0, 'rgba(52,152,219,0.15)');
        gradFill.addColorStop(1, 'rgba(52,152,219,0)');
        ctx.fillStyle = gradFill;
        for (let x = 0; x < W; x++) {
            const pct = x / W;
            const base = H * 0.65;
            const curve = -pct * H * 0.35 + Math.sin(pct * 6 + t) * H * 0.04;
            const y = base + curve;
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
        // Scatter dots (term structure nodes)
        const months = 6;
        for (let i = 0; i < months; i++) {
            const pct = (i + 0.5) / months;
            const base = H * 0.65;
            const y = base - pct * H * 0.35 + Math.sin(pct * 6 + t) * H * 0.04;
            ctx.beginPath();
            ctx.arc(pct * W, y, 4, 0, Math.PI*2);
            ctx.fillStyle = '#3498db';
            ctx.fill();
            ctx.strokeStyle = '#fff3';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
        t += 0.01;
    };
}

function animateOptions(canvas) {
    const ctx = canvas.getContext('2d');
    let t = 0;

    return function draw() {
        const W = canvas._w, H = canvas._h;
        ctx.clearRect(0, 0, W, H);
        const strikes = 14;
        const sw = W / (strikes + 1);
        // Max pain highlight
        const maxPainIdx = 7;
        ctx.fillStyle = 'rgba(243,156,18,0.08)';
        ctx.fillRect(maxPainIdx * sw - sw/2, 0, sw, H);

        for (let i = 1; i <= strikes; i++) {
            const x = i * sw;
            // Calls (green) — two-harmonic oscillation for livelier, wider swings
            const callOsc = Math.sin(t + i) * 0.07 + Math.sin(t * 0.6 + i * 1.7) * 0.04;
            const callH = Math.max(0.03, 0.1 + 0.6 * Math.pow(Math.max(0, 1 - Math.abs(i - maxPainIdx) / 6), 1.4) + callOsc) * H * 0.75;
            ctx.fillStyle = 'rgba(46,204,113,0.55)';
            ctx.fillRect(x - sw*0.28, H - callH - H*0.08, sw*0.25, callH);
            // Puts (red)
            const putOsc = Math.cos(t * 1.1 + i) * 0.07 + Math.cos(t * 0.7 + i * 2.3) * 0.04;
            const putH = Math.max(0.03, 0.08 + 0.5 * Math.pow(Math.max(0, 1 - Math.abs(i - maxPainIdx + 1) / 6), 1.3) + putOsc) * H * 0.75;
            ctx.fillStyle = 'rgba(231,76,60,0.55)';
            ctx.fillRect(x + sw*0.03, H - putH - H*0.08, sw*0.25, putH);
        }
        // IV smile curve
        ctx.beginPath();
        ctx.strokeStyle = '#f39c1288';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4,4]);
        for (let x = 0; x < W; x++) {
            const pct = x / W;
            const smile = H*0.55 - H*0.3*Math.exp(-Math.pow((pct-0.5)*3.5,2)) + Math.sin(t*0.8 + pct*2.5)*H*0.03;
            if (x === 0) ctx.moveTo(x, smile); else ctx.lineTo(x, smile);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        t += 0.02;
    };
}

function animateNG(canvas) {
    const ctx = canvas.getContext('2d');
    let t = 0;
    const ensembles = 12;

    return function draw() {
        const W = canvas._w, H = canvas._h;
        ctx.clearRect(0, 0, W, H);
        // Ensemble forecast paths
        for (let e = 0; e < ensembles; e++) {
            ctx.beginPath();
            const alpha = 0.12 + (e === Math.floor(ensembles/2) ? 0.5 : 0);
            const isMean = e === Math.floor(ensembles/2);
            ctx.strokeStyle = isMean ? `rgba(52,152,219,0.8)` : `rgba(100,180,255,${alpha})`;
            ctx.lineWidth = isMean ? 2 : 1;
            for (let x = 0; x < W; x++) {
                const pct = x / W;
                const base = H * 0.5;
                const trend = -pct * H * 0.1;
                const wave = Math.sin(pct * 5 + t + e * 0.6) * H * (0.08 + e * 0.012);
                const y = base + trend + wave;
                if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
        // Signal markers
        const sigX = [(W*0.25), (W*0.5), (W*0.78)];
        sigX.forEach((sx, idx) => {
            const sy = H * 0.5 - H * 0.1 * (sx/W) + Math.sin(sx/W * 5 + t) * H * 0.08;
            const isLong = idx % 2 === 0;
            ctx.beginPath();
            ctx.arc(sx, sy, 5, 0, Math.PI*2);
            ctx.fillStyle = isLong ? '#2ecc71' : '#e74c3c';
            ctx.fill();
            ctx.strokeStyle = '#fff2';
            ctx.lineWidth = 1;
            ctx.stroke();
        });
        t += 0.012;
    };
}

/* ════════════════════════════════════════
   THEME
════════════════════════════════════════ */
const THEME_KEY = 'ms-theme';

function setTheme(isDark) {
  const html = document.documentElement;
  const sunIcon = document.querySelector('.sun-icon');
  const moonIcon = document.querySelector('.moon-icon');
  if (isDark) {
    html.setAttribute('data-theme', 'dark');
    sunIcon.style.display = 'block'; moonIcon.style.display = 'none';
  } else {
    html.removeAttribute('data-theme');
    sunIcon.style.display = 'none'; moonIcon.style.display = 'block';
  }
}

function applyTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (e) {}
  if (saved === 'dark' || saved === 'light') {
    setTheme(saved === 'dark');
    return;
  }
  setTheme(window.matchMedia('(prefers-color-scheme: dark)').matches);
}

function toggleTheme() {
  const willBeDark = document.documentElement.getAttribute('data-theme') !== 'dark';
  setTheme(willBeDark);
  try { localStorage.setItem(THEME_KEY, willBeDark ? 'dark' : 'light'); } catch (e) {}
}

/* ════════════════════════════════════════
   MUSIC
════════════════════════════════════════ */
function toggleMusic() {
    const music = document.getElementById('backgroundMusic');
    const playIcon = document.querySelector('.play-icon');
    const pauseIcon = document.querySelector('.pause-icon');
    const btn = document.querySelector('.music-toggle');
    const setPlayingUI = (playing) => {
        playIcon.style.display = playing ? 'none' : 'block';
        pauseIcon.style.display = playing ? 'block' : 'none';
        if (btn) btn.setAttribute('aria-pressed', String(playing));
    };
    music.volume = 0.3;
    if (music.paused) {
        music.play().then(() => setPlayingUI(true)).catch(() => setPlayingUI(false));
    } else {
        music.pause();
        setPlayingUI(false);
    }
}

/* ════════════════════════════════════════
   INIT
════════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', () => {
    applyTheme();
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

    // Scroll reveal
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
    }, { threshold: 0.01, rootMargin: '0px 0px 200px 0px' });
    document.querySelectorAll('.section').forEach(s => observer.observe(s));

    // Smooth scroll
    document.querySelectorAll('a[href^="#"]').forEach(a => {
        a.addEventListener('click', e => {
            e.preventDefault();
            const t = document.querySelector(a.getAttribute('href'));
            if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    });

    // Code animation auto-trigger on load
    triggerCodeAnimation();
});

/* ════════════════════════════════════════
   MARKET SESSIONS CLOCK
   GMT-watch architecture: classical 12h Roman dial (inner) + 24h session bezel (outer).
   Zones are IANA-backed so DST is handled automatically by Intl
   (BST↔GMT, EDT↔EST, AEDT↔AEST). Bezel + session arcs rotate to the selected zone.
════════════════════════════════════════ */
function initSessionsClock() {
    const svg = document.getElementById('msDial');
    const widget = document.getElementById('msWidget');
    if (!svg || !widget) return;

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const CX = 200, CY = 200;
    const ROMANS = ['XII','I','II','III','IV','V','VI','VII','VIII','IX','X','XI'];

    // Selectable zones (IANA-aware). Offsets are resolved per render so DST is automatic.
    const ZONES = [
        { id: 'SYD', label: 'Sydney',   short: 'SYD', iana: 'Australia/Sydney'  },
        { id: 'TYO', label: 'Tokyo',    short: 'TYO', iana: 'Asia/Tokyo'        },
        { id: 'MSK', label: 'Moscow',   short: 'MSK', iana: 'Europe/Moscow'     },
        { id: 'LDN', label: 'London',   short: 'LDN', iana: 'Europe/London'    },
        { id: 'NYC', label: 'New York', short: 'NYC', iana: 'America/New_York' },
        { id: 'UTC', label: 'UTC',      short: 'UTC', iana: 'UTC'              }
    ];

    // Sessions defined in EXCHANGE-local hours + IANA. The current UTC range is computed
    // at render time so summer/winter (BST, EDT, AEDT…) shifts apply on the correct date.
    const SESSIONS = [
        { name: 'SYDNEY',   iana: 'Australia/Sydney',  startLocal: 8,  endLocal: 17, lane: 0 },
        { name: 'TOKYO',    iana: 'Asia/Tokyo',        startLocal: 9,  endLocal: 18, lane: 1 },
        { name: 'MOSCOW',   iana: 'Europe/Moscow',     startLocal: 10, endLocal: 19, lane: 2 },
        { name: 'LONDON',   iana: 'Europe/London',     startLocal: 8,  endLocal: 17, lane: 3 },
        { name: 'NEW YORK', iana: 'America/New_York',  startLocal: 8,  endLocal: 17, lane: 4 }
    ];

    const LANE_RADII     = [196, 184, 172, 160, 148]; // Sydney outermost → NY innermost
    const SESSION_W_BASE = 2;
    const SESSION_W_ACT  = 7;
    const BEZEL_RIM      = 200;
    const DIAL_RING_R    = 130;
    const MINUTE_RING_R  = 124;
    const ROMAN_R        = 108;
    const HAND_HOUR_R    = 58;
    const HAND_MIN_R     = 92;
    const HAND_SEC_R     = 108;

    // ── Zone offset helper (DST-aware via Intl). Returns hours (can be fractional).
    const _offsetFmtCache = {};
    function getOffsetHours(iana, date) {
        if (iana === 'UTC') return 0;
        let fmt = _offsetFmtCache[iana];
        if (!fmt) {
            fmt = new Intl.DateTimeFormat('en-US', {
                timeZone: iana, hour12: false,
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            });
            _offsetFmtCache[iana] = fmt;
        }
        const map = {};
        fmt.formatToParts(date).forEach(p => { if (p.type !== 'literal') map[p.type] = p.value; });
        const h = +map.hour === 24 ? 0 : +map.hour;
        const asUTC = Date.UTC(+map.year, +map.month - 1, +map.day, h, +map.minute, +map.second);
        return Math.round(((asUTC - date.getTime()) / 60000)) / 60; // rounded to nearest minute
    }

    function detectVisitorZoneId() {
        try {
            const v = Intl.DateTimeFormat().resolvedOptions().timeZone;
            const match = ZONES.find(z => z.iana === v);
            if (match) return match.id;
        } catch (_) {}
        return 'MSK';
    }

    // Initial selection: saved choice > visitor autodetect > MSK fallback
    let currentZoneId = '';
    try { currentZoneId = localStorage.getItem('ms-tz') || ''; } catch (_) {}
    if (!ZONES.find(z => z.id === currentZoneId)) {
        currentZoneId = detectVisitorZoneId();
    }

    // ── SVG helpers
    function ang24(h) { return (h / 24) * Math.PI * 2 - Math.PI / 2; }
    function ang12(h) { return (h / 12) * Math.PI * 2 - Math.PI / 2; }
    function pt(r, a) { return [CX + Math.cos(a) * r, CY + Math.sin(a) * r]; }
    function setAttrs(el, attrs) { for (const k in attrs) el.setAttribute(k, attrs[k]); }
    function svgEl(tag, attrs, text, parent) {
        const e = document.createElementNS(SVG_NS, tag);
        if (attrs) setAttrs(e, attrs);
        if (text != null) e.textContent = text;
        (parent || svg).appendChild(e);
        return e;
    }
    function arcPath(r, a0, a1, sweep) {
        const [x0,y0] = pt(r, a0);
        const [x1,y1] = pt(r, a1);
        const large = (a1 - a0) > Math.PI ? 1 : 0;
        return `M ${x0} ${y0} A ${r} ${r} 0 ${large} ${sweep} ${x1} ${y1}`;
    }

    let __pathId = 0;
    function textOnArc(str, r, a0, a1, fill, fontSize, parent) {
        if (a1 < a0) a1 += Math.PI * 2;
        const mid = (a0 + a1) / 2;
        const bottomHalf = (mid > 0 && mid < Math.PI);
        const pid = `ms-arc-${__pathId++}`;
        let d;
        if (bottomHalf) {
            const [x1,y1] = pt(r, a1), [x0,y0] = pt(r, a0);
            d = `M ${x1} ${y1} A ${r} ${r} 0 ${(a1-a0)>Math.PI?1:0} 0 ${x0} ${y0}`;
        } else {
            const [x0,y0] = pt(r, a0), [x1,y1] = pt(r, a1);
            d = `M ${x0} ${y0} A ${r} ${r} 0 ${(a1-a0)>Math.PI?1:0} 1 ${x1} ${y1}`;
        }
        let defs = svg.querySelector('defs');
        if (!defs) {
            defs = document.createElementNS(SVG_NS, 'defs');
            svg.insertBefore(defs, svg.firstChild);
        }
        const pathEl = document.createElementNS(SVG_NS, 'path');
        setAttrs(pathEl, { id: pid, d, fill: 'none' });
        defs.appendChild(pathEl);

        const textEl = document.createElementNS(SVG_NS, 'text');
        setAttrs(textEl, {
            'font-size': fontSize,
            'letter-spacing': fontSize > 7.5 ? '2.5' : '1.5',
            fill,
            'font-weight': '500',
            'font-family': 'IBM Plex Mono, monospace'
        });
        const tp = document.createElementNS(SVG_NS, 'textPath');
        tp.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', `#${pid}`);
        tp.setAttribute('href', `#${pid}`);
        tp.setAttribute('startOffset', '50%');
        tp.setAttribute('text-anchor', 'middle');
        tp.textContent = str;
        textEl.appendChild(tp);
        (parent || svg).appendChild(textEl);
    }

    // Resolve current UTC range for a session (DST-aware via the exchange's IANA zone).
    function sessionUtcRange(s, now) {
        const sOff = getOffsetHours(s.iana, now);
        const startUtc = ((s.startLocal - sOff) % 24 + 24) % 24;
        const endUtc   = ((s.endLocal   - sOff) % 24 + 24) % 24;
        return { startUtc, endUtc };
    }
    function isActiveUtc(range, utcFrac) {
        if (range.startUtc < range.endUtc) return utcFrac >= range.startUtc && utcFrac < range.endUtc;
        return utcFrac >= range.startUtc || utcFrac < range.endUtc;
    }
    function dominantActive(ranges, utcFrac) {
        // Trader priority — LONDON / NEW YORK headline when active, otherwise first active session
        const priority = ['LONDON', 'NEW YORK', 'MOSCOW', 'TOKYO', 'SYDNEY'];
        for (const name of priority) {
            const r = ranges.find(x => x.name === name);
            if (r && isActiveUtc(r, utcFrac)) return r;
        }
        return null;
    }
    function nextSession(ranges, utcFrac) {
        let best = null, bestDelta = 25;
        for (const r of ranges) {
            if (isActiveUtc(r, utcFrac)) continue;
            let d = r.startUtc - utcFrac;
            if (d < 0) d += 24;
            if (d < bestDelta) { bestDelta = d; best = r; }
        }
        return best;
    }

    function fmtH(h) { return String(((h % 24) + 24) % 24).padStart(2, '0'); }
    function fmtOffset(off) {
        if (Math.abs(off) < 1/120) return 'UTC';
        const sign = off >= 0 ? '+' : '−';
        const abs = Math.abs(off);
        const hh = Math.floor(abs);
        const mm = Math.round((abs - hh) * 60);
        return mm === 0 ? `UTC${sign}${hh}` : `UTC${sign}${hh}:${String(mm).padStart(2,'0')}`;
    }

    function readTokens() {
        const cs = getComputedStyle(widget);
        return {
            txt:  cs.getPropertyValue('--text-primary').trim()   || '#0a0a0a',
            dim:  cs.getPropertyValue('--text-secondary').trim() || '#666',
            line: cs.getPropertyValue('--border').trim()         || '#e0e0e0',
            bg:   cs.getPropertyValue('--bg-primary').trim()     || '#fff'
        };
    }

    // Layered rendering: static chrome is rebuilt only on theme change,
    // session arcs once per minute (or on zone/theme change), hands every second.
    let chromeG = null, sessionsG = null, hands = null;
    let lastChromeKey = '', lastSessionsKey = '';

    function buildChrome(tok) {
        if (chromeG) chromeG.remove();
        chromeG = document.createElementNS(SVG_NS, 'g');
        svg.insertBefore(chromeG, svg.firstChild);

        // === Outer 24h session bezel ===
        svgEl('circle', { cx: CX, cy: CY, r: BEZEL_RIM,           fill: 'none', stroke: tok.dim, 'stroke-width': 0.6, opacity: 0.45 }, null, chromeG);
        svgEl('circle', { cx: CX, cy: CY, r: LANE_RADII[4] - 6,   fill: 'none', stroke: tok.dim, 'stroke-width': 0.4, opacity: 0.30 }, null, chromeG);

        // 24h tick marks (every hour, longer every 3h)
        for (let h = 0; h < 24; h++) {
            const a = ang24(h);
            const major = h % 3 === 0;
            const [x0,y0] = pt(BEZEL_RIM, a);
            const [x1,y1] = pt(BEZEL_RIM - (major ? 9 : 4), a);
            svgEl('line', {
                x1: x0, y1: y0, x2: x1, y2: y1,
                stroke: tok.dim,
                'stroke-width': major ? 0.9 : 0.5,
                opacity: major ? 0.8 : 0.4
            }, null, chromeG);
        }
        // Bezel hour labels (24 / 03 / 06 / 09 / 12 / 15 / 18 / 21)
        for (let h = 0; h < 24; h += 3) {
            const a = ang24(h);
            const [lx, ly] = pt(BEZEL_RIM + 11, a);
            const lab = (h === 0) ? '24' : String(h).padStart(2, '0');
            svgEl('text', {
                x: lx, y: ly, fill: tok.dim,
                'font-size': 7.5, 'letter-spacing': '1.4',
                'text-anchor': 'middle', 'dominant-baseline': 'middle',
                opacity: 0.8
            }, lab, chromeG);
        }

        // === Inner 12h dial ===
        svgEl('circle', { cx: CX, cy: CY, r: DIAL_RING_R, fill: 'none', stroke: tok.dim, 'stroke-width': 0.5, opacity: 0.4 }, null, chromeG);

        // 60 minute ticks
        for (let m = 0; m < 60; m++) {
            const a = (m/60) * Math.PI * 2 - Math.PI / 2;
            const major = m % 5 === 0;
            const r0 = MINUTE_RING_R;
            const r1 = MINUTE_RING_R - (major ? 6 : 3);
            const [x0,y0] = pt(r0, a); const [x1,y1] = pt(r1, a);
            svgEl('line', {
                x1: x0, y1: y0, x2: x1, y2: y1,
                stroke: major ? tok.txt : tok.dim,
                'stroke-width': major ? 0.8 : 0.4,
                opacity: major ? 0.65 : 0.4
            }, null, chromeG);
        }

        // 12 Roman numerals — each rotated tangentially so the top points outward
        for (let i = 0; i < 12; i++) {
            const a = ang12(i);
            const [x, y] = pt(ROMAN_R, a);
            const rotDeg = (a * 180 / Math.PI) + 90;
            svgEl('text', {
                x, y,
                'text-anchor': 'middle',
                'dominant-baseline': 'middle',
                'font-size': 15,
                class: 'ms-roman',
                fill: tok.txt,
                opacity: 0.95,
                transform: `rotate(${rotDeg} ${x} ${y})`
            }, ROMANS[i], chromeG);
        }
    }

    function buildSessions(tok, isDark, ranges, utcFrac) {
        const dimTrack = isDark ? '#262626' : '#e6e6e6';
        const defs = svg.querySelector('defs');
        if (defs) defs.textContent = '';
        __pathId = 0;
        if (sessionsG) sessionsG.remove();
        sessionsG = document.createElementNS(SVG_NS, 'g');
        svg.insertBefore(sessionsG, hands ? hands.group : null);

        // Session arcs (anchored to SELECTED-zone local hours; activity checked vs UTC)
        ranges.forEach(r => {
            const active = isActiveUtc(r, utcFrac);
            const radius = LANE_RADII[r.lane];
            let a0 = ang24(r.startInZone), a1 = ang24(r.endInZone);
            if (r.endInZone <= r.startInZone) a1 += Math.PI * 2;
            const w = active ? SESSION_W_ACT : SESSION_W_BASE;
            const d = arcPath(radius, a0, a1, 1);
            svgEl('path', {
                d, fill: 'none',
                stroke: active ? tok.txt : dimTrack,
                'stroke-width': w, 'stroke-linecap': 'butt'
            }, null, sessionsG);
            const fontSize = active ? 7.5 : 6.5;
            textOnArc(r.name, radius, a0, a1, active ? tok.bg : tok.dim, fontSize, sessionsG);
        });
    }

    function buildHands(tok) {
        if (hands) hands.group.remove();
        const g = document.createElementNS(SVG_NS, 'g');
        svg.appendChild(g);
        hands = {
            group: g,
            nowMarker: svgEl('polygon', { fill: tok.txt }, null, g),
            hour: svgEl('line', { stroke: tok.txt, 'stroke-width': 3.0, 'stroke-linecap': 'round' }, null, g),
            minute: svgEl('line', { stroke: tok.txt, 'stroke-width': 1.8, 'stroke-linecap': 'round' }, null, g),
            second: svgEl('line', { stroke: tok.txt, 'stroke-width': 0.7, 'stroke-linecap': 'round', opacity: 0.85 }, null, g),
            pinOuter: svgEl('circle', { cx: CX, cy: CY, r: 3.4, fill: tok.txt }, null, g),
            pinInner: svgEl('circle', { cx: CX, cy: CY, r: 1.2, fill: tok.bg }, null, g)
        };
    }

    function updateHands(zoneFrac, zoneM, zoneS) {
        // "NOW" marker on the outer rim (selected-zone local time, inward-pointing triangle)
        const nowA = ang24(zoneFrac);
        const [nax, nay] = pt(BEZEL_RIM - 2, nowA);
        const [nlx, nly] = pt(BEZEL_RIM + 9, nowA - 0.035);
        const [nrx, nry] = pt(BEZEL_RIM + 9, nowA + 0.035);
        hands.nowMarker.setAttribute('points', `${nax},${nay} ${nlx},${nly} ${nrx},${nry}`);

        // Classical 12-hour dial (hour hand = 2 revolutions per day)
        const hA = ang12(zoneFrac % 12);
        const mA = ((zoneM + zoneS/60) / 60) * Math.PI * 2 - Math.PI / 2;
        const sA = (zoneS / 60) * Math.PI * 2 - Math.PI / 2;

        const [htx, hty] = pt(-9, hA);
        const [hx,  hy ] = pt(HAND_HOUR_R, hA);
        setAttrs(hands.hour, { x1: htx, y1: hty, x2: hx, y2: hy });

        const [mtx, mty] = pt(-12, mA);
        const [mxp, myp] = pt(HAND_MIN_R, mA);
        setAttrs(hands.minute, { x1: mtx, y1: mty, x2: mxp, y2: myp });

        const [stx, sty] = pt(-15, sA);
        const [sxp, syp] = pt(HAND_SEC_R, sA);
        setAttrs(hands.second, { x1: stx, y1: sty, x2: sxp, y2: syp });
    }

    function render() {
        const tok = readTokens();
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

        const now = new Date();
        const utcH = now.getUTCHours();
        const utcM = now.getUTCMinutes();
        const utcS = now.getUTCSeconds();
        const utcFrac = utcH + utcM/60 + utcS/3600;

        const zone = ZONES.find(z => z.id === currentZoneId) || ZONES.find(z => z.id === 'MSK');
        const zOff = getOffsetHours(zone.iana, now);
        const zoneFrac = ((utcFrac + zOff) % 24 + 24) % 24;
        const zoneH = Math.floor(zoneFrac);
        const zoneM = Math.floor((zoneFrac - zoneH) * 60);
        const zoneS = utcS;

        // Current session UTC ranges (DST-aware) + their bezel position in the SELECTED zone
        const ranges = SESSIONS.map(s => {
            const u = sessionUtcRange(s, now);
            const startInZone = ((u.startUtc + zOff) % 24 + 24) % 24;
            const endInZone   = ((u.endUtc   + zOff) % 24 + 24) % 24;
            return { name: s.name, lane: s.lane, startUtc: u.startUtc, endUtc: u.endUtc, startInZone, endInZone };
        });

        const chromeKey = `${isDark}|${tok.txt}`;
        if (chromeKey !== lastChromeKey) {
            lastChromeKey = chromeKey;
            buildChrome(tok);
            buildHands(tok);
            lastSessionsKey = '';
        }
        // Session arcs change at most once per minute (active state flips on hour boundaries)
        const sessionsKey = `${chromeKey}|${zone.id}|${utcH}:${utcM}`;
        if (sessionsKey !== lastSessionsKey) {
            lastSessionsKey = sessionsKey;
            buildSessions(tok, isDark, ranges, utcFrac);
        }
        updateHands(zoneFrac, zoneM, zoneS);

        // ── Update HTML header / footer
        document.getElementById('msTimeDigits').textContent = `${fmtH(zoneH)}:${String(zoneM).padStart(2, '0')}`;
        document.getElementById('msTimeSuffix').textContent = fmtOffset(zOff);
        document.getElementById('msTzLabel').textContent = zone.short;

        const dom = dominantActive(ranges, utcFrac);
        const activeLineEl = document.getElementById('msActiveLine');
        const pulseEl = document.getElementById('msPulse');
        const nextLineEl = document.getElementById('msNextLine');
        if (dom) {
            activeLineEl.innerHTML = `Active · <span class="ms-active-name">${dom.name}</span>`;
            if (pulseEl) pulseEl.style.opacity = '';
        } else {
            activeLineEl.innerHTML = '— · Off hours';
            if (pulseEl) pulseEl.style.opacity = '0.2';
        }
        const nx = nextSession(ranges, utcFrac);
        if (nx) {
            // Show next session's opening time in the SELECTED zone
            const totalMin = Math.round(nx.startInZone * 60) % 1440;
            const sH = Math.floor(totalMin / 60);
            const sM = totalMin % 60;
            nextLineEl.textContent = `Next · ${nx.name} ${fmtH(sH)}:${String(sM).padStart(2,'0')}`;
        } else {
            nextLineEl.textContent = '';
        }
    }

    // ── TZ selector
    const tzBtn = document.getElementById('msTzBtn');
    const tzPop = document.getElementById('msTzPop');

    function buildDropdown() {
        tzPop.innerHTML = '';
        const now = new Date();
        ZONES.forEach(z => {
            const opt = document.createElement('div');
            opt.className = 'ms-opt' + (z.id === currentZoneId ? ' active' : '');
            opt.setAttribute('role', 'option');
            opt.setAttribute('data-tz', z.id);
            const off = getOffsetHours(z.iana, now);
            opt.innerHTML = `<span>${z.label.toUpperCase()}</span><span class="ms-off">${fmtOffset(off)}</span>`;
            opt.addEventListener('click', (e) => {
                e.stopPropagation();
                currentZoneId = z.id;
                try { localStorage.setItem('ms-tz', z.id); } catch (_) {}
                buildDropdown();
                closeDropdown();
                render();
            });
            tzPop.appendChild(opt);
        });
    }
    function openDropdown() {
        buildDropdown(); // refresh UTC offsets (DST may have shifted since load)
        tzPop.classList.add('open');
        tzBtn.setAttribute('aria-expanded', 'true');
    }
    function closeDropdown() {
        tzPop.classList.remove('open');
        tzBtn.setAttribute('aria-expanded', 'false');
    }
    tzBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (tzPop.classList.contains('open')) closeDropdown(); else openDropdown();
    });
    document.addEventListener('click', (e) => {
        if (!tzPop.contains(e.target) && e.target !== tzBtn) closeDropdown();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeDropdown();
    });
    buildDropdown();

    // Re-render immediately when theme attribute flips
    const themeObserver = new MutationObserver(() => render());
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    // Initial render + 1Hz tick (no 60Hz rAF polling)
    render();
    setInterval(render, 1000);
}

/* ════════════════════════════════════════
   ORDER MODAL
════════════════════════════════════════ */
const ORDER_TG_USERNAME = 'Dm1tryMaltsev';
let orderLastFocus = null;

function openOrderModal() {
    const overlay = document.getElementById('orderOverlay');
    orderLastFocus = document.activeElement;
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    document.getElementById('orderName').focus();
}

function closeOrderModal() {
    const overlay = document.getElementById('orderOverlay');
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    if (orderLastFocus && typeof orderLastFocus.focus === 'function') orderLastFocus.focus();
}

function initOrderModal() {
    const overlay = document.getElementById('orderOverlay');
    const form = document.getElementById('orderForm');
    const errorEl = document.getElementById('orderError');

    overlay.addEventListener('click', e => { if (e.target === overlay) closeOrderModal(); });
    document.addEventListener('keydown', e => {
        if (!overlay.classList.contains('open')) return;
        if (e.key === 'Escape') { closeOrderModal(); return; }
        if (e.key === 'Tab') {
            const focusables = overlay.querySelectorAll('button, input, textarea');
            const first = focusables[0], last = focusables[focusables.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            else if (!overlay.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
        }
    });

    form.addEventListener('submit', e => {
        e.preventDefault();
        const name = document.getElementById('orderName').value.trim();
        const task = document.getElementById('orderTask').value.trim();
        const contact = document.getElementById('orderContact').value.trim();
        if (!name || !task || !contact) {
            errorEl.textContent = 'Заполните все поля.';
            return;
        }
        errorEl.textContent = '';
        const text = `Заявка на проект\n\nНазвание: ${name}\n\nЗадача:\n${task}\n\nКонтакт (Telegram): ${contact}`;
        // t.me/<user>?text= не гарантирован для личных чатов — основной канал доставки текста: буфер обмена
        const copied = navigator.clipboard
            ? navigator.clipboard.writeText(text).then(() => true).catch(() => false)
            : Promise.resolve(false);
        window.open(`https://t.me/${ORDER_TG_USERNAME}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
        copied.then(ok => {
            errorEl.classList.add('ok');
            errorEl.textContent = ok
                ? 'Текст заявки скопирован — вставьте его в открывшийся чат Telegram.'
                : 'Открылся чат Telegram — отправьте заявку там.';
            setTimeout(() => {
                closeOrderModal();
                form.reset();
                errorEl.textContent = '';
                errorEl.classList.remove('ok');
            }, 2500);
        });
    });
}

window.addEventListener('DOMContentLoaded', () => {
    initOrderModal();
    new ParticlesSystem();
    initProjectCanvases();
    initSessionsClock();

    // Re-init canvases on resize
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            document.querySelectorAll('.proj-canvas').forEach(c => {
                sizeProjectCanvas(c);
                if (!c._running && c._draw) c._draw(); // resizing clears the canvas; repaint paused ones
            });
        }, 400);
    });
});
