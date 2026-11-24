(() => {
  'use strict';

  const MODE_LABELS = {
    'full-pipeline': '全链路协同',
    'plan-only': '独立规划',
    'codex-exec': 'Codex 直派',
    'codex-review': '审查门禁',
    'copy-polish': '文案顾问',
  };

  const MODE_SHORT = {
    'full-pipeline': '全链路',
    'plan-only': '独立规划',
    'codex-exec': 'Codex直派',
    'codex-review': '审查门禁',
    'copy-polish': '文案顾问',
  };

  const MODE_ITEMS = [
    { id: 'full-pipeline', title: '全链路协同', sub: 'Gemini 规划 → 人工拍板 → Codex 施工 → Pre-CI 审查', badge: '推荐' },
    { id: 'plan-only', title: '独立规划', sub: '仅 Gemini 只读拆解架构与接口契约', badge: '只读' },
    { id: 'codex-exec', title: 'Codex 直派', sub: '跳过规划，安全沙箱直接写代码（支持会话续跑）', badge: '沙箱' },
    { id: 'codex-review', title: 'Pre-CI 审查门禁', sub: '两级分级拦截，高危路径自动升档 xhigh', badge: '门禁' },
    { id: 'copy-polish', title: '文案与交互顾问', sub: 'Gemini 去 AI 味润色，输出前后对比表', badge: '润色' },
  ];

  const SLASH_COMMANDS = [
    { key: '/pipeline', mode: 'full-pipeline', detail: '全链路协同（Gemini 规划 → 拍板 → Codex 施工 → 审查）' },
    { key: '/plan', mode: 'plan-only', detail: '独立规划（仅 Gemini 只读拆解契约）' },
    { key: '/codex', mode: 'codex-exec', detail: 'Codex 直派（安全沙箱直接写代码）' },
    { key: '/review', mode: 'codex-review', detail: 'Pre-CI 审查门禁（分级拦截 + 自动升 xhigh）' },
    { key: '/copy', mode: 'copy-polish', detail: 'Gemini 文案与交互顾问' },
  ];

  const DEFAULT_TWEAKS = {
    surface: 'obsidian',
    accent: 'cobalt',
    inspector: 'standard',
    metal: 'chromatic',
    fontSize: 14,
    waveAmplitude: 75,
    crosshairs: true,
    hatch: true,
    motion: true,
  };

  const appState = {
    health: null,
    models: { agy: { models: [] }, codex: [] },
    customCodexModels: [],
    assets: null,
    runs: [],
    searchQuery: '',
    workspaceFiles: [],
    activeAsset: 'GEMINI.md',
    stageView: 'chat',
    activePicker: null,
    geminiSearch: '',
    inspectorOpen: false,
    inspectorTab: 'diff',
    diffViewMode: 'unified',
    diffCollapsed: new Set(),
    standaloneDiff: '',
    currentRun: null,
    activeStream: null,
    globalStream: null,
    resumeThreadId: '',
    stickyBottom: true,
    gateDirtyText: null,
    treeGroupOpen: new Map(), // key -> boolean (manual override)
    treeRowOpen: new Set(),   // key -> expanded row
    branchDeckOpen: new Map(), // runId -> boolean
    branchSelected: new Map(), // runId -> branchId
    wf: {
      statuses: ['idle', 'idle', 'idle'],
      selected: 0,
      demoRunning: false,
      demoToken: 0,
      failLast: false,
      statusMsg: '就绪：点击任意节点上的「单步执行」可直连本机 CLI，或点击上方「运行链路演练」预览三节点协同动效。',
      toggles: { readOnlyPlan: true, autoNewDiff: true, humanReport: true },
    },
    palette: { open: false, trigger: '', query: '', startPos: 0, items: [], selectedIdx: 0 },
    tweaks: loadTweaks(),
  };

  let waveEngine = null;
  let metalEngine = null;
  let canvasEngine = null;
  let canvasFittedOnce = false;
  let paletteBlurTimer = null;
  const el = (id) => document.getElementById(id);

  function loadTweaks() {
    try {
      const saved = JSON.parse(localStorage.getItem('conduit_tweaks_v2') || 'null');
      return saved ? { ...DEFAULT_TWEAKS, ...saved } : { ...DEFAULT_TWEAKS };
    } catch {
      return { ...DEFAULT_TWEAKS };
    }
  }

  function saveTweaks() {
    try {
      localStorage.setItem('conduit_tweaks_v2', JSON.stringify(appState.tweaks));
    } catch {
      // Ignore
    }
  }

  function applyTweaks() {
    const t = appState.tweaks;
    const root = document.documentElement;
    root.dataset.surface = t.surface;
    root.dataset.accent = t.accent;
    root.dataset.inspector = t.inspector;
    root.dataset.metal = t.metal || 'chromatic';
    root.dataset.crosshairs = t.crosshairs ? 'on' : 'off';
    root.dataset.hatch = t.hatch ? 'on' : 'off';
    root.dataset.motion = t.motion ? 'on' : 'off';
    root.style.setProperty('--base-font-size', `${t.fontSize}px`);

    el('tweakFontRange').value = String(t.fontSize);
    el('tweakFontVal').textContent = `${t.fontSize}px`;
    el('tweakWaveRange').value = String(t.waveAmplitude);
    el('tweakWaveVal').textContent = `${t.waveAmplitude}%`;
    el('tweakCrosshairs').checked = Boolean(t.crosshairs);
    el('tweakHatch').checked = Boolean(t.hatch);
    el('tweakMotion').checked = Boolean(t.motion);

    document.querySelectorAll('.tweak-pills').forEach((group) => {
      const key = group.dataset.tweak;
      group.querySelectorAll('button').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.val === t[key]);
      });
    });

    if (waveEngine) waveEngine.sync();
    if (metalEngine) metalEngine.sync();
    if (window.ConduitOrbs) window.ConduitOrbs.syncAll();
    requestAnimationFrame(syncAllFluidTracks);
  }

  function showToast(message) {
    const rack = el('toastRack');
    const node = document.createElement('div');
    node.className = 'toast';
    node.textContent = message;
    rack.appendChild(node);
    setTimeout(() => node.remove(), 2600);
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatInline(s) {
    return s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }

  function renderMarkdown(raw) {
    const text = String(raw || '');
    if (!text.trim()) return '';
    const blocks = text.split(/(```[\s\S]*?```)/g);
    return blocks
      .map((part) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const inner = part.replace(/^```[a-zA-Z0-9_-]*\n?/, '').replace(/```$/, '');
          return `<pre><code>${escapeHtml(inner)}</code></pre>`;
        }
        const escaped = escapeHtml(part);
        const lines = escaped.split(/\r?\n/);
        const html = [];
        let listType = null;
        const closeList = () => {
          if (listType) { html.push(`</${listType}>`); listType = null; }
        };

        for (let i = 0; i < lines.length; i += 1) {
          const trimmed = lines[i].trim();
          if (
            trimmed.startsWith('|') &&
            i + 1 < lines.length &&
            /^\|?[\s:-]+\|[\s|:-]+$/.test(lines[i + 1].trim())
          ) {
            closeList();
            const headers = trimmed
              .replace(/^\||\|$/g, '')
              .split('|')
              .map((c) => `<th>${formatInline(c.trim())}</th>`)
              .join('');
            i += 2;
            const rows = [];
            while (i < lines.length && lines[i].trim().startsWith('|')) {
              const cells = lines[i]
                .trim()
                .replace(/^\||\|$/g, '')
                .split('|')
                .map((c) => `<td>${formatInline(c.trim())}</td>`)
                .join('');
              rows.push(`<tr>${cells}</tr>`);
              i += 1;
            }
            i -= 1;
            html.push(`<div class="md-table-wrap"><table class="md-table"><thead><tr>${headers}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`);
            continue;
          }

          if (/^###\s+/.test(trimmed)) { closeList(); html.push(`<h3>${formatInline(trimmed.slice(4))}</h3>`); }
          else if (/^##\s+/.test(trimmed)) { closeList(); html.push(`<h2>${formatInline(trimmed.slice(3))}</h2>`); }
          else if (/^#\s+/.test(trimmed)) { closeList(); html.push(`<h1>${formatInline(trimmed.slice(2))}</h1>`); }
          else if (/^[-*]\s+/.test(trimmed)) {
            if (listType !== 'ul') { closeList(); html.push('<ul>'); listType = 'ul'; }
            html.push(`<li>${formatInline(trimmed.slice(2))}</li>`);
          } else if (/^\d+\.\s+/.test(trimmed)) {
            if (listType !== 'ol') { closeList(); html.push('<ol>'); listType = 'ol'; }
            html.push(`<li>${formatInline(trimmed.replace(/^\d+\.\s+/, ''))}</li>`);
          } else if (trimmed === '') { closeList(); }
          else { closeList(); html.push(`<p>${formatInline(trimmed)}</p>`); }
        }
        closeList();
        return html.join('');
      })
      .join('');
  }

  async function api(url, opts = {}) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  async function copyText(text, msg = '已复制到剪贴板') {
    if (!text) return showToast('没有可复制的内容');
    try {
      await navigator.clipboard.writeText(text);
      showToast(msg);
    } catch {
      showToast('复制失败，请手动选中复制');
    }
  }

  /* =========================================================================
     21st.dev Segmented Tabs Fluid Indicator (#26923)
     ========================================================================= */
  const fluidTracks = [];

  function initFluidTrack(trackEl) {
    if (!trackEl) return;
    const hoverPill = trackEl.querySelector('.fluid-hover-pill');
    const activePill = trackEl.querySelector('.fluid-active-pill');
    if (!hoverPill || !activePill) return;

    const place = (pill, btn, visible = true) => {
      if (!btn || !visible || btn.offsetWidth === 0) {
        pill.style.opacity = '0';
        return;
      }
      pill.style.width = `${btn.offsetWidth}px`;
      pill.style.height = `${btn.offsetHeight}px`;
      pill.style.transform = `translate3d(${btn.offsetLeft}px, ${btn.offsetTop}px, 0)`;
      pill.style.opacity = '1';
    };

    const syncActive = () => {
      const activeBtn = trackEl.querySelector('button.active');
      place(activePill, activeBtn, Boolean(activeBtn));
    };

    trackEl.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('pointerenter', () => {
        if (!btn.classList.contains('active')) place(hoverPill, btn, true);
        else place(hoverPill, null, false);
      });
    });
    trackEl.addEventListener('pointerleave', () => place(hoverPill, null, false));
    fluidTracks.push(syncActive);
    requestAnimationFrame(syncActive);
  }

  function syncAllFluidTracks() {
    fluidTracks.forEach((fn) => fn());
  }

  /* =========================================================================
     Ink-Orbit Live SVG Diagrams (Flow + 4-Tool Hub + Scrubbable Insights Chart)
     Zero-dependency native SVG port adapted for Gemini x Codex Orchestration
     ========================================================================= */
  function initInkOrbitDiagrams() {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // 1. Live Flow Diagram (Gemini Orchestrator Cluster -> CONDUIT Hub -> Codex Report Stack)
    const flowMount = el('inkFlowSvgMount');
    let reportCount = Math.max(12, appState.runs.length || 0);
    let flowSide = '';

    function renderFlowSvg() {
      if (!flowMount) return;
      const animate = appState.tweaks.motion && !reduced;
      const nodes = [
        { x: 56, y: 36, tag: 'PLAN', label: 'Gemini · 架构拆解' },
        { x: 104, y: 20, tag: 'SPEC', label: '接口契约定义' },
        { x: 152, y: 38, tag: 'COPY', label: '文案与交互润色' },
        { x: 46, y: 92, tag: 'RISK', label: '高危路径识别' },
        { x: 146, y: 116, tag: 'GATE', label: '人工拍板确认' },
      ];
      const L1 = 'M117,67 C196,67 210,100 262,100';
      const L2 = 'M117,73 C186,73 206,120 262,120';
      const R1 = 'M378,100 C412,100 418,86 450,86';
      const R2 = 'M378,120 C412,120 418,134 450,134';
      const rays = [-62, -38, -14, 14, 38, 62]
        .map((a) => {
          const x1 = (320 + Math.sin((a * Math.PI) / 180) * 240).toFixed(1);
          const y1 = (110 - Math.cos((a * Math.PI) / 180) * 240).toFixed(1);
          const x2 = (320 + Math.sin(((a + 7) * Math.PI) / 180) * 240).toFixed(1);
          const y2 = (110 - Math.cos(((a + 7) * Math.PI) / 180) * 240).toFixed(1);
          return `<path d="M320,110 L${x1},${y1} L${x2},${y2}Z" fill="url(#conduitRays)" opacity="0.48" />`;
        })
        .join('');

      const packets = animate
        ? [L1, L2, R1, R2]
            .map(
              (d, i) =>
                `<circle r="2.3" class="ib-pkt"><animateMotion dur="${(2.1 + (i % 2) * 0.55).toFixed(2)}s" begin="${(i * 0.35).toFixed(2)}s" repeatCount="indefinite" path="${d}" /></circle>`
            )
            .join('')
        : '';

      const sheets = [2, 1, 0]
        .map((k) => {
          const bars = [18, 26, 15, 31, 23, 35]
            .map((h, j) => `<rect x="${12 + j * 13}" y="${92 - h}" width="8" height="${h}" fill="${j >= 4 ? 'var(--accent-hex)' : 'var(--ink-primary)'}" opacity="${(0.24 + j * 0.13).toFixed(2)}" />`)
            .join('');
          return `
            <g transform="translate(${450 + k * 12},${40 - k * 10})" opacity="${(1 - k * 0.26).toFixed(2)}">
              <g class="${k === 0 && animate ? 'ib-sheet-new' : ''}">
                <rect width="138" height="102" rx="2" fill="var(--bg-surface-2)" stroke="var(--line-strong)" />
                ${
                  k === 0
                    ? `<text x="10" y="16" font-size="7.5" fill="var(--accent-hex)" font-family="var(--font-mono)">RUN #${reportCount} · PASS</text>
                       <rect x="10" y="24" width="66" height="4.5" rx="1" fill="var(--ink-primary)" opacity="0.8" />
                       <rect x="10" y="33" width="96" height="2.8" rx="1" fill="var(--line-strong)" />
                       <rect x="10" y="39" width="80" height="2.8" rx="1" fill="var(--line-strong)" />
                       ${bars}
                       <path d="M94 64h32M94 72h26M94 80h30" stroke="var(--line-strong)" stroke-width="2.2" />`
                    : ''
                }
              </g>
            </g>`;
        })
        .join('');

      flowMount.innerHTML = `
        <svg class="ib-diagram" viewBox="0 0 640 176" role="img" aria-label="Gemini 规划流经 CONDUIT 中枢派发至 Codex 施工与审查报告">
          <defs>
            <radialGradient id="conduitGlow" cx="320" cy="110" r="190" gradientUnits="userSpaceOnUse">
              <stop offset="0" stop-color="var(--bg-surface-3)" stop-opacity="0.9" />
              <stop offset="1" stop-color="var(--bg-surface-1)" stop-opacity="0" />
            </radialGradient>
            <linearGradient id="conduitRays" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="var(--line-strong)" stop-opacity="0.55" />
              <stop offset="1" stop-color="var(--line-strong)" stop-opacity="0" />
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="640" height="176" fill="url(#conduitGlow)" />
          ${rays}
          <g data-flow-zone="left">
            <rect x="16" y="8" width="176" height="132" fill="transparent" />
            ${nodes.map((n) => `<line x1="${n.x}" y1="${n.y}" x2="104" y2="70" stroke="var(--line-strong)" stroke-dasharray="2 3" />`).join('')}
            <g transform="translate(91,57)">
              <rect width="26" height="26" rx="3" class="ib-node ${flowSide === 'left' ? 'ib-node-active' : ''}" />
              <text x="13" y="17" text-anchor="middle" font-size="11" font-weight="700" fill="var(--accent-hex)" font-family="var(--font-mono)">G</text>
            </g>
            ${nodes
              .map(
                (n) => `
                <g>
                  <rect x="${n.x - 18}" y="${n.y - 10}" width="36" height="20" rx="2" class="ib-node" />
                  <text x="${n.x}" y="${n.y + 3}" text-anchor="middle" font-size="7" font-weight="600" fill="var(--ink-secondary)" font-family="var(--font-mono)">${n.tag}</text>
                </g>`
              )
              .join('')}
          </g>
          <path d="${L1}" class="ib-flow ${flowSide === 'left' ? 'ib-flow-on' : ''}" />
          <path d="${L2}" class="ib-flow ${flowSide === 'left' ? 'ib-flow-on' : ''} ${animate ? 'ib-dash' : ''}" />
          <path d="${R1}" class="ib-flow ${flowSide === 'right' ? 'ib-flow-on' : ''}" />
          <path d="${R2}" class="ib-flow ${flowSide === 'right' ? 'ib-flow-on' : ''} ${animate ? 'ib-dash' : ''}" />
          ${packets}
          <g transform="translate(262,88)">
            <rect x="-4" y="-4" width="124" height="52" rx="4" fill="none" stroke="var(--accent-hex)" opacity="0.45" class="${animate ? 'ib-glow' : ''}" />
            <rect width="116" height="44" rx="3" class="ib-node ib-node-active" />
            <rect x="11" y="13" width="18" height="18" fill="none" stroke="var(--ink-primary)" stroke-width="1.2" />
            <path d="M15 27V17H22L25 20V27" fill="none" stroke="var(--accent-hex)" stroke-width="1.5" />
            <text x="36" y="25.5" font-size="9" letter-spacing="1.4" font-weight="700" fill="var(--ink-primary)" font-family="var(--font-mono)">CONDUIT</text>
            <path d="M101 18l4 4-4 4" fill="none" stroke="var(--ink-muted)" stroke-width="1.3" />
          </g>
          <g data-flow-zone="right">${sheets}</g>
        </svg>`;

      flowMount.querySelectorAll('[data-flow-zone]').forEach((g) => {
        g.addEventListener('mouseenter', () => { flowSide = g.dataset.flowZone; renderFlowSvg(); });
        g.addEventListener('mouseleave', () => { flowSide = ''; renderFlowSvg(); });
      });
    }

    // 2. Live 4-Tool CLI Integrations Hub (AGY / CODEX / GIT / GATE)
    const hubMount = el('inkHubSvgMount');
    let hubHover = -1;
    let hubAuto = 0;
    const hubTools = [
      { x: 62, y: 34, code: 'AGY', label: 'Gemini CLI', action: 'env' },
      { x: 62, y: 114, code: 'CDX', label: 'Codex Exec', action: 'env' },
      { x: 238, y: 34, code: 'GIT', label: 'Git Diff', action: 'diff' },
      { x: 238, y: 114, code: 'CI', label: 'Review Gate', action: 'review' },
    ];

    function renderHubSvg() {
      if (!hubMount) return;
      const animate = appState.tweaks.motion && !reduced;
      const activeIdx = hubHover >= 0 ? hubHover : animate ? hubAuto : -1;
      const pathFor = (i) => {
        const t = hubTools[i];
        const dir = t.x < 150 ? -1 : 1;
        return `M${150 + dir * 18},74 H${150 + dir * 44} V${t.y} H${t.x - dir * 18}`;
      };

      hubMount.innerHTML = `
        <svg class="ib-diagram" viewBox="0 0 300 148" role="group" aria-label="本地 CLI 集成矩阵">
          ${hubTools.map((_, i) => `<path d="${pathFor(i)}" class="ib-flow ${activeIdx === i ? 'ib-flow-on' : ''}" />`).join('')}
          ${animate && activeIdx >= 0 ? `<circle r="2.3" class="ib-pkt"><animateMotion dur="1.15s" repeatCount="indefinite" path="${pathFor(activeIdx)}" /></circle>` : ''}
          <g transform="translate(132,56)">
            <rect width="36" height="36" rx="3" class="ib-node ib-node-active" />
            <path d="M12 25V11H20.5L24 14.5V25" fill="none" stroke="var(--accent-hex)" stroke-width="1.6" />
          </g>
          ${hubTools
            .map(
              (t, i) => `
              <g class="ib-tool ${activeIdx === i ? 'ib-tool-on' : ''}" data-hub-idx="${i}" tabindex="0" role="button" aria-label="${t.label}">
                <rect x="${t.x - 18}" y="${t.y - 15}" width="36" height="30" rx="3" class="ib-node" />
                <text x="${t.x}" y="${t.y + 3.5}" text-anchor="middle" font-size="9" font-weight="700" fill="var(--ink-primary)" font-family="var(--font-mono)">${t.code}</text>
                <text x="${t.x}" y="${t.y + (t.y < 74 ? -21 : 27)}" text-anchor="middle" font-size="7.5" fill="var(--ink-secondary)" font-family="var(--font-mono)" opacity="${activeIdx === i ? '1' : '0'}">${t.label}</text>
              </g>`
            )
            .join('')}
          <text x="150" y="114" text-anchor="middle" font-size="7.5" fill="var(--ink-muted)" font-family="var(--font-mono)">
            ${activeIdx >= 0 ? `syncing · ${hubTools[activeIdx].label.toLowerCase()}` : '4 local tools connected'}
          </text>
        </svg>`;

      hubMount.querySelectorAll('[data-hub-idx]').forEach((node) => {
        const idx = Number(node.dataset.hubIdx);
        node.addEventListener('mouseenter', () => { hubHover = idx; renderHubSvg(); });
        node.addEventListener('mouseleave', () => { hubHover = -1; renderHubSvg(); });
        node.addEventListener('click', () => {
          const act = hubTools[idx].action;
          if (act === 'diff') openInspector('diff');
          else if (act === 'review') openInspector('review');
          else { closeAllPopovers('envPopover'); el('envPopover').classList.remove('hidden'); }
        });
      });
    }

    // 3. Scrubbable Predictive / Throughput Insights Chart
    const chartMount = el('inkChartSvgMount');
    const chartValues = [22, 26, 25, 32, 30, 38, 36, 44, 42, 51, 56, 64];
    const forecastFrom = 8;
    let chartHover = -1;

    function renderChartSvg() {
      if (!chartMount) return;
      const W = 300;
      const H = 132;
      const pad = 14;
      const lo = Math.min(...chartValues);
      const hi = Math.max(...chartValues);
      const span = hi - lo || 1;
      const pts = chartValues.map((v, i) => [
        pad + (i / (chartValues.length - 1)) * (W - pad * 2),
        H - pad - ((v - lo) / span) * (H - pad * 2),
      ]);
      let line = '';
      pts.forEach(([x, y], i) => {
        if (i === 0) { line = `M${x.toFixed(1)},${y.toFixed(1)}`; return; }
        const [px, py] = pts[i - 1];
        const cx = (px + x) / 2;
        line += ` C${cx.toFixed(1)},${py.toFixed(1)} ${cx.toFixed(1)},${y.toFixed(1)} ${x.toFixed(1)},${y.toFixed(1)}`;
      });
      const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${H - pad} L${pts[0][0].toFixed(1)},${H - pad} Z`;
      const idx = chartHover >= 0 ? chartHover : pts.length - 1;
      const p = pts[idx];
      const pct = Math.round(((chartValues[idx] - chartValues[0]) / chartValues[0]) * 100);
      const tx = Math.min(W - 42, Math.max(42, p[0]));
      const ty = p[1] < 34 ? p[1] + 22 : p[1] - 12;
      const animate = appState.tweaks.motion && !reduced;

      chartMount.innerHTML = `
        <svg class="ib-diagram ib-chart" viewBox="0 0 ${W} ${H + 6}" role="img" aria-label="双模型协同吞吐与门禁效率曲线">
          <defs>
            <linearGradient id="conduitChartArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="var(--accent-hex)" stop-opacity="0.22" />
              <stop offset="1" stop-color="var(--accent-hex)" stop-opacity="0" />
            </linearGradient>
          </defs>
          ${[0.25, 0.5, 0.75].map((g) => `<line x1="14" x2="${W - 14}" y1="${(H * g).toFixed(1)}" y2="${(H * g).toFixed(1)}" stroke="var(--line-subtle)" />`).join('')}
          <path d="${area}" fill="url(#conduitChartArea)" />
          <path d="${line}" fill="none" stroke="var(--accent-hex)" stroke-width="1.6" />
          <line x1="${pts[forecastFrom][0].toFixed(1)}" x2="${pts[forecastFrom][0].toFixed(1)}" y1="10" y2="${H - 14}" stroke="var(--line-strong)" stroke-dasharray="2 3" />
          <text x="${(pts[forecastFrom][0] - 4).toFixed(1)}" y="${H - 18}" text-anchor="end" font-size="7" fill="var(--ink-muted)" font-family="var(--font-mono)">GATE</text>
          ${chartHover >= 0 ? `<line x1="${p[0].toFixed(1)}" x2="${p[0].toFixed(1)}" y1="8" y2="${H - 14}" stroke="var(--ink-primary)" stroke-opacity="0.32" />` : ''}
          ${animate && chartHover < 0 ? `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="7" fill="var(--accent-hex)" opacity="0.22" class="ib-glow" />` : ''}
          <circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.2" fill="var(--bg-canvas)" stroke="var(--accent-hex)" stroke-width="1.6" />
          <g transform="translate(${tx.toFixed(1)},${ty.toFixed(1)})">
            <rect x="-34" y="-11" width="68" height="15" rx="2" fill="var(--bg-inset-light)" />
            <text x="0" y="-1" text-anchor="middle" font-size="7.5" fill="var(--ink-inverse)" font-family="var(--font-mono)">
              ${idx >= forecastFrom ? 'gate ' : `step ${idx + 1} `}${pct >= 0 ? '+' : ''}${pct}%
            </text>
          </g>
        </svg>`;

      const svg = chartMount.querySelector('svg');
      if (svg) {
        svg.addEventListener('pointermove', (e) => {
          const r = svg.getBoundingClientRect();
          const relX = ((e.clientX - r.left) / r.width) * W;
          let best = 0;
          for (let i = 1; i < pts.length; i += 1) {
            if (Math.abs(pts[i][0] - relX) < Math.abs(pts[best][0] - relX)) best = i;
          }
          if (best !== chartHover) {
            chartHover = best;
            renderChartSvg();
          }
        });
        svg.addEventListener('pointerleave', () => {
          chartHover = -1;
          renderChartSvg();
        });
      }
    }

    renderFlowSvg();
    renderHubSvg();
    renderChartSvg();

    setInterval(() => {
      if (!appState.tweaks.motion || reduced || el('welcomeStage').classList.contains('hidden')) return;
      if (hubHover < 0) {
        hubAuto = (hubAuto + 1) % hubTools.length;
        renderHubSvg();
      }
    }, 1800);

    setInterval(() => {
      if (!appState.tweaks.motion || reduced || el('welcomeStage').classList.contains('hidden')) return;
      reportCount += 1;
      renderFlowSvg();
    }, 3400);

    return {
      sync: () => {
        renderFlowSvg();
        renderHubSvg();
        renderChartSvg();
      },
    };
  }

  /* =========================================================================
     21st.dev Audio Visualizer (#44800) Multi-Mode Signal Telemetry Engine
     5 interactive canvas engines: bars | grid | line | dots | radial
     + hover proximity acoustic scrub + live CONDUIT engine state coupling
     ========================================================================= */
  function initWaveEngine() {
    const miniCanvas = el('miniWaveCanvas');
    const deckEl = el('signalDeck');
    const stateLabelEl = el('signalStateLabel');
    const pillsWrap = el('signalModePills');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const COUNTS = { bars: 22, grid: 18, line: 34, dots: 12, radial: 36 };
    let variant = 'bars';
    try {
      const saved = localStorage.getItem('conduit_viz_mode_v1');
      if (saved && COUNTS[saved]) variant = saved;
    } catch {}

    let tSec = 0;
    let lastTs = 0;
    let rafId = null;
    let hoverNorm = -1; // 0..1 across canvas when pointer hovers
    let hoverEnergy = 0;
    let values = new Array(COUNTS[variant]).fill(0);
    let colors = { accent: '#1B66FF', warn: '#f59e0b', tick: '#313640', rest: 'rgba(255,255,255,0.08)' };
    let dims = { w: 0, h: 0, ctx: null };

    const clamp01 = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
    const approach = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
    const wobble = (t, seed) =>
      Math.sin(t * 1.31 + seed * 7.13) * 0.5 +
      Math.sin(t * 2.17 + seed * 3.71) * 0.3 +
      Math.sin(t * 3.73 + seed * 1.37) * 0.2;

    function syncPills() {
      if (!pillsWrap) return;
      pillsWrap.querySelectorAll('[data-viz]').forEach((b) => {
        b.classList.toggle('active', b.dataset.viz === variant);
      });
    }

    function setVariant(next) {
      if (!COUNTS[next]) return;
      variant = next;
      values = new Array(COUNTS[variant]).fill(0);
      try { localStorage.setItem('conduit_viz_mode_v1', variant); } catch {}
      syncPills();
      drawFrame(1 / 60, false);
    }

    if (pillsWrap) {
      pillsWrap.querySelectorAll('[data-viz]').forEach((b) => {
        b.addEventListener('click', () => setVariant(b.dataset.viz));
      });
    }

    if (miniCanvas) {
      miniCanvas.addEventListener('pointermove', (e) => {
        const r = miniCanvas.getBoundingClientRect();
        if (r.width > 0) {
          hoverNorm = clamp01((e.clientX - r.left) / r.width);
          hoverEnergy = 1;
        }
      });
      miniCanvas.addEventListener('pointerleave', () => {
        hoverNorm = -1;
      });
      miniCanvas.addEventListener('click', () => {
        const order = ['bars', 'grid', 'line', 'dots', 'radial'];
        setVariant(order[(order.indexOf(variant) + 1) % order.length]);
      });
    }

    function refreshColors() {
      const cs = getComputedStyle(document.documentElement);
      colors = {
        accent: cs.getPropertyValue('--accent-hex').trim() || '#1B66FF',
        warn: cs.getPropertyValue('--state-warn').trim() || '#f59e0b',
        tick: cs.getPropertyValue('--line-strong').trim() || '#313640',
        rest: cs.getPropertyValue('--line-subtle').trim() || '#1d2026',
      };
    }

    function sizeCanvas() {
      if (!miniCanvas) return;
      const rect = miniCanvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      miniCanvas.width = Math.max(1, Math.floor(rect.width * dpr));
      miniCanvas.height = Math.max(1, Math.floor(rect.height * dpr));
      const ctx = miniCanvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dims = { w: rect.width, h: rect.height, ctx };
    }

    function computeTargets(n, t, isLive, isGate, ampScale) {
      const out = new Array(n).fill(0);
      const half = (n - 1) / 2;
      const circular = variant === 'radial';
      const period = isLive ? 1.35 : 2.4;
      const u = (t % period) / period;
      const sweepPos = circular ? u * n : (0.5 - 0.5 * Math.cos(u * Math.PI * 2)) * (n - 1);

      for (let i = 0; i < n; i += 1) {
        const norm = n > 1 ? i / (n - 1) : 0.5;
        const distCenter = half > 0 ? Math.abs(i - half) / half : 0;
        let dSweep = Math.abs(i - sweepPos);
        if (circular) dSweep = Math.min(dSweep, n - dSweep);
        const sweep = Math.exp(-((dSweep / Math.max(1.5, n * 0.16)) ** 2));

        let v;
        if (isLive) {
          const hump = 0.45 + 0.55 * Math.exp(-(((distCenter - 0.18) / 0.55) ** 2));
          const rip = 0.55 + 0.45 * Math.abs(wobble(t * 2.9, i * 0.71 + 1.2));
          v = (0.28 + 0.72 * hump * rip) * (0.72 + 0.28 * sweep);
        } else if (isGate) {
          const breath = 0.5 + 0.5 * Math.sin((t * Math.PI * 2) / 1.7 - distCenter * 2.2);
          v = (0.22 + 0.48 * breath) * (1 - distCenter * 0.35);
        } else {
          const idleWave = 0.16 + 0.18 * (0.5 + 0.5 * Math.sin(t * 2.1 - distCenter * 2.6));
          v = Math.max(idleWave * (1 - distCenter * 0.35), 0.52 * sweep);
        }

        if (hoverNorm >= 0 && hoverEnergy > 0.02) {
          const dMouse = Math.abs(norm - hoverNorm);
          const prox = Math.exp(-((dMouse / 0.15) ** 2)) * hoverEnergy;
          v = Math.max(v, 0.25 + 0.72 * prox);
        }
        out[i] = clamp01(v * Math.max(0.2, ampScale));
      }
      return out;
    }

    function paintBars(ctx, w, h, vals, fg) {
      const n = vals.length;
      const gapRatio = 0.55;
      const bw = Math.min(4.5, (w - 16) / (n + (n - 1) * gapRatio));
      const gap = bw * gapRatio;
      const x0 = (w - (n * bw + (n - 1) * gap)) / 2;
      const maxH = h - 8;
      ctx.fillStyle = fg;
      for (let i = 0; i < n; i += 1) {
        const v = vals[i];
        const bh = Math.max(bw, v * maxH);
        ctx.globalAlpha = 0.25 + 0.75 * clamp01(v * 1.45);
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') ctx.roundRect(x0 + i * (bw + gap), (h - bh) / 2, bw, bh, bw / 2);
        else ctx.rect(x0 + i * (bw + gap), (h - bh) / 2, bw, bh);
        ctx.fill();
      }
    }

    function paintGrid(ctx, w, h, vals, fg) {
      const cols = vals.length;
      const gap = 2;
      const cell = Math.max(2.5, Math.min(6, (w - 14 - (cols - 1) * gap) / cols));
      let rows = Math.max(3, Math.floor((h - 6 + gap) / (cell + gap)));
      if (rows % 2 === 0) rows -= 1;
      const x0 = (w - (cols * cell + (cols - 1) * gap)) / 2;
      const y0 = (h - (rows * cell + (rows - 1) * gap)) / 2;
      const half = (rows - 1) / 2;
      for (let c = 0; c < cols; c += 1) {
        const lit = vals[c] * (half + 1.15);
        for (let r = 0; r < rows; r += 1) {
          const amount = clamp01(lit - Math.abs(r - half));
          const x = x0 + c * (cell + gap);
          const y = y0 + r * (cell + gap);
          ctx.globalAlpha = 0.5;
          ctx.fillStyle = colors.rest;
          ctx.beginPath();
          if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, cell, cell, 1.5);
          else ctx.rect(x, y, cell, cell);
          ctx.fill();
          if (amount > 0.02) {
            ctx.globalAlpha = amount;
            ctx.fillStyle = fg;
            ctx.fill();
          }
        }
      }
    }

    function paintLine(ctx, w, h, vals, fg) {
      const n = vals.length;
      const mid = h / 2;
      const amp = h / 2 - 4;
      const padX = 8;
      const step = (w - padX * 2) / Math.max(1, n - 1);
      const ys = vals.map((v, i) => v * amp * Math.sin((Math.PI * i) / Math.max(1, n - 1)) ** 0.75);
      ctx.strokeStyle = fg;
      ctx.lineWidth = 1.6;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (const dir of [-1, 1]) {
        ctx.globalAlpha = dir < 0 ? 0.95 : 0.35;
        ctx.beginPath();
        ctx.moveTo(padX, mid + dir * ys[0]);
        for (let i = 1; i < n - 1; i += 1) {
          const x = padX + i * step;
          const nx = padX + (i + 1) * step;
          ctx.quadraticCurveTo(x, mid + dir * ys[i], (x + nx) / 2, mid + dir * ((ys[i] + ys[i + 1]) / 2));
        }
        ctx.lineTo(padX + (n - 1) * step, mid + dir * ys[n - 1]);
        ctx.stroke();
      }
    }

    function paintDots(ctx, w, h, vals, fg) {
      const n = vals.length;
      const padX = 12;
      const pitch = (w - padX * 2) / n;
      const rMax = Math.min(pitch * 0.42, h * 0.36);
      const rMin = 1.7;
      ctx.fillStyle = fg;
      for (let i = 0; i < n; i += 1) {
        const v = vals[i];
        ctx.globalAlpha = 0.28 + 0.72 * clamp01(v * 1.4);
        ctx.beginPath();
        ctx.arc(padX + pitch * (i + 0.5), h / 2, rMin + v * (rMax - rMin), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function paintRadial(ctx, w, h, vals, fg) {
      const n = vals.length;
      const cx = w / 2;
      const cy = h / 2;
      const outer = Math.min(w, h) / 2 - 2.5;
      const inner = outer * 0.46;
      ctx.strokeStyle = fg;
      ctx.lineCap = 'round';
      ctx.lineWidth = 1.45;
      for (let i = 0; i < n; i += 1) {
        const v = vals[i];
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        const len = 1.5 + v * (outer - inner - 1.5);
        ctx.globalAlpha = 0.25 + 0.75 * clamp01(v * 1.4);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
        ctx.lineTo(cx + Math.cos(a) * (inner + len), cy + Math.sin(a) * (inner + len));
        ctx.stroke();
      }
    }

    function drawFrame(dt, advance = true) {
      if (!dims.ctx || dims.w <= 0) return;
      const { w, h, ctx } = dims;
      const run = appState.currentRun;
      const clusterLive = Boolean(canvasEngine && canvasEngine.isDemoRunning());
      const isLive = Boolean((run && run.status === 'running') || clusterLive);
      const isGate = Boolean(run && run.status === 'awaiting_approval');
      const ampScale = (Number(appState.tweaks.waveAmplitude) || 0) / 100;

      if (deckEl) {
        deckEl.classList.toggle('is-live', isLive);
        deckEl.classList.toggle('is-gate', isGate);
      }
      if (stateLabelEl) {
        stateLabelEl.textContent = isGate
          ? 'GATE · WAIT'
          : clusterLive
            ? 'CLUSTER · LIVE'
            : isLive
              ? (run.activeStage === 'exec' ? 'CODEX · LIVE' : run.activeStage === 'review' ? 'REVIEW · LIVE' : 'GEMINI · LIVE')
              : 'SIGNAL · IDLE';
      }

      if (advance && appState.tweaks.motion && !reducedMotion) {
        tSec += dt;
        if (hoverNorm < 0 && hoverEnergy > 0) hoverEnergy = Math.max(0, hoverEnergy - dt * 2.5);
      }

      const n = COUNTS[variant] || 22;
      if (values.length !== n) values = new Array(n).fill(0);
      const targets = computeTargets(n, tSec, isLive, isGate, ampScale);
      for (let i = 0; i < n; i += 1) {
        const goal = targets[i];
        values[i] = reducedMotion || !appState.tweaks.motion ? goal : approach(values[i], goal, goal > values[i] ? 22 : 7, dt);
      }

      ctx.clearRect(0, 0, w, h);
      const fg = isGate ? colors.warn : colors.accent;
      if (variant === 'grid') paintGrid(ctx, w, h, values, fg);
      else if (variant === 'line') paintLine(ctx, w, h, values, fg);
      else if (variant === 'dots') paintDots(ctx, w, h, values, fg);
      else if (variant === 'radial') paintRadial(ctx, w, h, values, fg);
      else paintBars(ctx, w, h, values, fg);
      ctx.globalAlpha = 1;
    }

    function loop(now) {
      if (!appState.tweaks.motion || reducedMotion) {
        rafId = null;
        return;
      }
      const dt = lastTs ? Math.min(0.05, Math.max(0.004, (now - lastTs) / 1000)) : 1 / 60;
      lastTs = now;
      drawFrame(dt, true);
      rafId = requestAnimationFrame(loop);
    }

    function resize() {
      sizeCanvas();
      drawFrame(1 / 60, false);
    }

    function sync() {
      refreshColors();
      syncPills();
      resize();
      if (appState.tweaks.motion && !reducedMotion && !rafId) {
        lastTs = 0;
        rafId = requestAnimationFrame(loop);
      } else if ((!appState.tweaks.motion || reducedMotion) && rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    }

    window.addEventListener('resize', () => {
      resize();
      syncAllFluidTracks();
    });
    sync();
    return { sync, redraw: () => drawFrame(1 / 60, false), resize, setVariant };
  }

  /* =========================================================================
     21st.dev Diff Viewer (#45484): Unified + Split + Dual Line Gutters
     ========================================================================= */
  function parseUnifiedDiff(diffText) {
    const files = [];
    const lines = String(diffText || '').split(/\r?\n/);
    let currentFile = null;
    let currentHunk = null;
    let oldLine = 0;
    let newLine = 0;

    for (const line of lines) {
      if (line.startsWith('diff --git ')) {
        const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
        currentFile = { path: match ? match[2] : line.slice(11), additions: 0, deletions: 0, hunks: [] };
        files.push(currentFile);
        currentHunk = null;
        continue;
      }
      if (!currentFile) {
        if (line.startsWith('@@ ') || line.startsWith('+') || line.startsWith('-')) {
          currentFile = { path: 'workspace.patch', additions: 0, deletions: 0, hunks: [] };
          files.push(currentFile);
        } else continue;
      }
      if (/^(--- |\+\+\+ |index |new file|deleted file)/.test(line)) continue;

      const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
      if (hunkMatch) {
        oldLine = Number(hunkMatch[1]);
        newLine = Number(hunkMatch[2]);
        currentHunk = { header: line, rows: [] };
        currentFile.hunks.push(currentHunk);
        continue;
      }
      if (!currentHunk) {
        currentHunk = { header: '@@ patch @@', rows: [] };
        currentFile.hunks.push(currentHunk);
      }
      if (line.startsWith('+')) {
        currentFile.additions += 1;
        currentHunk.rows.push({ kind: 'add', oldNum: '', newNum: newLine++, text: line.slice(1) });
      } else if (line.startsWith('-')) {
        currentFile.deletions += 1;
        currentHunk.rows.push({ kind: 'del', oldNum: oldLine++, newNum: '', text: line.slice(1) });
      } else if (line.startsWith(' ')) {
        currentHunk.rows.push({ kind: 'ctx', oldNum: oldLine++, newNum: newLine++, text: line.slice(1) });
      }
    }
    return files;
  }

  function renderDiffViewer(container, diffText) {
    if (!diffText || !diffText.trim()) {
      container.innerHTML =
        '<div class="empty-inline"><span class="mono-xs">DIFF / CLEAN</span><p>当前工作区暂无未提交的 Git 变更（含新建未跟踪文件）。</p></div>';
      return;
    }

    const files = parseUnifiedDiff(diffText);
    const totalAdd = files.reduce((s, f) => s + f.additions, 0);
    const totalDel = files.reduce((s, f) => s + f.deletions, 0);
    const mode = appState.diffViewMode;

    const toolbar = `
      <div class="diff-toolbar">
        <span class="mono-xs">${files.length} 个文件 · <span class="diff-cnt-add">+${totalAdd}</span> / <span class="diff-cnt-del">-${totalDel}</span></span>
        <div class="diff-mode-toggle">
          <button type="button" data-diff-mode="unified" class="${mode === 'unified' ? 'active' : ''}">Unified</button>
          <button type="button" data-diff-mode="split" class="${mode === 'split' ? 'active' : ''}">Split</button>
        </div>
      </div>`;

    const cards = files
      .map((file) => {
        const collapsed = appState.diffCollapsed.has(file.path);
        const bodyHtml = collapsed
          ? ''
          : file.hunks
              .map((hunk) => {
                let rowsHtml = '';
                if (mode === 'unified') {
                  rowsHtml = hunk.rows
                    .map((r) => {
                      const sign = r.kind === 'add' ? '+' : r.kind === 'del' ? '-' : ' ';
                      return `<div class="diff-row-unified ${r.kind}"><span class="diff-gutter">${r.oldNum}</span><span class="diff-gutter">${r.newNum}</span><span class="diff-sign">${sign}</span><span class="diff-code">${escapeHtml(r.text)}</span></div>`;
                    })
                    .join('');
                } else {
                  let i = 0;
                  while (i < hunk.rows.length) {
                    const row = hunk.rows[i];
                    if (row.kind === 'ctx') {
                      rowsHtml += `<div class="diff-row-split"><span class="diff-gutter">${row.oldNum}</span><span class="diff-split-cell">${escapeHtml(row.text)}</span><span class="diff-gutter">${row.newNum}</span><span class="diff-split-cell">${escapeHtml(row.text)}</span></div>`;
                      i += 1;
                    } else {
                      const dels = [];
                      const adds = [];
                      while (i < hunk.rows.length && hunk.rows[i].kind === 'del') { dels.push(hunk.rows[i]); i += 1; }
                      while (i < hunk.rows.length && hunk.rows[i].kind === 'add') { adds.push(hunk.rows[i]); i += 1; }
                      const maxLen = Math.max(dels.length, adds.length);
                      for (let k = 0; k < maxLen; k += 1) {
                        const d = dels[k];
                        const a = adds[k];
                        rowsHtml += `<div class="diff-row-split"><span class="diff-gutter">${d ? d.oldNum : ''}</span><span class="diff-split-cell ${d ? 'del' : ''}">${d ? escapeHtml(d.text) : ''}</span><span class="diff-gutter">${a ? a.newNum : ''}</span><span class="diff-split-cell ${a ? 'add' : ''}">${a ? escapeHtml(a.text) : ''}</span></div>`;
                      }
                    }
                  }
                }
                return `<div class="diff-hunk-bar">${escapeHtml(hunk.header)}</div>${rowsHtml}`;
              })
              .join('');

        return `
          <div class="diff-file-card">
            <button type="button" class="diff-file-head" data-toggle-file="${escapeHtml(file.path)}">
              <span class="diff-file-name">${collapsed ? '[+]' : '[-]'} ${escapeHtml(file.path)}</span>
              <span class="diff-counts"><span class="diff-cnt-add">+${file.additions}</span><span class="diff-cnt-del">-${file.deletions}</span></span>
            </button>
            ${collapsed ? '' : `<div class="diff-file-body">${bodyHtml}</div>`}
          </div>`;
      })
      .join('');

    container.innerHTML = toolbar + cards;
    container.querySelectorAll('[data-diff-mode]').forEach((b) => {
      b.addEventListener('click', () => {
        appState.diffViewMode = b.dataset.diffMode;
        renderDiffViewer(container, diffText);
      });
    });
    container.querySelectorAll('[data-toggle-file]').forEach((b) => {
      b.addEventListener('click', () => {
        const fp = b.dataset.toggleFile;
        if (appState.diffCollapsed.has(fp)) appState.diffCollapsed.delete(fp);
        else appState.diffCollapsed.add(fp);
        renderDiffViewer(container, diffText);
      });
    });
  }

  /* =========================================================================
     21st.dev Rich Prompt Input (#46359): / Slash + @ Mention Palette
     ========================================================================= */
  function autoGrowTextarea(ta) {
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(220, Math.max(54, ta.scrollHeight))}px`;
  }

  function closePromptPalette() {
    appState.palette.open = false;
    el('promptPalette').classList.add('hidden');
  }

  function renderPromptPalette() {
    const pal = appState.palette;
    const box = el('promptPalette');
    if (!pal.open || pal.items.length === 0) {
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');
    const heading = pal.trigger === '/' ? 'SLASH COMMANDS · 切换协同模式' : 'WORKSPACE FILES · 引用工程文件';
    box.innerHTML =
      `<div class="palette-heading">${heading}</div>` +
      pal.items
        .map(
          (item, idx) => `
          <button type="button" class="palette-item ${idx === pal.selectedIdx ? 'is-selected' : ''}" role="option" aria-selected="${idx === pal.selectedIdx}" data-pal-idx="${idx}">
            <span class="palette-key">${escapeHtml(item.key)}</span>
            <span class="palette-detail">${escapeHtml(item.detail)}</span>
          </button>`
        )
        .join('');

    box.querySelectorAll('[data-pal-idx]').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        applyPaletteItem(Number(btn.dataset.palIdx));
      });
    });
  }

  function applyPaletteItem(idx) {
    const pal = appState.palette;
    const item = pal.items[idx];
    if (!item) return;
    const ta = el('inputPrompt');
    const val = ta.value;
    const caret = ta.selectionStart || val.length;

    if (pal.trigger === '/' && item.mode) {
      setModeValue(item.mode);
      ta.value = (val.slice(0, pal.startPos) + val.slice(caret)).trimStart();
      ta.focus();
      showToast(`已切换至「${MODE_LABELS[item.mode]}」`);
    } else if (pal.trigger === '@') {
      const insert = `@${item.key} `;
      ta.value = val.slice(0, pal.startPos) + insert + val.slice(caret);
      const nextCaret = pal.startPos + insert.length;
      ta.setSelectionRange(nextCaret, nextCaret);
      ta.focus();
    }
    autoGrowTextarea(ta);
    closePromptPalette();
  }

  function evaluatePromptTrigger() {
    const ta = el('inputPrompt');
    const val = ta.value;
    const caret = ta.selectionStart || 0;
    const before = val.slice(0, caret);
    const match = before.match(/(?:^|\s)([/@])([^\s]*)$/);
    if (!match) {
      closePromptPalette();
      return;
    }

    const trigger = match[1];
    const query = match[2].toLowerCase();
    const startPos = caret - match[2].length - 1;
    const items =
      trigger === '/'
        ? SLASH_COMMANDS.filter((c) => c.key.includes(query) || c.detail.toLowerCase().includes(query))
        : appState.workspaceFiles.filter((f) => f.key.toLowerCase().includes(query)).slice(0, 12);

    appState.palette = { open: items.length > 0, trigger, query, startPos, items, selectedIdx: 0 };
    renderPromptPalette();
  }

  function insertTriggerChar(ch) {
    const ta = el('inputPrompt');
    ta.focus();
    const caret = ta.selectionStart ?? ta.value.length;
    const prefix = caret > 0 && !/\s$/.test(ta.value.slice(0, caret)) ? ` ${ch}` : ch;
    ta.value = ta.value.slice(0, caret) + prefix + ta.value.slice(caret);
    const nextPos = caret + prefix.length;
    ta.setSelectionRange(nextPos, nextPos);
    evaluatePromptTrigger();
  }

  /* =========================================================================
     21st.dev Chat Sidebar (#46401): Grouped Thread List + Pin/Rename/Delete
     ========================================================================= */
  async function loadRunsList() {
    try {
      const { runs } = await api('/api/runs');
      appState.runs = runs || [];
      renderSidebarThreads();
    } catch {
      // Silent retry next update
    }
  }

  function renderSidebarThreads() {
    const container = el('threadList');
    const q = appState.searchQuery.trim().toLowerCase();
    const filtered = appState.runs.filter((r) => !q || String(r.title || '').toLowerCase().includes(q));

    if (filtered.length === 0) {
      container.innerHTML = `<div class="thread-empty sidebar-label">${q ? '未找到匹配会话' : '暂无历史会话'}</div>`;
      return;
    }

    const now = new Date();
    const todayStr = now.toDateString();
    const pinned = [];
    const today = [];
    const earlier = [];

    filtered.forEach((r) => {
      if (r.pinned) pinned.push(r);
      else if (new Date(r.createdAt).toDateString() === todayStr) today.push(r);
      else earlier.push(r);
    });

    const renderGroup = (label, items) => {
      if (items.length === 0) return '';
      return (
        `<div class="thread-group-label sidebar-label">${label}</div>` +
        items
          .map((r) => {
            const active = appState.currentRun?.id === r.id;
            const timeShort = new Date(r.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
            return `
              <div class="thread-row ${active ? 'active' : ''}" data-thread-id="${escapeHtml(r.id)}" title="${escapeHtml(r.title)}">
                <span class="thread-dot ${escapeHtml(r.status)}"></span>
                <div class="thread-info sidebar-label">
                  <span class="thread-title">${escapeHtml(r.title)}</span>
                  <span class="thread-sub">${escapeHtml(MODE_LABELS[r.mode] || r.mode)} · ${timeShort}</span>
                </div>
                <div class="thread-actions sidebar-label">
                  <button type="button" class="thread-act-btn ${r.pinned ? 'pinned' : ''}" data-act="pin" data-id="${escapeHtml(r.id)}" title="${r.pinned ? '取消置顶' : '置顶'}">P</button>
                  <button type="button" class="thread-act-btn" data-act="rename" data-id="${escapeHtml(r.id)}" title="重命名">R</button>
                  <button type="button" class="thread-act-btn" data-act="delete" data-id="${escapeHtml(r.id)}" title="删除">×</button>
                </div>
              </div>`;
          })
          .join('')
      );
    };

    container.innerHTML =
      renderGroup('置顶', pinned) +
      renderGroup('今天', today) +
      renderGroup('更早', earlier);

    container.querySelectorAll('.thread-row').forEach((row) => {
      row.addEventListener('click', async (e) => {
        if (e.target.closest('.thread-act-btn')) return;
        const id = row.dataset.threadId;
        try {
          const { run } = await api(`/api/runs/${encodeURIComponent(id)}`);
          closeMobileDrawers();
          switchStageView('chat');
          attachToRun(run);
        } catch (err) {
          showToast(`载入会话失败: ${err.message}`);
        }
      });
    });

    container.querySelectorAll('.thread-act-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const act = btn.dataset.act;
        const item = appState.runs.find((x) => x.id === id);
        if (!item) return;

        try {
          if (act === 'pin') {
            await api(`/api/runs/${encodeURIComponent(id)}`, {
              method: 'PATCH',
              body: JSON.stringify({ pinned: !item.pinned }),
            });
            await loadRunsList();
          } else if (act === 'rename') {
            const nextTitle = window.prompt('输入新的会话标题：', item.title);
            if (nextTitle && nextTitle.trim()) {
              await api(`/api/runs/${encodeURIComponent(id)}`, {
                method: 'PATCH',
                body: JSON.stringify({ title: nextTitle.trim() }),
              });
              if (appState.currentRun?.id === id) {
                appState.currentRun.title = nextTitle.trim();
                el('topbarTitle').textContent = nextTitle.trim();
              }
              await loadRunsList();
            }
          } else if (act === 'delete') {
            await api(`/api/runs/${encodeURIComponent(id)}`, { method: 'DELETE' });
            if (appState.currentRun?.id === id) resetToNewChat();
            await loadRunsList();
            showToast('已删除该会话记录');
          }
        } catch (err) {
          showToast(`操作失败: ${err.message}`);
        }
      });
    });
  }

  /* =========================================================================
     Codex-Style Chronological Thread Renderer (Conversation + Tool Calls)
     ========================================================================= */
  function resetToNewChat() {
    if (appState.activeStream) {
      appState.activeStream.close();
      appState.activeStream = null;
    }
    appState.currentRun = null;
    appState.gateDirtyText = null;
    el('welcomeStage').classList.remove('hidden');
    el('threadMessages').classList.add('hidden');
    el('threadMessages').innerHTML = '';
    el('topbarTitle').textContent = '新协同会话';
    el('topbarMeta').textContent = 'GEMINI 4 NEON × CODEX CLI';
    el('btnCancelRun').classList.add('hidden');
    el('sendCtaGroup').classList.remove('hidden');
    el('composerShell').classList.remove('is-streaming');
    updatePipelinePills(null);
    syncTopbarOrb(null);
    renderSidebarThreads();
    if (appState.stageView === 'workflow') renderWorkflowCanvas();
    if (waveEngine) waveEngine.resize();
  }

  function renderOrbSvg(state, variant = 'default', size = 18, extraClass = '') {
    return `<svg class="thinking-orb ${extraClass}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" data-orb-state="${escapeHtml(state)}" data-orb-variant="${escapeHtml(variant)}" data-orb-size="${size}" aria-hidden="true"></svg>`;
  }

  function syncTopbarOrb(run) {
    const orb = el('topbarOrb');
    const wrap = el('topbarOrbWrap');
    if (!orb || !wrap) return;

    let state = 'base';
    let variant = 'default';
    let cls = '';

    if (run) {
      if (run.status === 'running') {
        cls = 'is-live';
        if (run.activeStage === 'exec') { state = 'working'; variant = 'gyro'; }
        else if (run.activeStage === 'review') { state = 'searching'; variant = 'lighthouse'; }
        else if (run.activeStage === 'summary') { state = 'compacting'; variant = 'fuse'; }
        else { state = 'reasoning'; variant = 'twins'; }
      } else if (run.status === 'awaiting_approval') {
        state = 'waiting';
        variant = 'default';
        cls = 'is-gate';
      } else if (run.status === 'completed') {
        state = 'base';
        variant = 'default';
        cls = 'is-done';
      } else if (run.status === 'failed' || run.status === 'blocked') {
        state = 'retrying';
        variant = 'default';
        cls = 'is-err';
      }
    } else if (canvasEngine && canvasEngine.isDemoRunning()) {
      cls = 'is-live';
      const orbPair = canvasEngine.getActiveOrb();
      if (orbPair) {
        state = orbPair[0];
        variant = orbPair[1];
      }
    }

    wrap.classList.remove('is-live', 'is-gate', 'is-done', 'is-err');
    if (cls) wrap.classList.add(cls);
    orb.dataset.orbState = state;
    orb.dataset.orbVariant = variant;
    if (window.ConduitOrbs) window.ConduitOrbs.mountAll(wrap);
  }

  /* =========================================================================
     Branching Reasoning Approach Deck (branching-reasoning-chat-input.tsx FLIP)
     ========================================================================= */
  function derivePlanBranches(run) {
    const planText = String(run.gemini?.planText || '');
    const headings = [];
    planText.split(/\r?\n/).forEach((line) => {
      const m = line.trim().match(/^#{2,3}\s+(.+)$/);
      if (m && headings.length < 4) headings.push(m[1].replace(/[*`]/g, '').trim());
    });
    const planSnippet = headings.slice(0, 2).join(' · ');

    const chosenId = appState.branchSelected.get(run.id) || 'contract-gate';
    const base = [
      {
        id: 'minimal-patch',
        title: '最小增量补丁',
        note: '优先复用既有模块与接口，最小化改动范围与回滚成本。',
        score: 76,
      },
      {
        id: 'modular-refactor',
        title: '模块解耦重构',
        note: '先剥离高耦合边界与纯函数单测，再逐层接入前端调用。',
        score: 85,
      },
      {
        id: 'contract-gate',
        title: '契约驱动 + 双门禁',
        note: planSnippet
          ? `围绕「${planSnippet.slice(0, 44)}」锁定契约，沙箱施工并过 Pre-CI 审查。`
          : '先锁定接口契约与验收清单，人工拍板后派发 Codex 沙箱实现与 Pre-CI 审查。',
        score: 94,
      },
    ];
    return base.map((b) => ({ ...b, chosen: b.id === chosenId }));
  }

  function applyBranchDeckLayout(wrapEl, isExpanded, selectedId) {
    const deck = wrapEl.querySelector('.branch-deck');
    if (!deck) return;
    const cards = Array.from(deck.querySelectorAll('.branch-card'));
    const compact = (deck.clientWidth || 680) < 540;
    const count = cards.length || 3;
    const gap = 10;

    if (isExpanded) {
      if (compact) {
        const cardH = 104;
        deck.style.height = `${count * cardH + (count - 1) * gap}px`;
        cards.forEach((card, i) => {
          const sel = card.dataset.branchId === selectedId;
          card.classList.toggle('is-selected', sel);
          card.style.left = '0px';
          card.style.top = `${i * (cardH + gap)}px`;
          card.style.width = '100%';
          card.style.height = `${cardH}px`;
          card.style.opacity = '1';
          card.style.pointerEvents = 'auto';
          card.style.zIndex = sel ? '3' : '2';
          card.style.transform = 'rotate(0deg) scale(1)';
        });
      } else {
        const deckW = deck.clientWidth || 680;
        const cardW = Math.floor((deckW - gap * (count - 1)) / count);
        const cardH = 126;
        const tilts = [-3.2, 0, 3.2];
        const offsets = [5, 0, 5];
        deck.style.height = `${cardH + 16}px`;
        cards.forEach((card, i) => {
          const sel = card.dataset.branchId === selectedId;
          card.classList.toggle('is-selected', sel);
          card.style.left = `${i * (cardW + gap)}px`;
          card.style.top = `${offsets[i] ?? 0}px`;
          card.style.width = `${cardW}px`;
          card.style.height = `${cardH}px`;
          card.style.opacity = '1';
          card.style.pointerEvents = 'auto';
          card.style.zIndex = sel ? '4' : String(i + 1);
          card.style.transform = `rotate(${tilts[i] ?? 0}deg) scale(1)`;
        });
      }
    } else {
      const cardH = 92;
      deck.style.height = `${cardH}px`;
      cards.forEach((card) => {
        const sel = card.dataset.branchId === selectedId;
        card.classList.toggle('is-selected', sel);
        card.style.left = '0px';
        card.style.top = '0px';
        card.style.width = '100%';
        card.style.height = `${cardH}px`;
        card.style.opacity = sel ? '1' : '0';
        card.style.pointerEvents = sel ? 'auto' : 'none';
        card.style.zIndex = sel ? '4' : '1';
        card.style.transform = sel ? 'rotate(0deg) scale(1)' : 'rotate(0deg) scale(0.95)';
      });
    }
  }

  function renderBranchDeckHtml(run, isStreaming) {
    if (!['full-pipeline', 'plan-only'].includes(run.mode)) return '';
    const branches = derivePlanBranches(run);
    const selected = branches.find((b) => b.chosen) || branches[branches.length - 1];
    const manual = appState.branchDeckOpen.get(run.id);
    const expanded = isStreaming ? true : Boolean(manual);

    const cardsHtml = branches
      .map(
        (b, idx) => `
        <button type="button" class="branch-card ${b.chosen ? 'is-selected' : ''}" data-branch-id="${escapeHtml(b.id)}">
          <div class="branch-card-kicker">
            <span>${b.chosen ? 'SELECTED APPROACH' : `APPROACH 0${idx + 1}`}</span>
            <span>${b.chosen ? '✓' : '○'}</span>
          </div>
          <div class="branch-card-title">${escapeHtml(b.title)}</div>
          <div class="branch-card-note">${escapeHtml(b.note)}</div>
          <div class="branch-score-row">
            <div class="branch-score-track"><div class="branch-score-fill" style="width:${b.score}%"></div></div>
            <span class="branch-score-num">${b.score}</span>
          </div>
        </button>`
      )
      .join('');

    return `
      <div class="branch-deck-wrap" data-branch-run="${escapeHtml(run.id)}" data-branch-expanded="${expanded}" data-branch-selected="${escapeHtml(selected.id)}">
        <div class="branch-head">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><circle cx="18" cy="6" r="3" />
            <path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9" /><path d="M12 12v3" />
          </svg>
          <span class="${isStreaming ? 'is-shimmer' : ''}">
            ${isStreaming ? '正在并行权衡 3 条架构实现路径...' : `已权衡 3 条方案 · 采纳「${escapeHtml(selected.title)}」`}
          </span>
        </div>
        <div class="branch-deck" style="height:${expanded ? '142px' : '92px'}">${cardsHtml}</div>
        ${
          !isStreaming
            ? `<button type="button" class="branch-toggle-btn" data-branch-toggle="${escapeHtml(run.id)}">
                <span>${expanded ? '▴ 收起备选方案' : '▾ 查看其余 2 个备选方案'}</span>
              </button>`
            : ''
        }
      </div>`;
  }

  function updatePipelinePills(run) {
    const order = ['plan', 'gate', 'exec', 'review', 'summary'];
    const stageIdxMap = { init: -1, plan: 0, copy: 0, exec: 2, review: 3, summary: 4, done: 5, failed: -2 };
    let activeIdx = run ? (stageIdxMap[run.activeStage] ?? -1) : -1;
    if (run?.status === 'awaiting_approval') {
      activeIdx = run.gate?.type === 'review_escalation' ? 3 : 1;
    }

    order.forEach((st, idx) => {
      const node = el(`pstep-${st}`);
      if (!node) return;
      node.classList.remove('is-active', 'is-done', 'is-gate', 'is-failed');
      if (!run) return;
      if (run.status === 'completed') {
        if (
          run.mode === 'full-pipeline' ||
          (run.mode === 'plan-only' && idx === 0) ||
          (run.mode === 'copy-polish' && idx === 0) ||
          (run.mode === 'codex-exec' && idx === 2) ||
          (run.mode === 'codex-review' && idx === 3)
        ) node.classList.add('is-done');
      } else if (run.status === 'awaiting_approval' && idx === activeIdx) {
        node.classList.add('is-gate');
      } else if ((run.status === 'failed' || run.status === 'blocked') && idx === Math.max(0, activeIdx)) {
        node.classList.add('is-failed');
      } else if (idx === activeIdx) {
        node.classList.add('is-active');
      } else if (idx < activeIdx && run.mode === 'full-pipeline') {
        node.classList.add('is-done');
      }
    });
  }

  function treeGlyphSvg(kind) {
    if (kind === 'command') {
      return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2.5 4.5L6 8L2.5 11.5M7.5 11.5H13.5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }
    if (kind === 'file_change') {
      return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 2.5H9.5L12.5 5.5V13.5H4V2.5Z" stroke="currentColor" stroke-width="1.25"/><path d="M6.5 8.5H10M8.25 6.75V10.25" stroke="currentColor" stroke-width="1.25"/></svg>';
    }
    if (kind === 'reasoning' || kind === 'step') {
      return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.2" stroke="currentColor" stroke-width="1.25"/><path d="M8 5.2V8L10 9.4" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>';
    }
    return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="3" y="3" width="10" height="10" rx="1.5" stroke="currentColor" stroke-width="1.25"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/></svg>';
  }

  /**
   * Renders the ai-thinking-and-tool-calls SVG Activity Rail Tree:
   * - Single continuous SVG trunk (x=12.5) with curved Q elbows per row
   * - Live shimmer summary header ("ran 2 commands · edited 1 file")
   * - Auto-open while working, auto-collapses cleanly when settled (manual clicks always win)
   */
  function renderToolTraceHtml(events, sourceFilter, isWorking, groupId) {
    const items = (events || []).filter((e) => {
      if (sourceFilter && e.source !== sourceFilter) return false;
      return ['command', 'file_change', 'reasoning', 'step', 'stage', 'worktree'].includes(e.kind);
    });
    if (items.length === 0) return '';

    const shown = items.slice(-14);
    let cmds = 0;
    let edits = 0;
    let thoughts = 0;
    let failedCount = 0;
    shown.forEach((ev) => {
      if (ev.kind === 'command') cmds += 1;
      else if (ev.kind === 'file_change') edits += (ev.changes?.length || 1);
      else if (ev.kind === 'reasoning' || ev.kind === 'step') thoughts += 1;
      if (ev.exitCode != null && ev.exitCode > 0) failedCount += 1;
    });

    const segs = [];
    if (cmds > 0) segs.push(`运行 ${cmds} 条命令`);
    if (edits > 0) segs.push(`修改 ${edits} 处文件`);
    if (thoughts > 0) segs.push(`推理 ${thoughts} 步`);
    if (failedCount > 0) segs.push(`${failedCount} 项失败`);
    const summaryText =
      segs.length > 0
        ? segs.join(' · ')
        : isWorking
          ? 'Thinking · 正在协同调度...'
          : `已完成 ${shown.length} 步调度轨迹`;

    const isOpen = appState.treeGroupOpen.has(groupId)
      ? appState.treeGroupOpen.get(groupId)
      : isWorking;

    const rowsHtml = shown
      .map((ev, idx) => {
        const rowKey = `${groupId}:${idx}`;
        const rowOpen = appState.treeRowOpen.has(rowKey);
        const first = idx === 0;
        const last = idx === shown.length - 1;
        const isRowActive = isWorking && last;
        const failed = ev.exitCode != null && ev.exitCode > 0;

        let verb = 'Stage';
        let pill = ev.text || '';
        let bodyHtml = '';
        let badge = '';

        if (ev.kind === 'command') {
          verb = 'Run';
          pill = ev.command || 'command';
          if (ev.exitCode === 0) badge = '<span class="tree-exit-ok">exit 0</span>';
          else if (ev.exitCode != null) badge = `<span class="tree-exit-err">exit ${ev.exitCode}</span>`;
          bodyHtml = `
            <div class="tree-terminal-card">
              <div class="tree-terminal-head">
                <span class="mono-xs">$ ${escapeHtml(ev.command || '')}</span>
                ${badge}
              </div>
              <div class="tree-terminal-out">${escapeHtml(ev.output || '(无终端输出)')}</div>
            </div>`;
        } else if (ev.kind === 'file_change') {
          verb = 'Edit';
          const paths = (ev.changes || []).map((c) => c.path || c).join(', ');
          pill = paths || 'workspace';
          bodyHtml = `<div class="tree-thought-body mono">${escapeHtml(JSON.stringify(ev.changes || [], null, 2))}</div>`;
        } else if (ev.kind === 'reasoning') {
          verb = 'Thought process';
          pill = (ev.text || '').slice(0, 60);
          bodyHtml = `<div class="tree-thought-body">${escapeHtml(ev.text || '')}</div>`;
        } else if (ev.kind === 'step') {
          verb = 'Step';
          pill = `${ev.stepType || 'step'} (${ev.state || ''})`;
          bodyHtml = `<div class="tree-thought-body">${escapeHtml(pill)}</div>`;
        } else {
          verb = ev.kind === 'worktree' ? 'Worktree' : 'Stage';
          pill = (ev.text || '').slice(0, 80);
          bodyHtml = `<div class="tree-thought-body">${escapeHtml(ev.text || '')}</div>`;
        }

        const continues = !last || rowOpen;
        const railSvg = `
          <svg class="tree-rail-svg" width="28" height="32" aria-hidden="true">
            <line x1="12.5" y1="${first ? -10 : 0}" x2="12.5" y2="10" stroke-width="1" class="tree-rail-stroke" />
            <path d="M12.5 10 Q12.5 16 18.5 16 H28" fill="none" stroke-width="1" class="tree-rail-stroke" />
            ${continues ? '<line x1="12.5" y1="10" x2="12.5" y2="100%" stroke-width="1" class="tree-rail-stroke" />' : ''}
          </svg>`;

        return `
          <div class="tree-row ${failed ? 'is-failed' : ''} ${rowOpen ? 'is-row-open' : ''}">
            ${railSvg}
            <span class="tree-row-icon" aria-hidden="true">
              ${isRowActive ? '<span class="tree-spinner"></span>' : treeGlyphSvg(ev.kind)}
            </span>
            <button type="button" class="tree-row-btn" data-tree-row="${escapeHtml(rowKey)}" aria-expanded="${rowOpen}">
              <span class="tree-row-verb">${escapeHtml(verb)}</span>
              ${pill ? `<span class="tree-pill">${escapeHtml(pill)}</span>` : ''}
              ${badge}
              <span class="tree-row-caret">${rowOpen ? '▾' : '▸'}</span>
            </button>
            <div class="tree-row-fold">
              <div class="tree-row-fold-inner">${bodyHtml}</div>
            </div>
          </div>`;
      })
      .join('');

    return `
      <div class="activity-tree-group ${isOpen ? 'is-open' : ''}">
        <button type="button" class="tree-group-btn" data-tree-group="${escapeHtml(groupId)}" aria-expanded="${isOpen}">
          <span class="tree-chevron-wrap" aria-hidden="true">
            <svg class="tree-chevron-svg" width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </span>
          <span class="tree-group-title ${isWorking ? 'is-live' : ''}">${escapeHtml(summaryText)}</span>
        </button>
        <div class="tree-rows-collapse">
          <div class="tree-rows-inner">${rowsHtml}</div>
        </div>
      </div>`;
  }

  function renderConversationThread(run) {
    if (!run) return;
    el('welcomeStage').classList.add('hidden');
    const container = el('threadMessages');
    container.classList.remove('hidden');

    const isActive = run.status === 'running' || run.status === 'awaiting_approval';
    el('btnCancelRun').classList.toggle('hidden', !isActive);
    el('sendCtaGroup').classList.toggle('hidden', isActive);
    el('composerShell').classList.toggle('is-streaming', run.status === 'running');

    const totalTokens = (run.metrics?.geminiTokens || 0) + (run.metrics?.codexTokens || 0);
    const totalSec = (((run.gemini?.durationMs || 0) + (run.codex?.durationMs || 0)) / 1000).toFixed(1);
    el('topbarTitle').textContent = run.title || '协同会话';
    el('topbarMeta').textContent = `${MODE_LABELS[run.mode] || run.mode} · ${totalTokens.toLocaleString()} TOKENS · ${totalSec}s`;
    updatePipelinePills(run);
    syncTopbarOrb(run);

    // Update Inspector badge
    const badge = el('inspectorBadge');
    const diffCount = run.codex?.diff ? parseUnifiedDiff(run.codex.diff).length : 0;
    if (run.reviewVerdict) {
      badge.textContent = run.reviewVerdict.passed ? 'PASS' : `BLK ${run.reviewVerdict.blocking?.length || 1}`;
      badge.classList.remove('hidden');
    } else if (diffCount > 0) {
      badge.textContent = `${diffCount}F`;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }

    const parts = [];
    const createdStr = new Date(run.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });

    // 1. User Prompt Turn
    parts.push(`
      <div class="msg-user-wrap">
        <div class="msg-user-bubble">
          <div class="msg-user-text">${escapeHtml(run.prompt)}</div>
          <div class="msg-user-meta">
            <span>${escapeHtml(MODE_LABELS[run.mode] || run.mode)}</span>
            <span>·</span>
            <span>${createdStr}</span>
          </div>
        </div>
      </div>`);

    // 2. Gemini Turn (Plan or Copy Advisor)
    const g = run.gemini || {};
    const showGeminiFirst = ['full-pipeline', 'plan-only', 'copy-polish'].includes(run.mode);
    if (showGeminiFirst) {
      const text = run.mode === 'copy-polish' ? g.copyText : g.planText;
      const isStreamingG = g.status === 'running' && run.activeStage !== 'summary';
      const titleLabel = run.mode === 'copy-polish' ? 'Gemini · 文案与交互顾问' : 'Gemini · 总指挥与架构师';
      const statusText = isStreamingG ? '正在流式推理...' : (g.status || 'idle').toUpperCase();
      parts.push(`
        <article class="agent-turn ${isStreamingG ? 'is-streaming' : ''}">
          <div class="border-beam" aria-hidden="true"></div>
          <header class="agent-turn-head">
            <div class="agent-identity">
              <span class="agent-avatar gemini ${isStreamingG ? 'is-orb' : ''}">${isStreamingG ? renderOrbSvg('reasoning', 'twins', 18) : 'G'}</span>
              <span class="agent-role-name">${titleLabel}</span>
              <span class="agent-model-tag">${escapeHtml(run.config?.geminiModel || '')}</span>
            </div>
            <span class="agent-status-pill ${escapeHtml(g.status || '')} ${isStreamingG ? 'is-shimmer' : ''}">
              ${isStreamingG ? renderOrbSvg('reasoning', 'twins', 13) : ''}
              <span>${statusText}</span>
            </span>
          </header>
          ${renderBranchDeckHtml(run, isStreamingG)}
          ${renderToolTraceHtml(run.events, 'gemini', isStreamingG, `${run.id}:gemini`)}
          ${text ? `<div class="markdown-output">${renderMarkdown(text)}</div>` : isStreamingG ? '<div class="mono-xs is-shimmer">正在拆解需求与接口契约...</div>' : ''}
          ${g.error && run.activeStage !== 'summary' ? `<div class="error-banner">${escapeHtml(g.error)}</div>` : ''}
          <footer class="agent-turn-foot">
            <span class="mono-xs">${(g.usage?.total_tokens || run.metrics?.geminiTokens || 0).toLocaleString()} TOKENS · ${((g.durationMs || 0) / 1000).toFixed(1)}s</span>
            <div class="turn-foot-actions">
              ${text ? `<button type="button" class="link-btn" data-copy-slot="gemini-main">复制方案</button>` : ''}
            </div>
          </footer>
        </article>`);
    }

    // 3. Inline Human Approval Gate (Plan Approval)
    if (run.status === 'awaiting_approval' && run.gate && run.gate.type === 'plan_approval') {
      const specValue = appState.gateDirtyText !== null ? appState.gateDirtyText : (run.gate.editableSpec || g.planText || '');
      parts.push(`
        <section class="inline-gate-card" id="inlineGateCard">
          <div class="gate-title-row">
            <span class="gate-badge">HUMAN GATE</span>
            <h3 class="gate-title">${escapeHtml(run.gate.title)}</h3>
          </div>
          <p class="gate-desc">${escapeHtml(run.gate.message)}</p>
          <textarea id="inlineGateEditor" class="gate-editor mono" rows="7">${escapeHtml(specValue)}</textarea>
          <div class="gate-actions-bar">
            <input type="text" id="inlineGateFeedback" class="text-input" placeholder="如方向有偏，填写打回意见让 Gemini 重规划..." />
            <button type="button" class="btn-secondary-sm" id="btnInlineReplan">打回重规划</button>
            <button type="button" class="btn-danger-sm" id="btnInlineAbort">中止</button>
            <button type="button" class="btn-primary-sm" id="btnInlineApprove">拍板放行 · 派发 Codex</button>
          </div>
        </section>`);
    }

    // 4. Codex Execution Turn
    const c = run.codex || {};
    const showCodexExec =
      run.mode === 'codex-exec' ||
      (run.mode === 'full-pipeline' && (c.status !== 'idle' || c.execText || c.error));
    if (showCodexExec) {
      const isStreamingC = c.status === 'running' && run.activeStage === 'exec';
      const statusText = isStreamingC ? '正在沙箱施工...' : (c.status || 'idle').toUpperCase();
      parts.push(`
        <article class="agent-turn ${isStreamingC ? 'is-streaming' : ''}">
          <div class="border-beam" aria-hidden="true"></div>
          <header class="agent-turn-head">
            <div class="agent-identity">
              <span class="agent-avatar codex ${isStreamingC ? 'is-orb is-codex' : ''}">${isStreamingC ? renderOrbSvg('working', 'gyro', 18) : 'C'}</span>
              <span class="agent-role-name">Codex · 沙箱工程师</span>
              <span class="agent-model-tag">${escapeHtml(run.config?.codexModel || '默认')} · ${escapeHtml(run.config?.codexEffort || 'high')} · ${escapeHtml(run.config?.sandbox || 'workspace-write')}${run.worktreePath ? ' · WT' : ''}</span>
            </div>
            <span class="agent-status-pill ${escapeHtml(c.status || '')} ${isStreamingC ? 'is-shimmer' : ''}">
              ${isStreamingC ? renderOrbSvg('working', 'gyro', 13) : ''}
              <span>${statusText}</span>
            </span>
          </header>
          ${renderToolTraceHtml(run.events, 'codex', isStreamingC, `${run.id}:codex`)}
          ${c.execText ? `<div class="markdown-output">${renderMarkdown(c.execText)}</div>` : isStreamingC ? '<div class="mono-xs is-shimmer">Codex 正在读取工作区并编写代码...</div>' : ''}
          ${
            c.diff
              ? `<div class="artifact-card">
                  <div class="artifact-card-left">
                    <span class="artifact-title">工作区代码变更已捕获（${diffCount} 个文件）</span>
                    <span class="mono-xs">${escapeHtml((c.diffStat || '点击在右侧 Diff 面板查看 Unified / Split 对比').split('\n')[0])}</span>
                  </div>
                  <button type="button" class="btn-secondary-sm" data-open-insp="diff">查看 Git Diff →</button>
                </div>`
              : ''
          }
          ${c.error && run.activeStage !== 'review' ? `<div class="error-banner">${escapeHtml(c.error)}</div>` : ''}
          <footer class="agent-turn-foot">
            <span class="mono-xs">THREAD: ${escapeHtml(c.threadId ? `${c.threadId.slice(0, 12)}...` : '—')} · ${(run.metrics?.codexTokens || 0).toLocaleString()} TOKENS</span>
            <div class="turn-foot-actions">
              ${c.threadId ? `<button type="button" class="link-btn" data-use-resume="${escapeHtml(c.threadId)}">以此会话续跑</button>` : ''}
              ${c.execText ? `<button type="button" class="link-btn" data-copy-slot="codex-exec">复制回报</button>` : ''}
            </div>
          </footer>
        </article>`);
    }

    // 5. Pre-CI Review Gate Turn
    const showReview = run.mode === 'codex-review' || run.reviewRound > 0 || Boolean(run.reviewVerdict);
    if (showReview) {
      const v = run.reviewVerdict;
      const isStreamingR = c.status === 'running' && run.activeStage === 'review';
      parts.push(`
        <article class="agent-turn ${isStreamingR ? 'is-streaming' : ''}">
          <div class="border-beam" aria-hidden="true"></div>
          <header class="agent-turn-head">
            <div class="agent-identity">
              <span class="agent-avatar codex ${isStreamingR ? 'is-orb' : ''}">${isStreamingR ? renderOrbSvg('searching', 'lighthouse', 18) : 'R'}</span>
              <span class="agent-role-name">Pre-CI 代码审查门禁</span>
              <span class="agent-model-tag">ROUND ${run.reviewRound || 1} / ${run.mode === 'codex-review' ? 1 : (run.config?.maxReviewRounds || 2)}</span>
            </div>
            <span class="agent-status-pill ${v ? (v.passed ? 'done' : 'failed') : (isStreamingR ? 'running' : '')} ${isStreamingR ? 'is-shimmer' : ''}">
              ${isStreamingR ? renderOrbSvg('searching', 'lighthouse', 13) : ''}
              <span>${isStreamingR ? '深度审查中...' : v ? (v.passed ? 'PASS' : 'BLOCK') : 'PENDING'}</span>
            </span>
          </header>
          ${
            v
              ? `<div class="verdict-header ${v.passed ? 'pass' : 'block'}">
                  <strong class="mono">${v.passed ? 'PASS · 门禁放行' : 'BLOCK · 审查拦截'}</strong>
                  <span class="mono-xs">${escapeHtml(v.summary)}</span>
                </div>
                ${v.blocking?.length ? `<div class="verdict-section-title">BLOCKING 阻塞项 (${v.blocking.length})</div>${v.blocking.map((b) => `<div class="verdict-item blocking">${escapeHtml(b)}</div>`).join('')}` : ''}
                ${v.suggestions?.length ? `<div class="verdict-section-title">SUGGESTION 建议 (${v.suggestions.length})</div>${v.suggestions.map((s) => `<div class="verdict-item">${escapeHtml(s)}</div>`).join('')}` : ''}`
              : isStreamingR
                ? '<div class="mono-xs is-shimmer">正在扫描高危路径与变更 Diff...</div>'
                : ''
          }
          ${c.error && run.activeStage === 'review' ? `<div class="error-banner">${escapeHtml(c.error)}</div>` : ''}
          <footer class="agent-turn-foot">
            <span class="mono-xs">只读门禁 · 仅严重事故阻塞</span>
            <button type="button" class="link-btn" data-open-insp="review">在右侧展开审查原文 →</button>
          </footer>
        </article>`);
    }

    // 6. Inline Review Escalation Gate
    if (run.status === 'awaiting_approval' && run.gate && run.gate.type === 'review_escalation') {
      parts.push(`
        <section class="inline-gate-card">
          <div class="gate-title-row">
            <span class="gate-badge">ESCALATION</span>
            <h3 class="gate-title">${escapeHtml(run.gate.title)}</h3>
          </div>
          <p class="gate-desc">${escapeHtml(run.gate.message)}</p>
          <div class="gate-actions-bar">
            <button type="button" class="btn-danger-sm" id="btnInlineStopBlocked">停止并保持拦截</button>
            <button type="button" class="btn-primary-sm" id="btnInlineOverride">人工确认风险 · 强制放行</button>
          </div>
        </section>`);
    }

    // 7. Gemini Final Executive Report Turn
    if (run.mode === 'full-pipeline' && (g.summaryText || run.activeStage === 'summary')) {
      const isStreamingS = g.status === 'running' && run.activeStage === 'summary';
      parts.push(`
        <article class="agent-turn ${isStreamingS ? 'is-streaming' : ''}">
          <div class="border-beam" aria-hidden="true"></div>
          <header class="agent-turn-head">
            <div class="agent-identity">
              <span class="agent-avatar gemini ${isStreamingS ? 'is-orb' : ''}">${isStreamingS ? renderOrbSvg('compacting', 'fuse', 18) : 'G'}</span>
              <span class="agent-role-name">Gemini · 最终交付汇报</span>
            </div>
            <span class="agent-status-pill ${escapeHtml(g.status || '')} ${isStreamingS ? 'is-shimmer' : ''}">
              ${isStreamingS ? renderOrbSvg('compacting', 'fuse', 13) : ''}
              <span>${isStreamingS ? '正在汇总汇报...' : 'REPORT'}</span>
            </span>
          </header>
          ${g.summaryText ? `<div class="markdown-output">${renderMarkdown(g.summaryText)}</div>` : ''}
          ${g.error && run.activeStage === 'summary' ? `<div class="error-banner">${escapeHtml(g.error)}</div>` : ''}
          <footer class="agent-turn-foot">
            <span class="mono-xs">面向人类 10 秒速览总结</span>
            ${g.summaryText ? `<button type="button" class="link-btn" data-copy-slot="gemini-summary">复制汇报</button>` : ''}
          </footer>
        </article>`);
    }

    container.innerHTML = parts.join('');
    bindThreadDynamicHandlers(container, run);
    if (window.ConduitOrbs) window.ConduitOrbs.mountAll(container);
    renderInspectorContent(run);
    if (appState.stageView === 'workflow') renderWorkflowCanvas();

    // Smart auto-follow (21st.dev Conversation #46450 — NEVER uses scrollIntoView!)
    const vp = el('conversationViewport');
    if (appState.stickyBottom) {
      vp.scrollTop = vp.scrollHeight;
      el('btnJumpLatest').classList.add('hidden');
    } else if (run.status === 'running') {
      el('btnJumpLatest').classList.remove('hidden');
    }

    if (waveEngine) waveEngine.redraw();
  }

  function bindThreadDynamicHandlers(container, run) {
    // FLIP Branching Reasoning Deck layout & smooth in-place toggling
    container.querySelectorAll('.branch-deck-wrap').forEach((wrap) => {
      let expanded = wrap.dataset.branchExpanded === 'true';
      let selectedId = wrap.dataset.branchSelected || 'contract-gate';
      const sync = () => {
        applyBranchDeckLayout(wrap, expanded, selectedId);
        const toggleBtn = wrap.querySelector('[data-branch-toggle]');
        if (toggleBtn) {
          toggleBtn.innerHTML = `<span>${expanded ? '▴ 收起备选方案' : '▾ 查看其余 2 个备选方案'}</span>`;
        }
      };
      requestAnimationFrame(sync);

      const toggleBtn = wrap.querySelector('[data-branch-toggle]');
      if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
          expanded = !expanded;
          appState.branchDeckOpen.set(run.id, expanded);
          sync();
        });
      }

      wrap.querySelectorAll('.branch-card').forEach((card) => {
        card.addEventListener('click', () => {
          const nextId = card.dataset.branchId;
          if (!nextId) return;
          selectedId = nextId;
          appState.branchSelected.set(run.id, nextId);
          const headText = wrap.querySelector('.branch-head span');
          const title = card.querySelector('.branch-card-title')?.textContent || nextId;
          if (headText && run.status !== 'running') {
            headText.textContent = `已权衡 3 条方案 · 采纳「${title}」`;
          }
          wrap.querySelectorAll('.branch-card').forEach((c, idx) => {
            const isSel = c.dataset.branchId === nextId;
            const k = c.querySelector('.branch-card-kicker');
            if (k) k.innerHTML = `<span>${isSel ? 'SELECTED APPROACH' : `APPROACH 0${idx + 1}`}</span><span>${isSel ? '✓' : '○'}</span>`;
          });
          sync();
        });
      });
    });

    container.querySelectorAll('[data-tree-group]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const gid = btn.dataset.treeGroup;
        const curr = btn.getAttribute('aria-expanded') === 'true';
        appState.treeGroupOpen.set(gid, !curr);
        renderConversationThread(run);
      });
    });

    container.querySelectorAll('[data-tree-row]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const rkey = btn.dataset.treeRow;
        if (appState.treeRowOpen.has(rkey)) appState.treeRowOpen.delete(rkey);
        else appState.treeRowOpen.add(rkey);
        renderConversationThread(run);
      });
    });

    container.querySelectorAll('[data-open-insp]').forEach((btn) => {
      btn.addEventListener('click', () => {
        openInspector(btn.dataset.openInsp);
      });
    });

    container.querySelectorAll('[data-copy-slot]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const slot = btn.dataset.copySlot;
        const txt =
          slot === 'gemini-main'
            ? (run.mode === 'copy-polish' ? run.gemini?.copyText : run.gemini?.planText)
            : slot === 'gemini-summary'
              ? run.gemini?.summaryText
              : run.codex?.execText;
        copyText(txt, '已复制内容');
      });
    });

    container.querySelectorAll('[data-use-resume]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tid = btn.dataset.useResume;
        appState.resumeThreadId = tid;
        el('resumeThreadLabel').textContent = `${tid.slice(0, 14)}...`;
        el('resumeIndicator').classList.remove('hidden');
        setModeValue('codex-exec');
        showToast('已锁定上次 Codex 会话并切至「Codex 直派」');
      });
    });

    const gateEd = el('inlineGateEditor');
    if (gateEd) {
      gateEd.addEventListener('input', () => {
        appState.gateDirtyText = gateEd.value;
      });
    }

    const btnApprove = el('btnInlineApprove');
    if (btnApprove) {
      btnApprove.addEventListener('click', async () => {
        try {
          const spec = el('inlineGateEditor')?.value || '';
          await api(`/api/runs/${encodeURIComponent(run.id)}/approve`, {
            method: 'POST',
            body: JSON.stringify({ action: 'approve', spec }),
          });
          appState.gateDirtyText = null;
          showToast('已拍板放行，正在派发 Codex 施工');
        } catch (err) {
          showToast(`放行失败: ${err.message}`);
        }
      });
    }

    const btnReplan = el('btnInlineReplan');
    if (btnReplan) {
      btnReplan.addEventListener('click', async () => {
        try {
          const fb = el('inlineGateFeedback')?.value.trim() || '';
          await api(`/api/runs/${encodeURIComponent(run.id)}/approve`, {
            method: 'POST',
            body: JSON.stringify({ action: 'replan', feedback: fb }),
          });
          appState.gateDirtyText = null;
          showToast('已打回 Gemini 重新规划');
        } catch (err) {
          showToast(`打回失败: ${err.message}`);
        }
      });
    }

    const btnAbort = el('btnInlineAbort');
    if (btnAbort) {
      btnAbort.addEventListener('click', async () => {
        try {
          await api(`/api/runs/${encodeURIComponent(run.id)}/cancel`, { method: 'POST' });
          appState.gateDirtyText = null;
          showToast('已中止任务');
        } catch (err) {
          showToast(`中止失败: ${err.message}`);
        }
      });
    }

    const btnOverride = el('btnInlineOverride');
    if (btnOverride) {
      btnOverride.addEventListener('click', async () => {
        try {
          await api(`/api/runs/${encodeURIComponent(run.id)}/approve`, {
            method: 'POST',
            body: JSON.stringify({ action: 'override' }),
          });
          showToast('已人工强制放行，进入 Gemini 最终汇报');
        } catch (err) {
          showToast(`放行失败: ${err.message}`);
        }
      });
    }

    const btnStopBlocked = el('btnInlineStopBlocked');
    if (btnStopBlocked) {
      btnStopBlocked.addEventListener('click', async () => {
        try {
          await api(`/api/runs/${encodeURIComponent(run.id)}/approve`, {
            method: 'POST',
            body: JSON.stringify({ action: 'abort' }),
          });
          showToast('已停止并保持门禁拦截');
        } catch (err) {
          showToast(`操作失败: ${err.message}`);
        }
      });
    }
  }

  /* =========================================================================
     Right Inspector Rendering (Diff / Review / Terminal Events)
     ========================================================================= */
  function openInspector(tabName = null) {
    appState.inspectorOpen = true;
    el('inspectorPane').classList.remove('hidden');
    el('btnToggleInspector').setAttribute('aria-expanded', 'true');
    if (tabName) switchInspectorTab(tabName);
    else renderInspectorContent(appState.currentRun);
    requestAnimationFrame(syncAllFluidTracks);
  }

  function closeInspector() {
    appState.inspectorOpen = false;
    el('inspectorPane').classList.add('hidden');
    el('btnToggleInspector').setAttribute('aria-expanded', 'false');
  }

  function switchInspectorTab(tab) {
    appState.inspectorTab = tab;
    el('inspectorTabs').querySelectorAll('.insp-tab').forEach((b) => {
      const active = b.dataset.insp === tab;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', String(active));
    });
    el('inspectorDiffBox').classList.toggle('hidden', tab !== 'diff');
    el('inspectorReviewBox').classList.toggle('hidden', tab !== 'review');
    el('inspectorEventsBox').classList.toggle('hidden', tab !== 'events');
    syncAllFluidTracks();
    renderInspectorContent(appState.currentRun);
  }

  function renderInspectorContent(run) {
    if (appState.inspectorTab === 'diff') {
      const diffText = run ? (run.codex?.diff || '') : appState.standaloneDiff;
      renderDiffViewer(el('inspectorDiffBox'), diffText);
    } else if (appState.inspectorTab === 'review') {
      const box = el('inspectorReviewBox');
      const v = run?.reviewVerdict;
      const raw = run?.codex?.reviewText || '';
      if (!v && !raw) {
        box.innerHTML = '<div class="empty-inline"><span class="mono-xs">PRE-CI GATE / STANDBY</span><p>暂无审查记录。</p></div>';
      } else {
        let html = '';
        if (v) {
          html += `<div class="verdict-header ${v.passed ? 'pass' : 'block'}"><strong class="mono">${v.passed ? 'PASS · 通过' : 'BLOCK · 拦截'}</strong><span class="mono-xs">${escapeHtml(v.summary)}</span></div>`;
          if (v.blocking?.length) {
            html += `<div class="verdict-section-title">BLOCKING (${v.blocking.length})</div>` + v.blocking.map((b) => `<div class="verdict-item blocking">${escapeHtml(b)}</div>`).join('');
          }
          if (v.suggestions?.length) {
            html += `<div class="verdict-section-title">SUGGESTION (${v.suggestions.length})</div>` + v.suggestions.map((s) => `<div class="verdict-item">${escapeHtml(s)}</div>`).join('');
          }
        }
        if (raw) {
          html += `<div class="verdict-section-title">完整审查原文</div><div class="markdown-output">${renderMarkdown(raw)}</div>`;
        }
        box.innerHTML = html;
      }
    } else if (appState.inspectorTab === 'events') {
      const box = el('inspectorEventsBox');
      const events = run?.events || [];
      if (events.length === 0) {
        box.innerHTML = '<div class="empty-inline"><span class="mono-xs">TERMINAL / IDLE</span><p>暂无实时事件流。</p></div>';
      } else {
        box.innerHTML = events
          .slice(-150)
          .map((e) => {
            const t = e.ts ? new Date(e.ts).toTimeString().slice(0, 8) : '--:--:--';
            const msg = e.text || e.command || e.status || e.kind || '';
            return `<div class="event-row"><span class="event-time">${t}</span><span class="event-src">${escapeHtml(e.source || 'sys')}</span><span class="event-msg">${escapeHtml(msg)}</span></div>`;
          })
          .join('');
      }
    }
  }

  /* =========================================================================
     Run Execution & SSE Streams
     ========================================================================= */
  function isTerminalStatus(status) {
    return ['completed', 'failed', 'cancelled', 'blocked', 'interrupted'].includes(status);
  }

  async function startRun() {
    const prompt = el('inputPrompt').value.trim();
    if (!prompt) {
      showToast('请输入任务需求');
      el('inputPrompt').focus();
      return;
    }

    const mode = el('selectMode').value;
    const payload = {
      mode,
      prompt,
      workspaceDir: el('inputWorkspace').value.trim(),
      geminiModel: el('selectGeminiModel').value,
      codexModel: el('selectCodexModel').value,
      codexReviewModel: el('selectCodexReviewModel').value,
      codexEffort: el('selectCodexEffort').value,
      sandbox: el('selectSandbox').value,
      maxReviewRounds: Number(el('selectMaxRounds').value) || 2,
      codexHome: el('selectCodexHome').value,
      requireApproval: el('chkApproval').checked,
      useWorktree: el('chkWorktree').checked,
      resumeThreadId: mode === 'codex-exec' ? appState.resumeThreadId : '',
    };

    el('btnStartRun').disabled = true;
    try {
      const { run } = await api('/api/runs', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      el('inputPrompt').value = '';
      autoGrowTextarea(el('inputPrompt'));
      appState.stickyBottom = true;
      appState.gateDirtyText = null;
      attachToRun(run);
      await loadRunsList();
    } catch (err) {
      showToast(`启动失败: ${err.message}`);
    } finally {
      el('btnStartRun').disabled = false;
    }
  }

  function attachToRun(run) {
    if (appState.activeStream) {
      appState.activeStream.close();
      appState.activeStream = null;
    }
    appState.currentRun = run;
    appState.gateDirtyText = null;
    renderSidebarThreads();
    renderConversationThread(run);

    if (isTerminalStatus(run.status)) return;

    const es = new EventSource(`/api/runs/${encodeURIComponent(run.id)}/stream`);
    appState.activeStream = es;

    es.addEventListener('state', (ev) => {
      try {
        const next = JSON.parse(ev.data);
        const hadDiff = Boolean(appState.currentRun?.codex?.diff);
        appState.currentRun = next;
        renderConversationThread(next);
        if (!hadDiff && next.codex?.diff && !appState.inspectorOpen) {
          openInspector('diff');
        }
        if (isTerminalStatus(next.status)) {
          es.close();
          if (appState.activeStream === es) appState.activeStream = null;
          loadRunsList();
        }
      } catch {
        // Ignore
      }
    });

    es.addEventListener('event', (ev) => {
      try {
        const item = JSON.parse(ev.data);
        if (appState.currentRun) {
          appState.currentRun.events = appState.currentRun.events || [];
          appState.currentRun.events.push(item);
          if (appState.inspectorOpen && appState.inspectorTab === 'events') {
            renderInspectorContent(appState.currentRun);
          }
        }
      } catch {
        // Ignore
      }
    });

    es.onerror = () => {
      if (appState.currentRun && isTerminalStatus(appState.currentRun.status)) {
        es.close();
        if (appState.activeStream === es) appState.activeStream = null;
      }
    };
  }

  function initGlobalEvents() {
    if (appState.globalStream) return;
    const es = new EventSource('/api/events');
    appState.globalStream = es;
    const sync = () => loadRunsList();
    es.addEventListener('run_created', sync);
    es.addEventListener('run_updated', sync);
    es.addEventListener('run_deleted', sync);
  }

  /* =========================================================================
     Environment, Models, Workspace & Studio Drawer
     ========================================================================= */
  async function loadHealth() {
    try {
      const data = await api('/api/health');
      appState.health = data;
      el('dotAgy').className = `status-dot ${data.agy.installed ? 'ok' : 'err'}`;
      el('dotCodex').className = `status-dot ${data.codex.installed ? 'ok' : 'err'}`;
      el('welcomeEnvTag').textContent = `AGY ${data.agy.installed ? 'OK' : 'MISSING'} · CODEX ${data.codex.installed ? 'OK' : 'MISSING'}`;

      if (!el('inputWorkspace').value) {
        el('inputWorkspace').value = data.defaultWorkspace || data.workbenchDir || '';
        inspectCurrentWorkspace();
      }

      const profiles = data.codex?.config?.profiles || [];
      const homeSel = el('selectCodexHome');
      const prev = homeSel.value;
      homeSel.innerHTML = '<option value="">默认环境变量</option>';
      profiles.forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p.codexHome;
        opt.textContent = `${p.codexHome} (${p.model || 'default'} / ${p.provider})`;
        homeSel.appendChild(opt);
      });
      if (prev) homeSel.value = prev;

      el('envDetails').innerHTML = `
        <div class="env-row"><span>Antigravity (agy)</span><span class="mono">${escapeHtml(data.agy.installed ? 'READY' : 'MISSING')}</span></div>
        <div class="env-row"><span>agy 路径</span><span class="mono">${escapeHtml(data.agy.path || '未检测到')}</span></div>
        <div class="env-row"><span>Codex CLI</span><span class="mono">${escapeHtml(data.codex.version || 'MISSING')}</span></div>
        <div class="env-row"><span>CODEX_HOME</span><span class="mono">${escapeHtml(data.codex.config?.activeHome || '默认')}</span></div>
        <div class="env-row"><span>Codex 默认配置</span><span class="mono">${escapeHtml(`${data.codex.config?.defaultModel || '—'} (${data.codex.config?.defaultProvider || '—'})`)}</span></div>
        <div class="env-row"><span>Git / Node</span><span class="mono">${escapeHtml(`${data.git.installed ? 'Git OK' : 'No Git'} · ${data.nodeVersion}`)}</span></div>
      `;
    } catch (err) {
      showToast(`环境探测失败: ${err.message}`);
    }
  }

  /* =========================================================================
     Custom Obsidian Grouped Pickers (Zero Native OS <select> Dropdowns)
     ========================================================================= */
  function formatGeminiShort(id) {
    if (!id) return 'Gemini';
    const raw = String(id).trim();
    const effortMap = { xhigh: 'XHigh', high: 'High', medium: 'Med', low: 'Low' };
    const m4 = raw.match(/^gemini-4-([a-z0-9]+)-(xhigh|high|medium|low)$/i);
    if (m4) {
      const fam = m4[1].charAt(0).toUpperCase() + m4[1].slice(1);
      return `${fam} · ${effortMap[m4[2].toLowerCase()] || m4[2]}`;
    }
    const m38 = raw.match(/^gemini-3\.8-flash-(xhigh|high|medium|low)$/i);
    if (m38) {
      return `Flash · ${effortMap[m38[1].toLowerCase()] || m38[1]}`;
    }
    const mo = raw.match(/^orchestrator-([a-z0-9]+)$/i);
    if (mo) {
      return `Orch · ${mo[1].charAt(0).toUpperCase() + mo[1].slice(1)}`;
    }
    return raw.replace(/^gemini-/i, 'G-').slice(0, 18);
  }

  function formatCodexShort(id) {
    if (!id) return 'Codex · 默认';
    const raw = String(id).trim();
    if (/^gpt-/i.test(raw)) return raw.replace(/^gpt-/i, 'GPT ').replace(/-/g, ' ');
    return raw.slice(0, 16);
  }

  function setModeValue(modeVal) {
    const val = MODE_LABELS[modeVal] ? modeVal : 'full-pipeline';
    el('selectMode').value = val;
    const lbl = el('labelModePicker');
    if (lbl) lbl.textContent = MODE_SHORT[val] || MODE_LABELS[val];
    if (appState.stageView === 'workflow') renderWorkflowCanvas();
  }

  function setGeminiModelValue(id) {
    const val = id || 'gemini-4-neon-high';
    el('selectGeminiModel').value = val;
    const lbl = el('labelGeminiPicker');
    if (lbl) lbl.textContent = formatGeminiShort(val);
    renderCliCommandCards();
    if (appState.stageView === 'workflow') renderWorkflowCanvas();
  }

  function setCodexModelValue(id) {
    const val = String(id || '').trim();
    el('selectCodexModel').value = val;
    const lbl = el('labelCodexPicker');
    if (lbl) lbl.textContent = formatCodexShort(val);
    renderCliCommandCards();
    if (appState.stageView === 'workflow') renderWorkflowCanvas();
  }

  function closePickers() {
    appState.activePicker = null;
    [
      ['menuModePicker', 'btnModePicker'],
      ['menuGeminiPicker', 'btnGeminiPicker'],
      ['menuCodexPicker', 'btnCodexPicker'],
    ].forEach(([menuId, btnId]) => {
      const m = el(menuId);
      const b = el(btnId);
      if (m) m.classList.add('hidden');
      if (b) b.setAttribute('aria-expanded', 'false');
    });
  }

  function positionPickerMenu(menuEl, btnEl) {
    const shell = el('composerShell');
    if (!menuEl || !btnEl || !shell) return;
    const shellW = shell.clientWidth || 720;
    const menuW = Math.min(320, shellW - 24);
    const desiredLeft = btnEl.offsetLeft;
    const clampedLeft = Math.max(12, Math.min(desiredLeft, shellW - menuW - 12));
    menuEl.style.left = `${clampedLeft}px`;
  }

  function renderModePicker() {
    const menu = el('menuModePicker');
    if (!menu) return;
    const current = el('selectMode').value || 'full-pipeline';
    menu.innerHTML =
      '<div class="picker-group-label">ORCHESTRATION MODE · 选择协同模式</div>' +
      MODE_ITEMS.map(
        (m) => `
        <button type="button" class="picker-option ${m.id === current ? 'is-selected' : ''}" role="option" aria-selected="${m.id === current}" data-pick-mode="${escapeHtml(m.id)}">
          <div class="picker-opt-main">
            <span class="picker-opt-title">${escapeHtml(m.title)}</span>
            <span class="picker-opt-sub">${escapeHtml(m.sub)}</span>
          </div>
          <div class="picker-opt-right">
            <span class="picker-badge">${escapeHtml(m.badge)}</span>
            ${m.id === current ? '<span class="picker-check">✓</span>' : ''}
          </div>
        </button>`
      ).join('');

    menu.querySelectorAll('[data-pick-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        setModeValue(btn.dataset.pickMode);
        closePickers();
        showToast(`已切换至「${MODE_LABELS[btn.dataset.pickMode]}」`);
      });
    });
  }

  function groupGeminiModels(models) {
    const groups = [
      { key: 'neon', title: 'GEMINI 4 NEON · 推荐', items: [] },
      { key: 'g4', title: 'GEMINI 4 SERIES', items: [] },
      { key: 'orch', title: 'ORCHESTRATOR', items: [] },
      { key: 'flash', title: 'GEMINI 3.8 FLASH', items: [] },
      { key: 'other', title: 'OTHER MODELS', items: [] },
    ];
    models.forEach((m) => {
      const id = String(m.id || '').toLowerCase();
      if (id.includes('neon') && id.startsWith('gemini-4')) groups[0].items.push(m);
      else if (id.startsWith('gemini-4')) groups[1].items.push(m);
      else if (id.startsWith('orchestrator')) groups[2].items.push(m);
      else if (id.includes('flash')) groups[3].items.push(m);
      else groups[4].items.push(m);
    });
    return groups.filter((g) => g.items.length > 0);
  }

  function renderGeminiPicker() {
    const menu = el('menuGeminiPicker');
    if (!menu) return;
    const current = el('selectGeminiModel').value || 'gemini-4-neon-high';
    const rawModels = appState.models?.agy?.models || [
      { id: 'gemini-4-neon-high', label: 'Gemini 4 Neon (High)' },
      { id: 'gemini-4-neon-xhigh', label: 'Gemini 4 Neon (XHigh)' },
      { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
    ];
    const q = appState.geminiSearch.trim().toLowerCase();
    const filtered = rawModels.filter(
      (m) => !q || String(m.id).toLowerCase().includes(q) || String(m.label || '').toLowerCase().includes(q)
    );
    const groups = groupGeminiModels(filtered);

    const listHtml =
      groups.length === 0
        ? '<div class="picker-group-label">无匹配模型</div>'
        : groups
            .map(
              (g) =>
                `<div class="picker-group-label">${g.title}</div>` +
                g.items
                  .map((m) => {
                    const effortMatch = String(m.id).match(/-(xhigh|high|medium|low)$/i);
                    const effortBadge = effortMatch ? effortMatch[1].toUpperCase() : '';
                    const sel = m.id === current;
                    return `
                      <button type="button" class="picker-option ${sel ? 'is-selected' : ''}" role="option" aria-selected="${sel}" data-pick-gemini="${escapeHtml(m.id)}">
                        <div class="picker-opt-main">
                          <span class="picker-opt-title">${escapeHtml(m.label || m.id)}</span>
                          <span class="picker-opt-sub mono">${escapeHtml(m.id)}</span>
                        </div>
                        <div class="picker-opt-right">
                          ${effortBadge ? `<span class="picker-badge">${effortBadge}</span>` : ''}
                          ${sel ? '<span class="picker-check">✓</span>' : ''}
                        </div>
                      </button>`;
                  })
                  .join('')
            )
            .join('');

    menu.innerHTML = `
      <div class="picker-menu-top">
        <input type="text" class="picker-search" id="inputGeminiSearch" placeholder="搜索本机 Gemini 模型..." value="${escapeHtml(appState.geminiSearch)}" autocomplete="off" />
        <button type="button" class="link-btn" id="btnPickerRefreshGemini">刷新</button>
      </div>
      <div class="picker-list-body">${listHtml}</div>`;

    const searchInput = el('inputGeminiSearch');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        appState.geminiSearch = e.target.value;
        const caret = e.target.selectionStart || e.target.value.length;
        renderGeminiPicker();
        const nextInp = el('inputGeminiSearch');
        if (nextInp) {
          nextInp.focus();
          nextInp.setSelectionRange(caret, caret);
        }
      });
    }

    const refBtn = el('btnPickerRefreshGemini');
    if (refBtn) {
      refBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        loadModels(true);
      });
    }

    menu.querySelectorAll('[data-pick-gemini]').forEach((btn) => {
      btn.addEventListener('click', () => {
        setGeminiModelValue(btn.dataset.pickGemini);
        closePickers();
      });
    });
  }

  function renderCodexPicker() {
    const menu = el('menuCodexPicker');
    if (!menu) return;
    const current = el('selectCodexModel').value || '';
    const baseList = appState.models?.codex || [{ id: '', label: '默认（读取本机 CODEX_HOME 配置）' }];
    const combined = [...baseList];
    appState.customCodexModels.forEach((cid) => {
      if (!combined.some((m) => m.id === cid)) combined.push({ id: cid, label: `${cid}（自定义）` });
    });

    const optsHtml = combined
      .map((m) => {
        const sel = m.id === current;
        return `
          <button type="button" class="picker-option ${sel ? 'is-selected' : ''}" role="option" aria-selected="${sel}" data-pick-codex="${escapeHtml(m.id)}">
            <div class="picker-opt-main">
              <span class="picker-opt-title">${escapeHtml(m.label || m.id || '默认配置')}</span>
              <span class="picker-opt-sub mono">${escapeHtml(m.id || 'CODEX_HOME/config.toml')}</span>
            </div>
            <div class="picker-opt-right">
              ${m.id === '' ? '<span class="picker-badge">AUTO</span>' : ''}
              ${sel ? '<span class="picker-check">✓</span>' : ''}
            </div>
          </button>`;
      })
      .join('');

    menu.innerHTML = `
      <div class="picker-group-label">CODEX EXECUTION MODEL · 施工引擎</div>
      ${optsHtml}
      <div class="picker-custom-row">
        <input type="text" class="picker-search mono" id="inputCustomCodex" placeholder="自定义模型名，如 gpt-5.4" autocomplete="off" />
        <button type="button" class="btn-primary-sm" id="btnApplyCustomCodex">应用</button>
      </div>`;

    menu.querySelectorAll('[data-pick-codex]').forEach((btn) => {
      btn.addEventListener('click', () => {
        setCodexModelValue(btn.dataset.pickCodex);
        closePickers();
      });
    });

    const applyCustom = () => {
      const val = (el('inputCustomCodex')?.value || '').trim();
      if (!val) return;
      if (!appState.customCodexModels.includes(val)) appState.customCodexModels.push(val);
      setCodexModelValue(val);
      closePickers();
      showToast(`Codex 模型已设为 ${val}`);
    };

    const applyBtn = el('btnApplyCustomCodex');
    if (applyBtn) applyBtn.addEventListener('click', applyCustom);
    const customInp = el('inputCustomCodex');
    if (customInp) {
      customInp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          applyCustom();
        }
      });
    }
  }

  function openPicker(kind) {
    const already = appState.activePicker === kind;
    closeAllPopovers();
    closePromptPalette();
    closePickers();
    if (already) return;

    appState.activePicker = kind;
    if (kind === 'mode') {
      renderModePicker();
      positionPickerMenu(el('menuModePicker'), el('btnModePicker'));
      el('menuModePicker').classList.remove('hidden');
      el('btnModePicker').setAttribute('aria-expanded', 'true');
    } else if (kind === 'gemini') {
      appState.geminiSearch = '';
      renderGeminiPicker();
      positionPickerMenu(el('menuGeminiPicker'), el('btnGeminiPicker'));
      el('menuGeminiPicker').classList.remove('hidden');
      el('btnGeminiPicker').setAttribute('aria-expanded', 'true');
      setTimeout(() => el('inputGeminiSearch')?.focus(), 20);
    } else if (kind === 'codex') {
      renderCodexPicker();
      positionPickerMenu(el('menuCodexPicker'), el('btnCodexPicker'));
      el('menuCodexPicker').classList.remove('hidden');
      el('btnCodexPicker').setAttribute('aria-expanded', 'true');
    }
  }

  async function loadModels(refresh = false) {
    try {
      const data = await api(`/api/models${refresh ? '?refresh=1' : ''}`);
      appState.models = data;

      const agyModels = data.agy?.models || [];
      const prevAgy = el('selectGeminiModel').value;
      if (prevAgy && agyModels.some((m) => m.id === prevAgy)) {
        setGeminiModelValue(prevAgy);
      } else if (agyModels.some((m) => m.id === 'gemini-4-neon-high')) {
        setGeminiModelValue('gemini-4-neon-high');
      } else if (agyModels.length > 0) {
        setGeminiModelValue(agyModels[0].id);
      } else {
        setGeminiModelValue('gemini-4-neon-high');
      }

      const prevCodex = el('selectCodexModel').value;
      if (prevCodex && (data.codex || []).some((m) => m.id === prevCodex)) {
        setCodexModelValue(prevCodex);
      } else {
        setCodexModelValue('');
      }

      const revSel = el('selectCodexReviewModel');
      if (revSel) {
        const prevRev = revSel.value;
        revSel.innerHTML = '';
        (data.codex || []).forEach((m) => {
          const opt = document.createElement('option');
          opt.value = m.id;
          opt.textContent = m.label;
          revSel.appendChild(opt);
        });
        if (prevRev && Array.from(revSel.options).some((o) => o.value === prevRev)) revSel.value = prevRev;
      }

      if (appState.activePicker === 'gemini') renderGeminiPicker();
      if (appState.activePicker === 'codex') renderCodexPicker();
      if (refresh) showToast('已刷新本机 agy Gemini 模型列表');
      renderCliCommandCards();
      if (appState.stageView === 'workflow') renderWorkflowCanvas();
    } catch (err) {
      showToast(`模型列表加载失败: ${err.message}`);
    }
  }

  /* =========================================================================
     Blender-Style Infinite Agent Cluster Canvas Wrapper
     ========================================================================= */
  function renderWorkflowCanvas() {
    if (canvasEngine) canvasEngine.render();
  }

  function initInfiniteWorkflowCanvas() {
    if (!window.ConduitCanvas || !el('wfViewport')) return null;
    return window.ConduitCanvas.createInfiniteCanvas({
      viewportEl: el('wfViewport'),
      worldEl: el('wfWorld'),
      edgesSvgEl: el('wfEdgesSvg'),
      nodesLayerEl: el('wfNodesLayer'),
      minimapCanvasEl: el('wfMinimapCanvas'),
      zoomLabelEl: el('btnWfZoomReset'),
      statusBarEl: el('wfStatusBar'),
      getContext: () => ({
        currentRun: appState.currentRun,
        geminiModelShort: formatGeminiShort(el('selectGeminiModel').value || 'gemini-4-neon-high'),
        codexModelShort: formatCodexShort(el('selectCodexModel').value || ''),
        codexEffort: el('selectCodexEffort')?.value || 'high',
        sandbox: el('selectSandbox')?.value || 'workspace-write',
        maxRounds: el('selectMaxRounds')?.value || '2',
        approval: Boolean(el('chkApproval')?.checked),
        worktree: Boolean(el('chkWorktree')?.checked),
      }),
      onToggleSync: (key) => {
        if (key === 'approval') el('chkApproval').checked = !el('chkApproval').checked;
        else if (key === 'worktree') el('chkWorktree').checked = !el('chkWorktree').checked;
        else if (key === 'writable') {
          el('selectSandbox').value = el('selectSandbox').value === 'workspace-write' ? 'read-only' : 'workspace-write';
        }
        renderCliCommandCards();
      },
      onRunSingleNode: (node) => {
        const prompt = el('inputPrompt').value.trim();
        const modeMap = {
          'gemini-plan': 'plan-only',
          'gemini-copy': 'copy-polish',
          'codex-exec': 'codex-exec',
          'cluster-merge': 'full-pipeline',
          'codex-review': 'codex-review',
        };
        if (prompt) {
          setModeValue(modeMap[node.kind] || 'full-pipeline');
          switchStageView('chat');
          startRun();
          return true;
        }
        return false; // Fall back to single-node visual preview
      },
      onStatusChange: () => {
        syncTopbarOrb(appState.currentRun);
        if (waveEngine) waveEngine.redraw();
      },
      onToast: showToast,
    });
  }

  function switchStageView(view) {
    const next = view === 'workflow' ? 'workflow' : 'chat';
    appState.stageView = next;
    el('conversationViewport').classList.toggle('hidden', next !== 'chat');
    el('workflowStage').classList.toggle('hidden', next !== 'workflow');
    const composerDock = document.querySelector('.composer-dock');
    if (composerDock) composerDock.classList.toggle('hidden', next === 'workflow');
    closePickers();
    closePromptPalette();

    const tabs = el('stageViewTabs');
    if (tabs) {
      tabs.querySelectorAll('.stage-view-tab').forEach((b) => {
        const active = b.dataset.stageView === next;
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', String(active));
      });
    }
    requestAnimationFrame(() => {
      syncAllFluidTracks();
      if (next === 'workflow' && canvasEngine) {
        canvasEngine.render();
        if (!canvasFittedOnce) {
          canvasFittedOnce = true;
          canvasEngine.fitView(false);
        }
      }
    });
  }

  async function inspectCurrentWorkspace() {
    const dir = el('inputWorkspace').value.trim();
    const box = el('wsTelemetry');
    if (!dir) {
      el('wsShortName').textContent = '选择工作目录';
      el('wsBranchPill').textContent = '—';
      el('wsSubStatus').textContent = '点击配置目录路径';
      appState.workspaceFiles = [];
      return;
    }

    const baseName = dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || dir;
    el('wsShortName').textContent = baseName;

    try {
      const info = await api(`/api/workspace/inspect?dir=${encodeURIComponent(dir)}`);
      const bits = [];
      if (info.isGitRepo) {
        el('wsBranchPill').textContent = info.branch || 'HEAD';
        el('wsSubStatus').textContent =
          info.highRiskFiles.length > 0
            ? `${info.changedFiles.length} 变更 · ${info.highRiskFiles.length} 高危 (xhigh)`
            : `${info.changedFiles.length} 个未提交变更`;
        bits.push(`<span class="branch-flag">GIT: ${escapeHtml(info.branch)}</span>`);
        bits.push(`<span class="mono-xs">变更文件: ${info.changedFiles.length}</span>`);
        if (info.highRiskFiles.length > 0) {
          bits.push(`<span class="risk-flag">高危路径 (${info.highRiskFiles.length}) → 自动 xhigh</span>`);
        }
      } else {
        el('wsBranchPill').textContent = 'NO-GIT';
        el('wsSubStatus').textContent = `${(info.topFiles || []).length} 项文件 · 非 Git 目录`;
        bits.push('<span class="mono-xs">非 Git 目录（自动启用 --skip-git-repo-check）</span>');
      }
      box.innerHTML = bits.join('');

      const seen = new Set();
      const mentions = [];
      (info.changedFiles || []).forEach((c) => {
        if (!seen.has(c.file)) { seen.add(c.file); mentions.push({ key: c.file, detail: `Git [${c.code}]` }); }
      });
      (info.topFiles || []).forEach((f) => {
        const key = f.type === 'dir' ? `${f.name}/` : f.name;
        if (!seen.has(key)) { seen.add(key); mentions.push({ key, detail: f.type === 'dir' ? '目录' : '文件' }); }
      });
      appState.workspaceFiles = mentions;
      renderCliCommandCards();
    } catch (err) {
      el('wsBranchPill').textContent = 'ERR';
      el('wsSubStatus').textContent = err.message;
      box.innerHTML = `<span class="risk-flag">${escapeHtml(err.message)}</span>`;
      appState.workspaceFiles = [];
    }
  }

  async function loadAssets() {
    try {
      appState.assets = await api('/api/assets');
      renderAssetEditor();
      renderCliCommandCards();
    } catch (err) {
      showToast(`加载脚本与模板失败: ${err.message}`);
    }
  }

  function renderCliCommandCards() {
    const container = el('cliCommandCards');
    if (!container) return;
    const dir = el('inputWorkspace').value.trim() || 'D:\\your-project';
    const wb = appState.assets?.workbenchDir || appState.health?.workbenchDir || '.';
    const joinScript = (rel) => (wb === '.' ? rel : `${wb}\\${rel.replace(/\//g, '\\')}`);
    const gModel = el('selectGeminiModel').value || 'gemini-4-neon-high';
    const cModel = el('selectCodexModel').value;
    const rModel = el('selectCodexReviewModel').value || cModel;
    const effort = el('selectCodexEffort').value || 'high';
    const modelFlag = cModel ? ` --model ${cModel}` : '';
    const reviewModelFlag = rModel ? ` --model ${rModel}` : '';

    const items = [
      {
        title: '01 · Gemini 独立规划',
        desc: '无头只读调用 agy，输出接口契约。',
        cmd: `node "${joinScript('scripts/gemini-ask.mjs')}" --dir "${dir}" --model ${gModel} --mode plan "填入需求"`,
      },
      {
        title: '02 · Gemini 文案顾问',
        desc: '去除 AI 解释腔，输出前后对照。',
        cmd: `node "${joinScript('scripts/gemini-ask.mjs')}" --model ${gModel} --copy "待润色文案"`,
      },
      {
        title: '03 · Codex 安全沙箱施工',
        desc: 'workspace-write 沙箱，支持 --worktree / --resume。',
        cmd: `node "${joinScript('scripts/codex-worker.mjs')}" --dir "${dir}"${modelFlag} --effort ${effort} "施工契约"`,
      },
      {
        title: '04 · Pre-CI 代码审查门禁',
        desc: '分级拦截（0 通过 / 2 拦截），高危自动升 xhigh。',
        cmd: `node "${joinScript('scripts/codex-review.mjs')}" --dir "${dir}"${reviewModelFlag}`,
      },
    ];

    container.innerHTML = items
      .map(
        (item, idx) => `
        <div class="cli-item">
          <div class="cli-item-head">
            <span class="cli-item-title">${escapeHtml(item.title)}</span>
            <button type="button" class="link-btn" data-copy-cli="${idx}">复制</button>
          </div>
          <div class="cli-item-desc">${escapeHtml(item.desc)}</div>
          <pre class="cli-cmd">${escapeHtml(item.cmd)}</pre>
        </div>`
      )
      .join('');

    container.querySelectorAll('[data-copy-cli]').forEach((b) => {
      b.addEventListener('click', () => copyText(items[Number(b.dataset.copyCli)].cmd, '已复制 CLI 命令'));
    });
  }

  function renderAssetEditor() {
    if (!appState.assets) return;
    const key = appState.activeAsset;
    const isTpl = key === 'GEMINI.md' || key === 'CODEX.md';
    const editor = el('assetEditor');
    editor.value = isTpl ? appState.assets.templates[key] || '' : appState.assets.scripts[key] || '';
    editor.readOnly = !isTpl;
    el('btnSaveTemplate').classList.toggle('hidden', !isTpl);
  }

  /* =========================================================================
     Popovers, Drawers & Event Wiring
     ========================================================================= */
  function closeAllPopovers(exceptId = '') {
    ['wsPopover', 'guardrailsPopover', 'envPopover'].forEach((id) => {
      if (id !== exceptId) el(id).classList.add('hidden');
    });
    if (exceptId !== 'guardrailsPopover') {
      el('btnGuardrailsPopover').setAttribute('aria-expanded', 'false');
    }
    if (!exceptId) closePickers();
  }

  function closeMobileDrawers() {
    el('sidebar').classList.remove('is-mobile-open');
    el('studioDrawer').classList.add('hidden');
    el('drawerBackdrop').classList.add('hidden');
  }

  function toggleTweaks(forceOpen = null) {
    const panel = el('tweaksPanel');
    const willOpen = forceOpen === null ? panel.classList.contains('hidden') : forceOpen;
    panel.classList.toggle('hidden', !willOpen);
    el('btnToggleTweaks').setAttribute('aria-expanded', String(willOpen));
  }

  function bindEvents() {
    initFluidTrack(el('inspectorTabs'));
    initFluidTrack(el('stageViewTabs'));

    // Topbar View Switcher (对话流 / 节点画布) & Pipeline pills
    el('stageViewTabs')?.querySelectorAll('.stage-view-tab').forEach((btn) => {
      btn.addEventListener('click', () => switchStageView(btn.dataset.stageView));
    });
    el('topbarPipeline')?.querySelectorAll('[data-wf-node]').forEach((btn) => {
      btn.addEventListener('click', () => {
        switchStageView('workflow');
        if (canvasEngine) canvasEngine.selectKind(Number(btn.dataset.wfNode));
      });
    });

    // Blender-Style Infinite Canvas Floating HUD Controls
    document.querySelectorAll('[data-ic-add]').forEach((btn) => {
      btn.addEventListener('click', () => { if (canvasEngine) canvasEngine.addNode(btn.dataset.icAdd); });
    });
    document.querySelectorAll('[data-ic-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-ic-preset]').forEach((b) => b.classList.toggle('is-active', b === btn));
        if (canvasEngine) canvasEngine.loadPreset(btn.dataset.icPreset);
      });
    });
    el('btnWfRunAll')?.addEventListener('click', () => { if (canvasEngine) canvasEngine.runClusterDemo(); });
    el('btnWfUndo')?.addEventListener('click', () => { if (canvasEngine) canvasEngine.undo(); });
    el('btnWfReset')?.addEventListener('click', () => { if (canvasEngine) canvasEngine.resetDemo(); });
    el('btnWfExport')?.addEventListener('click', () => { if (canvasEngine) canvasEngine.exportJson(); });
    el('btnWfZoomIn')?.addEventListener('click', () => { if (canvasEngine) canvasEngine.zoomIn(); });
    el('btnWfZoomOut')?.addEventListener('click', () => { if (canvasEngine) canvasEngine.zoomOut(); });
    el('btnWfZoomReset')?.addEventListener('click', () => { if (canvasEngine) canvasEngine.resetZoom(); });
    el('btnWfFit')?.addEventListener('click', () => { if (canvasEngine) canvasEngine.fitView(true); });
    el('chkWfFailLast')?.addEventListener('change', (e) => {
      if (canvasEngine) canvasEngine.setFailLast(e.target.checked);
    });
    ['chkApproval', 'chkWorktree', 'selectSandbox', 'selectCodexEffort', 'selectCodexReviewModel', 'selectMaxRounds'].forEach((id) => {
      el(id)?.addEventListener('change', () => {
        renderCliCommandCards();
        if (appState.stageView === 'workflow') renderWorkflowCanvas();
      });
    });

    // Custom Obsidian Picker Triggers
    el('btnModePicker')?.addEventListener('click', (e) => { e.stopPropagation(); openPicker('mode'); });
    el('btnGeminiPicker')?.addEventListener('click', (e) => { e.stopPropagation(); openPicker('gemini'); });
    el('btnCodexPicker')?.addEventListener('click', (e) => { e.stopPropagation(); openPicker('codex'); });

    // Sidebar collapse & mobile toggle
    el('btnCollapseSidebar').addEventListener('click', () => {
      if (window.innerWidth <= 820) {
        closeMobileDrawers();
        return;
      }
      el('sidebar').classList.toggle('is-collapsed');
      setTimeout(() => { if (waveEngine) waveEngine.resize(); }, 240);
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 820 && el('sidebar').classList.contains('is-mobile-open')) {
        closeMobileDrawers();
      }
      document.querySelectorAll('.branch-deck-wrap').forEach((wrap) => {
        const rid = wrap.dataset.branchRun;
        const expanded = appState.currentRun?.status === 'running' ? true : Boolean(appState.branchDeckOpen.get(rid));
        const selectedId = appState.branchSelected.get(rid) || wrap.dataset.branchSelected || 'contract-gate';
        applyBranchDeckLayout(wrap, expanded, selectedId);
      });
    });

    el('btnMobileSidebar').addEventListener('click', () => {
      el('sidebar').classList.add('is-mobile-open');
      el('drawerBackdrop').classList.remove('hidden');
    });

    el('drawerBackdrop').addEventListener('click', closeMobileDrawers);
    el('btnNewChat').addEventListener('click', () => {
      closeMobileDrawers();
      switchStageView('chat');
      resetToNewChat();
      el('inputPrompt').focus();
    });

    el('inputSearchThreads').addEventListener('input', (e) => {
      appState.searchQuery = e.target.value;
      renderSidebarThreads();
    });

    // Starter copy buttons inside Ink-Orbit Bento
    document.querySelectorAll('[data-starter-mode]').forEach((card) => {
      card.addEventListener('click', () => {
        setModeValue(card.dataset.starterMode);
        const ta = el('inputPrompt');
        ta.value = card.dataset.starterPrompt;
        autoGrowTextarea(ta);
        ta.focus();
      });
    });

    // Conversation sticky bottom detector (21st.dev Conversation #46450)
    const vp = el('conversationViewport');
    vp.addEventListener('scroll', () => {
      const distFromBottom = vp.scrollHeight - vp.scrollTop - vp.clientHeight;
      appState.stickyBottom = distFromBottom < 48;
      if (appState.stickyBottom) el('btnJumpLatest').classList.add('hidden');
    });

    el('btnJumpLatest').addEventListener('click', () => {
      appState.stickyBottom = true;
      vp.scrollTop = vp.scrollHeight;
      el('btnJumpLatest').classList.add('hidden');
    });

    // Inspector toggle & tabs
    el('btnToggleInspector').addEventListener('click', () => {
      if (appState.inspectorOpen) closeInspector();
      else openInspector();
    });
    el('btnCloseInspector').addEventListener('click', closeInspector);
    el('inspectorTabs').querySelectorAll('.insp-tab').forEach((b) => {
      b.addEventListener('click', () => switchInspectorTab(b.dataset.insp));
    });

    el('btnRefreshDiff').addEventListener('click', async () => {
      const dir = appState.currentRun?.effectiveWorkDir || appState.currentRun?.workspaceDir || el('inputWorkspace').value.trim();
      if (!dir) return;
      try {
        const info = await api(`/api/workspace/diff?dir=${encodeURIComponent(dir)}`);
        if (appState.currentRun) appState.currentRun.codex.diff = info.diff || '';
        else appState.standaloneDiff = info.diff || '';
        openInspector('diff');
        showToast('已刷新 Git Diff');
      } catch (err) {
        showToast(`刷新 Diff 失败: ${err.message}`);
      }
    });

    // Popovers (Workspace, Guardrails, Environment)
    el('btnWsPopover').addEventListener('click', () => {
      const open = el('wsPopover').classList.contains('hidden');
      closeAllPopovers(open ? 'wsPopover' : '');
      el('wsPopover').classList.toggle('hidden', !open);
      if (open) el('inputWorkspace').focus();
    });
    el('btnCloseWsPopover').addEventListener('click', () => el('wsPopover').classList.add('hidden'));
    el('btnInspectWs').addEventListener('click', inspectCurrentWorkspace);
    el('inputWorkspace').addEventListener('change', () => {
      if (appState.resumeThreadId) {
        appState.resumeThreadId = '';
        el('resumeIndicator').classList.add('hidden');
      }
      inspectCurrentWorkspace();
    });

    el('btnGuardrailsPopover').addEventListener('click', () => {
      const open = el('guardrailsPopover').classList.contains('hidden');
      closeAllPopovers(open ? 'guardrailsPopover' : '');
      el('guardrailsPopover').classList.toggle('hidden', !open);
      el('btnGuardrailsPopover').setAttribute('aria-expanded', String(open));
    });

    el('btnEnvPopover').addEventListener('click', () => {
      const open = el('envPopover').classList.contains('hidden');
      closeAllPopovers(open ? 'envPopover' : '');
      el('envPopover').classList.toggle('hidden', !open);
    });
    el('btnRefreshHealth').addEventListener('click', loadHealth);
    el('btnRefreshModels').addEventListener('click', () => loadModels(true));

    // Studio Slide-Over Drawer
    el('btnOpenStudio').addEventListener('click', () => {
      closeAllPopovers();
      el('studioDrawer').classList.remove('hidden');
      el('drawerBackdrop').classList.remove('hidden');
      if (!appState.assets) loadAssets();
    });
    el('btnCloseStudio').addEventListener('click', closeMobileDrawers);

    el('assetTabs').querySelectorAll('.subtab').forEach((btn) => {
      btn.addEventListener('click', () => {
        appState.activeAsset = btn.dataset.asset;
        el('assetTabs').querySelectorAll('.subtab').forEach((b) => {
          const active = b === btn;
          b.classList.toggle('active', active);
          b.setAttribute('aria-selected', String(active));
        });
        renderAssetEditor();
      });
    });

    el('btnCopyAsset').addEventListener('click', () => copyText(el('assetEditor').value, `已复制 ${appState.activeAsset}`));
    el('btnSaveTemplate').addEventListener('click', async () => {
      try {
        await api('/api/templates', {
          method: 'POST',
          body: JSON.stringify({ filename: appState.activeAsset, content: el('assetEditor').value }),
        });
        if (appState.assets) appState.assets.templates[appState.activeAsset] = el('assetEditor').value;
        showToast(`已保存 ${appState.activeAsset}`);
      } catch (err) {
        showToast(`保存失败: ${err.message}`);
      }
    });

    // Rich Prompt Input triggers (mousedown preventDefault avoids blur race!)
    const promptTa = el('inputPrompt');
    const cancelBlur = () => {
      if (paletteBlurTimer) { clearTimeout(paletteBlurTimer); paletteBlurTimer = null; }
    };
    const bindTrigger = (id, ch) => {
      const b = el(id);
      b.addEventListener('mousedown', (e) => { e.preventDefault(); cancelBlur(); });
      b.addEventListener('click', () => { cancelBlur(); insertTriggerChar(ch); });
    };
    bindTrigger('btnTriggerSlash', '/');
    bindTrigger('btnTriggerMention', '@');

    promptTa.addEventListener('input', () => {
      cancelBlur();
      autoGrowTextarea(promptTa);
      evaluatePromptTrigger();
    });

    promptTa.addEventListener('keydown', (e) => {
      if (appState.palette.open) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          appState.palette.selectedIdx = (appState.palette.selectedIdx + 1) % appState.palette.items.length;
          renderPromptPalette();
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          appState.palette.selectedIdx = (appState.palette.selectedIdx - 1 + appState.palette.items.length) % appState.palette.items.length;
          renderPromptPalette();
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          applyPaletteItem(appState.palette.selectedIdx);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          closePromptPalette();
          return;
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        startRun();
      }
    });

    promptTa.addEventListener('blur', () => {
      cancelBlur();
      paletteBlurTimer = setTimeout(() => { paletteBlurTimer = null; closePromptPalette(); }, 150);
    });

    el('btnStartRun').addEventListener('click', () => {
      if (appState.stageView === 'workflow') switchStageView('chat');
      startRun();
    });
    el('btnQuickPlan').addEventListener('click', () => {
      setModeValue('plan-only');
      showToast('已切换为「Gemini 独立规划」模式');
      el('inputPrompt').focus();
    });
    el('btnCancelRun').addEventListener('click', async () => {
      if (!appState.currentRun) return;
      try {
        await api(`/api/runs/${encodeURIComponent(appState.currentRun.id)}/cancel`, { method: 'POST' });
        showToast('已发送中止指令');
      } catch (err) {
        showToast(`中止失败: ${err.message}`);
      }
    });

    el('btnClearResume').addEventListener('click', () => {
      appState.resumeThreadId = '';
      el('resumeIndicator').classList.add('hidden');
    });

    // Tweaks Panel
    el('btnToggleTweaks').addEventListener('click', () => toggleTweaks());
    el('btnCloseTweaks').addEventListener('click', () => toggleTweaks(false));

    document.querySelectorAll('.tweak-pills').forEach((group) => {
      const key = group.dataset.tweak;
      group.querySelectorAll('button').forEach((btn) => {
        btn.addEventListener('click', () => {
          appState.tweaks[key] = btn.dataset.val;
          applyTweaks();
          saveTweaks();
        });
      });
    });

    el('tweakFontRange').addEventListener('input', (e) => {
      appState.tweaks.fontSize = Number(e.target.value);
      applyTweaks();
      saveTweaks();
    });
    el('tweakWaveRange').addEventListener('input', (e) => {
      appState.tweaks.waveAmplitude = Number(e.target.value);
      applyTweaks();
      saveTweaks();
    });
    el('tweakCrosshairs').addEventListener('change', (e) => {
      appState.tweaks.crosshairs = e.target.checked;
      applyTweaks();
      saveTweaks();
    });
    el('tweakHatch').addEventListener('change', (e) => {
      appState.tweaks.hatch = e.target.checked;
      applyTweaks();
      saveTweaks();
    });
    el('tweakMotion').addEventListener('change', (e) => {
      appState.tweaks.motion = e.target.checked;
      applyTweaks();
      if (inkDiagrams) inkDiagrams.sync();
      saveTweaks();
    });
    el('btnResetTweaks').addEventListener('click', () => {
      appState.tweaks = { ...DEFAULT_TWEAKS };
      applyTweaks();
      saveTweaks();
      showToast('已恢复 DeepBook 默认参数');
    });

    // Global Keyboard & Outside-Click Dismiss
    document.addEventListener('keydown', (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (e.key === 'Escape') {
        toggleTweaks(false);
        closeAllPopovers();
        closePickers();
        closePromptPalette();
        closeMobileDrawers();
      } else if (
        (e.key === 't' || e.key === 'T') &&
        !e.ctrlKey && !e.metaKey && !e.altKey &&
        !['input', 'textarea', 'select'].includes(tag)
      ) {
        toggleTweaks();
      }
    });

    document.addEventListener('click', (e) => {
      const pairs = [
        ['wsPopover', 'btnWsPopover'],
        ['guardrailsPopover', 'btnGuardrailsPopover'],
        ['envPopover', 'btnEnvPopover'],
      ];
      pairs.forEach(([popId, btnId]) => {
        const pop = el(popId);
        const btn = el(btnId);
        if (!pop.classList.contains('hidden') && !pop.contains(e.target) && !btn.contains(e.target)) {
          pop.classList.add('hidden');
          if (btnId === 'btnGuardrailsPopover') btn.setAttribute('aria-expanded', 'false');
        }
      });

      if (appState.activePicker) {
        const pickerMap = {
          mode: ['menuModePicker', 'btnModePicker'],
          gemini: ['menuGeminiPicker', 'btnGeminiPicker'],
          codex: ['menuCodexPicker', 'btnCodexPicker'],
        };
        const pair = pickerMap[appState.activePicker];
        if (pair) {
          const menu = el(pair[0]);
          const btn = el(pair[1]);
          if (menu && btn && !menu.contains(e.target) && !btn.contains(e.target)) {
            closePickers();
          }
        }
      }
    });
  }

  // Bootstrap
  let inkDiagrams = null;
  applyTweaks();
  bindEvents();
  waveEngine = initWaveEngine();
  inkDiagrams = initInkOrbitDiagrams();
  canvasEngine = initInfiniteWorkflowCanvas();
  if (window.ConduitMetalFx) metalEngine = window.ConduitMetalFx.init();
  if (window.ConduitOrbs) window.ConduitOrbs.mountAll(document);
  setModeValue('full-pipeline');
  initGlobalEvents();
  loadHealth();
  loadModels(false);
  loadRunsList();
})();
