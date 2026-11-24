(() => {
  'use strict';

  /**
   * CONDUIT EffortSlider — Zero-Dependency Native Port of 21st.dev `effort-slider.tsx`
   * - 6 levels: low | medium | high | xhigh | max | ultracode
   * - Under-damped spring snap + press glide + pointer-capture drag + keyboard support
   * - 3D rolling drum level label (`rotateX(±88deg)` + edge mask) & Ultracode shimmer/pop
   * - Canvas dot-lattice pixel trail with travelling light pulses + 110-spark arrival burst
   * - Harmonized strictly to locked Figma Weave (`DESIGN.md`) light/dark architectural tokens
   */

  const LEVELS = [
    { id: 'low', label: 'Low', zh: '极速' },
    { id: 'medium', label: 'Medium', zh: '均衡' },
    { id: 'high', label: 'High', zh: '推荐' },
    { id: 'xhigh', label: 'Extra', zh: '深度' },
    { id: 'max', label: 'Max', zh: '极限' },
    { id: 'ultracode', label: 'Ultracode', zh: 'Ultracode' },
  ];

  const LAST = LEVELS.length - 1;
  const THUMB_WIDTH = 16;
  const TRACK_PAD = THUMB_WIDTH / 2;
  const DOT_PITCH = 3.5;
  const DOT_SIZE = 1.5;
  const TRAIL_LENGTH = 0.75;
  const GROW_SECONDS = 0.6;
  const RETRACT_SECONDS = 0.35;
  const FX_X = 32;
  const FX_Y = 40;
  const TAU = Math.PI * 2;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const easeOutCubic = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
  const smoothstep = (e0, e1, x) => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const hash = (n) => {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
    return s - Math.floor(s);
  };
  const mixRgb = (a, b, t) => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
  const rgba = (rgb, a) => `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},${clamp(a, 0, 1).toFixed(3)})`;

  function prefersReducedMotion() {
    if (document.documentElement.dataset.motion === 'off') return true;
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function parseCssColor(str, fallback) {
    if (!str) return fallback;
    const raw = str.trim();
    if (raw.startsWith('#')) {
      const hex = raw.slice(1);
      if (hex.length === 3) {
        return [parseInt(hex[0] + hex[0], 16), parseInt(hex[1] + hex[1], 16), parseInt(hex[2] + hex[2], 16)];
      }
      if (hex.length >= 6) {
        return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
      }
    }
    const m = raw.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
    return fallback;
  }

  function readPalette(el) {
    const cs = getComputedStyle(el || document.documentElement);
    return {
      accent: parseCssColor(cs.getPropertyValue('--effort-accent'), [104, 134, 0]),
      glint: parseCssColor(cs.getPropertyValue('--effort-glint'), [238, 255, 130]),
      muted: parseCssColor(cs.getPropertyValue('--ink-muted'), [113, 113, 123]),
      card: parseCssColor(cs.getPropertyValue('--bg-surface-1'), [255, 255, 255]),
    };
  }

  function levelIndex(id, fallback = 2) {
    const idx = LEVELS.findIndex((l) => l.id === id);
    return idx >= 0 ? idx : fallback;
  }

  function toCodexCliEffort(level) {
    if (level === 'low' || level === 'medium' || level === 'high' || level === 'xhigh') return level;
    return 'xhigh';
  }

  function springStep(state, target, dt) {
    const stiffness = 460;
    const damping = 26;
    const sub = Math.min(dt, 0.04);
    const force = (target - state.position) * stiffness;
    const damp = -state.velocity * damping;
    state.velocity += (force + damp) * sub;
    state.position += state.velocity * sub;
  }

  function buildLattice(width, height) {
    const columns = Math.floor((width - 4) / DOT_PITCH);
    const rows = Math.floor((height - 4) / DOT_PITCH);
    const left = (width - (columns - 1) * DOT_PITCH) / 2;
    const top = (height - (rows - 1) * DOT_PITCH) / 2;
    const dots = [];
    for (let c = 0; c < columns; c++) {
      for (let r = 0; r < rows; r++) {
        const seed = c * 31 + r * 7 + 1;
        dots.push({
          x: left + c * DOT_PITCH,
          y: top + r * DOT_PITCH,
          density: hash(seed),
          jitter: hash(seed + 1.13),
          phase: hash(seed + 0.37) * TAU,
          speed: 2 + hash(seed + 0.71) * 5,
        });
      }
    }
    return dots;
  }

  function arrivalSparks(x, y) {
    return Array.from({ length: 110 }, (_, i) => {
      const alongTrail = i < 78;
      const angle = alongTrail ? Math.PI + (Math.random() - 0.5) * 1.3 : Math.random() * TAU;
      const speed = alongTrail ? 160 + Math.random() * 520 : 70 + Math.random() * 230;
      return {
        x: x + (Math.random() - 0.5) * 6,
        y: y + (Math.random() - 0.5) * 14,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * (alongTrail ? 0.75 : 1),
        age: 0,
        life: 0.45 + Math.random() * 0.75,
        size: Math.random() < 0.25 ? 2.5 : 1.5,
        mix: Math.random(),
      };
    });
  }

  function stopOffset(index) {
    return `calc(${TRACK_PAD}px + (100% - ${TRACK_PAD * 2}px) * ${index / LAST})`;
  }

  function xFor(pos, width) {
    return TRACK_PAD + (pos / LAST) * (width - 2 * TRACK_PAD);
  }

  const RING_TIMINGS = [
    { duration: 900, delay: 80 },
    { duration: 1050, delay: 180 },
    { duration: 750, delay: 0 },
  ];
  const RING_KEYFRAMES = [
    { opacity: 1, transform: 'scale(1)' },
    { opacity: 0, transform: 'scale(4.2, 2.8)' },
  ];
  const FLASH_KEYFRAMES = [
    { opacity: 1, transform: 'scale(.3)' },
    { opacity: 0, transform: 'scale(1.9)' },
  ];
  const POP_EASING = 'cubic-bezier(.2,1.5,.4,1)';
  const POP_KEYFRAMES = [
    { transform: 'scale(.82)', easing: POP_EASING },
    { transform: 'scale(1.28, 1.16)', easing: POP_EASING, offset: 0.4 },
    { transform: 'scale(1)' },
  ];
  const LEVEL_POP_KEYFRAMES = [
    { transform: 'scale(.75)', opacity: 0, filter: 'blur(3px)' },
    { transform: 'scale(1.16)', opacity: 1, filter: 'blur(0) brightness(1.35)', offset: 0.45 },
    { transform: 'scale(1)', opacity: 1, filter: 'blur(0) brightness(1)' },
  ];
  const ROLL_TIMING = { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' };

  function mountEffortSlider(container, options = {}) {
    if (!container) return null;
    if (container._effortDestroy) container._effortDestroy();

    const initial = levelIndex(options.value ?? options.defaultValue ?? 'high', 2);
    const recommendedIdx = levelIndex(options.recommended ?? 'high', 2);
    const compact = Boolean(options.compact);
    const titleText = options.title || '推理深度';
    const noteText =
      options.note ||
      '更高的推理深度会在作答与写代码前做更充分推演；Ultracode 档位自动启用最高深度 (xhigh) 与多 Agent 协同编排。';

    const state = {
      position: initial,
      velocity: 0,
      target: initial,
      index: initial,
      committed: initial,
      ultra: initial === LAST ? 1 : 0,
      ultraLive: initial === LAST,
      growing: initial === LAST,
      burstStart: -1,
      dragging: false,
      grabGlide: false,
      lastInput: initial,
      lit: initial === LAST,
      sparks: [],
      fxDirty: false,
      wordKey: 0,
      noteOpen: false,
      destroyed: false,
    };

    const noteId = `effort-note-${Math.random().toString(36).slice(2, 8)}`;
    container.innerHTML = `
      <div class="effort-slider-root ${compact ? 'is-compact' : ''}" data-slot="effort-slider">
        <div class="effort-panel">
          <div class="effort-head">
            <span class="effort-kicker">${titleText}</span>
            <span class="effort-level-drum" aria-hidden="true"></span>
            <button type="button" class="effort-help-btn" aria-label="关于推理深度" aria-expanded="false" aria-controls="${noteId}">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" width="13" height="13" aria-hidden="true">
                <circle cx="8" cy="8" r="6.4" />
                <path d="M6.3 6.2a1.8 1.8 0 0 1 3.5.5c0 1.2-1.8 1.5-1.8 2.6" />
                <circle cx="8" cy="11.4" r=".5" fill="currentColor" stroke="none" />
              </svg>
            </button>
          </div>
          <p class="effort-note hidden" id="${noteId}">${noteText}</p>
          <div class="effort-ends" aria-hidden="true">
            <span>更快响应</span>
            <span>更深推理</span>
          </div>
          <div
            class="effort-track"
            role="slider"
            tabindex="0"
            aria-label="${titleText}"
            aria-valuemin="0"
            aria-valuemax="${LAST}"
            aria-valuenow="${initial}"
            aria-valuetext="${LEVELS[initial].label}"
            ${initial === LAST ? 'data-ultra=""' : ''}
          >
            <canvas class="effort-dots-canvas" aria-hidden="true"></canvas>
            <div class="effort-ticks" aria-hidden="true">
              ${LEVELS.map(
                (l, i) =>
                  `<div class="effort-tick ${i === recommendedIdx ? 'is-recommended' : ''}" style="left:${stopOffset(i)}"></div>`
              ).join('')}
            </div>
            <canvas class="effort-fx-canvas" aria-hidden="true"></canvas>
            <div class="effort-thumb">
              <div class="effort-flash"></div>
              <div class="effort-ring"></div>
              <div class="effort-ring"></div>
              <div class="effort-ring"></div>
              <div class="effort-knob"></div>
            </div>
          </div>
          <div class="effort-caption-row" aria-hidden="true">
            <span class="effort-rec-caption" style="left:${stopOffset(recommendedIdx)}">推荐 (${LEVELS[recommendedIdx].label})</span>
          </div>
        </div>
      </div>`;

    const panelEl = container.querySelector('.effort-panel');
    const drumEl = container.querySelector('.effort-level-drum');
    const helpBtn = container.querySelector('.effort-help-btn');
    const noteEl = container.querySelector('.effort-note');
    const trackEl = container.querySelector('.effort-track');
    const dotsCanvas = container.querySelector('.effort-dots-canvas');
    const fxCanvas = container.querySelector('.effort-fx-canvas');
    const thumbEl = container.querySelector('.effort-thumb');
    const knobEl = container.querySelector('.effort-knob');
    const flashEl = container.querySelector('.effort-flash');
    const ringEls = Array.from(container.querySelectorAll('.effort-ring'));
    const recCaption = container.querySelector('.effort-rec-caption');

    const dotsCtx = dotsCanvas.getContext('2d');
    const fxCtx = fxCanvas.getContext('2d');

    let trackLayout = { width: 0, height: 0, dots: [] };
    let fxSize = { width: 0, height: 0 };
    let palette = readPalette(panelEl);
    let rafId = 0;
    let lastTs = 0;
    let arrivalAnims = [];
    let glowAnim = null;
    let currentWordIdx = initial;

    function formatDisplay(idx) {
      const item = LEVELS[idx] || LEVELS[2];
      return item.id === 'ultracode' ? 'Ultracode' : `${item.label} · ${item.zh}`;
    }

    function createWordNode(idx) {
      const span = document.createElement('span');
      span.className = `effort-word ${idx === LAST ? 'is-ultra' : ''}`;
      span.textContent = formatDisplay(idx);
      return span;
    }

    drumEl.appendChild(createWordNode(initial));

    function updateDrumWord(nextIdx, animate = true) {
      if (nextIdx === currentWordIdx) return;
      const dir = nextIdx > currentWordIdx ? 1 : -1;
      const prevEl = drumEl.lastElementChild;
      currentWordIdx = nextIdx;
      const nextEl = createWordNode(nextIdx);
      drumEl.appendChild(nextEl);

      trackEl.setAttribute('aria-valuenow', String(nextIdx));
      trackEl.setAttribute('aria-valuetext', formatDisplay(nextIdx));

      const reduced = prefersReducedMotion() || !animate;
      if (reduced || typeof nextEl.animate !== 'function') {
        while (drumEl.children.length > 1) drumEl.firstElementChild.remove();
        return;
      }

      if (prevEl) {
        const outFrames =
          prevEl.classList.contains('is-ultra')
            ? [
                { opacity: 1, transform: 'scale(1)', filter: 'blur(0)' },
                { opacity: 0, transform: 'scale(.85)', filter: 'blur(3px)' },
              ]
            : [
                { opacity: 1, transform: 'rotateX(0deg)', filter: 'blur(0)', offset: 0 },
                { opacity: 0.35, offset: 0.45 },
                { opacity: 0, transform: `rotateX(${dir * 88}deg)`, filter: 'blur(1.2px)', offset: 1 },
              ];
        const aOut = prevEl.animate(outFrames, { ...ROLL_TIMING, fill: 'forwards' });
        aOut.onfinish = () => prevEl.remove();
      }

      const inFrames =
        nextIdx === LAST
          ? [
              { opacity: 0, transform: 'scale(.8)', filter: 'blur(3px)' },
              { opacity: 1, transform: 'scale(1)', filter: 'blur(0)' },
            ]
          : [
              { opacity: 0, transform: `rotateX(${-dir * 88}deg)`, filter: 'blur(1.2px)', offset: 0 },
              { opacity: 1, filter: 'blur(0)', offset: 0.55 },
              { opacity: 1, transform: 'rotateX(0deg)', filter: 'blur(0)', offset: 1 },
            ];
      nextEl.animate(inFrames, ROLL_TIMING);
    }

    function stopGlow() {
      if (glowAnim) {
        glowAnim.cancel();
        glowAnim = null;
      }
    }

    function startGlow(delay = 0) {
      stopGlow();
      if (prefersReducedMotion() || typeof knobEl.animate !== 'function') return;
      const acc = `rgb(${palette.accent[0] | 0}, ${palette.accent[1] | 0}, ${palette.accent[2] | 0})`;
      glowAnim = knobEl.animate(
        [
          { boxShadow: `0 1px 2px rgba(0,0,0,.28), 0 0 0 1px ${acc}, 0 0 10px 1px ${rgba(palette.accent, 0.36)}` },
          { boxShadow: `0 1px 2px rgba(0,0,0,.28), 0 0 0 1.5px ${acc}, 0 0 16px 3px ${rgba(palette.accent, 0.55)}`, offset: 0.5 },
          { boxShadow: `0 1px 2px rgba(0,0,0,.28), 0 0 0 1px ${acc}, 0 0 10px 1px ${rgba(palette.accent, 0.36)}` },
        ],
        { duration: 2600, iterations: Infinity, delay, easing: 'ease-in-out' }
      );
    }

    function fireArrival(now, thumbX) {
      state.ultraLive = true;
      if (prefersReducedMotion()) return;
      state.burstStart = now;
      arrivalAnims.forEach((a) => a.cancel());
      arrivalAnims = [];
      const play = (el, kf, opts) => {
        if (el && typeof el.animate === 'function') arrivalAnims.push(el.animate(kf, opts));
      };
      play(flashEl, FLASH_KEYFRAMES, { duration: 550, easing: 'cubic-bezier(.1,.8,.3,1)' });
      RING_TIMINGS.forEach((t, i) => play(ringEls[i], RING_KEYFRAMES, { ...t, easing: 'cubic-bezier(.1,.75,.3,1)' }));
      play(knobEl, POP_KEYFRAMES, { duration: 550 });
      const word = drumEl.lastElementChild;
      if (word) {
        word.style.transformOrigin = 'left center';
        play(word, LEVEL_POP_KEYFRAMES, { duration: 560, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
      startGlow(550);
      state.sparks.push(...arrivalSparks(thumbX + FX_X, trackLayout.height / 2 + FX_Y));
    }

    function resizeCanvases() {
      const rect = trackEl.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const userScale = Number(document.documentElement.dataset.canvasScale || 2);
      const dpr = Math.min(3, Math.max(window.devicePixelRatio || 1, userScale));
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      if (dotsCanvas.width !== Math.round(w * dpr) || dotsCanvas.height !== Math.round(h * dpr)) {
        dotsCanvas.width = Math.round(w * dpr);
        dotsCanvas.height = Math.round(h * dpr);
        dotsCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        trackLayout = { width: w, height: h, dots: buildLattice(w, h) };
      }
      const fw = w + FX_X * 2;
      const fh = h + FX_Y * 2;
      if (fxCanvas.width !== Math.round(fw * dpr) || fxCanvas.height !== Math.round(fh * dpr)) {
        fxCanvas.width = Math.round(fw * dpr);
        fxCanvas.height = Math.round(fh * dpr);
        fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        fxSize = { width: fw, height: fh };
      }
      if (recCaption && recCaption.offsetWidth) {
        const half = recCaption.offsetWidth / 2;
        recCaption.style.left = `clamp(${half}px, ${stopOffset(recommendedIdx)}, calc(100% - ${half}px))`;
      }
      palette = readPalette(panelEl);
      kick();
    }

    function drawTrail(thumbX, now, reduced) {
      const { width, height, dots } = trackLayout;
      if (!width) return;
      dotsCtx.clearRect(0, 0, width, height);
      if (state.ultra <= 0) return;

      const growth = state.growing ? easeOutCubic(state.ultra) : state.ultra;
      const dotRgb = mixRgb(palette.muted, palette.card, 1 / 3);
      const { accent, glint } = palette;
      const t = now / 1000;
      const start = thumbX - THUMB_WIDTH / 2;
      const length = width * TRAIL_LENGTH;

      const bloom = dotsCtx.createLinearGradient(start, 0, start - length, 0);
      bloom.addColorStop(0, rgba(accent, 0.28 * smoothstep(0, 0.35, growth)));
      bloom.addColorStop(1, rgba(accent, 0));
      dotsCtx.fillStyle = bloom;
      dotsCtx.fillRect(Math.max(0, start - length), 0, Math.min(length, start), height);

      const pulses = reduced ? [] : [(t * 0.48) % 1.3, (t * 0.48 + 0.62) % 1.3];
      const pulseStrength = reduced ? 0 : smoothstep(0.55, 1, growth);
      const flashWindow = state.growing && !reduced ? 1 - smoothstep(0.9, 1, growth) : 0;
      const since = now - state.burstStart;
      const burstGlow = state.burstStart > 0 && since < 1500 && !reduced ? Math.exp(-since / 280) : 0;

      for (const d of dots) {
        const n = (start - d.x) / length;
        if (n < 0 || n > 1) continue;
        const threshold = n * 0.82 + d.jitter * 0.18;
        const appear = clamp((growth - threshold) / 0.07, 0, 1);
        if (appear <= 0) continue;

        let pulse = 0;
        for (const p of pulses) {
          const dist = n - p;
          pulse += Math.exp(-(dist * dist) / (2 * 0.045 * 0.045));
        }
        pulse = Math.min(1, pulse) * pulseStrength * (1 - n * 0.35);

        const density = 0.9 - 0.8 * Math.pow(n, 0.85) + pulse * 0.25 + burstGlow * 0.75;
        if (d.density > density) continue;

        let alpha = 0.95 - 0.68 * n;
        let tint = 1 - smoothstep(0.2, 1, n) * 0.85;
        let white = 0;

        if (flashWindow > 0) {
          const fl = Math.exp(-(growth - threshold) / 0.05) * flashWindow;
          alpha += fl * 0.5;
          white += fl * 0.7;
        }
        if (!reduced) alpha *= 0.66 + 0.34 * Math.sin(t * d.speed + d.phase);
        alpha += pulse * 0.6 + burstGlow * 0.7;
        white += pulse * 0.55 + burstGlow * 0.55;
        alpha *= appear * (1 - smoothstep(0.82, 1, n) * 0.6);
        alpha = clamp(alpha, 0, 1);
        if (alpha < 0.02) continue;

        tint = clamp(tint, 0, 1);
        white = clamp(white, 0, 1);
        const r = (dotRgb[0] + (accent[0] - dotRgb[0]) * tint) * (1 - white) + glint[0] * white;
        const g = (dotRgb[1] + (accent[1] - dotRgb[1]) * tint) * (1 - white) + glint[1] * white;
        const b = (dotRgb[2] + (accent[2] - dotRgb[2]) * tint) * (1 - white) + glint[2] * white;
        dotsCtx.globalAlpha = alpha;
        dotsCtx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
        dotsCtx.fillRect(d.x - DOT_SIZE / 2, d.y - DOT_SIZE / 2, DOT_SIZE, DOT_SIZE);
      }
      dotsCtx.globalAlpha = 1;
    }

    function drawEffects(thumbX, now, delta) {
      const { width, height } = fxSize;
      if (!width) return false;
      const since = now - state.burstStart;
      const shock = state.burstStart > 0 && since < 420;
      if (!state.sparks.length && !shock) {
        if (state.fxDirty) {
          fxCtx.clearRect(0, 0, width, height);
          state.fxDirty = false;
        }
        return false;
      }
      state.fxDirty = true;
      const { accent, glint } = palette;
      fxCtx.clearRect(0, 0, width, height);
      const cx = thumbX + FX_X;
      const cy = trackLayout.height / 2 + FX_Y;

      if (shock) {
        const k = since / 420;
        const reach = easeOutCubic(k * 1.6) * trackLayout.width * 0.9;
        const alpha = 0.55 * (1 - k);
        const beam = fxCtx.createLinearGradient(cx, 0, cx - reach, 0);
        beam.addColorStop(0, rgba(glint, alpha));
        beam.addColorStop(0.25, rgba(accent, alpha * 0.8));
        beam.addColorStop(1, rgba(accent, 0));
        fxCtx.fillStyle = beam;
        const thick = 3 + 8 * (1 - k);
        fxCtx.fillRect(cx - reach, cy - thick / 2, reach, thick);
      }

      const drag = Math.exp(-delta * 3.4);
      const alive = [];
      for (const s of state.sparks) {
        s.age += delta;
        if (s.age >= s.life) continue;
        s.vx *= drag;
        s.vy *= drag;
        s.x += s.vx * delta;
        s.y += s.vy * delta;
        const life = 1 - s.age / s.life;
        const hot = Math.max(0, 1 - s.age / 0.12);
        const col = mixRgb(accent, glint, Math.min(1, s.mix * 0.6 + hot));
        fxCtx.globalAlpha = Math.pow(life, 1.3);
        fxCtx.fillStyle = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`;
        fxCtx.fillRect(Math.round(s.x * 2) / 2, Math.round(s.y * 2) / 2, s.size, s.size);
        alive.push(s);
      }
      fxCtx.globalAlpha = 1;
      state.sparks = alive;
      return alive.length > 0 || shock;
    }

    function step(ts) {
      if (state.destroyed) return;
      rafId = 0;
      const delta = lastTs ? Math.min((ts - lastTs) / 1000, 0.05) : 0.016;
      lastTs = ts;
      const reduced = prefersReducedMotion();
      const { width } = trackLayout;

      if (!state.dragging || state.grabGlide) {
        if (reduced) {
          state.position = state.target;
          state.velocity = 0;
        } else {
          springStep(state, state.target, delta);
          state.position = clamp(state.position, -0.15, LAST + 0.15);
        }
      }

      const ultraOn = state.dragging
        ? Math.round(clamp(state.position, 0, LAST)) === LAST
        : state.index === LAST;
      const thumbX = xFor(clamp(state.position, 0, LAST), width || 220);

      if (!ultraOn) state.ultraLive = false;
      else if (!state.ultraLive && state.position >= LAST - 0.12) fireArrival(ts, thumbX);

      const goal = ultraOn && state.ultraLive ? 1 : 0;
      if (reduced) state.ultra = goal;
      else if (state.ultra < goal) state.ultra = Math.min(goal, state.ultra + delta / GROW_SECONDS);
      else if (state.ultra > goal) state.ultra = Math.max(goal, state.ultra - delta / RETRACT_SECONDS);
      state.growing = ultraOn;

      const nextLit = goal === 1;
      if (state.lit !== nextLit) {
        state.lit = nextLit;
        if (nextLit) {
          trackEl.setAttribute('data-ultra', '');
          if (!glowAnim) startGlow(0);
        } else {
          trackEl.removeAttribute('data-ultra');
          stopGlow();
        }
      }

      if (width > 0) {
        const px = (clamp(state.position, 0, LAST) / LAST) * (width - THUMB_WIDTH);
        thumbEl.style.transform = `translate3d(${px.toFixed(2)}px,0,0)`;
      }

      drawTrail(thumbX, ts, reduced);
      const sparksLive = drawEffects(thumbX, ts, delta);

      const bursting = sparksLive || (state.burstStart > 0 && ts - state.burstStart < 1300);
      const settled =
        !state.dragging &&
        Math.abs(state.position - state.target) < 0.0005 &&
        Math.abs(state.velocity) < 0.001 &&
        state.ultra === goal;
      const ambient = !reduced && state.ultra > 0;

      if (!settled || ambient || bursting) {
        rafId = requestAnimationFrame(step);
      } else {
        lastTs = 0;
      }
    }

    function kick() {
      if (state.destroyed) return;
      if (!rafId) rafId = requestAnimationFrame(step);
    }

    function positionOnTrack(clientX) {
      const rect = trackEl.getBoundingClientRect();
      const span = Math.max(1, rect.width - 2 * TRACK_PAD);
      return clamp((clientX - rect.left - TRACK_PAD) / span, 0, 1) * LAST;
    }

    function dragTo(clientX, first) {
      const pos = positionOnTrack(clientX);
      if (first && !prefersReducedMotion()) {
        state.target = pos;
        state.grabGlide = true;
      } else {
        state.grabGlide = false;
        state.position = pos;
        state.velocity = 0;
      }
      const nearest = Math.round(pos);
      if (nearest !== state.lastInput) {
        state.lastInput = nearest;
        state.index = nearest;
        updateDrumWord(nearest, true);
        if (options.onInput) options.onInput(LEVELS[nearest].id);
      }
      kick();
    }

    trackEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      trackEl.focus({ preventScroll: true });
      try { trackEl.setPointerCapture(e.pointerId); } catch {}
      state.dragging = true;
      state.lastInput = state.index;
      trackEl.setAttribute('data-dragging', '');
      dragTo(e.clientX, true);
    });

    trackEl.addEventListener('pointermove', (e) => {
      if (state.dragging) dragTo(e.clientX, false);
    });

    const finishDrag = (e) => {
      if (!state.dragging) return;
      const glide = state.grabGlide;
      state.dragging = false;
      state.grabGlide = false;
      trackEl.removeAttribute('data-dragging');
      try {
        if (trackEl.hasPointerCapture(e.pointerId)) trackEl.releasePointerCapture(e.pointerId);
      } catch {}
      const idx = clamp(Math.round(glide ? state.target : state.position), 0, LAST);
      state.index = idx;
      state.target = idx;
      state.committed = idx;
      updateDrumWord(idx, true);
      if (options.onChange) options.onChange(LEVELS[idx].id);
      kick();
    };
    trackEl.addEventListener('pointerup', finishDrag);
    trackEl.addEventListener('pointercancel', finishDrag);

    trackEl.addEventListener('keydown', (e) => {
      let next = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = state.committed + 1;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = state.committed - 1;
      else if (e.key === 'Home' || e.key === 'PageDown') next = 0;
      else if (e.key === 'End' || e.key === 'PageUp') next = LAST;
      if (next === null) return;
      e.preventDefault();
      const idx = clamp(next, 0, LAST);
      if (idx === state.committed) return;
      state.committed = idx;
      state.index = idx;
      state.target = idx;
      updateDrumWord(idx, true);
      if (options.onChange) options.onChange(LEVELS[idx].id);
      kick();
    });

    helpBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.noteOpen = !state.noteOpen;
      helpBtn.setAttribute('aria-expanded', String(state.noteOpen));
      noteEl.classList.toggle('hidden', !state.noteOpen);
    });

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resizeCanvases) : null;
    if (ro) ro.observe(trackEl);
    requestAnimationFrame(resizeCanvases);
    if (initial === LAST && !prefersReducedMotion()) startGlow(0);

    const api = {
      setValue(levelId, silent = true) {
        const idx = levelIndex(levelId, state.committed);
        state.committed = idx;
        state.index = idx;
        state.target = idx;
        if (prefersReducedMotion()) {
          state.position = idx;
          state.velocity = 0;
        }
        updateDrumWord(idx, !silent);
        kick();
      },
      getValue() {
        return LEVELS[state.committed]?.id || 'high';
      },
      syncTheme() {
        palette = readPalette(panelEl);
        resizeCanvases();
        kick();
      },
      destroy() {
        state.destroyed = true;
        if (rafId) cancelAnimationFrame(rafId);
        stopGlow();
        arrivalAnims.forEach((a) => a.cancel());
        if (ro) ro.disconnect();
      },
    };

    container._effortDestroy = api.destroy;
    return api;
  }

  window.ConduitEffortSlider = {
    LEVELS,
    mount: mountEffortSlider,
    toCodexCliEffort,
  };
})();
