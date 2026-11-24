(() => {
  'use strict';

  /**
   * CONDUIT ThinkingOrbs Engine
   * Native zero-dependency port of 21st.dev `thinking-orbs.tsx`
   * Animated 3D Fibonacci-sphere SVG dot orbs tinted via `currentColor`.
   * States: base, working(+gyro), reasoning(+twins), searching(+lighthouse),
   *         background(+spiral), retrying(+surge), compacting(+squeeze/+fuse), waiting.
   */
  const VARIANTS = {
    base: ['default'],
    working: ['default', 'gyro'],
    reasoning: ['default', 'twins'],
    searching: ['default', 'lighthouse'],
    background: ['default', 'spiral'],
    retrying: ['default', 'surge'],
    compacting: ['default', 'squeeze', 'fuse'],
    waiting: ['default'],
  };

  const TAU = Math.PI * 2;
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const ease = (x) => (1 - Math.cos(Math.PI * x)) / 2;
  const hash = (n) => {
    const s = Math.sin(n * 127.1) * 43758.5453;
    return s - Math.floor(s);
  };
  const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

  function nearest(pts, i, k) {
    const idx = [];
    const d = [];
    const p = pts[i];
    for (let j = 0; j < pts.length; j += 1) {
      if (j === i) continue;
      const e = dist2(p, pts[j]);
      let at = idx.length;
      if (at === k) {
        if (e >= d[k - 1]) continue;
        at -= 1;
      }
      while (at > 0 && d[at - 1] > e) {
        idx[at] = idx[at - 1];
        d[at] = d[at - 1];
        at -= 1;
      }
      idx[at] = j;
      d[at] = e;
    }
    return idx;
  }

  const PERIOD = {
    base: 6500,
    working: 3000,
    'working-gyro': 3000,
    reasoning: 6500,
    'reasoning-twins': 6500,
    searching: 13000,
    'searching-lighthouse': 13000,
    background: 13000,
    'background-spiral': 13000,
    retrying: 13000,
    'retrying-surge': 13000,
    compacting: 10000,
    'compacting-squeeze': 10000,
    'compacting-fuse': 10000,
    waiting: 13000,
  };

  const clocks = new Map();
  function tick(look, now, speed) {
    let c = clocks.get(look);
    if (!c) {
      c = { t: 0, last: now };
      clocks.set(look, c);
    }
    if (now > c.last) {
      c.t += Math.min(now - c.last, 100) * speed;
      c.last = now;
    }
    return c.t;
  }

  const spring = (x) => 1 - Math.exp(-4.5 * x) * Math.cos(3 * Math.PI * x) - x * Math.exp(-4.5);

  function rewind(t, w) {
    const P = 3200;
    const k = Math.floor(t / P);
    const u = t - k * P;
    const back = 0.6 * 2100 * w;
    const fwd = (2000 + 100 + 100) * w;
    let a;
    if (u < 2000) a = u * w;
    else if (u < 2200) {
      const x = (u - 2000) / 200;
      a = (2000 + 200 * (x - (x * x) / 2)) * w;
    } else if (u < 3000) a = 2100 * w - back * spring((u - 2200) / 800);
    else {
      const x = (u - 3000) / 200;
      a = 2100 * w - back + 100 * x * x * w;
    }
    return k * (fwd - back) + a;
  }

  function yawOf(state, t) {
    if (state === 'retrying') return rewind(2 * t, TAU / 9000);
    if (state === 'retrying-surge') {
      const turns = t / 3250;
      const u = turns - Math.floor(turns);
      return (Math.floor(turns) + (1 - (1 - u) ** 3)) * TAU;
    }
    return (t / (PERIOD[state] || 6500)) * TAU;
  }

  const RING_AXIS = (() => {
    const tip = (30 * Math.PI) / 180;
    const roll = (10 * Math.PI) / 180;
    return [-Math.sin(roll) * Math.cos(tip), Math.cos(roll) * Math.cos(tip), Math.sin(tip)];
  })();
  const TWIST = 1.4;
  const LEAN = (30 * Math.PI) / 180;
  const TRAIL = Math.PI / 2;
  const LENS_MS = 1800;
  const MOVE = 0.4;
  const LENS = 0.6;
  const HOP = 220;
  const TAIL = 5;
  const REACH = 24;
  const WALK = 16;

  function spot(k) {
    const phi = k * 2.45 + hash(k) * 1.5;
    const theta = ((15 + 30 * hash(k + 0.5)) * Math.PI) / 180;
    return [Math.sin(theta) * Math.cos(phi), Math.sin(theta) * Math.sin(phi), Math.cos(theta)];
  }

  function lensAt(t) {
    const k = Math.floor(t / LENS_MS);
    const u = t / LENS_MS - k;
    const e = u < MOVE ? (1 - Math.cos((u / MOVE) * Math.PI)) / 2 : 1;
    const a = spot(k);
    const b = spot(k + 1);
    const v = a.map((ai, j) => ai + (b[j] - ai) * e);
    const n = Math.hypot(v[0], v[1], v[2]) || 1;
    return v.map((vi) => vi / n);
  }

  function arms(count) {
    const at = (lat, lon) => [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];
    const g = Math.sqrt((4 * Math.PI) / count);
    const n = 8;
    const along = 0.6 * g;
    return Array.from({ length: n }, (_, m) => {
      const room = m ? m & -m : n;
      const lim = Math.min((85 * Math.PI) / 180, Math.acos(Math.min(1, (g * n) / (TAU * room))));
      const out = [];
      for (let lat = -lim + ((m * 0.618) % 1) * along; lat <= lim; lat += along / Math.sqrt(1 + Math.cos(lat) ** 2)) {
        out.push(at(lat, (m / n) * TAU - lat));
      }
      return out;
    }).flat();
  }

  function distribute(state, count) {
    if (state === 'background-spiral') return arms(count);
    return Array.from({ length: count }, (_, i) => {
      const y = 1 - (2 * (i + 0.5)) / count;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const th = i * GOLDEN;
      return [r * Math.cos(th), y, r * Math.sin(th)];
    });
  }

  const activeInstances = new Set();

  function isMotionEnabled() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    return document.documentElement.dataset.motion !== 'off';
  }

  function mountOrb(svg, opts = {}) {
    if (!svg) return null;
    const {
      state: asked = 'base',
      variant = 'default',
      size = 20,
      speed = 1,
      label = '',
      density = 1,
      dotSize = 1,
      tilt = 20,
    } = opts;

    const which = Object.prototype.hasOwnProperty.call(VARIANTS, asked) ? asked : 'base';
    const own = variant !== 'default' && VARIANTS[which].includes(variant);
    const state = own ? `${which}-${variant}` : which;

    svg.replaceChildren();
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svg.setAttribute('fill', 'currentColor');
    if (label) {
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', label);
      svg.removeAttribute('aria-hidden');
    } else {
      svg.setAttribute('aria-hidden', 'true');
      svg.removeAttribute('role');
      svg.removeAttribute('aria-label');
    }

    const dens = state === 'background' ? 1 : 4;
    const count = Math.max(8, Math.round(size * dens * density));
    const c = size / 2;
    const R = c * 0.8;
    const rs = (size / 64) ** 0.6 * (0.72 * Math.sqrt(4 / dens)) * dotSize;
    const pts = distribute(state, count);

    const els = pts.map(() => svg.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'circle')));
    const hidden = new Uint8Array(pts.length);

    const reasoning = (state === 'reasoning' || state === 'reasoning-twins') && pts.length > 1;
    const compacting = state === 'compacting' || state === 'compacting-fuse';
    const near = reasoning ? pts.map((_, i) => nearest(pts, i, REACH)) : [];
    const walks = Array.from({ length: state === 'reasoning-twins' ? 2 : 1 }, () => []);
    let hops = 0;

    function draw(t) {
      const period = PERIOD[state] || 6500;
      const yaw = yawOf(state, t);
      const gyro = state === 'working-gyro' ? (t / 5000) * TAU : null;
      const pitch = ((tilt + (gyro === null ? 0 : 10 * Math.cos(gyro))) * Math.PI) / 180;
      const roll = gyro === null ? 0 : (12 * Math.sin(gyro) * Math.PI) / 180;
      const sr = Math.sin(roll);
      const cr = Math.cos(roll);
      const sy = Math.sin(yaw);
      const cy = Math.cos(yaw);
      const st = Math.sin(pitch);
      const ct = Math.cos(pitch);

      const facing = (k) => pts[k][1] * st + (-pts[k][0] * sy + pts[k][2] * cy) * ct;
      const lit = new Map();

      if (reasoning) {
        const s = t / HOP;
        const n = Math.floor(s);
        const f = s - n;
        if (!walks[0].length) {
          let first = 0;
          for (let k = 1; k < pts.length; k += 1) {
            if (facing(k) > facing(first)) first = k;
          }
          walks.forEach((walk, w) => {
            if (w === 0) {
              walk.push(first);
            } else {
              let best = 0;
              let bestVal = -Infinity;
              for (let k = 0; k < pts.length; k += 1) {
                const val = facing(k) + dist2(pts[k], pts[first]);
                if (val > bestVal) {
                  bestVal = val;
                  best = k;
                }
              }
              walk.push(best);
            }
          });
        }
        hops = Math.max(hops, n - WALK);
        for (; hops < n; hops += 1) {
          walks.forEach((walk, w) => {
            const recent = walk.slice(-8);
            const from = walk[walk.length - 1];
            let best = -1;
            let score = -Infinity;
            const other = state === 'reasoning-twins' ? walks[1 - w][walks[1 - w].length - 1] : undefined;
            near[from].forEach((k, j) => {
              const apart = other === undefined ? 0 : 1.2 * Math.min(Math.sqrt(dist2(pts[k], pts[other])), 0.8);
              const sc = facing(k) + 0.35 * hash(hops * 31 + j + w * 977) + apart;
              if (!recent.includes(k) && sc > score) {
                score = sc;
                best = k;
              }
            });
            walk.push(best < 0 ? near[from][0] : best);
            if (walk.length > WALK) walk.shift();
          });
        }
        const light = (k, v) => {
          if (k !== undefined) lit.set(k, Math.max(lit.get(k) || 0, v));
        };
        for (const walk of walks) {
          for (let j = TAIL - 1; j >= 0; j -= 1) {
            light(walk[walk.length - 1 - j], j === 0 ? ease(Math.min(1, f * 2)) : 1 - (j - 1 + f) / TAIL);
          }
        }
      }

      const head = (t / 2000) * TAU + yaw;
      const ahead = TAU / 2000 + TAU / period;
      const headLat = (tt) => ((70 * Math.PI) / 180) * (1 - 2 * ((tt % 6000) / 6000));
      const glow = Math.min(1, 3 * Math.sin(Math.PI * ((t % 6000) / 6000)));
      const lens = state === 'searching' ? lensAt(t) : null;
      const tw =
        state === 'working-gyro'
          ? 0.5 * Math.sin((t / 2600) * TAU)
          : state === 'compacting-squeeze'
            ? Math.sin((t / 2600) * TAU)
            : 0;

      let sweep = null;
      if (compacting) {
        const u = (t % 2800) / 2800;
        const s = (u - 0.7) / 0.3;
        const release =
          state === 'compacting-fuse'
            ? (1 - s) ** 3
            : s < 0.45
              ? 1 - 1.25 * ease(s / 0.45)
              : s < 0.7
                ? -0.25 * (1 - (s - 0.45) / 0.25) ** 2
                : 0;
        sweep = { at: -1.15 + 2.3 * Math.min(1, u / 0.7), hold: u < 0.7 ? 1 : release };
      }

      for (let i = 0; i < pts.length; i += 1) {
        const [x, y, z] = pts[i];
        const turn = yaw + TWIST * tw * y;
        const ly = tw ? Math.sin(turn) : sy;
        const lc = tw ? Math.cos(turn) : cy;
        const z1 = -x * ly + z * lc;
        let vx = x * lc + z * ly;
        let vy = y * ct - z1 * st;
        const vz = y * st + z1 * ct;
        const d = (vz + 1) / 2;
        let r = (0.5 + 1.4 * d) * rs;
        let a = Math.max(0, (d - 0.3) / 0.7);

        if (lens) {
          const ang = Math.acos(Math.min(1, (vx * lens[0] + vy * lens[1] + vz * lens[2]) / (Math.hypot(vx, vy, vz) || 1)));
          const w = ang < LENS ? (1 - (ang / LENS) ** 2) ** 2 : 0;
          a *= 1 - 0.55 * (1 - w);
          if (size <= 24) r *= 1 + 0.5 * w;
          if (w) {
            vx *= 1 + 0.12 * w;
            vy *= 1 + 0.12 * w;
            vx += (vx - lens[0]) * 0.35 * w;
            vy += (vy - lens[1]) * 0.35 * w;
            r *= 1 + 0.9 * w;
            a += (1 - a) * w;
          }
        }
        if (sweep) {
          const q = vx;
          const w = Math.min(1, Math.max(0, (sweep.at - q) / 0.2)) * sweep.hold;
          const k = state === 'compacting' ? 1.5 : 1;
          vx *= 1 - 0.2 * k * w;
          vy *= 1 - 0.2 * k * w;
          r *= 1 - 0.3 * k * w;
          if (state === 'compacting-fuse') {
            a *= 1 - 0.5 * w;
            const g = Math.exp(-(((q - sweep.at) / 0.08) ** 2)) * Math.max(0, sweep.hold) * Math.min(1, d / 0.5);
            r *= 1 + 0.8 * g;
            a += (1 - a) * g;
          }
        }
        if (state === 'working') {
          const u = t % 1700;
          const at = 1.3 - 2.6 * ease(Math.min(1, u / 1200));
          const q = vx * RING_AXIS[0] + vy * RING_AXIS[1] + vz * RING_AXIS[2];
          const g = u < 1200 ? Math.exp(-(((q - at) / 0.2) ** 2)) : 0;
          r *= 1 + 0.6 * g;
          a += (1 - a) * g;
          const w = Math.min(1, Math.max(0, (q - at) / 0.2)) * (u < 1200 ? 1 : 1 - Math.min(1, 1.6 * ((u - 1200) / 800)));
          vx *= 1 - 0.08 * w;
          vy *= 1 - 0.08 * w;
          r *= 1 - 0.15 * w;
        }
        if (state === 'searching-lighthouse') {
          a *= 0.5;
          const lr = Math.sin(LEAN);
          const lc2 = Math.cos(LEAN);
          const across = vx * lc2 - vy * lr;
          const toward = -st * (vx * lr + vy * lc2) + ct * vz;
          const off = Math.atan2(across, toward) - (((t / 2500) % 1) * TAU - Math.PI);
          const dphi = ((((off + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
          const beam = dphi < 0 ? Math.max(0, 1 + dphi / TRAIL) : Math.exp(-((dphi / 0.45) ** 2));
          const g = beam * (0.25 + 0.75 * Math.min(1, Math.max(0, (d - 0.4) / 0.3)));
          r *= 1 + 0.6 * g;
          a += (1 - a) * g;
        }
        if (reasoning) {
          const spark = lit.get(i) || 0;
          a *= 0.5;
          if (spark) {
            r *= 1 + 0.8 * spark;
            a += (1 - a) * spark;
          }
        }
        if (state === 'waiting') {
          const lat = Math.asin(y / (Math.hypot(x, y, z) || 1));
          const lon = Math.atan2(z, x);
          const off = Math.atan2(Math.sin(lon - head), Math.cos(lon - head));
          const along = off * Math.cos(lat);
          const g =
            Math.exp(-(((lat - headLat(t + off / ahead)) / 0.28) ** 2)) *
            Math.exp(-((along / (off * ahead > 0 ? 0.12 : 1)) ** 2));
          const w = glow * g ** 0.6;
          a = a * 0.5 + (1 - a * 0.5) * w;
          r *= 1 + 1.1 * w;
        }
        if (roll) {
          const nvx = vx * cr - vy * sr;
          const nvy = vx * sr + vy * cr;
          vx = nvx;
          vy = nvy;
        }

        const dotEl = els[i];
        const o = Math.max(0, Math.min(1, a)).toFixed(2);
        if (o === '0.00' && hidden[i]) continue;
        hidden[i] = o === '0.00' ? 1 : 0;
        dotEl.setAttribute('cx', (c + vx * R).toFixed(2));
        dotEl.setAttribute('cy', (c - vy * R).toFixed(2));
        dotEl.setAttribute('r', Math.max(0.45, r).toFixed(2));
        dotEl.setAttribute('fill-opacity', o);
      }
    }

    const look = `${state}@${speed}`;
    draw(tick(look, performance.now(), speed));

    let visible = true;
    let raf = 0;
    let dead = false;
    const io = new IntersectionObserver((es) => {
      visible = es[es.length - 1].isIntersecting;
    });
    io.observe(svg);

    function frame(now) {
      if (dead || !svg.isConnected) {
        api.destroy();
        return;
      }
      const t = tick(look, now, speed);
      if (visible) draw(t);
      raf = requestAnimationFrame(frame);
    }

    const api = {
      svg,
      key: `${state}:${size}:${speed}:${density}`,
      pause() {
        cancelAnimationFrame(raf);
        raf = 0;
      },
      play() {
        if (!raf && !dead && isMotionEnabled()) {
          raf = requestAnimationFrame(frame);
        }
      },
      destroy() {
        if (dead) return;
        dead = true;
        cancelAnimationFrame(raf);
        raf = 0;
        io.disconnect();
        activeInstances.delete(api);
      },
    };

    activeInstances.add(api);
    if (!opts.paused) api.play();
    return api;
  }

  /* =========================================================================
     Semantic 10-State AI Orb State Machine (Native Port of 21st.dev ai-orb.tsx)
     ========================================================================= */
  const AI_ORB_STATES = [
    'idle',
    'listening',
    'thinking',
    'reasoning',
    'tool-call',
    'tool-result',
    'streaming',
    'waiting-approval',
    'error',
    'done',
  ];

  const AI_ORB_LABELS = {
    idle: '助手就绪',
    listening: '正在聆听输入',
    thinking: '正在思考拆解',
    reasoning: '正在深度推演',
    'tool-call': '正在调用本地工具',
    'tool-result': '正在汇总工具结果',
    streaming: '正在流式作答',
    'waiting-approval': '等待人工拍板确认',
    error: '运行遇到异常',
    done: '本轮协同已完成',
  };

  const AI_ORB_VISUALS = {
    idle: { state: 'base', variant: 'default', speed: 0.6, paused: false, settles: true, tone: 'muted' },
    listening: { state: 'waiting', variant: 'default', speed: 1, paused: false, settles: true, tone: 'primary' },
    thinking: { state: 'working', variant: 'default', speed: 1, paused: false, settles: false, tone: 'primary' },
    reasoning: { state: 'reasoning', variant: 'twins', speed: 1, paused: false, settles: false, tone: 'primary' },
    'tool-call': { state: 'searching', variant: 'lighthouse', speed: 1, paused: false, settles: false, tone: 'primary' },
    'tool-result': { state: 'compacting', variant: 'fuse', speed: 1, paused: false, settles: false, tone: 'primary' },
    streaming: { state: 'working', variant: 'gyro', speed: 1, paused: false, settles: false, tone: 'primary' },
    'waiting-approval': { state: 'compacting', variant: 'squeeze', speed: 0.8, paused: false, settles: true, tone: 'attention' },
    error: { state: 'retrying', variant: 'default', speed: 1, paused: true, settles: false, tone: 'critical' },
    done: { state: 'base', variant: 'default', speed: 0.6, paused: false, settles: true, tone: 'primary' },
  };

  function orbStateFor({ status = 'ready', activity, hasDraft = false, hasAnswered = false } = {}) {
    if (status === 'error') return 'error';
    if (status === 'submitted') return 'thinking';
    if (status === 'streaming') {
      const live = { question: 'waiting-approval', reasoning: 'reasoning', text: 'streaming', 'tool-call': 'tool-call', 'tool-result': 'tool-result' };
      return activity && live[activity] ? live[activity] : 'thinking';
    }
    if (activity === 'question') return 'waiting-approval';
    if (hasDraft) return 'listening';
    return hasAnswered ? 'done' : 'idle';
  }

  function applyAiOrbState(svg, aiState, { settleMs = 5000 } = {}) {
    if (!svg) return;
    const key = AI_ORB_VISUALS[aiState] ? aiState : 'idle';
    const v = AI_ORB_VISUALS[key];
    svg.dataset.aiOrbState = key;
    svg.dataset.aiOrbTone = v.tone;
    svg.dataset.orbState = v.state;
    svg.dataset.orbVariant = v.variant;
    svg.dataset.orbSpeed = String(v.speed);
    svg.dataset.orbPaused = v.paused ? '1' : '0';
    svg.setAttribute('aria-label', AI_ORB_LABELS[key] || key);
    if (svg.__settleTimer) {
      clearTimeout(svg.__settleTimer);
      svg.__settleTimer = null;
    }
    mountAll(svg.parentElement || document);
    if (v.settles && !v.paused && settleMs > 0) {
      svg.__settleTimer = setTimeout(() => {
        if (svg.dataset.aiOrbState === key && svg.__conduitOrb) svg.__conduitOrb.pause();
      }, settleMs);
    }
  }

  function mountAll(root = document) {
    // Cleanup disconnected orbs first
    for (const inst of Array.from(activeInstances)) {
      if (!inst.svg || !inst.svg.isConnected) inst.destroy();
    }

    const nodes = root.querySelectorAll('svg[data-orb-state]');
    nodes.forEach((svg) => {
      const state = svg.dataset.orbState || 'base';
      const variant = svg.dataset.orbVariant || 'default';
      const size = Number(svg.dataset.orbSize) || 20;
      const speed = Number(svg.dataset.orbSpeed) || 1;
      const paused = svg.dataset.orbPaused === '1';
      const label = svg.dataset.orbLabel || '';
      const key = `${state}:${variant}:${size}:${speed}:${paused ? 1 : 0}`;
      if (svg.__conduitOrb && svg.__conduitOrb.key === key) {
        if (isMotionEnabled() && !paused) svg.__conduitOrb.play();
        else svg.__conduitOrb.pause();
        return;
      }
      if (svg.__conduitOrb) svg.__conduitOrb.destroy();
      const inst = mountOrb(svg, { state, variant, size, speed, label, paused });
      if (inst) {
        inst.key = key;
        svg.__conduitOrb = inst;
      }
    });
  }

  function syncAll() {
    const enabled = isMotionEnabled();
    for (const inst of Array.from(activeInstances)) {
      if (!inst.svg || !inst.svg.isConnected) {
        inst.destroy();
        continue;
      }
      const paused = inst.svg.dataset.orbPaused === '1';
      if (enabled && !paused) inst.play();
      else inst.pause();
    }
  }

  window.ConduitOrbs = {
    VARIANTS,
    AI_ORB_STATES,
    AI_ORB_LABELS,
    AI_ORB_VISUALS,
    orbStateFor,
    applyAiOrbState,
    mountOrb,
    mountAll,
    syncAll,
  };
})();
