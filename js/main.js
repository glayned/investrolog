
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
const mobileAnimationQuery = window.matchMedia('(max-width: 768px), (pointer: coarse)');
function motionAllowed() { return !document.hidden; }
function getMotionScale() { return reducedMotionQuery.matches ? 0.45 : 1; }
function usesMobileAnimations() { return mobileAnimationQuery.matches; }
function onMediaQueryChange(query, callback) {
    if (query.addEventListener) query.addEventListener('change', callback);
    else query.addListener(callback);
}
function getDpr() {
    return Math.min(window.devicePixelRatio || 1, usesMobileAnimations() ? 1.25 : 2);
}
function getProjectFrameInterval() {
    const cores = navigator.hardwareConcurrency || 8;
    const memory = navigator.deviceMemory;
    const saveData = navigator.connection && navigator.connection.saveData;
    const lowPower = usesMobileAnimations()
        && (cores <= 4 || (memory != null && memory <= 4) || saveData);
    return 1000 / (lowPower || reducedMotionQuery.matches ? 20 : usesMobileAnimations() ? 24 : 30);
}

/* ════════════════════════════════════════
   MARKET CONSTELLATION
════════════════════════════════════════ */
const STAR_COUNT = {
    desktop: { min: 105, max: 150, area: 8600 },
    mobile: { min: 42, max: 68, area: 12500 },
    lowPower: { min: 30, max: 46, area: 17000 }
};
const CURSOR_RADIUS = 180;
const CURSOR_RADIUS_SQ = CURSOR_RADIUS * CURSOR_RADIUS;
const GLOW_RADIUS = 230;
const LOCAL_LINK_DIST = 145;
const LOCAL_LINK_DIST_SQ = LOCAL_LINK_DIST * LOCAL_LINK_DIST;
const MAX_LOCAL_STARS = 7;
const COMET_DELAY_MIN = 7000;
const COMET_DELAY_MAX = 12000;
const COMET_DELAY_MOBILE_MIN = 5000;
const COMET_DELAY_MOBILE_MAX = 9000;

function randomBetween(min, max) {
    return min + Math.random() * (max - min);
}

class Star {
    constructor(w, h) {
        this.reset(w, h);
    }
    reset(w, h) {
        this.angle = Math.random() * Math.PI * 2;
        this.radiusRatio = Math.pow(Math.random(), 1.5) * 0.8;
        this.angularSpeed = randomBetween(0.00018, 0.00048);
        this.depth = randomBetween(0.35, 1);
        this.size = this.pickSize();
        this.phase = Math.random() * Math.PI * 2;
        this.twinkleSpeed = randomBetween(2.1, 3.4);
        this.update(0, w, h);
    }
    pickSize() {
        const roll = Math.random();
        if (roll < 0.58) return randomBetween(0.45, 0.95);
        if (roll < 0.93) return randomBetween(0.95, 1.5);
        return randomBetween(1.5, 1.9);
    }
    update(frameScale, w, h) {
        this.angle += this.angularSpeed * (0.72 + this.depth * 0.48) * frameScale;
        const radius = Math.max(w, h) * this.radiusRatio;
        this.x = w / 2 + Math.cos(this.angle) * radius;
        this.y = h / 2 + Math.sin(this.angle) * radius;
    }
}

class ParticlesSystem {
    constructor() {
        this.canvas = document.getElementById('particles-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.stars = [];
        this.pointer = {
            targetX: -999,
            targetY: -999,
            x: -999,
            y: -999,
            active: false,
            glow: 0
        };
        this.comet = null;
        this.running = false;
        this.rafId = 0;
        this.lastTick = 0;
        this.lastFrame = 0;
        this.updateCapabilities();
        this.nextCometAt = performance.now() + this.cometDelay();
        this.resize(true);
        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => this.resize(false), 150);
        });
        window.addEventListener('orientationchange', () => this.resize(true));
        window.addEventListener('pointermove', e => this.onPointerMove(e), { passive: true });
        document.addEventListener('pointerleave', () => { this.pointer.active = false; });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this.stop();
            else this.start();
        });
        onMediaQueryChange(reducedMotionQuery, () => {
            this.pointer.glow = 0;
            this.frameInterval = 1000 / (this.lowPower || reducedMotionQuery.matches
                ? 20
                : this.mobile ? 24 : 30);
            this.nextCometAt = performance.now() + this.cometDelay();
            this.start();
        });
        new MutationObserver(() => {
            if (!this.running) this.drawFrame(performance.now(), false);
        })
            .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        this.start();
    }
    updateCapabilities() {
        this.mobile = window.matchMedia('(max-width: 768px), (pointer: coarse)').matches;
        this.finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
        const memory = navigator.deviceMemory;
        const cores = navigator.hardwareConcurrency || 8;
        const saveData = navigator.connection && navigator.connection.saveData;
        this.lowPower = this.mobile && (cores <= 4 || (memory != null && memory <= 4) || saveData);
        this.frameInterval = 1000 / (this.lowPower ? 20 : this.mobile ? 24 : 30);
        if (!this.finePointer && this.pointer) {
            this.pointer.active = false;
            this.pointer.glow = 0;
        }
    }
    cometDelay() {
        return this.mobile
            ? randomBetween(COMET_DELAY_MOBILE_MIN, COMET_DELAY_MOBILE_MAX)
            : randomBetween(COMET_DELAY_MIN, COMET_DELAY_MAX);
    }
    onPointerMove(event) {
        if (!this.finePointer || reducedMotionQuery.matches) return;
        this.pointer.targetX = event.clientX;
        this.pointer.targetY = event.clientY;
        if (!this.pointer.active) {
            this.pointer.x = event.clientX;
            this.pointer.y = event.clientY;
            this.pointer.active = true;
        }
    }
    resize(force) {
        this.updateCapabilities();
        const nextWidth = window.innerWidth;
        const nextHeight = window.innerHeight;
        if (!force && this.mobile && this.w && Math.abs(nextWidth - this.w) < 2) return;
        const dpr = Math.min(window.devicePixelRatio || 1, this.mobile ? 1 : 2);
        this.w = nextWidth;
        this.h = nextHeight;
        for (const star of this.stars) star.update(0, this.w, this.h);
        this.canvas.width = Math.round(this.w * dpr);
        this.canvas.height = Math.round(this.h * dpr);
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const profile = this.lowPower
            ? STAR_COUNT.lowPower
            : this.mobile ? STAR_COUNT.mobile : STAR_COUNT.desktop;
        const target = Math.min(
            profile.max,
            Math.max(profile.min, Math.round((this.w * this.h) / profile.area))
        );
        while (this.stars.length < target) this.stars.push(new Star(this.w, this.h));
        if (this.stars.length > target) this.stars.length = target;
    }
    start() {
        if (this.running || !motionAllowed()) return;
        this.running = true;
        this.lastTick = 0;
        this.lastFrame = 0;
        this.rafId = requestAnimationFrame(now => this.tick(now));
    }
    stop() {
        this.running = false;
        cancelAnimationFrame(this.rafId);
    }
    tick(now) {
        if (!motionAllowed()) {
            this.running = false;
            return;
        }
        const sinceFrame = now - this.lastFrame;
        if (!this.lastFrame || sinceFrame >= this.frameInterval) {
            const elapsed = this.lastTick ? Math.min(now - this.lastTick, 50) : this.frameInterval;
            this.lastTick = now;
            this.lastFrame = this.lastFrame
                ? now - (sinceFrame % this.frameInterval)
                : now;
            this.drawFrame(now, true, elapsed / 16.667);
        }
        this.rafId = requestAnimationFrame(next => this.tick(next));
    }
    drawGlow(isDark, frameScale) {
        const pointer = this.pointer;
        pointer.x += (pointer.targetX - pointer.x) * 0.08 * frameScale;
        pointer.y += (pointer.targetY - pointer.y) * 0.08 * frameScale;
        pointer.glow += ((pointer.active ? 1 : 0) - pointer.glow) * 0.07 * frameScale;
        if (pointer.glow < 0.01) return;

        const color = isDark ? '200,146,53' : '152,103,31';
        const strength = (isDark ? 0.048 : 0.018) * pointer.glow;
        const gradient = this.ctx.createRadialGradient(
            pointer.x, pointer.y, 0,
            pointer.x, pointer.y, GLOW_RADIUS
        );
        gradient.addColorStop(0, `rgba(${color},${strength})`);
        gradient.addColorStop(0.22, `rgba(${color},${strength * 0.82})`);
        gradient.addColorStop(0.45, `rgba(${color},${strength * 0.48})`);
        gradient.addColorStop(0.68, `rgba(${color},${strength * 0.2})`);
        gradient.addColorStop(0.84, `rgba(${color},${strength * 0.06})`);
        gradient.addColorStop(1, `rgba(${color},0)`);
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(
            pointer.x - GLOW_RADIUS,
            pointer.y - GLOW_RADIUS,
            GLOW_RADIUS * 2,
            GLOW_RADIUS * 2
        );
    }
    drawStars(isDark, now, update, frameScale) {
        const ctx = this.ctx;
        const pointer = this.pointer;
        const interactive = this.finePointer && pointer.glow > 0.02 && update;
        const near = [];
        const baseColor = isDark ? '245,247,250' : '18,22,26';
        const time = now / 1000;

        for (const star of this.stars) {
            if (update) star.update(frameScale, this.w, this.h);
            let x = star.x;
            let y = star.y;
            let boost = 0;

            if (interactive) {
                const dx = star.x - pointer.x;
                const dy = star.y - pointer.y;
                const distanceSq = dx * dx + dy * dy;
                if (distanceSq < CURSOR_RADIUS_SQ) {
                    const distance = Math.sqrt(distanceSq) || 0.001;
                    boost = (1 - distance / CURSOR_RADIUS) * pointer.glow;
                    const candidate = { x, y, boost, distanceSq };
                    const insertAt = near.findIndex(item => distanceSq < item.distanceSq);
                    if (insertAt === -1) {
                        if (near.length < MAX_LOCAL_STARS) near.push(candidate);
                    } else {
                        near.splice(insertAt, 0, candidate);
                        if (near.length > MAX_LOCAL_STARS) near.pop();
                    }
                }
            }

            const twinkle = update
                ? 0.58
                    + 0.34 * Math.sin(time * star.twinkleSpeed + star.phase)
                    + 0.08 * Math.sin(time * star.twinkleSpeed * 0.37 + star.phase * 1.7)
                : 0.74;
            const alpha = Math.min(
                1,
                (isDark ? 0.22 + star.depth * 0.4 : 0.15 + star.depth * 0.24) * twinkle
                    + boost * (isDark ? 0.24 : 0.14)
            );
            const radius = star.size * (1 + boost * 0.18);
            if (star.size > 1.5) {
                ctx.beginPath();
                ctx.arc(x, y, radius * 3.2, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(${baseColor},${alpha * 0.08})`;
                ctx.fill();
            }
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${baseColor},${alpha})`;
            ctx.fill();
        }

        ctx.lineWidth = 0.6;
        for (let i = 1; i < near.length; i++) {
            const a = near[i];
            let closest = null;
            let closestDistanceSq = LOCAL_LINK_DIST_SQ;
            for (let j = 0; j < i; j++) {
                const candidate = near[j];
                const dx = a.x - candidate.x;
                const dy = a.y - candidate.y;
                const distanceSq = dx * dx + dy * dy;
                if (distanceSq < closestDistanceSq) {
                    closest = candidate;
                    closestDistanceSq = distanceSq;
                }
            }
            if (closest) {
                const distance = Math.sqrt(closestDistanceSq);
                const alpha = (1 - distance / LOCAL_LINK_DIST)
                    * Math.min(a.boost, closest.boost)
                    * (isDark ? 0.2 : 0.1);
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(closest.x, closest.y);
                ctx.strokeStyle = `rgba(${baseColor},${alpha})`;
                ctx.stroke();
            }
        }
    }
    spawnComet(now) {
        const vx = this.mobile ? randomBetween(220, 310) : randomBetween(280, 390);
        this.comet = {
            x: Math.random() > 0.35
                ? randomBetween(-this.w * 0.15 - 80, -80)
                : randomBetween(0, this.w * 0.75),
            y: randomBetween(0, Math.max(40, this.h * 0.28)),
            vx,
            vy: vx * randomBetween(0.45, 0.7),
            length: this.mobile ? randomBetween(90, 145) : randomBetween(140, 220),
            bornAt: now,
            duration: this.mobile ? randomBetween(1400, 1800) : randomBetween(1550, 1950)
        };
        this.nextCometAt = now + this.cometDelay();
    }
    drawComet(isDark, now, elapsedSeconds) {
        if (!this.comet && now >= this.nextCometAt) this.spawnComet(now);
        if (!this.comet) return;

        const comet = this.comet;
        const progress = (now - comet.bornAt) / comet.duration;
        if (progress >= 1 || comet.x > this.w + 140 || comet.y > this.h + 140) {
            this.comet = null;
            return;
        }

        comet.x += comet.vx * elapsedSeconds;
        comet.y += comet.vy * elapsedSeconds;
        const speed = Math.hypot(comet.vx, comet.vy);
        const tailX = comet.x - (comet.vx / speed) * comet.length;
        const tailY = comet.y - (comet.vy / speed) * comet.length;
        const life = 1 - progress;
        const fadeIn = Math.min(1, progress / 0.08);
        const fade = life * fadeIn * (isDark ? 0.82 : 0.34);
        const color = isDark ? '245,247,250' : '18,22,26';
        const gradient = this.ctx.createLinearGradient(comet.x, comet.y, tailX, tailY);
        gradient.addColorStop(0, `rgba(${color},${fade})`);
        gradient.addColorStop(0.12, `rgba(${color},${fade * 0.88})`);
        gradient.addColorStop(1, `rgba(${color},0)`);
        this.ctx.beginPath();
        this.ctx.moveTo(comet.x, comet.y);
        this.ctx.lineTo(tailX, tailY);
        this.ctx.strokeStyle = gradient;
        this.ctx.lineWidth = 1.35 + life;
        this.ctx.lineCap = 'round';
        this.ctx.stroke();

        this.ctx.beginPath();
        this.ctx.arc(comet.x, comet.y, 5.5, 0, Math.PI * 2);
        this.ctx.fillStyle = `rgba(${color},${fade * 0.12})`;
        this.ctx.fill();
        this.ctx.beginPath();
        this.ctx.arc(comet.x, comet.y, 1.15 + life * 0.55, 0, Math.PI * 2);
        this.ctx.fillStyle = `rgba(${color},${Math.min(1, fade * 1.15)})`;
        this.ctx.fill();
    }
    drawFrame(now, update, frameScale = 1) {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const ctx = this.ctx;
        ctx.fillStyle = isDark ? '#080808' : '#ffffff';
        ctx.fillRect(0, 0, this.w, this.h);
        if (update && this.finePointer) this.drawGlow(isDark, frameScale);
        this.drawStars(isDark, now, update, frameScale * getMotionScale());
        if (update) this.drawComet(isDark, now, frameScale / 60);
    }
}

/* ════════════════════════════════════════
   PROJECT CANVAS ANIMATIONS
════════════════════════════════════════ */
const PROJECT_ANIMATIONS = {
    cot: animateCOT,
    vix: animateVIX,
    options: animateOptions,
    ng: animateNG,
    alerts: animateAlerts,
    desk: animateDesk,
    sentiment: animateSentiment,
    ai: animateAI
};

function sizeProjectCanvas(canvas) {
    const dpr = getDpr();
    const parent = canvas.parentElement;
    const width = parent.offsetWidth;
    const height = parent.offsetHeight;
    if (canvas._w === width && canvas._h === height && canvas._dpr === dpr) return false;
    canvas._w = width;
    canvas._h = height;
    canvas._dpr = dpr;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
}

function startProjectCanvas(canvas) {
    if (canvas._running) return;
    if (!canvas._inView || !motionAllowed()) return;
    canvas._running = true;
    canvas._lastFrame = 0;
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
        canvas._lastFrame = 0;
        canvas._frameInterval = getProjectFrameInterval();
        canvas._tick = now => {
            if (!canvas._inView || !motionAllowed()) { canvas._running = false; return; }
            const interval = canvas._frameInterval;
            const sinceFrame = now - canvas._lastFrame;
            if (!canvas._lastFrame || sinceFrame >= interval) {
                const elapsed = canvas._lastFrame ? Math.min(sinceFrame, 100) : interval;
                canvas._lastFrame = canvas._lastFrame
                    ? now - (sinceFrame % interval)
                    : now;
                drawFrame((elapsed / 16.667) * getMotionScale());
            }
            requestAnimationFrame(canvas._tick);
        };
        drawFrame(0); // static first frame (also covers prefers-reduced-motion)
        io.observe(canvas);
    });

    document.addEventListener('visibilitychange', () => canvases.forEach(startProjectCanvas));
    onMediaQueryChange(reducedMotionQuery, () => {
        canvases.forEach(canvas => {
            canvas._frameInterval = getProjectFrameInterval();
            startProjectCanvas(canvas);
        });
    });
}

function animateCOT(canvas) {
    const ctx = canvas.getContext('2d');
    const bars = 20;
    let t = 0;

    return function draw(frameScale = 1) {
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
        t += 0.006 * frameScale;
    };
}

function animateVIX(canvas) {
    const ctx = canvas.getContext('2d');
    let t = 0;

    return function draw(frameScale = 1) {
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
        t += 0.01 * frameScale;
    };
}

function animateOptions(canvas) {
    const ctx = canvas.getContext('2d');
    let t = 0;

    return function draw(frameScale = 1) {
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
        t += 0.02 * frameScale;
    };
}

function animateNG(canvas) {
    const ctx = canvas.getContext('2d');
    let t = 0;
    const ensembles = 12;

    return function draw(frameScale = 1) {
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
        t += 0.012 * frameScale;
    };
}

/* ════════════════════════════════════════
   THEME
════════════════════════════════════════ */
const THEME_KEY = 'ms-theme';
const PAGE_LANGUAGE = document.documentElement.lang === 'en' ? 'en' : 'ru';
const ORDER_TEXT = {
    ru: {
        required: 'Заполните все поля.',
        request: (name, task, contact) =>
            `Заявка на проект\n\nНазвание: ${name}\n\nЗадача:\n${task}\n\nКонтакт (Telegram): ${contact}`,
        copied: 'Текст заявки скопирован — вставьте его в открывшийся чат Telegram.',
        opened: 'Открылся чат Telegram — отправьте заявку там.'
    },
    en: {
        required: 'Please complete all fields.',
        request: (name, task, contact) =>
            `Project inquiry\n\nProject: ${name}\n\nBrief:\n${task}\n\nContact (Telegram): ${contact}`,
        copied: 'The inquiry was copied — paste it into the Telegram chat.',
        opened: 'Telegram is open — send your inquiry in the chat.'
    }
};

function setTheme(isDark) {
  const html = document.documentElement;
  const sunIcon = document.querySelector('.sun-icon');
  const moonIcon = document.querySelector('.moon-icon');
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (isDark) {
    html.setAttribute('data-theme', 'dark');
    if (themeColor) themeColor.setAttribute('content', '#080808');
    sunIcon.style.display = 'block'; moonIcon.style.display = 'none';
  } else {
    html.removeAttribute('data-theme');
    if (themeColor) themeColor.setAttribute('content', '#ffffff');
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
  setTheme(true);
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

    document.querySelectorAll('[data-language-link]').forEach(link => {
        link.addEventListener('click', () => {
            if (window.location.hash) link.hash = window.location.hash;
        });
    });

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
    const TRADING_WEEKDAYS = new Set([1, 2, 3, 4, 5]);

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
    const _partsFmtCache = {};
    function getOffsetHours(iana, date) {
        if (iana === 'UTC') return 0;
        let fmt = _offsetFmtCache[iana];
        if (!fmt) {
            fmt = new Intl.DateTimeFormat('en-US', {
                timeZone: iana, hourCycle: 'h23',
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

    function getZonedParts(iana, date) {
        let fmt = _partsFmtCache[iana];
        if (!fmt) {
            fmt = new Intl.DateTimeFormat('en-US', {
                timeZone: iana,
                hourCycle: 'h23',
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            });
            _partsFmtCache[iana] = fmt;
        }
        const map = {};
        fmt.formatToParts(date).forEach(p => { if (p.type !== 'literal') map[p.type] = p.value; });
        return {
            year: +map.year,
            month: +map.month,
            day: +map.day,
            hour: +map.hour,
            minute: +map.minute,
            second: +map.second
        };
    }

    function weekdayOf(parts) {
        return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
    }

    function zonedLocalToUtc(iana, parts, hour) {
        const localMs = Date.UTC(parts.year, parts.month - 1, parts.day, hour);
        let utcMs = localMs;
        for (let i = 0; i < 3; i++) {
            const adjusted = localMs - getOffsetHours(iana, new Date(utcMs)) * 3600000;
            if (adjusted === utcMs) break;
            utcMs = adjusted;
        }
        return new Date(utcMs);
    }

    function sessionState(s, now) {
        const local = getZonedParts(s.iana, now);
        const localMinutes = local.hour * 60 + local.minute + local.second / 60;
        const active = TRADING_WEEKDAYS.has(weekdayOf(local))
            && localMinutes >= s.startLocal * 60
            && localMinutes < s.endLocal * 60;

        let nextOpen = null;
        for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
            const calendarDate = new Date(Date.UTC(local.year, local.month - 1, local.day + dayOffset));
            const candidateParts = {
                year: calendarDate.getUTCFullYear(),
                month: calendarDate.getUTCMonth() + 1,
                day: calendarDate.getUTCDate()
            };
            if (!TRADING_WEEKDAYS.has(weekdayOf(candidateParts))) continue;
            const candidate = zonedLocalToUtc(s.iana, candidateParts, s.startLocal);
            if (candidate > now) {
                nextOpen = candidate;
                break;
            }
        }
        return { active, nextOpen };
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
    function dominantActive(ranges) {
        // Trader priority — LONDON / NEW YORK headline when active, otherwise first active session
        const priority = ['LONDON', 'NEW YORK', 'MOSCOW', 'TOKYO', 'SYDNEY'];
        for (const name of priority) {
            const r = ranges.find(x => x.name === name);
            if (r && r.active) return r;
        }
        return null;
    }
    function nextSession(ranges) {
        let best = null;
        for (const r of ranges) {
            if (r.active || !r.nextOpen) continue;
            if (!best || r.nextOpen < best.nextOpen) best = r;
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
            bg:   cs.getPropertyValue('--bg-primary').trim()     || '#fff',
            signal: cs.getPropertyValue('--signal-accent').trim() || '#98671f'
        };
    }

    // Layered rendering: static chrome is rebuilt only on theme change,
    // session arcs once per minute (or on zone/theme change), hands every second.
    let chromeG = null, sessionsG = null, hands = null;
    let lastChromeKey = '', lastSessionsKey = '', lastScheduleKey = '';
    let cachedRanges = [];

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

    function buildSessions(tok, isDark, ranges) {
        const dimTrack = isDark ? '#262626' : '#e6e6e6';
        const defs = svg.querySelector('defs');
        if (defs) defs.textContent = '';
        __pathId = 0;
        if (sessionsG) sessionsG.remove();
        sessionsG = document.createElementNS(SVG_NS, 'g');
        svg.insertBefore(sessionsG, hands ? hands.group : null);

        // Session arcs are anchored to selected-zone hours; activity follows each exchange calendar.
        ranges.forEach(r => {
            const active = r.active;
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
            nowMarker: svgEl('polygon', { fill: tok.signal }, null, g),
            hour: svgEl('line', { stroke: tok.txt, 'stroke-width': 3.0, 'stroke-linecap': 'round' }, null, g),
            minute: svgEl('line', { stroke: tok.txt, 'stroke-width': 1.8, 'stroke-linecap': 'round' }, null, g),
            second: svgEl('line', { stroke: tok.signal, 'stroke-width': 0.8, 'stroke-linecap': 'round', opacity: 0.9 }, null, g),
            pinOuter: svgEl('circle', { cx: CX, cy: CY, r: 3.4, fill: tok.signal }, null, g),
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

        const scheduleKey = `${zone.id}|${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}|${utcH}:${utcM}`;
        if (scheduleKey !== lastScheduleKey) {
            lastScheduleKey = scheduleKey;
            cachedRanges = SESSIONS.map(s => {
                const u = sessionUtcRange(s, now);
                const state = sessionState(s, now);
                const startInZone = ((u.startUtc + zOff) % 24 + 24) % 24;
                const endInZone   = ((u.endUtc   + zOff) % 24 + 24) % 24;
                return {
                    name: s.name,
                    lane: s.lane,
                    startInZone,
                    endInZone,
                    active: state.active,
                    nextOpen: state.nextOpen
                };
            });
        }
        const ranges = cachedRanges;

        const chromeKey = `${isDark}|${tok.txt}|${tok.signal}`;
        if (chromeKey !== lastChromeKey) {
            lastChromeKey = chromeKey;
            buildChrome(tok);
            buildHands(tok);
            lastSessionsKey = '';
        }
        // Session arcs change at most once per minute (active state flips on hour boundaries)
        const sessionsKey = `${chromeKey}|${scheduleKey}`;
        if (sessionsKey !== lastSessionsKey) {
            lastSessionsKey = sessionsKey;
            buildSessions(tok, isDark, ranges);
        }
        updateHands(zoneFrac, zoneM, zoneS);

        // ── Update HTML header / footer
        document.getElementById('msTimeDigits').textContent = `${fmtH(zoneH)}:${String(zoneM).padStart(2, '0')}`;
        document.getElementById('msTimeSuffix').textContent = fmtOffset(zOff);
        document.getElementById('msTzLabel').textContent = zone.short;

        const dom = dominantActive(ranges);
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
        const nx = nextSession(ranges);
        if (nx) {
            const nextLocal = getZonedParts(zone.iana, nx.nextOpen);
            const currentLocal = getZonedParts(zone.iana, now);
            const currentDate = Date.UTC(currentLocal.year, currentLocal.month - 1, currentLocal.day);
            const nextDate = Date.UTC(nextLocal.year, nextLocal.month - 1, nextLocal.day);
            const dayDelta = Math.round((nextDate - currentDate) / 86400000);
            const dayLabel = dayDelta > 0
                ? `${['SUN','MON','TUE','WED','THU','FRI','SAT'][weekdayOf(nextLocal)]} `
                : '';
            nextLineEl.textContent = `Next · ${nx.name} ${dayLabel}${fmtH(nextLocal.hour)}:${String(nextLocal.minute).padStart(2,'0')}`;
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

/* Alerts / Clouds — volume tape with rare flare-ups and alert chips */
function animateAlerts(canvas) {
    const ctx = canvas.getContext('2d');
    const bars = 26;
    let t = 0;

    return function draw(frameScale = 1) {
        const W = canvas._w, H = canvas._h;
        ctx.clearRect(0, 0, W, H);
        const gap = W / bars, bw = gap * 0.55;
        for (let i = 0; i < bars; i++) {
            let h = (0.12 + 0.22 * Math.abs(Math.sin(i * 0.8 + t)) + 0.08 * Math.sin(i * 2.3 + t * 0.7)) * H;
            const spike = Math.max(0, Math.sin(i * 3.7 + t * 0.45) - 0.97) / 0.03;
            h += spike * H * 0.45;
            const x = i * gap + (gap - bw) / 2;
            const y = H - h - H * 0.08;
            ctx.fillStyle = spike > 0
                ? `rgba(243,156,18,${0.35 + spike * 0.6})`
                : 'rgba(90,140,200,0.4)';
            ctx.fillRect(x, y, bw, h);
            if (spike > 0.25 && x < W - 130) { // keep chips clear of the corner label
                const cw = Math.min(96, W * 0.32), ch = 20;
                const cx = Math.min(W - cw - 6, Math.max(6, x - cw / 2));
                const cy = Math.max(6, y - ch - 8);
                ctx.globalAlpha = Math.min(1, (spike - 0.25) / 0.4);
                ctx.fillStyle = 'rgba(8,14,24,0.92)';
                ctx.strokeStyle = 'rgba(243,156,18,0.7)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                if (ctx.roundRect) ctx.roundRect(cx, cy, cw, ch, 5); else ctx.rect(cx, cy, cw, ch);
                ctx.fill();
                ctx.stroke();
                ctx.fillStyle = '#f39c12';
                ctx.font = '10px "IBM Plex Mono", monospace';
                ctx.fillText('VOL 6.6× avg', cx + 9, cy + 14);
                ctx.globalAlpha = 1;
            }
        }
        t += 0.01 * frameScale;
    };
}

/* Market Desk — S/R level ladder with drifting price line */
function animateDesk(canvas) {
    const ctx = canvas.getContext('2d');
    const levels = [0.2, 0.36, 0.64, 0.82];
    let t = 0;

    return function draw(frameScale = 1) {
        const W = canvas._w, H = canvas._h;
        ctx.clearRect(0, 0, W, H);
        const priceAt = x => H * (0.5 + 0.18 * Math.sin(x * 0.02 + t) + 0.09 * Math.sin(x * 0.05 - t * 0.7));
        const py = priceAt(W - 1);
        levels.forEach(ly => {
            const y = H * ly;
            const near = Math.max(0, 1 - Math.abs(py - y) / (H * 0.09));
            const base = y < H * 0.5 ? '231,76,60' : '46,204,113';
            if (near > 0.05) {
                ctx.fillStyle = `rgba(${base},${0.14 * near})`;
                ctx.fillRect(0, y - 4, W, 8);
            }
            ctx.strokeStyle = `rgba(${base},${0.25 + near * 0.55})`;
            ctx.lineWidth = 1 + near * 0.8;
            ctx.setLineDash([6, 5]);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(W, y);
            ctx.stroke();
            ctx.setLineDash([]);
        });
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(138,182,255,0.85)';
        ctx.lineWidth = 1.5;
        for (let x = 0; x < W; x++) {
            const y = priceAt(x);
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.beginPath();
        ctx.fillStyle = '#cfe3ff';
        ctx.arc(W - 2, py, 2.5, 0, Math.PI * 2);
        ctx.fill();
        t += 0.008 * frameScale;
    };
}

/* Sentiment Track — opposing bear/bull gauges with contrarian extremes */
function animateSentiment(canvas) {
    const ctx = canvas.getContext('2d');
    const rows = 5;
    let t = 0;

    return function draw(frameScale = 1) {
        const W = canvas._w, H = canvas._h;
        ctx.clearRect(0, 0, W, H);
        const rh = H / (rows + 1);
        const mid = W / 2;
        ctx.strokeStyle = 'rgba(150,160,180,0.22)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(mid, H * 0.1);
        ctx.lineTo(mid, H * 0.9);
        ctx.stroke();
        for (let i = 0; i < rows; i++) {
            const y = rh * (i + 0.85);
            const bear = 0.12 + 0.32 * (0.5 + 0.5 * Math.sin(t * 0.6 + i * 1.7));
            const bull = 0.12 + 0.32 * (0.5 + 0.5 * Math.cos(t * 0.5 + i * 2.1));
            ctx.fillStyle = 'rgba(231,76,60,0.55)';
            ctx.fillRect(mid - bear * W * 0.45, y, bear * W * 0.45, 6);
            ctx.fillStyle = 'rgba(46,204,113,0.55)';
            ctx.fillRect(mid + 1, y, bull * W * 0.45, 6);
            const ext = Math.max(bear, bull);
            if (ext > 0.42) {
                const a = Math.min(0.9, (ext - 0.42) / 0.02 * 0.9);
                const ex = bear > bull ? mid - bear * W * 0.45 - 7 : mid + bull * W * 0.45 + 8;
                ctx.fillStyle = `rgba(243,156,18,${a})`;
                ctx.beginPath();
                ctx.arc(ex, y + 3, 2.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        t += 0.01 * frameScale;
    };
}

/* AI Assistant — terminal dialogue typing out and dissolving */
function animateAI(canvas) {
    const ctx = canvas.getContext('2d');
    const lines = [
        '> explain: γ-flip 3.074',
        '  dealers pin above the level',
        '> context: COT 260w · 10.2%',
        '  MM extreme shorts, adding longs',
        '> library: iv term structure',
        '  contango · percentile 42'
    ];
    const CHARS_PER_LINE = 26;
    let t = 0;

    return function draw(frameScale = 1) {
        const W = canvas._w, H = canvas._h;
        ctx.clearRect(0, 0, W, H);
        ctx.font = '11px "IBM Plex Mono", monospace';
        const lh = (H - 24) / lines.length;
        const total = lines.length * CHARS_PER_LINE + 60;
        const p = (t * 14) % total;
        const fade = p > total - 30 ? Math.max(0, 1 - (p - (total - 30)) / 30) : 1;
        ctx.globalAlpha = fade;
        lines.forEach((line, i) => {
            const chars = Math.max(0, Math.min(line.length, Math.floor(p - i * CHARS_PER_LINE)));
            if (chars <= 0) return;
            ctx.fillStyle = line.startsWith('>') ? 'rgba(138,182,255,0.9)' : 'rgba(200,210,225,0.55)';
            const y = 22 + lh * i + lh / 2;
            const shown = line.slice(0, chars);
            ctx.fillText(shown, 14, y);
            if (chars < line.length && Math.floor(t * 3) % 2 === 0) {
                ctx.fillStyle = 'rgba(243,156,18,0.9)';
                ctx.fillRect(14 + ctx.measureText(shown).width + 3, y - 9, 6, 11);
            }
        });
        ctx.globalAlpha = 1;
        t += 0.05 * frameScale;
    };
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
        const copy = ORDER_TEXT[PAGE_LANGUAGE];
        const name = document.getElementById('orderName').value.trim();
        const task = document.getElementById('orderTask').value.trim();
        const contact = document.getElementById('orderContact').value.trim();
        if (!name || !task || !contact) {
            errorEl.textContent = copy.required;
            return;
        }
        errorEl.textContent = '';
        const text = copy.request(name, task, contact);
        // t.me/<user>?text= не гарантирован для личных чатов — основной канал доставки текста: буфер обмена
        const copied = navigator.clipboard
            ? navigator.clipboard.writeText(text).then(() => true).catch(() => false)
            : Promise.resolve(false);
        window.open(`https://t.me/${ORDER_TG_USERNAME}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
        copied.then(ok => {
            errorEl.classList.add('ok');
            errorEl.textContent = ok
                ? copy.copied
                : copy.opened;
            setTimeout(() => {
                closeOrderModal();
                form.reset();
                errorEl.textContent = '';
                errorEl.classList.remove('ok');
            }, 2500);
        });
    });
}

/* ════════════════════════════════════════
   SCROLL TO TOP
════════════════════════════════════════ */
function initToTop() {
    const btn = document.getElementById('toTop');
    let ticking = false;
    const update = () => {
        ticking = false;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        // Opacity ramps smoothly from 0 at 50% scroll to 1 at 90%
        const p = max > 0 ? Math.min(1, Math.max(0, (window.scrollY / max - 0.5) / 0.4)) : 0;
        btn.style.opacity = p;
        btn.style.transform = `translateY(${(1 - p) * 8}px)`;
        btn.classList.toggle('visible', p > 0);
    };
    const requestUpdate = () => {
        if (!ticking) { ticking = true; requestAnimationFrame(update); }
    };
    window.addEventListener('scroll', requestUpdate, { passive: true });
    window.addEventListener('resize', requestUpdate);
    btn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: reducedMotionQuery.matches ? 'auto' : 'smooth' });
    });
    update();
}

/* COT strip: percentile text from data-p, extremes (≤10 / ≥90) highlighted */
function initCotStrip() {
    document.querySelectorAll('.ms-cot-val[data-p]').forEach(el => {
        const p = Number(el.dataset.p);
        if (!Number.isFinite(p)) return;
        el.textContent = 'p' + p;
        el.classList.toggle('ext', p <= 10 || p >= 90);
    });
}

window.addEventListener('DOMContentLoaded', () => {
    initCotStrip();
    initToTop();
    initOrderModal();
    new ParticlesSystem();
    initProjectCanvases();
    initSessionsClock();

    // Re-init canvases on resize
    let resizeTimer;
    let lastCanvasWidth = window.innerWidth;
    const resizeCanvases = force => {
        const nextWidth = window.innerWidth;
        if (!force && usesMobileAnimations() && Math.abs(nextWidth - lastCanvasWidth) < 2) return;
        lastCanvasWidth = nextWidth;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            document.querySelectorAll('.proj-canvas').forEach(c => {
                c._frameInterval = getProjectFrameInterval();
                if (sizeProjectCanvas(c) && c._draw) c._draw(0);
            });
        }, force ? 0 : 400);
    };
    window.addEventListener('resize', () => {
        resizeCanvases(false);
    });
    window.addEventListener('orientationchange', () => resizeCanvases(true));
});
