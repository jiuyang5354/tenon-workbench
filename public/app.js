(() => {
  'use strict';

  const MODE_LABELS = {
    'agent-chat': '自由对话',
    'full-pipeline': '全链路协同',
    'plan-only': '独立规划',
    'codex-exec': 'Codex 直派',
    'codex-review': '审查门禁',
    'copy-polish': '文案顾问',
    'custom-agent': '外部 Agent / API',
    'image-gen': '图像生成',
    'video-gen': '视频渲染',
  };

  const MODE_SHORT = {
    'agent-chat': '自由对话',
    'full-pipeline': '全链路',
    'plan-only': '独立规划',
    'codex-exec': 'Codex直派',
    'codex-review': '审查门禁',
    'copy-polish': '文案顾问',
    'custom-agent': '外部Agent',
    'image-gen': '图像输出',
    'video-gen': '视频输出',
  };

  const MODE_ITEMS = [
    { id: 'agent-chat', title: '自由对话', sub: '像日常 Agent 一样直接多轮聊天，不启动巡检与审批流', badge: '默认' },
    { id: 'full-pipeline', title: '全链路协同', sub: '规划引擎拆解 → 人工拍板 → Codex 施工 → Pre-CI 审查', badge: '工程流' },
    { id: 'plan-only', title: '独立规划', sub: '仅只读拆解架构与接口契约（支持切换外部模型）', badge: '只读' },
    { id: 'codex-exec', title: 'Codex 直派', sub: '跳过规划，安全沙箱直接写代码（支持会话续跑）', badge: '沙箱' },
    { id: 'codex-review', title: 'Pre-CI 审查门禁', sub: '两级分级拦截，高危路径自动升档 xhigh', badge: '门禁' },
    { id: 'custom-agent', title: '外部 Agent / API 直连', sub: '直连已接入的 Claude Code / Ollama / DeepSeek / OpenRouter / 自定义 CLI', badge: 'EXT' },
    { id: 'copy-polish', title: '文案与交互顾问', sub: '去 AI 味润色，输出前后对比表', badge: '润色' },
    { id: 'image-gen', title: '图像输出与变体', sub: '渐进扫描揭示 · 4 组变体对比 · 放大 / 变体 / Lightbox', badge: 'IMG' },
    { id: 'video-gen', title: '视频渲染与播放', sub: '帧渐进揭示 · 悬浮自隐藏播放器 · 帧级拖拽 / 下载', badge: 'VID' },
  ];

  const SLASH_COMMANDS = [
    { key: '/chat', mode: 'agent-chat', detail: '自由对话（像普通 Agent 一样自然多轮聊天，无冗余巡检）' },
    { key: '/pipeline', mode: 'full-pipeline', detail: '全链路协同（Gemini/外部规划 → 拍板 → Codex 施工 → 审查）' },
    { key: '/plan', mode: 'plan-only', detail: '独立规划（只读拆解契约）' },
    { key: '/codex', mode: 'codex-exec', detail: 'Codex 直派（安全沙箱直接写代码）' },
    { key: '/review', mode: 'codex-review', detail: 'Pre-CI 审查门禁（分级拦截 + 自动升 xhigh）' },
    { key: '/agent', mode: 'custom-agent', detail: '外部 Agent / API 直连（Claude Code / Ollama / DeepSeek / 自定义 CLI）' },
    { key: '/copy', mode: 'copy-polish', detail: '文案与交互顾问' },
    { key: '/image', mode: 'image-gen', detail: '图像输出（多变体渐进渲染、放大、参考图与 Lightbox）' },
    { key: '/video', mode: 'video-gen', detail: '视频渲染（渐进海报揭示、自定义浮动控制栏播放器）' },
  ];

  const DEFAULT_TWEAKS = {
    surface: 'weave',
    accent: 'lime',
    inspector: 'standard',
    chatWidth: 'wide',
    canvasScale: '2',
    canvasGrid: 'dots',
    fontSize: 14,
    waveAmplitude: 55,
    crosshairs: false,
    hatch: false,
    motion: true,
  };

  const appState = {
    health: null,
    models: { agy: { models: [] }, codex: [], providers: [] },
    providers: [],
    localAgents: { clis: [], services: [] },
    providerPresets: [],
    updateInfo: null,
    updateChecking: false,
    updatePollTimer: null,
    updatePollInFlight: false,
    autoCheckUpdates: (() => {
      try { return localStorage.getItem('tenon_auto_check_updates') !== '0'; } catch { return true; }
    })(),
    customCodexModels: [],
    assets: null,
    runs: [],
    searchQuery: '',
    workspaceFiles: [],
    discoveredWorkspaces: [],
    discoveredSummary: null,
    wsDiscoverFilter: 'all',
    wsDiscovering: false,
    wsDiscoverError: '',
    activeAsset: 'GEMINI.md',
    stageView: 'chat',
    lastWorkView: 'chat',
    settingsSection: 'appearance',
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
    globalStreamReconnectTimer: null,
    openRunSeq: 0,
    resumeThreadId: '',
    resumeRunId: '',
    stickyBottom: true,
    gateDirtyText: null,
    treeGroupOpen: new Map(), // key -> boolean (manual override)
    treeRowOpen: new Set(),   // key -> expanded row
    chatTraceOpen: new Map(), // msgId -> boolean (manual override)
    chatToolOpen: new Set(),  // msgId:traceId -> expanded tool detail
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
    contextChips: [],
    localRuns: new Map(),
    orbPaused: false,
    orbPreviewState: null,
    orbDemoTimers: [],
    catchUpOpen: new Map(),
    tweaks: loadTweaks(),
  };

  let waveEngine = null;
  let canvasEngine = null;
  let effortSlider = null;
  let workspacePanels = null;
  let canvasFittedOnce = false;
  let paletteBlurTimer = null;
  let reclampPanesFn = () => {};
  const el = (id) => document.getElementById(id);

  function loadTweaks() {
    try {
      const saved = JSON.parse(localStorage.getItem('conduit_tweaks_v7') || 'null');
      return saved ? { ...DEFAULT_TWEAKS, ...saved } : { ...DEFAULT_TWEAKS };
    } catch {
      return { ...DEFAULT_TWEAKS };
    }
  }

  function saveTweaks() {
    try {
      localStorage.setItem('conduit_tweaks_v7', JSON.stringify(appState.tweaks));
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
    root.dataset.chatWidth = String(t.chatWidth || 'wide');
    root.dataset.canvasScale = String(t.canvasScale || '2');
    root.dataset.canvasGrid = String(t.canvasGrid || 'dots');
    root.dataset.crosshairs = t.crosshairs ? 'on' : 'off';
    root.dataset.hatch = t.hatch ? 'on' : 'off';
    root.dataset.motion = t.motion ? 'on' : 'off';
    root.style.setProperty('--base-font-size', `${t.fontSize}px`);

    if (window.TenonDesktop?.isDesktopApp) {
      root.dataset.desktop = 'electron';
      root.dataset.platform = window.TenonDesktop.platform || '';
      window.TenonDesktop.setTitleBarTheme?.(t.surface);
    }

    const isDark = t.surface === 'charcoal';
    const ttBtn = el('btnThemeToggle');
    if (ttBtn) {
      ttBtn.dataset.themeMode = isDark ? 'dark' : 'light';
      ttBtn.setAttribute('aria-pressed', String(isDark));
      const lbl = el('themeToggleLabel');
      if (lbl) lbl.textContent = isDark ? '暗房' : '白昼';
    }
    const gridBtn = el('btnWfGridCycle');
    if (gridBtn) {
      const gLabels = { dots: '底纹: 点阵', grid: '底纹: 细格', solid: '底纹: 纯色' };
      gridBtn.textContent = gLabels[t.canvasGrid || 'dots'] || '底纹: 点阵';
    }

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
        btn.classList.toggle('active', btn.dataset.val === String(t[key]));
      });
    });

    if (waveEngine) waveEngine.sync();
    if (canvasEngine) canvasEngine.render();
    if (effortSlider) effortSlider.syncTheme();
    if (window.ConduitOrbs) window.ConduitOrbs.syncAll();
    requestAnimationFrame(syncAllFluidTracks);
  }

  /** One-Click Light/Dark Theme Toggle with optional organic View Transition reveal (21st.dev #37503) */
  function toggleLightDarkTheme(ev) {
    const nextSurface = appState.tweaks.surface === 'charcoal' ? 'weave' : 'charcoal';
    const commit = () => {
      appState.tweaks.surface = nextSurface;
      applyTweaks();
      saveTweaks();
    };
    const motionOk =
      appState.tweaks.motion &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
      typeof document.startViewTransition === 'function';
    if (!motionOk) {
      commit();
      showToast(nextSurface === 'charcoal' ? '已切换至建筑暗房主题' : '已切换至建筑白昼主题');
      return;
    }
    const x = ev && Number.isFinite(ev.clientX) ? ev.clientX : window.innerWidth - 160;
    const y = ev && Number.isFinite(ev.clientY) ? ev.clientY : 24;
    const maxR = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    document.documentElement.style.setProperty('--tt-x', `${Math.round(x)}px`);
    document.documentElement.style.setProperty('--tt-y', `${Math.round(y)}px`);
    document.documentElement.style.setProperty('--tt-r', `${Math.ceil(maxR)}px`);
    const vt = document.startViewTransition(commit);
    vt.finished.finally(() => {
      showToast(nextSurface === 'charcoal' ? '已切换至建筑暗房主题' : '已切换至建筑白昼主题');
    });
  }

  const TOAST_ICONS = {
    success: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="m8.5 12.5 2.4 2.4 4.8-5.2"/></svg>',
    info: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="M12 16v-4"/><circle cx="12" cy="8.2" r="0.6" fill="currentColor" stroke="none"/></svg>',
    warning: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m10.3 3.8-7.4 13A2 2 0 0 0 4.6 20h14.8a2 2 0 0 0 1.7-3.2l-7.4-13a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4.5"/><circle cx="12" cy="16.6" r="0.6" fill="currentColor" stroke="none"/></svg>',
    error: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="M12 8v4.5"/><circle cx="12" cy="16" r="0.6" fill="currentColor" stroke="none"/></svg>',
  };

  function inferToastVariant(msg) {
    const s = String(msg || '');
    if (/失败|错误|拦截|拒绝|异常/.test(s)) return 'error';
    if (/警告|高危|中止|停止|注意|取消/.test(s)) return 'warning';
    if (/已保存|已复制|已完成|已恢复|已激活|已切换|已刷新|已写入|已新建|已附加|放行|通过/.test(s)) return 'success';
    return 'info';
  }

  function showToast(message, opts = {}) {
    const rack = el('toastRack');
    if (!rack) return;
    const isObj = message && typeof message === 'object';
    const rawText = isObj ? (message.title || '') : String(message || '');
    const variant = (isObj ? message.variant : opts.variant) || inferToastVariant(rawText);
    const title = isObj ? message.title : rawText;
    const body = isObj ? (message.body || '') : (opts.body || '');

    const node = document.createElement('div');
    node.className = `toast is-${variant}`;
    node.setAttribute('role', 'status');
    node.innerHTML = `
      <span class="toast-ico" aria-hidden="true">${TOAST_ICONS[variant] || TOAST_ICONS.info}</span>
      <div class="toast-copy">
        <span class="toast-title">${escapeHtml(title)}</span>
        ${body ? `<span class="toast-body">${escapeHtml(body)}</span>` : ''}
      </div>
      <button type="button" class="toast-close" aria-label="关闭通知">
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>
      </button>`;

    let removed = false;
    const dismiss = () => {
      if (removed) return;
      removed = true;
      node.classList.add('is-leaving');
      setTimeout(() => node.remove(), 160);
    };
    node.querySelector('.toast-close')?.addEventListener('click', dismiss);

    while (rack.children.length >= 4) rack.firstElementChild?.remove();
    rack.appendChild(node);
    setTimeout(dismiss, 3400);
  }

  function stripPreferenceTag(str) {
    return String(str || '')
      .replace(/\s*\[(?:用户偏好风格|附加参考上下文):[\s\S]*?(?:\]|$)/g, ' ')
      .replace(/…+$/g, '')
      .trim();
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
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
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

          if (/^-{3,}$/.test(trimmed)) { closeList(); html.push('<hr class="md-hr" />'); }
          else if (/^###\s+/.test(trimmed)) { closeList(); html.push(`<h3>${formatInline(trimmed.slice(4))}</h3>`); }
          else if (/^##\s+/.test(trimmed)) { closeList(); html.push(`<h2>${formatInline(trimmed.slice(3))}</h2>`); }
          else if (/^#\s+/.test(trimmed)) { closeList(); html.push(`<h1>${formatInline(trimmed.slice(2))}</h1>`); }
          else if (/^&gt;\s+/.test(trimmed)) { closeList(); html.push(`<blockquote>${formatInline(trimmed.slice(5))}</blockquote>`); }
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
    const flowMount = el('inkFlowSvgMount');
    const hubMountEarly = el('inkHubSvgMount');
    const chartMountEarly = el('inkChartSvgMount');
    if (!flowMount && !hubMountEarly && !chartMountEarly) {
      return { sync: () => {} };
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // 1. Live Flow Diagram (Gemini Orchestrator Cluster -> CONDUIT Hub -> Codex Report Stack)
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
        <svg class="ib-diagram" viewBox="0 0 300 156" role="group" aria-label="本地 CLI 集成矩阵">
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
          <text x="150" y="148" text-anchor="middle" font-size="7.5" fill="var(--ink-muted)" font-family="var(--font-mono)">
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
          else { closeAllPopovers(); switchStageView('settings', 'env'); }
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
      const saved = localStorage.getItem('conduit_viz_mode_v2');
      if (saved && COUNTS[saved]) variant = saved;
    } catch {}

    let tSec = 0;
    let lastTs = 0;
    let rafId = null;
    let hoverNorm = -1; // 0..1 across canvas when pointer hovers
    let hoverEnergy = 0;
    let values = new Array(COUNTS[variant]).fill(0);
    let colors = { accent: '#111315', warn: '#b45309', tick: '#c8cfd6', rest: 'rgba(17,19,21,0.08)' };
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
      try { localStorage.setItem('conduit_viz_mode_v2', variant); } catch {}
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
        accent: cs.getPropertyValue('--ink-primary').trim() || '#111315',
        warn: cs.getPropertyValue('--state-warn').trim() || '#b45309',
        tick: cs.getPropertyValue('--line-strong').trim() || '#c8cfd6',
        rest: cs.getPropertyValue('--line-subtle').trim() || 'rgba(17,19,21,0.08)',
      };
    }

    function sizeCanvas() {
      if (!miniCanvas) return;
      const rect = miniCanvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const userScale = Number(document.documentElement.dataset.canvasScale || 2);
      const dpr = Math.min(3, Math.max(window.devicePixelRatio || 1, userScale));
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
  function closeActiveStream() {
    if (appState.activeStream) {
      try { appState.activeStream.close(); } catch {}
      appState.activeStream = null;
    }
  }

  function clearResumeState() {
    appState.resumeThreadId = '';
    appState.resumeRunId = '';
    el('resumeIndicator')?.classList.add('hidden');
  }

  async function openRunById(id) {
    const reqSeq = ++appState.openRunSeq;
    if (appState.resumeRunId && appState.resumeRunId !== id) {
      clearResumeState();
    }
    if (appState.localRuns.has(id)) {
      closeActiveStream();
      const localRun = appState.localRuns.get(id);
      closeMobileDrawers();
      switchStageView('chat');
      appState.currentRun = localRun;
      renderSidebarThreads();
      renderConversationThread(localRun);
      return;
    }
    try {
      const { run } = await api(`/api/runs/${encodeURIComponent(id)}`);
      if (reqSeq !== appState.openRunSeq) return;
      closeMobileDrawers();
      switchStageView('chat');
      if (run.mode === 'agent-chat') setModeValue('agent-chat');
      attachToRun(run);
    } catch (err) {
      if (reqSeq !== appState.openRunSeq) return;
      showToast(`载入会话失败: ${err.message}`);
    }
  }

  async function loadRunsList() {
    try {
      const { runs } = await api('/api/runs');
      const locals = Array.from(appState.localRuns.values()).map((r) => ({
        id: r.id,
        title: r.title,
        mode: r.mode,
        status: r.status,
        pinned: Boolean(r.pinned),
        createdAt: r.createdAt,
      }));
      appState.runs = [...locals, ...(runs || [])];
      renderSidebarThreads();
      if (appState.inspectorOpen && appState.inspectorTab === 'runs') {
        renderAgentRunsMonitor(el('inspectorRunsBox'));
      }
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
            const cleanTitle = stripPreferenceTag(r.title) || '新协同会话';
            return `
              <div class="thread-row ${active ? 'active' : ''}" data-thread-id="${escapeHtml(r.id)}" title="${escapeHtml(cleanTitle)}">
                <span class="thread-dot ${escapeHtml(r.status)}"></span>
                <div class="thread-info sidebar-label">
                  <span class="thread-title">${escapeHtml(cleanTitle)}</span>
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
      row.addEventListener('click', (e) => {
        if (e.target.closest('.thread-act-btn')) return;
        openRunById(row.dataset.threadId);
      });
    });

    container.querySelectorAll('.thread-act-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const act = btn.dataset.act;
        const item = appState.runs.find((x) => x.id === id);
        if (!item) return;

        if (appState.localRuns.has(id)) {
          const local = appState.localRuns.get(id);
          if (act === 'pin') {
            local.pinned = !local.pinned;
            item.pinned = local.pinned;
            renderSidebarThreads();
          } else if (act === 'rename') {
            const nextTitle = window.prompt('输入新的会话标题：', item.title);
            if (nextTitle && nextTitle.trim()) {
              local.title = nextTitle.trim();
              item.title = local.title;
              if (appState.currentRun?.id === id) el('topbarTitle').textContent = local.title;
              renderSidebarThreads();
            }
          } else if (act === 'delete') {
            local.mediaJob?._cancel?.();
            if (local.mediaJob?.src && String(local.mediaJob.src).startsWith('blob:')) {
              try { URL.revokeObjectURL(local.mediaJob.src); } catch {}
            }
            appState.localRuns.delete(id);
            appState.runs = appState.runs.filter((x) => x.id !== id);
            if (appState.currentRun?.id === id) resetToNewChat();
            renderSidebarThreads();
            showToast('已删除该媒体会话');
          }
          return;
        }

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
    appState.openRunSeq += 1;
    closeActiveStream();
    clearResumeState();
    appState.currentRun = null;
    appState.gateDirtyText = null;
    el('welcomeStage').classList.remove('hidden');
    el('threadMessages').classList.add('hidden');
    el('threadMessages').innerHTML = '';
    el('topbarTitle').textContent = '新协同会话';
    el('topbarMeta').textContent = 'TENON · MULTI-AGENT WORKBENCH';
    el('btnCancelRun').classList.add('hidden');
    el('sendCtaGroup').classList.remove('hidden');
    el('composerShell').classList.remove('is-streaming');
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

    const hasDraft = Boolean((el('inputPrompt')?.value || '').trim());
    let aiState = 'idle';
    let cls = '';

    if (appState.orbPreviewState) {
      aiState = appState.orbPreviewState;
      if (aiState === 'waiting-approval') cls = 'is-gate';
      else if (aiState === 'error') cls = 'is-err';
      else if (aiState === 'done') cls = 'is-done';
      else if (aiState !== 'idle' && aiState !== 'listening') cls = 'is-live';
    } else if (run) {
      if (run.status === 'running') {
        cls = 'is-live';
        if (run.activeStage === 'exec') aiState = 'streaming';
        else if (run.activeStage === 'review') aiState = 'tool-call';
        else if (run.activeStage === 'summary') aiState = 'tool-result';
        else aiState = 'reasoning';
      } else if (run.status === 'awaiting_approval') {
        aiState = 'waiting-approval';
        cls = 'is-gate';
      } else if (run.status === 'completed') {
        aiState = hasDraft ? 'listening' : 'done';
        cls = 'is-done';
      } else if (run.status === 'failed' || run.status === 'blocked') {
        aiState = 'error';
        cls = 'is-err';
      }
    } else if (hasDraft) {
      aiState = 'listening';
    }

    const paused = Boolean(appState.orbPaused);
    wrap.classList.remove('is-live', 'is-gate', 'is-done', 'is-err');
    if (cls) wrap.classList.add(cls);
    wrap.dataset.aiState = aiState;
    if (window.ConduitOrbs?.applyAiOrbState) {
      const label = window.ConduitOrbs.AI_ORB_LABELS[aiState] || aiState;
      const hint = window.ConduitOrbs.AI_ORB_HINTS?.[aiState] || '';
      const v = window.ConduitOrbs.AI_ORB_VISUALS[aiState] || window.ConduitOrbs.AI_ORB_VISUALS.idle;
      window.ConduitOrbs.applyAiOrbState(orb, aiState, { settleMs: 5000, forcePaused: paused });
      wrap.title = `对话流信号：${label} (${aiState})${paused ? ' · 已暂停' : ''}`;
      const compOrb = el('composerOrb');
      const compBtn = el('btnQuickPlan');
      if (compOrb) {
        window.ConduitOrbs.applyAiOrbState(compOrb, aiState, { settleMs: 5000, forcePaused: paused });
        if (compBtn) {
          compBtn.dataset.aiState = aiState;
          compBtn.dataset.aiTone = v.tone;
          compBtn.classList.toggle('is-paused', paused);
          compBtn.title = `对话流实时信号：${label} (${aiState})${paused ? ' [已暂停]' : ''} — 点击展开控制`;
        }
      }
      const cancelOrb = el('cancelRunOrb');
      const cancelBtn = el('btnCancelRun');
      const cancelLbl = el('cancelRunLabel');
      if (cancelOrb) {
        window.ConduitOrbs.applyAiOrbState(cancelOrb, aiState, { settleMs: 0, forcePaused: paused });
        if (cancelBtn) {
          cancelBtn.dataset.aiState = aiState;
          cancelBtn.dataset.aiTone = v.tone;
          cancelBtn.title = `${label} (${aiState}) · 点击立即停止当前协同`;
        }
        if (cancelLbl) cancelLbl.textContent = label;
      }
      // Keep anchored Composer Orb Popover synced whenever visible
      const pop = el('composerOrbPopover');
      if (pop && !pop.classList.contains('hidden')) {
        syncComposerOrbPopover(aiState, label, hint, v.tone);
      }
    }
  }

  function clearOrbDemoTimers() {
    (appState.orbDemoTimers || []).forEach(clearTimeout);
    appState.orbDemoTimers = [];
  }

  function syncComposerOrbPopover(aiState, label, hint, tone) {
    const heroSvg = el('orbPopHeroSvg');
    const heroTile = el('orbPopHeroTile');
    const titleEl = el('orbPopTitle');
    const codeEl = el('orbPopCode');
    const hintEl = el('orbPopHint');
    const primaryBtn = el('btnOrbPopPrimary');
    const pauseBtn = el('btnOrbPopPause');
    const isRunActive = Boolean(appState.currentRun && (appState.currentRun.status === 'running' || appState.currentRun.status === 'awaiting_approval'));
    if (heroTile) heroTile.dataset.aiTone = tone || 'primary';
    if (heroSvg && window.ConduitOrbs?.applyAiOrbState) {
      window.ConduitOrbs.applyAiOrbState(heroSvg, aiState, { settleMs: 60000, forcePaused: appState.orbPaused });
    }
    if (titleEl) titleEl.textContent = appState.orbPaused ? `${label}（已暂停）` : label;
    if (codeEl) codeEl.textContent = aiState;
    if (hintEl) hintEl.textContent = hint;
    if (primaryBtn) primaryBtn.textContent = isRunActive ? '停止当前协同' : '启动协同';
    if (pauseBtn) pauseBtn.textContent = appState.orbPaused ? '恢复信号' : '暂停信号';
    const grid = el('orbPopStatesGrid');
    if (grid) {
      grid.querySelectorAll('[data-orb-pick]').forEach((b) => {
        b.classList.toggle('is-active', b.dataset.orbPick === aiState);
      });
    }
  }

  function renderComposerOrbPopoverGrid() {
    const grid = el('orbPopStatesGrid');
    if (!grid || !window.ConduitOrbs) return;
    if (grid.dataset.built === '1') return;
    grid.dataset.built = '1';
    grid.innerHTML = window.ConduitOrbs.AI_ORB_STATES.map((st) => {
      const v = window.ConduitOrbs.AI_ORB_VISUALS[st];
      const lbl = window.ConduitOrbs.AI_ORB_LABELS[st] || st;
      return `
        <button type="button" class="orb-pop-cell" data-orb-pick="${st}" title="${escapeHtml(lbl)} (${st})">
          <span class="orb-pop-mini-tile" data-ai-tone="${v.tone}">
            <svg class="thinking-orb" width="28" height="28" viewBox="0 0 28 28" data-orb-family="ai" data-orb-state="${v.geom}" data-orb-variant="ai" data-orb-size="28" data-orb-speed="${v.speed}" data-orb-paused="${v.paused ? '1' : '0'}"></svg>
          </span>
          <span class="mono-xs orb-pop-cell-name">${st}</span>
        </button>`;
    }).join('');
    window.ConduitOrbs.mountAll(grid);
    grid.querySelectorAll('[data-orb-pick]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        clearOrbDemoTimers();
        const picked = btn.dataset.orbPick;
        appState.orbPaused = false;
        appState.orbPreviewState = picked === 'idle' && !appState.currentRun ? null : picked;
        syncTopbarOrb(appState.currentRun);
      });
    });
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
   * Renders the Dialogue Stream Chain-of-Thought & Tool Activity Tree:
   * - Single continuous SVG trunk (x=12.5) with curved Q elbows per row
   * - Displays readable inline Chain-of-Thought reasoning steps + live tool/command activity
   * - Uses live miniature AiOrb icons for active steps; zero clipped pills
   */
  function renderToolTraceHtml(events, sourceFilter, isWorking, groupId, runCtx = null) {
    const rawItems = (events || []).filter((e) => {
      if (sourceFilter && e.source !== sourceFilter) return false;
      return ['command', 'file_change', 'reasoning', 'step', 'stage', 'worktree'].includes(e.kind);
    });

    // Ensure rich, transparent Chain-of-Thought steps are visible even before CLI tool calls emit
    const items = [...rawItems];
    const hasReasoning = items.some((e) => e.kind === 'reasoning');
    if (!hasReasoning && (isWorking || items.length > 0)) {
      const modelName =
        sourceFilter === 'codex'
          ? (runCtx?.config?.codexModel || 'Codex 默认模型')
          : (runCtx?.config?.geminiModel || 'gemini-4-neon-high');
      const scopeHint = appState.workspaceFiles?.length
        ? `已挂载工作区上下文（${appState.workspaceFiles.length} 个文件）`
        : '已接入当前工程工作区';
      items.push({
        kind: 'reasoning',
        source: sourceFilter,
        text:
          sourceFilter === 'codex'
            ? `基于已锁定接口契约在受管沙箱（${runCtx?.config?.sandbox || 'workspace-write'}）中规划代码改动与边界单测，准备捕获完整 Git Diff。`
            : `使用 ${modelName} 进行需求意图拆解：${scopeHint}，正在权衡最小变更路径、接口边界与验收标准。`,
        synthetic: true,
      });
      if (isWorking) {
        items.push({
          kind: 'step',
          source: sourceFilter,
          stepType: sourceFilter === 'codex' ? '沙箱实现与语法单测验证' : '整理结构化结论与执行方案',
          state: 'running',
          synthetic: true,
        });
      }
    }
    if (items.length === 0) return '';

    const shown = items.slice(-16);
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
    if (thoughts > 0) segs.push(`${thoughts} 步推理`);
    if (cmds > 0) segs.push(`${cmds} 条命令`);
    if (edits > 0) segs.push(`${edits} 处文件`);
    if (failedCount > 0) segs.push(`${failedCount} 项失败`);
    const summaryText = isWorking
      ? `思维链 · 正在推演（${segs.join(' · ') || '实时调度'}）`
      : `思维链 · ${segs.join(' · ') || `已完成 ${shown.length} 步`}`;

    const isOpen = appState.treeGroupOpen.has(groupId)
      ? appState.treeGroupOpen.get(groupId)
      : isWorking || hasReasoning;

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
        let inlineProse = '';
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
          verb = '思考';
          pill = '';
          inlineProse = String(ev.text || '').trim();
          bodyHtml = '';
        } else if (ev.kind === 'step') {
          verb = '步骤';
          pill = `${ev.stepType || 'step'}${ev.state ? ` · ${ev.state}` : ''}`;
          bodyHtml = `<div class="tree-thought-body">${escapeHtml(pill)}</div>`;
        } else {
          verb = ev.kind === 'worktree' ? 'Worktree' : 'Stage';
          pill = String(ev.text || '').trim();
          bodyHtml = `<div class="tree-thought-body">${escapeHtml(ev.text || '')}</div>`;
        }

        const continues = !last || rowOpen;
        const railSvg = `
          <svg class="tree-rail-svg" width="28" height="32" aria-hidden="true">
            <line x1="12.5" y1="${first ? -10 : 0}" x2="12.5" y2="10" stroke-width="1" class="tree-rail-stroke" />
            <path d="M12.5 10 Q12.5 16 18.5 16 H28" fill="none" stroke-width="1" class="tree-rail-stroke" />
            ${continues ? '<line x1="12.5" y1="10" x2="12.5" y2="100%" stroke-width="1" class="tree-rail-stroke" />' : ''}
          </svg>`;

        const activeGeom = ev.kind === 'command' ? 'ai-searching' : ev.kind === 'file_change' ? 'ai-connecting' : 'ai-solving';
        return `
          <div class="tree-row ${failed ? 'is-failed' : ''} ${rowOpen ? 'is-row-open' : ''} ${inlineProse ? 'is-thought-row' : ''}">
            ${railSvg}
            <span class="tree-row-icon ${isRowActive ? 'is-live-orb' : ''}" aria-hidden="true">
              ${
                isRowActive
                  ? `<svg class="thinking-orb" width="16" height="16" viewBox="0 0 16 16" data-orb-family="ai" data-orb-state="${activeGeom}" data-orb-variant="ai" data-orb-size="16" aria-hidden="true"></svg>`
                  : treeGlyphSvg(ev.kind)
              }
            </span>
            ${
              inlineProse
                ? `<div class="cot-thought-inline"><span class="tree-row-verb">${escapeHtml(verb)}</span><p class="cot-thought-text">${escapeHtml(inlineProse)}</p></div>`
                : `<button type="button" class="tree-row-btn" data-tree-row="${escapeHtml(rowKey)}" aria-expanded="${rowOpen}" title="${escapeHtml(pill || verb)}">
                    <span class="tree-row-verb">${escapeHtml(verb)}</span>
                    ${pill ? `<span class="tree-pill">${escapeHtml(pill)}</span>` : ''}
                    ${badge}
                    <span class="tree-row-caret">${rowOpen ? '▾' : '▸'}</span>
                  </button>
                  <div class="tree-row-fold">
                    <div class="tree-row-fold-inner">${bodyHtml}</div>
                  </div>`
            }
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

  /* =========================================================================
     chatcn Middle Card: 4-Phase Research & Pipeline Progress Card
     chatcn Left Card:   Catch up (前情提要 · 关键决策 · 待决问题)
     ========================================================================= */
  function renderResearchProgressCard(run) {
    const g = run.gemini || {};
    const c = run.codex || {};
    const cleanTitle = stripPreferenceTag(run.title || run.prompt) || '双模型协同调研与交付';
    const totalMs = (g.durationMs || 0) + (c.durationMs || 0);
    const totalSec = totalMs > 0 ? `${(totalMs / 1000).toFixed(1)}s` : (run.status === 'running' ? '进行中' : '0.0s');
    const sourceCount = Math.max(appState.workspaceFiles?.length || 0, (run.events || []).length);
    const evCount = (run.events || []).length;
    const isDone = run.status === 'completed';
    const isFailed = run.status === 'failed' || run.status === 'blocked';
    const isRunning = run.status === 'running';

    // Determine 4 phase completion states
    const p1Done = Boolean(g.planText || g.copyText || c.status !== 'idle' || isDone);
    const p2Done = Boolean((run.events || []).some((e) => e.kind === 'command' || e.kind === 'file_change') || c.execText || g.planText || isDone);
    const p3Done = Boolean(c.execText || run.reviewVerdict || (run.mode === 'plan-only' && g.planText) || isDone);
    const p4Done = Boolean(isDone || g.summaryText || (run.mode === 'plan-only' && g.planText && !isRunning));
    const phases = [
      { key: '规划', en: 'Planning', done: p1Done, active: isRunning && !p1Done },
      { key: '检索', en: 'Searching', done: p2Done, active: isRunning && p1Done && !p2Done },
      { key: '施工推演', en: 'Reading', done: p3Done, active: isRunning && p2Done && !p3Done },
      { key: '交付报告', en: 'Writing', done: p4Done, active: isRunning && p3Done && !p4Done },
    ];
    const wordLen = [g.planText, g.copyText, c.execText, g.summaryText].filter(Boolean).join('').length;
    const statusLine = isDone
      ? `已完成全部协同阶段 · ${totalSec} · 扫描 ${sourceCount} 项上下文`
      : isFailed
        ? `流程已拦截或中止 · ${totalSec} · 共记录 ${evCount} 条事件`
        : `正在推进多模型协同 · ${totalSec} · 扫描 ${sourceCount} 项上下文`;
    const footCopy = wordLen > 0
      ? `已汇总 ${sourceCount} 项工作区上下文与 ${evCount} 条轨迹，当前交付约 ${wordLen.toLocaleString()} 字。`
      : `正在实时索引工作区目录边界并生成结构化契约与验证结论。`;

    return `
      <section class="research-progress-card" data-slot="research-progress">
        <header class="rp-head">
          <span class="rp-status-ico ${isDone ? 'is-done' : isFailed ? 'is-err' : 'is-live'}" aria-hidden="true">
            ${
              isDone
                ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9.5"/><path d="m8.5 12.5 2.4 2.4 4.8-5.2"/></svg>'
                : `<svg class="thinking-orb" width="16" height="16" viewBox="0 0 16 16" data-orb-family="ai" data-orb-state="${isFailed ? 'ai-breathing' : 'ai-solving'}" data-orb-variant="ai" data-orb-size="16" data-orb-paused="${isFailed ? '1' : '0'}"></svg>`
            }
          </span>
          <div class="rp-title-block">
            <h3 class="rp-title">${escapeHtml(cleanTitle)}</h3>
            <span class="rp-meta mono-xs">${escapeHtml(statusLine)}</span>
          </div>
        </header>
        <div class="rp-phases" role="list" aria-label="协同四阶段进度">
          ${phases
            .map(
              (p) => `
              <div class="rp-phase ${p.done ? 'is-done' : p.active ? 'is-active' : ''}" role="listitem">
                <span class="rp-bar"><span class="rp-bar-fill"></span></span>
                <span class="rp-phase-label">${escapeHtml(p.key)} ${p.done ? '✓' : p.active ? '…' : ''}</span>
              </div>`
            )
            .join('')}
        </div>
        <div class="rp-foot">
          <p class="rp-summary">${escapeHtml(footCopy)}</p>
          <div class="rp-foot-actions">
            <button type="button" class="rp-activity-btn mono-xs" data-open-insp="events">活动轨迹 ${evCount} ▾</button>
            <button type="button" class="rp-open-btn" data-open-insp="${run.codex?.diff ? 'diff' : run.reviewVerdict ? 'review' : 'preview'}">打开报告 →</button>
          </div>
        </div>
      </section>`;
  }

  function renderCatchUpCard(run) {
    const g = run.gemini || {};
    const c = run.codex || {};
    const combined = [g.summaryText, g.planText, g.copyText, c.execText].filter(Boolean).join('\n');
    if (!combined.trim() && run.status === 'running') return '';

    const rawLines = combined
      .split(/\r?\n/)
      .map((l) => l.replace(/^[-*•\d.)#\s]+/, '').replace(/\*\*/g, '').trim())
      .filter((l) => l.length >= 8 && l.length <= 140 && !l.startsWith('```'));

    const summaryBullets = rawLines.slice(0, 3);
    if (summaryBullets.length === 0) {
      summaryBullets.push(`当前模式：${MODE_LABELS[run.mode] || run.mode}，直连本机官方 CLI。`);
    }

    const decisions = [];
    if (run.config?.geminiModel) decisions.push(`架构规划锁定 ${run.config.geminiModel}，保持接口契约优先。`);
    if (run.config?.sandbox) {
      const netNote = run.config.allowCodexNetwork && run.config.sandbox === 'workspace-write' ? '，允许沙箱联网' : '';
      decisions.push(`Codex 沙箱策略设为 ${run.config.sandbox}（推理档位 ${run.config.codexEffort || 'high'}${netNote}）。`);
    }
    if (run.reviewVerdict) decisions.push(`Pre-CI 门禁裁决：${run.reviewVerdict.passed ? 'PASS 放行' : 'BLOCK 拦截'}。`);

    const openQuestions = [];
    if (run.status === 'awaiting_approval') {
      openQuestions.push('当前处于人工拍板闸门，需确认接口契约后放行 Codex 施工。');
    }
    if (run.reviewVerdict?.blocking?.length) {
      openQuestions.push(...run.reviewVerdict.blocking.slice(0, 2));
    } else if (run.reviewVerdict?.suggestions?.length) {
      openQuestions.push(run.reviewVerdict.suggestions[0]);
    } else {
      openQuestions.push('是否需要将本轮输出同步至右侧「代码 + 实时预览」双栏进一步核验？');
    }

    const isOpen = appState.catchUpOpen.has(run.id) ? appState.catchUpOpen.get(run.id) : true;
    return `
      <section class="catchup-card ${isOpen ? 'is-open' : 'is-compact'}" data-slot="catch-up">
        <div class="cu-head">
          <div class="cu-title-row">
            <strong>前情提要</strong>
            <span class="mono-xs cu-meta">${(run.events || []).length} 条会话轨迹 · ${MODE_LABELS[run.mode] || run.mode}</span>
          </div>
          <button type="button" class="link-btn cu-toggle-btn" data-cu-toggle="${escapeHtml(run.id)}">${isOpen ? '收起摘要' : '展开前情提要'}</button>
        </div>
        ${
          isOpen
            ? `<div class="cu-body">
                <ul class="cu-list">
                  ${summaryBullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}
                </ul>
                <div class="cu-sec">
                  <div class="cu-sec-head"><span>关键决策</span><span class="mono-xs">${decisions.length}</span></div>
                  <ul class="cu-list is-sub">
                    ${decisions.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}
                  </ul>
                </div>
                <div class="cu-sec">
                  <div class="cu-sec-head"><span>待决问题</span><span class="mono-xs">${openQuestions.length}</span></div>
                  <ul class="cu-list is-warn">
                    ${openQuestions.map((q) => `<li>${escapeHtml(q)}</li>`).join('')}
                  </ul>
                </div>
              </div>`
            : ''
        }
      </section>`;
  }

  function renderChatTraceHtml(msg, isStreaming, fallbackKey = '') {
    const trace = Array.isArray(msg.trace) ? msg.trace : [];
    const thoughtText = String(msg.thinkingText || '').trim();
    const thinkTok = Number(msg.thinkingTokens) || 0;
    const toolCount = trace.filter((t) => t.kind === 'tool' || t.kind === 'file_change').length;
    const thinkCount = trace.filter((t) => t.kind === 'thinking').length;
    const hasContent = trace.length > 0 || Boolean(thoughtText) || thinkTok > 0;

    if (!isStreaming && !hasContent) return '';

    const msgKey = msg.id || fallbackKey || 'msg';
    const hasManual = appState.chatTraceOpen.has(msgKey);
    const isOpen = hasManual ? appState.chatTraceOpen.get(msgKey) : isStreaming;

    const activeTool = [...trace].reverse().find((t) => t.status === 'running' && t.kind === 'tool');
    const summaryBits = [];
    if (thinkCount > 0) summaryBits.push(`${thinkCount} 步思考`);
    if (toolCount > 0) summaryBits.push(`${toolCount} 次工具调用`);
    if (thinkTok > 0) summaryBits.push(`${thinkTok.toLocaleString()} 推理 tokens`);

    let titleText = '';
    if (isStreaming) {
      if (activeTool) {
        titleText = `正在调用 ${activeTool.title}${activeTool.detail ? ` · ${activeTool.detail.slice(0, 42)}` : ''}`;
      } else if (thoughtText) {
        titleText = `正在推演思考链${summaryBits.length ? `（${summaryBits.join(' · ')}）` : ''}`;
      } else if (msg.liveStep) {
        titleText = `正在执行 ${msg.liveStep}...`;
      } else {
        titleText = summaryBits.length ? `深度思考中 · ${summaryBits.join(' · ')}` : '深度思考中...';
      }
    } else {
      titleText = summaryBits.length
        ? `思考链与工具调用 · ${summaryBits.join(' · ')}`
        : '查看思考与执行轨迹';
    }

    const bodyRows = [];
    if (thoughtText) {
      bodyRows.push(`
        <div class="chat-trace-thought">
          <div class="chat-trace-thought-label mono-xs">CHAIN OF THOUGHT</div>
          <div class="chat-trace-thought-text">${escapeHtml(thoughtText)}</div>
        </div>`);
    }

    const nonDuplicateSteps = trace.filter((t) => !(t.id === 'reason_stream' && thoughtText));
    if (nonDuplicateSteps.length > 0) {
      const rowsHtml = nonDuplicateSteps
        .map((item, sIdx) => {
          const itemKey = `${msgKey}:${item.id || sIdx}`;
          const expanded = appState.chatToolOpen.has(itemKey);
          const hasDetail = Boolean(item.body && String(item.body).trim());
          const statusCls = item.status === 'error' ? 'is-error' : item.status === 'running' ? 'is-running' : 'is-done';
          const statusGlyph = item.status === 'error' ? '✕' : item.status === 'running' ? '●' : '✓';
          const badgeLabel =
            item.kind === 'thinking'
              ? 'THINK'
              : item.kind === 'file_change'
                ? 'EDIT'
                : String(item.title || 'TOOL').toUpperCase();
          const durText = item.durationMs ? `${(item.durationMs / 1000).toFixed(1)}s` : '';

          return `
            <div class="chat-trace-item ${statusCls}">
              <button type="button" class="chat-trace-row ${hasDetail ? 'is-expandable' : ''}" ${hasDetail ? `data-chat-tool-toggle="${escapeHtml(itemKey)}" aria-expanded="${expanded}"` : 'disabled'}>
                <span class="chat-trace-glyph ${statusCls}" aria-hidden="true">${statusGlyph}</span>
                <span class="chat-trace-badge mono-xs">${escapeHtml(badgeLabel)}</span>
                <span class="chat-trace-summary mono-xs">${escapeHtml(item.detail || item.title || '')}</span>
                <span class="chat-trace-right mono-xs">
                  ${durText ? `<span>${escapeHtml(durText)}</span>` : ''}
                  ${hasDetail ? `<span class="chat-trace-chev">${expanded ? '▴' : '▾'}</span>` : ''}
                </span>
              </button>
              ${expanded && hasDetail ? `<pre class="chat-trace-detail mono-xs">${escapeHtml(item.body)}</pre>` : ''}
            </div>`;
        })
        .join('');
      bodyRows.push(`<div class="chat-trace-list">${rowsHtml}</div>`);
    } else if (isStreaming && !thoughtText) {
      bodyRows.push(`
        <div class="chat-trace-live-placeholder mono-xs is-shimmer">
          正在建立推理上下文并监听本机工具调用...
        </div>`);
    }

    return `
      <div class="chat-trace-box ${isOpen ? 'is-open' : ''} ${isStreaming ? 'is-live' : ''}">
        <button type="button" class="chat-trace-head" data-chat-trace-toggle="${escapeHtml(msgKey)}" aria-expanded="${isOpen}">
          <span class="chat-trace-dot ${isStreaming ? 'is-pulse' : ''}" aria-hidden="true"></span>
          <span class="chat-trace-title">${escapeHtml(titleText)}</span>
          <span class="chat-trace-toggle-chev mono-xs">${isOpen ? '收起 ▴' : '展开 ▾'}</span>
        </button>
        ${isOpen ? `<div class="chat-trace-body">${bodyRows.join('')}</div>` : ''}
      </div>`;
  }

  function renderChatMessagesHtml(run, messages) {
    const htmlParts = [];
    (messages || []).forEach((msg, idx) => {
      const msgKey = msg.id || `${run.id}:msg:${idx}`;
      const ts = new Date(msg.createdAt || run.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
      if (msg.role === 'user') {
        htmlParts.push(`
          <div class="msg-user-wrap">
            <div class="msg-user-bubble">
              <div class="msg-user-text">${escapeHtml(stripPreferenceTag(msg.content))}</div>
              <div class="msg-user-meta">
                <span>${ts}</span>
              </div>
            </div>
          </div>`);
        return;
      }

      const isStreamingMsg = msg.status === 'running';
      const engineLabel = msg.engine || 'Gemini';
      const isCodexEng = engineLabel === 'Codex';
      const avatarCls = isCodexEng ? 'codex' : 'gemini';
      const glyph = isCodexEng ? 'C' : (engineLabel === 'Gemini' ? 'G' : (engineLabel.trim()[0] || 'A').toUpperCase());
      const metaBits = [];
      if (msg.tokens) metaBits.push(`${Number(msg.tokens).toLocaleString()} TOKENS`);
      if (msg.durationMs) metaBits.push(`${(msg.durationMs / 1000).toFixed(1)}s`);
      if (!metaBits.length) {
        if (isStreamingMsg) metaBits.push('回复中...');
        else if (msg.status === 'interrupted') metaBits.push('已中断');
        else if (msg.status === 'cancelled') metaBits.push('已中止');
        else metaBits.push(ts);
      }

      const traceHtml = renderChatTraceHtml(msg, isStreamingMsg, msgKey);
      let statusPillHtml = '';
      if (isStreamingMsg) {
        statusPillHtml = `<span class="agent-status-pill running is-shimmer"><span>${escapeHtml(msg.liveStep ? '执行工具中...' : '思考与回复中...')}</span></span>`;
      } else if (msg.status === 'failed') {
        statusPillHtml = '<span class="agent-status-pill failed"><span>执行失败</span></span>';
      } else if (msg.status === 'cancelled') {
        statusPillHtml = '<span class="agent-status-pill cancelled"><span>已中止</span></span>';
      } else if (msg.status === 'interrupted') {
        statusPillHtml = '<span class="agent-status-pill interrupted"><span>已中断</span></span>';
      }

      const fallbackNote = !isStreamingMsg && !msg.content && !msg.error
        ? (msg.status === 'interrupted'
            ? '<p class="agent-empty-state mono-xs">本次回复在完成前被中断，可直接点击右下角在当前对话内继续。</p>'
            : msg.status === 'cancelled'
              ? '<p class="agent-empty-state mono-xs">已手动中止本次回复。</p>'
              : msg.status === 'failed'
                ? '<p class="agent-empty-state mono-xs">本次调用未返回内容，可在右侧事件终端查看详情。</p>'
                : '')
        : '';

      const canResumeCodex = !isStreamingMsg && isCodexEng && Boolean(run.codex?.threadId);
      const canContinueInterrupted = !isStreamingMsg && !canResumeCodex && (msg.status === 'interrupted' || msg.status === 'cancelled');

      htmlParts.push(`
        <article class="agent-turn chat-turn ${isStreamingMsg ? 'is-streaming' : ''}">
          <header class="agent-turn-head">
            <div class="agent-identity">
              <span class="agent-avatar ${avatarCls} ${isStreamingMsg ? 'is-orb' : ''}">${isStreamingMsg ? '<svg class="thinking-orb" width="16" height="16" viewBox="0 0 18 18" data-orb-family="ai" data-orb-state="ai-solving" data-orb-variant="ai" data-orb-size="16" aria-hidden="true"></svg>' : escapeHtml(glyph)}</span>
              <span class="agent-role-name">${escapeHtml(engineLabel)}</span>
              ${msg.model ? `<span class="agent-model-tag">${escapeHtml(msg.model)}</span>` : ''}
            </div>
            <div class="agent-head-right">
              ${statusPillHtml}
            </div>
          </header>
          ${traceHtml}
          ${msg.content ? `<div class="markdown-output">${renderMarkdown(msg.content)}</div>` : fallbackNote}
          ${msg.error ? `<div class="error-banner">${escapeHtml(msg.error)}</div>` : ''}
          <footer class="agent-turn-foot">
            <span class="mono-xs">${escapeHtml(metaBits.join(' · '))}</span>
            <div class="turn-foot-actions">
              ${canResumeCodex ? `<button type="button" class="link-btn" data-use-resume="${escapeHtml(run.codex.threadId)}">以此会话续跑</button>` : ''}
              ${canContinueInterrupted ? '<button type="button" class="link-btn" data-continue-interrupted="1">从中断处续跑</button>' : ''}
              ${isCodexEng && run.codex?.diff ? '<button type="button" class="link-btn" data-open-insp="diff">查看 Git Diff →</button>' : ''}
              ${msg.content ? `<button type="button" class="link-btn" data-copy-msg="${escapeHtml(msgKey)}">复制</button>` : ''}
            </div>
          </footer>
        </article>`);
    });
    return htmlParts.join('');
  }

  function renderConversationThread(run) {
    if (!run) return;
    el('welcomeStage').classList.add('hidden');
    const container = el('threadMessages');
    container.classList.remove('hidden');
    const vp = el('conversationViewport');
    const prevScrollTop = vp ? vp.scrollTop : 0;

    const isActive = run.status === 'running' || run.status === 'awaiting_approval';
    el('btnCancelRun').classList.toggle('hidden', !isActive);
    el('sendCtaGroup').classList.toggle('hidden', isActive);
    el('composerShell').classList.toggle('is-streaming', run.status === 'running');

    const totalTokens = (run.metrics?.geminiTokens || 0) + (run.metrics?.codexTokens || 0);
    const totalSec = (((run.gemini?.durationMs || 0) + (run.codex?.durationMs || 0)) / 1000).toFixed(1);
    el('topbarTitle').textContent = stripPreferenceTag(run.title) || '协同会话';
    el('topbarMeta').textContent = `${MODE_LABELS[run.mode] || run.mode} · ${totalTokens.toLocaleString()} TOKENS · ${totalSec}s`;
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

    // Clean Multi-Turn Agent Chat Rendering (Zero heavy pipeline/inspection ceremony!)
    if (run.mode === 'agent-chat') {
      const messages = Array.isArray(run.messages) && run.messages.length > 0
        ? run.messages
        : [{ id: 'initial_u', role: 'user', content: run.prompt, status: 'done', createdAt: run.createdAt }];

      parts.push(renderChatMessagesHtml(run, messages));

      container.innerHTML = parts.join('');
      bindThreadDynamicHandlers(container, run);
      if (window.ConduitOrbs) window.ConduitOrbs.mountAll(container);
      renderInspectorContent(run);
      if (vp) {
        if (appState.stickyBottom) {
          vp.scrollTop = vp.scrollHeight;
          el('btnJumpLatest').classList.add('hidden');
        } else {
          vp.scrollTop = prevScrollTop;
          if (run.status === 'running') el('btnJumpLatest').classList.remove('hidden');
        }
      }
      if (waveEngine) waveEngine.redraw();
      return;
    }

    // 1. User Prompt Turn (Stripped of internal preference prompt suffix)
    parts.push(`
      <div class="msg-user-wrap">
        <div class="msg-user-bubble">
          <div class="msg-user-text">${escapeHtml(stripPreferenceTag(run.prompt))}</div>
          <div class="msg-user-meta">
            <span>${escapeHtml(MODE_LABELS[run.mode] || run.mode)}</span>
            <span>·</span>
            <span>${createdStr}</span>
          </div>
        </div>
      </div>`);

    // 1.5 Middle Control: 4-Phase Research & Pipeline Progress Card + Left Control: Catch Up Summary
    parts.push(renderResearchProgressCard(run));
    const catchUpHtml = renderCatchUpCard(run);
    if (catchUpHtml) parts.push(catchUpHtml);

    // 2. Primary Planning / External Agent Turn (Gemini or Configured External Provider)
    const g = run.gemini || {};
    const showGeminiFirst = ['full-pipeline', 'plan-only', 'copy-polish', 'custom-agent'].includes(run.mode);
    if (showGeminiFirst) {
      const text = run.mode === 'copy-polish' ? g.copyText : g.planText;
      const isStreamingG = g.status === 'running' && run.activeStage !== 'summary';
      const hasExtProv = Boolean(run.config?.providerName);
      const titleLabel = hasExtProv
        ? `${run.config.providerName} · ${run.mode === 'custom-agent' ? '外部 Agent' : run.mode === 'copy-polish' ? '文案顾问' : '架构规划师'}`
        : (run.mode === 'copy-polish' ? 'Gemini · 文案与交互顾问' : 'Gemini · 总指挥与架构师');
      const modelBadgeText = hasExtProv
        ? (run.config.providerModel || run.config.providerProtocol || 'EXTERNAL')
        : (run.config?.geminiModel || '');
      const avatarGlyph = hasExtProv ? (run.config.providerName.trim()[0] || 'A').toUpperCase() : 'G';
      const statusText = isStreamingG ? '正在流式推理...' : (g.status || 'idle').toUpperCase();
      parts.push(`
        <article class="agent-turn ${isStreamingG ? 'is-streaming' : ''}">
          <header class="agent-turn-head">
            <div class="agent-identity">
              <span class="agent-avatar gemini ${isStreamingG ? 'is-orb' : ''}">${isStreamingG ? '<svg class="thinking-orb" width="18" height="18" viewBox="0 0 18 18" data-orb-family="ai" data-orb-state="ai-solving" data-orb-variant="ai" data-orb-size="18" aria-hidden="true"></svg>' : escapeHtml(avatarGlyph)}</span>
              <span class="agent-role-name">${escapeHtml(titleLabel)}</span>
              <span class="agent-model-tag">${escapeHtml(modelBadgeText)}</span>
            </div>
            <span class="agent-status-pill ${escapeHtml(g.status || '')} ${isStreamingG ? 'is-shimmer' : ''}">
              <span>${statusText}</span>
            </span>
          </header>
          ${run.mode !== 'custom-agent' ? renderBranchDeckHtml(run, isStreamingG) : ''}
          ${renderToolTraceHtml(run.events, 'gemini', isStreamingG, `${run.id}:gemini`, run)}
          ${text ? `<div class="markdown-output">${renderMarkdown(text)}</div>` : isStreamingG ? `<div class="mono-xs is-shimmer">${hasExtProv ? `正在调用 ${escapeHtml(run.config.providerName)} 实时流式推理...` : '正在拆解需求与接口契约...'}</div>` : ''}
          ${g.error && run.activeStage !== 'summary' ? `<div class="error-banner">${escapeHtml(g.error)}</div>` : ''}
          <footer class="agent-turn-foot">
            <span class="mono-xs">${(g.usage?.total_tokens || run.metrics?.geminiTokens || 0).toLocaleString()} TOKENS · ${((g.durationMs || 0) / 1000).toFixed(1)}s</span>
            <div class="turn-foot-actions">
              ${text ? `<button type="button" class="link-btn" data-copy-slot="gemini-main">${run.mode === 'custom-agent' ? '复制回复' : '复制方案'}</button>` : ''}
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
          <header class="agent-turn-head">
            <div class="agent-identity">
              <span class="agent-avatar codex ${isStreamingC ? 'is-orb is-codex' : ''}">${isStreamingC ? '<svg class="thinking-orb" width="18" height="18" viewBox="0 0 18 18" data-orb-family="ai" data-orb-state="ai-composing" data-orb-variant="ai" data-orb-size="18" aria-hidden="true"></svg>' : 'C'}</span>
              <span class="agent-role-name">Codex · 沙箱工程师</span>
              <span class="agent-model-tag">${escapeHtml(run.config?.codexModel || '默认')} · ${escapeHtml(run.config?.codexEffort || 'high')} · ${escapeHtml(run.config?.sandbox || 'workspace-write')}${run.worktreePath ? ' · WT' : ''}</span>
            </div>
            <span class="agent-status-pill ${escapeHtml(c.status || '')} ${isStreamingC ? 'is-shimmer' : ''}">
              <span>${statusText}</span>
            </span>
          </header>
          ${renderToolTraceHtml(run.events, 'codex', isStreamingC, `${run.id}:codex`, run)}
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
          <header class="agent-turn-head">
            <div class="agent-identity">
              <span class="agent-avatar codex ${isStreamingR ? 'is-orb' : ''}">${isStreamingR ? '<svg class="thinking-orb" width="18" height="18" viewBox="0 0 18 18" data-orb-family="ai" data-orb-state="ai-searching" data-orb-variant="ai" data-orb-size="18" aria-hidden="true"></svg>' : 'R'}</span>
              <span class="agent-role-name">Pre-CI 代码审查门禁</span>
              <span class="agent-model-tag">ROUND ${run.reviewRound || 1} / ${run.mode === 'codex-review' ? 1 : (run.config?.maxReviewRounds || 2)}</span>
            </div>
            <span class="agent-status-pill ${v ? (v.passed ? 'done' : 'failed') : (isStreamingR ? 'running' : '')} ${isStreamingR ? 'is-shimmer' : ''}">
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
          <header class="agent-turn-head">
            <div class="agent-identity">
              <span class="agent-avatar gemini ${isStreamingS ? 'is-orb' : ''}">${isStreamingS ? '<svg class="thinking-orb" width="18" height="18" viewBox="0 0 18 18" data-orb-family="ai" data-orb-state="ai-connecting" data-orb-variant="ai" data-orb-size="18" aria-hidden="true"></svg>' : 'G'}</span>
              <span class="agent-role-name">Gemini · 最终交付汇报</span>
            </div>
            <span class="agent-status-pill ${escapeHtml(g.status || '')} ${isStreamingS ? 'is-shimmer' : ''}">
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

    // 7.5 Dedicated or Extracted Media Output Turn (ImageGeneration & VideoGeneration)
    if (run.mediaJob) {
      const mj = run.mediaJob;
      const isVid = mj.kind === 'video';
      const isRunningM = mj.status === 'queued' || mj.status === 'generating';
      parts.push(`
        <article class="agent-turn ${isRunningM ? 'is-streaming' : ''}">
          <header class="agent-turn-head">
            <div class="agent-identity">
              <span class="agent-avatar gemini ${isRunningM ? 'is-orb' : ''}">${isRunningM ? '<svg class="thinking-orb" width="18" height="18" viewBox="0 0 18 18" data-orb-family="ai" data-orb-state="ai-composing" data-orb-variant="ai" data-orb-size="18" aria-hidden="true"></svg>' : (isVid ? 'V' : 'I')}</span>
              <span class="agent-role-name">${isVid ? 'TENON · 视频生成输出' : 'TENON · 图像生成输出'}</span>
              <span class="agent-model-tag">${escapeHtml(mj.modelLabel || (isVid ? 'VIDEO STUDIO' : 'IMAGE STUDIO'))}</span>
            </div>
            <span class="agent-status-pill ${mj.status === 'done' ? 'completed' : mj.status === 'failed' ? 'failed' : isRunningM ? 'running is-shimmer' : ''}">
              <span>${mj.status === 'queued' ? 'QUEUED' : mj.status === 'generating' ? 'RENDERING' : mj.status === 'done' ? 'READY' : mj.status.toUpperCase()}</span>
            </span>
          </header>
          <div class="turn-media-mount" data-media-job-id="${escapeHtml(run.id)}"></div>
        </article>`);
    } else if (window.ConduitMediaGen) {
      const combinedText = [g.planText, g.copyText, c.execText, g.summaryText].filter(Boolean).join('\n');
      const extracted = window.ConduitMediaGen.extractMediaFromText(combinedText, run.workspaceDir);
      if (extracted.images.length > 0 || extracted.videos.length > 0) {
        parts.push(`
          <article class="agent-turn">
            <header class="agent-turn-head">
              <div class="agent-identity">
                <span class="agent-avatar gemini">M</span>
                <span class="agent-role-name">媒体产物渲染</span>
                <span class="agent-model-tag">${extracted.images.length ? `${extracted.images.length} 张图像` : ''}${extracted.images.length && extracted.videos.length ? ' · ' : ''}${extracted.videos.length ? `${extracted.videos.length} 段视频` : ''}</span>
              </div>
              <span class="agent-status-pill completed"><span>MEDIA</span></span>
            </header>
            <div class="turn-media-mount" data-media-extracted="${escapeHtml(run.id)}"></div>
          </article>`);
      }
    }

    // 8. In-Place Resumed / Follow-Up Messages appended onto non-chat runs
    if (Array.isArray(run.messages) && run.messages.length > 0) {
      parts.push('<div class="thread-followup-divider"><span class="mono-xs">原会话内续跑记录</span></div>');
      parts.push(renderChatMessagesHtml(run, run.messages));
    }

    container.innerHTML = parts.join('');
    bindThreadDynamicHandlers(container, run);
    mountTurnMediaWidgets(container, run);
    if (window.ConduitOrbs) window.ConduitOrbs.mountAll(container);
    renderInspectorContent(run);
    if (appState.stageView === 'workflow') renderWorkflowCanvas();

    // Smart auto-follow (21st.dev Conversation #46450 — NEVER uses scrollIntoView!)
    if (vp) {
      if (appState.stickyBottom) {
        vp.scrollTop = vp.scrollHeight;
        el('btnJumpLatest').classList.add('hidden');
      } else {
        vp.scrollTop = prevScrollTop;
        if (run.status === 'running') el('btnJumpLatest').classList.remove('hidden');
      }
    }

    if (waveEngine) waveEngine.redraw();
  }

  function bindThreadDynamicHandlers(container, run) {
    // Catch-up collapsible summary toggle
    container.querySelectorAll('[data-cu-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const rid = btn.dataset.cuToggle;
        const cur = appState.catchUpOpen.has(rid) ? appState.catchUpOpen.get(rid) : true;
        appState.catchUpOpen.set(rid, !cur);
        renderConversationThread(run);
      });
    });

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

    container.querySelectorAll('[data-chat-trace-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mid = btn.dataset.chatTraceToggle;
        const curr = btn.getAttribute('aria-expanded') === 'true';
        appState.chatTraceOpen.set(mid, !curr);
        renderConversationThread(run);
      });
    });

    container.querySelectorAll('[data-chat-tool-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.chatToolToggle;
        if (appState.chatToolOpen.has(key)) appState.chatToolOpen.delete(key);
        else appState.chatToolOpen.add(key);
        renderConversationThread(run);
      });
    });

    container.querySelectorAll('[data-copy-msg]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mid = btn.dataset.copyMsg;
        const found = (run.messages || []).find((m, idx) => (m.id || `${run.id}:msg:${idx}`) === mid);
        copyText(found?.content || '', '已复制回复');
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
        appState.resumeRunId = run.id;
        el('resumeThreadLabel').textContent = tid.length > 16 ? `${tid.slice(0, 14)}...` : tid;
        el('resumeIndicator').classList.remove('hidden');
        setModeValue('agent-chat');
        setGeminiModelValue('codex:chat');
        el('inputPrompt')?.focus();
        showToast('已锁定原 Codex 会话，下一条消息将在当前对话内续跑（不新建对话）');
      });
    });

    container.querySelectorAll('[data-continue-interrupted]').forEach((btn) => {
      btn.addEventListener('click', () => {
        setModeValue('agent-chat');
        const ta = el('inputPrompt');
        if (ta) {
          if (!ta.value.trim()) {
            ta.value = '请从上次中断处继续完成刚才的任务。';
            autoGrowTextarea(ta);
          }
          ta.focus();
          ta.setSelectionRange(ta.value.length, ta.value.length);
        }
        showToast('已就绪，按回车即可在当前对话内继续');
      });
    });

    const gateEd = el('inlineGateEditor');
    if (gateEd) {
      gateEd.addEventListener('input', () => {
        appState.gateDirtyText = gateEd.value;
      });
    }

    const gateButtons = ['btnInlineApprove', 'btnInlineReplan', 'btnInlineAbort', 'btnInlineOverride', 'btnInlineStopBlocked']
      .map((id) => el(id))
      .filter(Boolean);
    const setGateBusy = (busy) => {
      gateButtons.forEach((b) => { b.disabled = busy; });
    };

    const btnApprove = el('btnInlineApprove');
    if (btnApprove) {
      btnApprove.addEventListener('click', async () => {
        if (btnApprove.disabled) return;
        setGateBusy(true);
        try {
          const spec = el('inlineGateEditor')?.value || '';
          await api(`/api/runs/${encodeURIComponent(run.id)}/approve`, {
            method: 'POST',
            body: JSON.stringify({ action: 'approve', spec }),
          });
          appState.gateDirtyText = null;
          showToast('已拍板放行，正在派发 Codex 施工');
        } catch (err) {
          setGateBusy(false);
          showToast(`放行失败: ${err.message}`);
        }
      });
    }

    const btnReplan = el('btnInlineReplan');
    if (btnReplan) {
      btnReplan.addEventListener('click', async () => {
        if (btnReplan.disabled) return;
        setGateBusy(true);
        try {
          const fb = el('inlineGateFeedback')?.value.trim() || '';
          await api(`/api/runs/${encodeURIComponent(run.id)}/approve`, {
            method: 'POST',
            body: JSON.stringify({ action: 'replan', feedback: fb }),
          });
          appState.gateDirtyText = null;
          showToast('已打回 Gemini 重新规划');
        } catch (err) {
          setGateBusy(false);
          showToast(`打回失败: ${err.message}`);
        }
      });
    }

    const btnAbort = el('btnInlineAbort');
    if (btnAbort) {
      btnAbort.addEventListener('click', async () => {
        if (btnAbort.disabled) return;
        setGateBusy(true);
        try {
          await api(`/api/runs/${encodeURIComponent(run.id)}/cancel`, { method: 'POST' });
          appState.gateDirtyText = null;
          showToast('已中止任务');
        } catch (err) {
          setGateBusy(false);
          showToast(`中止失败: ${err.message}`);
        }
      });
    }

    const btnOverride = el('btnInlineOverride');
    if (btnOverride) {
      btnOverride.addEventListener('click', async () => {
        if (btnOverride.disabled) return;
        setGateBusy(true);
        try {
          await api(`/api/runs/${encodeURIComponent(run.id)}/approve`, {
            method: 'POST',
            body: JSON.stringify({ action: 'override' }),
          });
          showToast('已人工强制放行，进入 Gemini 最终汇报');
        } catch (err) {
          setGateBusy(false);
          showToast(`放行失败: ${err.message}`);
        }
      });
    }

    const btnStopBlocked = el('btnInlineStopBlocked');
    if (btnStopBlocked) {
      btnStopBlocked.addEventListener('click', async () => {
        if (btnStopBlocked.disabled) return;
        setGateBusy(true);
        try {
          await api(`/api/runs/${encodeURIComponent(run.id)}/approve`, {
            method: 'POST',
            body: JSON.stringify({ action: 'abort' }),
          });
          showToast('已停止并保持门禁拦截');
        } catch (err) {
          setGateBusy(false);
          showToast(`操作失败: ${err.message}`);
        }
      });
    }
  }

  function renderContextChips() {
    const bar = el('contextChipsBar');
    if (!bar) return;
    if (!appState.contextChips.length) {
      bar.classList.add('hidden');
      bar.innerHTML = '';
      return;
    }
    bar.classList.remove('hidden');
    bar.innerHTML = appState.contextChips
      .map(
        (chip, idx) => `
        <span class="ctx-chip" data-chip-idx="${idx}">
          ${chip.thumb ? `<img class="ctx-chip-thumb" src="${escapeHtml(chip.thumb)}" alt="" />` : '<span class="ctx-chip-badge mono-xs">REF</span>'}
          <span class="ctx-chip-label">${escapeHtml(chip.label)}</span>
          <button type="button" class="ctx-chip-rm" data-rm-chip="${idx}" aria-label="移除参考">×</button>
        </span>`
      )
      .join('');
    bar.querySelectorAll('[data-rm-chip]').forEach((btn) => {
      btn.addEventListener('click', () => {
        appState.contextChips.splice(Number(btn.dataset.rmChip), 1);
        renderContextChips();
      });
    });
  }

  function addContextChip(chip) {
    if (appState.contextChips.length >= 6) appState.contextChips.shift();
    appState.contextChips.push(chip);
    renderContextChips();
  }

  function mountTurnMediaWidgets(container, run) {
    if (!window.ConduitMediaGen) return;

    const jobMount = container.querySelector('[data-media-job-id]');
    if (jobMount && run.mediaJob) {
      const mj = run.mediaJob;
      if (mj.kind === 'image') {
        mj._api = window.ConduitMediaGen.mountImageGeneration(jobMount, {
          prompt: mj.prompt,
          status: mj.status,
          images: mj.images,
          count: mj.count || 4,
          aspectRatio: mj.aspectRatio || '4:3',
          progress: mj.progress,
          queuePosition: mj.queuePosition,
          settings: mj.settings || ['TENON Studio', '本地渲染'],
          busyAction: mj.busyAction,
          selectedIndex: mj.selectedIndex || 0,
          onToast: showToast,
          onCancel: () => {
            if (mj._cancel) mj._cancel();
            mj.status = 'failed';
            mj.errorText = '任务已手动取消。';
            run.status = 'cancelled';
            renderConversationThread(run);
          },
          onRetry: () => runLocalMediaGeneration('image-gen', mj.prompt, (mj.salt || 0) + 1),
          onEditPrompt: () => {
            el('inputPrompt').value = mj.prompt;
            setModeValue('image-gen');
            el('inputPrompt').focus();
          },
          onUpscale: (img, idx, api) => {
            mj.busyAction = 'upscale';
            api.update({ busyAction: 'upscale' });
            setTimeout(() => {
              const hi = window.ConduitMediaGen.createArchitecturalImage(mj.prompt, idx, 1280, 960, (mj.salt || 0) + 7);
              mj.images[idx] = { ...mj.images[idx], ...hi, alt: `${mj.prompt} · 2× 高清放大` };
              mj.busyAction = undefined;
              mj.settings = ['TENON Studio', '1280×960 高清放大'];
              api.update({ busyAction: undefined, images: mj.images, settings: mj.settings });
              showToast(`变体 ${idx + 1} 已完成 2× 高清放大`);
            }, 650);
          },
          onVary: (img, idx) => {
            showToast(`正在基于变体 ${idx + 1} 生成新一组微调方案...`);
            runLocalMediaGeneration('image-gen', `${mj.prompt}（变体 ${idx + 1} 延展）`, (mj.salt || 0) + idx + 3);
          },
          onUseAsReference: (img, idx) => {
            addContextChip({
              kind: 'image',
              label: `参考图 · 变体 ${idx + 1}`,
              thumb: img.previewSrc || img.src,
              prompt: mj.prompt,
            });
            showToast(`已将变体 ${idx + 1} 附加到输入框上下文`);
            el('inputPrompt').focus();
          },
        });
      } else if (mj.kind === 'video') {
        mj._api = window.ConduitMediaGen.mountVideoGeneration(jobMount, {
          prompt: mj.prompt,
          status: mj.status,
          progress: mj.progress,
          queuePosition: mj.queuePosition,
          etaMs: mj.etaMs,
          posterSrc: mj.posterSrc,
          src: mj.src,
          duration: mj.duration || 4,
          resolution: mj.resolution || '1080p',
          fps: mj.fps || 24,
          audio: Boolean(mj.audio),
          aspectRatio: mj.aspectRatio || '16:9',
          settings: mj.settings || ['TENON Motion'],
          autoPlay: true,
          loop: true,
          onToast: showToast,
          onCancel: () => {
            if (mj._cancel) mj._cancel();
            mj.status = 'failed';
            mj.errorText = '视频渲染已手动中止。';
            run.status = 'cancelled';
            renderConversationThread(run);
          },
          onRetry: () => runLocalMediaGeneration('video-gen', mj.prompt, (mj.salt || 0) + 1),
          onEditPrompt: () => {
            el('inputPrompt').value = mj.prompt;
            setModeValue('video-gen');
            el('inputPrompt').focus();
          },
          onUseAsReference: () => {
            addContextChip({
              kind: 'video',
              label: `参考分镜 · ${mj.prompt.slice(0, 14)}`,
              thumb: mj.posterSrc || '',
              prompt: mj.prompt,
            });
            showToast('已将视频首帧附加为参考上下文');
            el('inputPrompt').focus();
          },
        });
      }
    }

    const extMount = container.querySelector('[data-media-extracted]');
    if (extMount) {
      const g = run.gemini || {};
      const c = run.codex || {};
      const combinedText = [g.planText, g.copyText, c.execText, g.summaryText].filter(Boolean).join('\n');
      const extracted = window.ConduitMediaGen.extractMediaFromText(combinedText, run.workspaceDir);
      extMount.innerHTML = '';

      if (extracted.images.length > 0) {
        const imgHost = document.createElement('div');
        imgHost.className = 'extracted-media-block';
        extMount.appendChild(imgHost);
        window.ConduitMediaGen.mountImageGeneration(imgHost, {
          prompt: run.prompt || '生成图像产物',
          status: 'done',
          images: extracted.images.slice(0, 4),
          count: Math.min(4, extracted.images.length),
          aspectRatio: '4:3',
          settings: ['工作区输出'],
          onToast: showToast,
          onUseAsReference: (img, idx) => {
            addContextChip({ kind: 'image', label: img.alt || `输出图像 ${idx + 1}`, thumb: img.src });
            showToast('已附加为对话参考图');
          },
        });
      }

      extracted.videos.slice(0, 2).forEach((vid) => {
        const vidHost = document.createElement('div');
        vidHost.className = 'extracted-media-block';
        extMount.appendChild(vidHost);
        window.ConduitMediaGen.mountVideoGeneration(vidHost, {
          prompt: vid.title || run.prompt || '生成视频产物',
          status: 'done',
          src: vid.src,
          aspectRatio: '16:9',
          settings: ['工作区输出'],
          autoPlay: false,
          loop: true,
          onToast: showToast,
        });
      });
    }
  }

  function runLocalMediaGeneration(mode, promptText, salt = 0) {
    if (!window.ConduitMediaGen) return;
    const isVideo = mode === 'video-gen';
    const id = `local-${isVideo ? 'vid' : 'img'}-${Date.now()}`;
    const cleanPrompt =
      (promptText || '').trim() ||
      (isVideo
        ? '极简建筑光影下的静水同心涟漪，俯视慢镜头，细微胶片颗粒'
        : 'Figma Weave 风格的冷矿物建筑白昼光影雕塑，极简几何构图，细腻纸张肌理');

    const timers = [];
    let cancelled = false;
    const at = (ms, fn) => {
      const tid = setTimeout(() => { if (!cancelled) fn(); }, ms);
      timers.push(tid);
    };

    const run = {
      id,
      title: `${isVideo ? '视频' : '图像'} · ${cleanPrompt.slice(0, 22)}`,
      mode,
      prompt: cleanPrompt,
      status: 'running',
      createdAt: new Date().toISOString(),
      workspaceDir: el('inputWorkspace')?.value.trim() || '',
      metrics: { geminiTokens: 0, codexTokens: 0 },
      gemini: { status: 'idle', durationMs: 0 },
      codex: { status: 'idle', durationMs: 0 },
      events: [{ ts: new Date().toISOString(), source: 'studio', kind: 'stage', text: isVideo ? '启动视频帧渲染管线' : '启动多变体图像渲染管线' }],
      mediaJob: isVideo
        ? {
            kind: 'video',
            prompt: cleanPrompt,
            status: 'queued',
            queuePosition: 1,
            etaMs: 6000,
            progress: 0,
            duration: 4,
            resolution: '1080p',
            fps: 24,
            audio: false,
            aspectRatio: '16:9',
            settings: ['CONDUIT Motion', 'WebM 24fps'],
            modelLabel: 'VIDEO STUDIO',
            salt,
            _cancel: () => { cancelled = true; timers.forEach(clearTimeout); },
          }
        : {
            kind: 'image',
            prompt: cleanPrompt,
            status: 'queued',
            queuePosition: 1,
            count: 4,
            aspectRatio: '4:3',
            progress: 0,
            images: [],
            settings: ['CONDUIT Studio', '4:3 构图'],
            modelLabel: 'IMAGE STUDIO',
            salt,
            _cancel: () => { cancelled = true; timers.forEach(clearTimeout); },
          },
    };

    appState.openRunSeq += 1;
    closeActiveStream();
    appState.localRuns.set(id, run);
    appState.runs = [
      { id: run.id, title: run.title, mode: run.mode, status: run.status, createdAt: run.createdAt },
      ...appState.runs.filter((r) => r.id !== id),
    ];
    appState.currentRun = run;
    appState.stickyBottom = true;
    renderSidebarThreads();
    renderConversationThread(run);

    if (!isVideo) {
      const rendered = [0, 1, 2, 3].map((idx) =>
        window.ConduitMediaGen.createArchitecturalImage(cleanPrompt, idx, undefined, undefined, salt)
      );
      const rates = [1.06, 0.94, 1.0, 0.88];
      at(420, () => {
        run.mediaJob.status = 'generating';
        run.mediaJob.progress = 8;
        run.mediaJob.images = rendered.map((img, i) => ({ ...img, progress: Math.round(8 * rates[i]) }));
        run.mediaJob._api?.update({ status: 'generating', progress: 8, images: run.mediaJob.images });
      });
      [22, 39, 57, 74, 89, 98].forEach((pct, stepIdx) => {
        at(740 + stepIdx * 290, () => {
          run.mediaJob.progress = pct;
          run.mediaJob.images = rendered.map((img, i) => ({ ...img, progress: Math.min(99, Math.round(pct * rates[i])) }));
          run.mediaJob._api?.update({ progress: pct, images: run.mediaJob.images });
        });
      });
      at(2600, () => {
        run.status = 'completed';
        run.mediaJob.status = 'done';
        run.mediaJob.progress = 100;
        run.mediaJob.images = rendered.map((img) => ({ ...img, progress: 100 }));
        const idx = appState.runs.findIndex((r) => r.id === id);
        if (idx >= 0) appState.runs[idx].status = 'completed';
        renderSidebarThreads();
        if (appState.currentRun?.id === id) renderConversationThread(run);
      });
    } else {
      const { posterSrc, videoPromise } = window.ConduitMediaGen.recordKineticClip({ prompt: cleanPrompt, seconds: 3.4 });
      run.mediaJob.posterSrc = posterSrc;
      let clipUrl = null;
      let stepsDone = false;
      const tryFinish = () => {
        if (cancelled || !stepsDone) return;
        run.status = 'completed';
        run.mediaJob.status = 'done';
        run.mediaJob.progress = 100;
        run.mediaJob.src = clipUrl || '';
        if (!clipUrl) {
          run.mediaJob.status = 'failed';
          run.mediaJob.errorText = '当前浏览器不支持 MediaRecorder 本地封装，已保留高清首帧海报。';
        }
        const idx = appState.runs.findIndex((r) => r.id === id);
        if (idx >= 0) appState.runs[idx].status = run.status;
        renderSidebarThreads();
        if (appState.currentRun?.id === id) renderConversationThread(run);
      };
      videoPromise.then((url) => {
        clipUrl = url;
        if (stepsDone) tryFinish();
      });

      at(420, () => {
        run.mediaJob.status = 'generating';
        run.mediaJob.etaMs = undefined;
        run.mediaJob.progress = 12;
        run.mediaJob._api?.update({ status: 'generating', etaMs: undefined, progress: 12, posterSrc });
      });
      [28, 46, 65, 82, 95].forEach((pct, stepIdx) => {
        at(780 + stepIdx * 420, () => {
          run.mediaJob.progress = pct;
          run.mediaJob._api?.update({ progress: pct, posterSrc });
        });
      });
      at(3200, () => {
        stepsDone = true;
        if (clipUrl) tryFinish();
        else videoPromise.then(() => tryFinish());
      });
    }
  }

  /* =========================================================================
     Right Inspector Rendering (Diff / Review / Agent Runs / Terminal Events)
     ========================================================================= */
  function openInspector(tabName = null) {
    appState.inspectorOpen = true;
    el('inspectorPane').classList.remove('hidden');
    el('inspectorResizeHandle')?.classList.remove('hidden');
    el('btnToggleInspector').setAttribute('aria-expanded', 'true');
    reclampPanesFn();
    if (tabName) switchInspectorTab(tabName);
    else renderInspectorContent(appState.currentRun);
    requestAnimationFrame(syncAllFluidTracks);
  }

  function closeInspector() {
    appState.inspectorOpen = false;
    el('inspectorPane').classList.add('hidden');
    el('inspectorResizeHandle')?.classList.add('hidden');
    el('btnToggleInspector').setAttribute('aria-expanded', 'false');
  }

  function initPaneResizers() {
    const root = document.documentElement;
    const MIN_STAGE_W = 500;
    const COMPACT_INSP_BP = 1180;
    const INSPECTOR_PRESETS = { compact: 380, standard: 448, wide: 540 };

    const getPreferredSidebar = () => {
      try {
        const saved = Number(localStorage.getItem('tenon_sidebar_w'));
        if (Number.isFinite(saved) && saved >= 204) return saved;
      } catch {}
      return 248;
    };

    const getPreferredInspector = () => {
      try {
        const saved = Number(localStorage.getItem('tenon_inspector_w'));
        if (Number.isFinite(saved) && saved >= 320) return saved;
      } catch {}
      return INSPECTOR_PRESETS[appState.tweaks?.inspector] || 448;
    };

    const clampSidebar = (w) => {
      const vw = window.innerWidth || 1440;
      const cap = vw <= COMPACT_INSP_BP
        ? Math.max(204, Math.min(280, Math.round(vw * 0.28)))
        : Math.max(220, Math.min(360, Math.round(vw * 0.28)));
      return Math.max(204, Math.min(cap, Math.round(w)));
    };

    const clampInspector = (w) => {
      const vw = window.innerWidth || 1440;
      if (vw <= COMPACT_INSP_BP) {
        return Math.max(320, Math.min(460, Math.round(vw * 0.94)));
      }
      const sidebar = el('sidebar');
      const activeSideW = vw <= 820
        ? 0
        : sidebar?.classList.contains('is-collapsed')
          ? 54
          : clampSidebar(getPreferredSidebar());
      const availForInsp = vw - activeSideW - MIN_STAGE_W;
      const maxW = Math.max(320, Math.min(Math.round(vw * 0.62), availForInsp));
      return Math.max(320, Math.min(maxW, Math.round(w)));
    };

    const reclampPanes = () => {
      const vw = window.innerWidth || 1440;
      if (vw <= 820) {
        root.style.removeProperty('--sidebar-w');
      } else {
        root.style.setProperty('--sidebar-w', `${clampSidebar(getPreferredSidebar())}px`);
      }

      if (vw <= COMPACT_INSP_BP) {
        // Below 1180px (including Electron 1080px minWidth), inspector switches to overlay drawer
        root.style.removeProperty('--inspector-w');
      } else {
        root.style.setProperty('--inspector-w', `${clampInspector(getPreferredInspector())}px`);
      }
    };

    reclampPanesFn = reclampPanes;
    reclampPanes();

    const sideHandle = el('sidebarResizeHandle');
    if (sideHandle) {
      sideHandle.addEventListener('dblclick', () => {
        try { localStorage.removeItem('tenon_sidebar_w'); } catch {}
        reclampPanes();
        requestAnimationFrame(syncAllFluidTracks);
      });
      sideHandle.addEventListener('pointerdown', (ev) => {
        const sidebar = el('sidebar');
        if (!sidebar || sidebar.classList.contains('is-collapsed') || window.innerWidth <= 820) return;
        ev.preventDefault();
        sideHandle.setPointerCapture(ev.pointerId);
        sideHandle.classList.add('is-dragging');
        document.body.classList.add('is-resizing');
        let lastW = clampSidebar(sidebar.getBoundingClientRect().width);
        const onMove = (mEv) => {
          lastW = clampSidebar(mEv.clientX);
          root.style.setProperty('--sidebar-w', `${lastW}px`);
          if (window.innerWidth > COMPACT_INSP_BP) {
            const availForInsp = window.innerWidth - lastW - MIN_STAGE_W;
            const curInsp = clampInspector(getPreferredInspector());
            const boundedInsp = Math.max(320, Math.min(curInsp, Math.max(320, availForInsp)));
            root.style.setProperty('--inspector-w', `${boundedInsp}px`);
          }
        };
        const onUp = () => {
          sideHandle.classList.remove('is-dragging');
          document.body.classList.remove('is-resizing');
          try { localStorage.setItem('tenon_sidebar_w', String(lastW)); } catch {}
          reclampPanes();
          requestAnimationFrame(syncAllFluidTracks);
          sideHandle.removeEventListener('pointermove', onMove);
          sideHandle.removeEventListener('pointerup', onUp);
          sideHandle.removeEventListener('pointercancel', onUp);
        };
        sideHandle.addEventListener('pointermove', onMove);
        sideHandle.addEventListener('pointerup', onUp);
        sideHandle.addEventListener('pointercancel', onUp);
      });
    }

    const inspHandle = el('inspectorResizeHandle');
    if (inspHandle) {
      inspHandle.addEventListener('dblclick', () => {
        try { localStorage.removeItem('tenon_inspector_w'); } catch {}
        reclampPanes();
        requestAnimationFrame(syncAllFluidTracks);
      });
      inspHandle.addEventListener('pointerdown', (ev) => {
        if (window.innerWidth <= COMPACT_INSP_BP) return;
        ev.preventDefault();
        inspHandle.setPointerCapture(ev.pointerId);
        inspHandle.classList.add('is-dragging');
        document.body.classList.add('is-resizing');
        let lastW = clampInspector(el('inspectorPane')?.getBoundingClientRect().width || 448);
        const onMove = (mEv) => {
          lastW = clampInspector(window.innerWidth - mEv.clientX);
          root.style.setProperty('--inspector-w', `${lastW}px`);
        };
        const onUp = () => {
          inspHandle.classList.remove('is-dragging');
          document.body.classList.remove('is-resizing');
          try { localStorage.setItem('tenon_inspector_w', String(lastW)); } catch {}
          reclampPanes();
          requestAnimationFrame(syncAllFluidTracks);
          inspHandle.removeEventListener('pointermove', onMove);
          inspHandle.removeEventListener('pointerup', onUp);
          inspHandle.removeEventListener('pointercancel', onUp);
        };
        inspHandle.addEventListener('pointermove', onMove);
        inspHandle.addEventListener('pointerup', onUp);
        inspHandle.addEventListener('pointercancel', onUp);
      });
    }
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
    el('inspectorPreviewBox')?.classList.toggle('hidden', tab !== 'preview');
    el('inspectorRunsBox')?.classList.toggle('hidden', tab !== 'runs');
    el('inspectorEventsBox').classList.toggle('hidden', tab !== 'events');
    syncAllFluidTracks();
    renderInspectorContent(appState.currentRun);
  }

  function renderAgentRunsMonitor(box) {
    if (!box) return;
    const allRuns = appState.runs || [];
    if (allRuns.length === 0) {
      box.innerHTML = '<div class="empty-inline"><span class="mono-xs">AGENT RUNS / IDLE</span><p>暂无运行中的多模型协同任务。</p></div>';
      return;
    }
    const statusMap = {
      running: { label: '运行中', cls: 'is-running' },
      awaiting_approval: { label: '待人工拍板', cls: 'is-waiting' },
      completed: { label: '已完成', cls: 'is-done' },
      failed: { label: '已失败', cls: 'is-failed' },
      blocked: { label: '门禁拦截', cls: 'is-failed' },
      cancelled: { label: '已中止', cls: 'is-stopped' },
      interrupted: { label: '已中断', cls: 'is-stopped' },
    };
    box.innerHTML = `
      <div class="runs-monitor-head">
        <span class="mono-xs">AGENT RUNS · ${allRuns.length} 项任务</span>
        <span class="mono-xs">点击切换上下文</span>
      </div>
      <div class="runs-list">
        ${allRuns
          .slice(0, 24)
          .map((r) => {
            const st = statusMap[r.status] || { label: r.status || 'IDLE', cls: 'is-stopped' };
            const active = appState.currentRun?.id === r.id;
            const tStr = r.createdAt ? new Date(r.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '--:--';
            return `
              <button type="button" class="run-status-row ${active ? 'is-active' : ''}" data-open-run="${escapeHtml(r.id)}">
                <div class="run-row-main">
                  <span class="run-row-title">${escapeHtml(r.title || '协同任务')}</span>
                  <span class="run-row-sub mono-xs">${escapeHtml(MODE_LABELS[r.mode] || r.mode || '')} · ${tStr}</span>
                </div>
                <span class="run-status-pill ${st.cls}">
                  <span class="run-status-dot"></span>
                  <span>${escapeHtml(st.label)}</span>
                </span>
              </button>`;
          })
          .join('')}
      </div>`;
    box.querySelectorAll('[data-open-run]').forEach((btn) => {
      btn.addEventListener('click', () => openRunById(btn.dataset.openRun));
    });
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
    } else if (appState.inspectorTab === 'preview') {
      const box = el('inspectorPreviewBox');
      if (box && window.ConduitMediaGen) {
        const text = [run?.codex?.execText, run?.gemini?.planText, run?.gemini?.summaryText].filter(Boolean).join('\n');
        const htmlMatch = text.match(/```html\s*([\s\S]*?)```/i);
        const codeMatch = text.match(/```([a-zA-Z0-9_-]*)\s*([\s\S]*?)```/);
        const urlMatch = text.match(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+[^\s)"'`]*/i);
        window.ConduitMediaGen.mountSafariPreview(box, {
          url: urlMatch ? urlMatch[0] : '',
          htmlSnippet: htmlMatch ? htmlMatch[1] : '',
          codeSnippet: codeMatch ? codeMatch[2].trim() : (run?.codex?.diff || ''),
          codeLang: codeMatch ? (codeMatch[1] || 'tsx') : (run?.codex?.diff ? 'diff' : 'tsx'),
          runMeta: run ? {
            title: stripPreferenceTag(run.title) || 'tenon-workbench',
            status: run.status,
            durationSec: (((run.gemini?.durationMs || 0) + (run.codex?.durationMs || 0)) / 1000).toFixed(1),
            passed: run.reviewVerdict ? run.reviewVerdict.passed : run.status === 'completed',
          } : null,
          onToast: showToast,
        });
      }
    } else if (appState.inspectorTab === 'runs') {
      renderAgentRunsMonitor(el('inspectorRunsBox'));
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
    const rawPrompt = el('inputPrompt').value.trim();
    if (!rawPrompt) {
      showToast('请输入任务需求');
      el('inputPrompt').focus();
      return;
    }

    let mode = el('selectMode').value || 'agent-chat';
    let prompt = rawPrompt;
    const slashMap = [
      [/^\/chat(?:\s|$)/i, 'agent-chat'],
      [/^\/pipeline(?:\s|$)/i, 'full-pipeline'],
      [/^\/plan(?:\s|$)/i, 'plan-only'],
      [/^\/codex(?:\s|$)/i, 'codex-exec'],
      [/^\/review(?:\s|$)/i, 'codex-review'],
      [/^\/copy(?:\s|$)/i, 'copy-polish'],
      [/^\/agent(?:\s|$)/i, 'custom-agent'],
      [/^\/image(?:\s|$)/i, 'image-gen'],
      [/^\/video(?:\s|$)/i, 'video-gen'],
    ];
    for (const [rx, targetMode] of slashMap) {
      if (rx.test(rawPrompt)) {
        mode = targetMode;
        setModeValue(targetMode);
        prompt = rawPrompt.replace(rx, '').trim();
        break;
      }
    }
    if (!prompt) {
      showToast('请在指令后面输入具体内容');
      el('inputPrompt').focus();
      return;
    }

    if (mode === 'image-gen' || mode === 'video-gen') {
      el('inputPrompt').value = '';
      autoGrowTextarea(el('inputPrompt'));
      runLocalMediaGeneration(mode, prompt);
      return;
    }

    let selectedPrimaryModel = el('selectGeminiModel').value;
    if (mode === 'custom-agent' && !String(selectedPrimaryModel || '').startsWith('provider:')) {
      const firstEnabled = (appState.providers || []).find((p) => p.enabled);
      if (!firstEnabled) {
        showToast('请先在「设置 → Agent 与 API 接入」中启用至少一个外部 Agent 或 API');
        switchStageView('settings', 'providers');
        return;
      }
      selectedPrimaryModel = `provider:${firstEnabled.id}:${firstEnabled.defaultModel || ''}`;
      setGeminiModelValue(selectedPrimaryModel);
    }

    const parsedExtRef = parseProviderRefClient(selectedPrimaryModel);

    const rawEffort = el('selectCodexEffort').value || 'high';
    const cliEffort = window.ConduitEffortSlider
      ? window.ConduitEffortSlider.toCodexCliEffort(rawEffort)
      : rawEffort;
    const prefCtx = workspacePanels ? workspacePanels.getInstructionContext() : null;
    const LEGACY_DEFAULT_INSTR = '先给核心结论与接口契约，再用简洁中文列出验证步骤。';
    const cleanInstr =
      mode === 'agent-chat' && prefCtx?.instructions?.trim() === LEGACY_DEFAULT_INSTR
        ? ''
        : (prefCtx?.instructions || '').trim();
    const refNotes = appState.contextChips.length
      ? `\n\n[附加参考上下文: ${appState.contextChips.map((c) => c.label).join(', ')}]`
      : '';
    const prefNote =
      prefCtx && (cleanInstr || prefCtx.personality !== 'default')
        ? `\n\n[用户偏好风格: ${prefCtx.personalityName}${cleanInstr ? ` | ${cleanInstr}` : ''}]`
        : '';

    const usedExplicitPipelineSlash = /^\/(pipeline|plan|codex|review|copy|agent|image|video)(?:\s|$)/i.test(rawPrompt);
    const isInPlaceResume = Boolean(
      appState.resumeThreadId &&
      appState.currentRun &&
      appState.resumeRunId === appState.currentRun.id &&
      !appState.localRuns.has(appState.currentRun.id) &&
      appState.currentRun.status !== 'running' &&
      appState.currentRun.status !== 'awaiting_approval'
    );

    const payload = {
      mode,
      prompt: `${prompt}${refNotes}${prefNote}`,
      workspaceDir: el('inputWorkspace').value.trim(),
      geminiModel: isInPlaceResume ? 'codex:chat' : selectedPrimaryModel,
      providerId: isInPlaceResume ? '' : (parsedExtRef?.providerId || ''),
      providerModel: isInPlaceResume ? '' : (parsedExtRef?.model || ''),
      codexModel: el('selectCodexModel').value,
      codexReviewModel: el('selectCodexReviewModel').value,
      codexEffort: cliEffort,
      sandbox: el('selectSandbox').value,
      maxReviewRounds: Number(el('selectMaxRounds').value) || 2,
      codexHome: el('selectCodexHome').value,
      requireApproval: el('chkApproval').checked,
      useWorktree: el('chkWorktree').checked,
      allowCodexNetwork: Boolean(el('chkCodexNetwork')?.checked),
      timeoutMode: el('selectTimeoutMode')?.value || 'none',
      resumeThreadId: isInPlaceResume
        ? appState.resumeThreadId
        : (mode === 'codex-exec' ? appState.resumeThreadId : ''),
      forceCodexResume: isInPlaceResume,
    };

    const canContinueInPlace = Boolean(
      appState.currentRun &&
      !appState.localRuns.has(appState.currentRun.id) &&
      appState.currentRun.status !== 'running' &&
      appState.currentRun.status !== 'awaiting_approval' &&
      !usedExplicitPipelineSlash &&
      (isInPlaceResume || mode === 'agent-chat')
    );

    el('btnStartRun').disabled = true;
    try {
      const endpoint = canContinueInPlace
        ? `/api/runs/${encodeURIComponent(appState.currentRun.id)}/message`
        : '/api/runs';
      const { run } = await api(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (isInPlaceResume) clearResumeState();
      el('inputPrompt').value = '';
      autoGrowTextarea(el('inputPrompt'));
      if (appState.contextChips.length > 0) {
        appState.contextChips = [];
        renderContextChips();
      }
      appState.stickyBottom = true;
      appState.gateDirtyText = null;
      if (canvasEngine) canvasEngine.clearDemoOverlay();
      attachToRun(run);
      await loadRunsList();
    } catch (err) {
      showToast(`发送失败: ${err.message}`);
    } finally {
      el('btnStartRun').disabled = false;
    }
  }

  async function cancelCurrentRun() {
    const run = appState.currentRun;
    if (!run) return;
    if (appState.localRuns.has(run.id)) {
      run.mediaJob?._cancel?.();
      run.status = 'cancelled';
      if (run.mediaJob) {
        run.mediaJob.status = 'failed';
        run.mediaJob.errorText = '已手动中止本地媒体渲染';
        run.mediaJob._api?.update({ status: 'failed', errorText: run.mediaJob.errorText });
      }
      const idx = appState.runs.findIndex((r) => r.id === run.id);
      if (idx >= 0) appState.runs[idx].status = 'cancelled';
      renderSidebarThreads();
      renderConversationThread(run);
      showToast('已中止本地媒体渲染任务');
      return;
    }
    try {
      await api(`/api/runs/${encodeURIComponent(run.id)}/cancel`, { method: 'POST' });
      showToast('已发送中止指令');
    } catch (err) {
      showToast(`中止失败: ${err.message}`);
    }
  }

  function attachToRun(run) {
    appState.openRunSeq += 1;
    closeActiveStream();
    const runId = run.id;
    appState.currentRun = run;
    appState.gateDirtyText = null;
    renderSidebarThreads();
    renderConversationThread(run);

    if (isTerminalStatus(run.status)) return;

    const es = new EventSource(`/api/runs/${encodeURIComponent(runId)}/stream`);
    appState.activeStream = es;
    let errCount = 0;
    let probing = false;

    es.onopen = () => { errCount = 0; };

    es.addEventListener('state', (ev) => {
      if (appState.activeStream !== es || appState.currentRun?.id !== runId) {
        es.close();
        return;
      }
      errCount = 0;
      try {
        const next = JSON.parse(ev.data);
        if (next?.id && next.id !== runId) return;
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
        // Ignore malformed SSE payload
      }
    });

    es.addEventListener('event', (ev) => {
      if (appState.activeStream !== es || appState.currentRun?.id !== runId) {
        es.close();
        return;
      }
      errCount = 0;
      try {
        const item = JSON.parse(ev.data);
        if (appState.currentRun && appState.currentRun.id === runId) {
          appState.currentRun.events = appState.currentRun.events || [];
          appState.currentRun.events.push(item);
          if (appState.inspectorOpen && appState.inspectorTab === 'events') {
            renderInspectorContent(appState.currentRun);
          }
        }
      } catch {
        // Ignore malformed event payload
      }
    });

    es.onerror = () => {
      if (appState.activeStream !== es || appState.currentRun?.id !== runId) {
        es.close();
        return;
      }
      if (appState.currentRun && isTerminalStatus(appState.currentRun.status)) {
        es.close();
        appState.activeStream = null;
        return;
      }
      errCount += 1;
      if (es.readyState === EventSource.CLOSED) {
        es.close();
        appState.activeStream = null;
        return;
      }
      if (errCount >= 3 && !probing) {
        probing = true;
        api(`/api/runs/${encodeURIComponent(runId)}`)
          .then(({ run: latest }) => {
            if (appState.activeStream !== es || appState.currentRun?.id !== runId) {
              es.close();
              return;
            }
            if (latest) {
              appState.currentRun = latest;
              renderConversationThread(latest);
              if (isTerminalStatus(latest.status)) {
                es.close();
                appState.activeStream = null;
                loadRunsList();
              }
            }
          })
          .catch(() => {
            if (appState.activeStream === es) {
              es.close();
              appState.activeStream = null;
            }
          })
          .finally(() => {
            probing = false;
            if (errCount >= 5 && appState.activeStream === es) {
              es.close();
              appState.activeStream = null;
            }
          });
      }
    };
  }

  let globalRunsSyncTimer = null;
  function scheduleRunsListSync() {
    if (globalRunsSyncTimer) return;
    globalRunsSyncTimer = setTimeout(() => {
      globalRunsSyncTimer = null;
      loadRunsList();
    }, 220);
  }

  function initGlobalEvents() {
    if (appState.globalStream && appState.globalStream.readyState !== EventSource.CLOSED) return;
    if (appState.globalStream) {
      try { appState.globalStream.close(); } catch {}
      appState.globalStream = null;
    }
    if (appState.globalStreamReconnectTimer) {
      clearTimeout(appState.globalStreamReconnectTimer);
      appState.globalStreamReconnectTimer = null;
    }

    const es = new EventSource('/api/events');
    appState.globalStream = es;

    const patchSummary = (ev, isCreate = false) => {
      let summary = null;
      try { summary = JSON.parse(ev.data); } catch {}
      if (!summary || !summary.id) {
        scheduleRunsListSync();
        return;
      }
      const idx = appState.runs.findIndex((r) => r.id === summary.id);
      if (idx >= 0) {
        const prev = appState.runs[idx];
        const visuallyChanged =
          prev.title !== summary.title ||
          prev.status !== summary.status ||
          Boolean(prev.pinned) !== Boolean(summary.pinned) ||
          prev.mode !== summary.mode;
        appState.runs[idx] = { ...prev, ...summary };
        if (visuallyChanged) {
          renderSidebarThreads();
          if (appState.inspectorOpen && appState.inspectorTab === 'runs') {
            renderAgentRunsMonitor(el('inspectorRunsBox'));
          }
        }
      } else if (isCreate) {
        appState.runs = [summary, ...appState.runs];
        renderSidebarThreads();
        if (appState.inspectorOpen && appState.inspectorTab === 'runs') {
          renderAgentRunsMonitor(el('inspectorRunsBox'));
        }
      } else {
        scheduleRunsListSync();
      }
    };

    es.addEventListener('run_created', (ev) => patchSummary(ev, true));
    es.addEventListener('run_updated', (ev) => patchSummary(ev, false));
    es.addEventListener('run_deleted', (ev) => {
      let payload = null;
      try { payload = JSON.parse(ev.data); } catch {}
      const delId = payload?.id;
      if (!delId) {
        scheduleRunsListSync();
        return;
      }
      appState.runs = appState.runs.filter((r) => r.id !== delId);
      if (appState.currentRun?.id === delId) {
        resetToNewChat();
      } else {
        renderSidebarThreads();
      }
      if (appState.inspectorOpen && appState.inspectorTab === 'runs') {
        renderAgentRunsMonitor(el('inspectorRunsBox'));
      }
    });

    es.onerror = () => {
      if (appState.globalStream !== es) {
        es.close();
        return;
      }
      if (es.readyState === EventSource.CLOSED) {
        es.close();
        appState.globalStream = null;
        if (!appState.globalStreamReconnectTimer) {
          appState.globalStreamReconnectTimer = setTimeout(() => {
            appState.globalStreamReconnectTimer = null;
            initGlobalEvents();
          }, 3000);
        }
      }
    };
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
      el('welcomeEnvTag').textContent = `GEMINI CLI ${data.agy.installed ? 'READY' : 'MISSING'} · CODEX CLI ${data.codex.installed ? 'READY' : 'MISSING'}`;

      const pickBtn = el('btnPickWsFolder');
      if (pickBtn) {
        pickBtn.classList.toggle('hidden', !data.capabilities?.nativeFolderPicker);
      }
      const pickParentBtn = el('btnPickNewWsParent');
      if (pickParentBtn) {
        pickParentBtn.classList.toggle('hidden', !data.capabilities?.nativeFolderPicker);
      }
      const newParentInput = el('inputNewWsParent');
      if (newParentInput && !newParentInput.value) {
        newParentInput.value = data.defaultWorkspace || '';
      }

      if (!el('inputWorkspace').value) {
        const savedDir = loadSavedWorkspace();
        const fallbackDir = data.recommendedWorkspace || data.defaultWorkspace || data.workbenchDir || '';
        const initialDir = savedDir || fallbackDir;
        el('inputWorkspace').value = initialDir;
        const ok = await inspectCurrentWorkspace({ persist: Boolean(savedDir) });
        if (!ok && savedDir && fallbackDir && normalizeWsKey(savedDir) !== normalizeWsKey(fallbackDir)) {
          el('inputWorkspace').value = fallbackDir;
          await inspectCurrentWorkspace({ persist: true });
        }
      }

      if (!appState.discoveredWorkspaces.length && !appState.wsDiscovering) {
        loadDiscoveredWorkspaces(false);
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
      syncAllArchSelects();

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
  function parseProviderRefClient(ref) {
    const s = String(ref || '').trim();
    if (!s.startsWith('provider:')) return null;
    const rest = s.slice('provider:'.length);
    const idx = rest.indexOf(':');
    if (idx < 0) return { providerId: rest, model: '' };
    return { providerId: rest.slice(0, idx), model: rest.slice(idx + 1) };
  }

  function formatGeminiShort(id) {
    if (!id) return 'Gemini';
    const raw = String(id).trim();
    if (raw === 'codex:chat') return 'Codex · 对话';
    const ext = parseProviderRefClient(raw);
    if (ext) {
      const prov = (appState.providers || []).find((p) => p.id === ext.providerId);
      const baseName = prov ? prov.name.replace(/\s*\([^)]*\)\s*/g, '').trim() : '外部 Agent';
      const label = ext.model ? `${baseName} · ${ext.model}` : baseName;
      return label.length > 18 ? `${label.slice(0, 17)}…` : label;
    }
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
    const val = MODE_LABELS[modeVal] ? modeVal : 'agent-chat';
    el('selectMode').value = val;
    const lbl = el('labelModePicker');
    if (lbl) lbl.textContent = MODE_SHORT[val] || MODE_LABELS[val];
    const sendLbl = el('labelStartRun');
    if (sendLbl) sendLbl.textContent = val === 'agent-chat' ? '发送' : '派发协同';
    if (appState.stageView === 'workflow') renderWorkflowCanvas();
  }

  function setGeminiModelValue(id) {
    const val = id || 'gemini-4-neon-high';
    el('selectGeminiModel').value = val;
    const lbl = el('labelGeminiPicker');
    if (lbl) lbl.textContent = formatGeminiShort(val);
    const glyph = el('btnGeminiPicker')?.querySelector('.picker-glyph');
    if (glyph) {
      glyph.textContent = val === 'codex:chat' ? 'C' : String(val).startsWith('provider:') ? 'A' : 'G';
    }
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

    const enabledProviders = (appState.providers || []).filter((p) => p.enabled);
    const providerEntries = [];
    enabledProviders.forEach((p) => {
      const mlist = Array.isArray(p.models) && p.models.length > 0 ? p.models : [p.defaultModel || ''];
      mlist.slice(0, 6).forEach((mId) => {
        const ref = `provider:${p.id}:${mId}`;
        const label = mId ? `${p.name} · ${mId}` : p.name;
        if (!q || label.toLowerCase().includes(q) || String(p.protocol).toLowerCase().includes(q)) {
          providerEntries.push({
            ref,
            title: p.name,
            sub: mId || p.command || p.baseUrl || p.protocol,
            badge: p.kind === 'cli' ? 'CLI' : 'API',
          });
        }
      });
    });

    const extHtml = providerEntries.length
      ? `<div class="picker-group-label">外部 AGENT 与 API（已启用）</div>` +
        providerEntries
          .map((item) => {
            const sel = item.ref === current;
            return `
              <button type="button" class="picker-option ${sel ? 'is-selected' : ''}" role="option" aria-selected="${sel}" data-pick-gemini="${escapeHtml(item.ref)}">
                <div class="picker-opt-main">
                  <span class="picker-opt-title">${escapeHtml(item.title)}</span>
                  <span class="picker-opt-sub mono">${escapeHtml(item.sub)}</span>
                </div>
                <div class="picker-opt-right">
                  <span class="picker-badge">${escapeHtml(item.badge)}</span>
                  ${sel ? '<span class="picker-check">✓</span>' : ''}
                </div>
              </button>`;
          })
          .join('')
      : '';

    const codexChatOpt = !q || 'codex 对话 cli sandbox'.includes(q)
      ? `<div class="picker-group-label">本地 CODEX 对话引擎</div>
        <button type="button" class="picker-option ${current === 'codex:chat' ? 'is-selected' : ''}" role="option" aria-selected="${current === 'codex:chat'}" data-pick-gemini="codex:chat">
          <div class="picker-opt-main">
            <span class="picker-opt-title">Codex CLI（直接对话）</span>
            <span class="picker-opt-sub mono">自由对话模式下支持多轮续跑与工作区读写</span>
          </div>
          <div class="picker-opt-right">
            <span class="picker-badge">CODEX</span>
            ${current === 'codex:chat' ? '<span class="picker-check">✓</span>' : ''}
          </div>
        </button>`
      : '';

    const listHtml =
      !extHtml && !codexChatOpt && groups.length === 0
        ? '<div class="picker-group-label">无匹配模型</div>'
        : codexChatOpt +
          extHtml +
          groups
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
        <input type="text" class="picker-search" id="inputGeminiSearch" placeholder="搜索本机 Gemini 或外部 Agent / API..." value="${escapeHtml(appState.geminiSearch)}" autocomplete="off" />
        <button type="button" class="link-btn" id="btnPickerRefreshGemini">刷新</button>
      </div>
      <div class="picker-list-body">${listHtml}</div>
      <div class="picker-manage-foot">
        <button type="button" class="picker-manage-btn" id="btnPickerManageProviders">
          <span>+ 管理外部 Agent 与 API 接入</span>
          <span class="mono-xs">${enabledProviders.length} 已启用 →</span>
        </button>
      </div>`;

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
        loadProviders(true);
      });
    }

    el('btnPickerManageProviders')?.addEventListener('click', () => {
      closePickers();
      switchStageView('settings', 'providers');
    });

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
      if (prevAgy && (prevAgy === 'codex:chat' || prevAgy.startsWith('provider:') || agyModels.some((m) => m.id === prevAgy))) {
        setGeminiModelValue(prevAgy);
      } else if (agyModels.some((m) => m.id === 'gemini-4-neon-high')) {
        setGeminiModelValue('gemini-4-neon-high');
      } else if (agyModels.length > 0) {
        setGeminiModelValue(agyModels[0].id);
      } else {
        setGeminiModelValue('gemini-4-neon-high');
      }

      const prevCodex = el('selectCodexModel').value;
      if (prevCodex && ((data.codex || []).some((m) => m.id === prevCodex) || appState.customCodexModels.includes(prevCodex))) {
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
      syncAllArchSelects();

      if (appState.activePicker === 'gemini') renderGeminiPicker();
      if (appState.activePicker === 'codex') renderCodexPicker();
      if (refresh) showToast('已刷新本机 agy Gemini 模型列表');
      renderCliCommandCards();
      if (appState.stageView === 'workflow') renderWorkflowCanvas();
      if (appState.stageView === 'settings' && appState.settingsSection === 'telemetry') renderSettingsTelemetry();
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
      framesLayerEl: el('wfFramesLayer'),
      edgesSvgEl: el('wfEdgesSvg'),
      nodesLayerEl: el('wfNodesLayer'),
      minimapCanvasEl: el('wfMinimapCanvas'),
      contextMenuEl: el('wfContextMenu'),
      resultDrawerEl: el('wfResultDrawer'),
      resultBodyEl: el('wfResultBody'),
      resultTabsEl: el('wfResultTabs'),
      zoomLabelEl: el('btnWfZoomReset'),
      statusBarEl: el('wfStatusBar'),
      commandInputEl: el('inputWfCommand'),
      renderMarkdown,
      getContext: () => ({
        currentRun: appState.currentRun,
        geminiModels: appState.models?.agy?.models || [],
        codexModels: [
          ...(appState.models?.codex || []),
          ...appState.customCodexModels.map((id) => ({ id, label: `${id}（自定义）` })),
        ],
        providers: appState.providers || [],
        formatGeminiShort,
        formatCodexShort,
        geminiModelShort: formatGeminiShort(el('selectGeminiModel').value || 'gemini-4-neon-high'),
        codexModelShort: formatCodexShort(el('selectCodexModel').value || ''),
        codexEffort: el('selectCodexEffort')?.value || 'high',
        sandbox: el('selectSandbox')?.value || 'workspace-write',
        maxRounds: el('selectMaxRounds')?.value || '2',
        approval: Boolean(el('chkApproval')?.checked),
        worktree: Boolean(el('chkWorktree')?.checked),
        allowCodexNetwork: Boolean(el('chkCodexNetwork')?.checked),
      }),
      onOpenProviderHub: () => {
        switchStageView('settings', 'providers');
      },
      onRunProviderNode: async (providerId, model, promptText, node) => {
        const res = await api('/api/providers/run', {
          method: 'POST',
          body: JSON.stringify({
            providerId,
            model,
            prompt: promptText,
            systemPrompt: `你正在 TENON 多 Agent 节点画布中执行节点「${node?.title || '外部模型'}」。请用结构化中文直接输出可执行交付结果。`,
            cwd: el('inputWorkspace')?.value.trim() || '',
          }),
        });
        return res;
      },
      onRunCanvasNode: async ({ node, model, prompt, systemPrompt }) => {
        const rawEffort = node?.effort || el('selectCodexEffort')?.value || 'high';
        const cliEffort = window.ConduitEffortSlider
          ? window.ConduitEffortSlider.toCodexCliEffort(rawEffort)
          : rawEffort;
        const res = await api('/api/canvas/node-run', {
          method: 'POST',
          body: JSON.stringify({
            nodeKind: node?.kind || 'summary-card',
            nodeTitle: node?.title || '',
            model: model || '',
            fallbackGeminiModel: el('selectGeminiModel')?.value || 'gemini-4-neon-high',
            prompt,
            systemPrompt: systemPrompt || '',
            cwd: el('inputWorkspace')?.value.trim() || '',
            codexEffort: cliEffort,
            sandbox: el('selectSandbox')?.value || 'workspace-write',
            codexHome: el('selectCodexHome')?.value || '',
            allowCodexNetwork: Boolean(el('chkCodexNetwork')?.checked),
            timeoutMode: el('selectTimeoutMode')?.value || 'none',
          }),
        });
        return res;
      },
      onPresetChange: (presetName) => {
        const sel = el('selectWfPreset');
        if (sel && presetName) {
          sel.value = presetName;
          syncAllArchSelects();
        }
        document.querySelectorAll('[data-ic-preset]').forEach((b) => {
          b.classList.toggle('is-active', Boolean(presetName) && b.dataset.icPreset === presetName);
        });
      },
      onToggleSync: (key) => {
        if (key === 'approval') el('chkApproval').checked = !el('chkApproval').checked;
        else if (key === 'worktree') el('chkWorktree').checked = !el('chkWorktree').checked;
        else if (key === 'writable') {
          el('selectSandbox').value = el('selectSandbox').value === 'workspace-write' ? 'read-only' : 'workspace-write';
          syncAllArchSelects();
        }
        renderCliCommandCards();
      },
      onDispatchRealCli: (node, promptText) => {
        const modeMap = {
          'gemini-plan': 'plan-only',
          'gemini-copy': 'copy-polish',
          'codex-exec': 'codex-exec',
          'cluster-merge': 'full-pipeline',
          'codex-review': 'codex-review',
          'summary-card': 'agent-chat',
          'custom-agent': 'custom-agent',
          'image-gen': 'image-gen',
          'video-gen': 'video-gen',
        };
        let resolvedMode = modeMap[node?.kind] || 'full-pipeline';
        const rawM = String(node?.model || '').trim();
        if (rawM) {
          if (rawM.startsWith('provider:')) {
            setGeminiModelValue(rawM);
            if (node?.kind !== 'cluster-merge' && node?.kind !== 'gemini-plan' && node?.kind !== 'gemini-copy') {
              resolvedMode = 'custom-agent';
            }
          } else if (rawM === 'codex:default' || rawM.startsWith('codex:') || /^(gpt-|o1|o3|o4|codex)/i.test(rawM)) {
            const cleanCdx = rawM === 'codex:default' ? '' : rawM.replace(/^codex:/, '');
            setCodexModelValue(cleanCdx);
            if (node?.kind === 'gemini-plan' || node?.kind === 'gemini-copy' || node?.kind === 'summary-card') {
              resolvedMode = 'agent-chat';
              setGeminiModelValue('codex:chat');
            }
          } else {
            setGeminiModelValue(rawM);
            if (node?.kind === 'codex-exec' || node?.kind === 'codex-review') {
              resolvedMode = 'agent-chat';
            }
          }
        }
        if (node?.codexModel) {
          const cleanCdx = String(node.codexModel).replace(/^codex:/, '');
          setCodexModelValue(cleanCdx === 'default' ? '' : cleanCdx);
        }
        if (node?.effort && el('selectCodexEffort')) {
          el('selectCodexEffort').value = node.effort;
          effortSlider?.setValue(node.effort, true);
          syncAllArchSelects();
        }
        setModeValue(resolvedMode);
        const ta = el('inputPrompt');
        if (promptText && promptText.trim()) {
          ta.value = promptText.trim();
          autoGrowTextarea(ta);
        }
        if (canvasEngine) canvasEngine.clearDemoOverlay();
        switchStageView('chat');
        startRun();
      },
      onStatusChange: () => {
        syncTopbarOrb(appState.currentRun);
        if (waveEngine) waveEngine.redraw();
      },
      onToast: showToast,
    });
  }

  async function loadProviders(refresh = false) {
    try {
      const data = await api(`/api/providers${refresh ? '?refresh=1' : ''}`);
      appState.providers = data.providers || [];
      appState.localAgents = data.localAgents || { clis: [], services: [] };
      appState.providerPresets = data.presets || [];

      const countBadge = el('settingsProviderCount');
      if (countBadge) {
        countBadge.textContent = String(appState.providers.filter((p) => p.enabled).length);
      }

      // Refresh composer pill label in case a provider name updated
      if (String(el('selectGeminiModel')?.value || '').startsWith('provider:')) {
        setGeminiModelValue(el('selectGeminiModel').value);
      }
      if (appState.activePicker === 'gemini') renderGeminiPicker();
      if (appState.stageView === 'settings' && appState.settingsSection === 'providers') {
        renderSettingsProviders();
      }
      if (appState.stageView === 'workflow') renderWorkflowCanvas();
      if (refresh) showToast('已完成本机 Agent 与本地推理服务探测');
    } catch (err) {
      showToast(`加载接入列表失败: ${err.message}`);
    }
  }

  function renderSettingsProviders() {
    workspacePanels?.renderProvidersInto(el('settingsProvidersMount'), {
      providers: appState.providers,
      localAgents: appState.localAgents,
      presets: appState.providerPresets,
    });
  }

  async function saveProviderConfig(payload) {
    try {
      const data = await api('/api/providers', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      appState.providers = data.providers || appState.providers;
      renderSettingsProviders();
      if (appState.activePicker === 'gemini') renderGeminiPicker();
      if (appState.stageView === 'workflow') renderWorkflowCanvas();
      showToast(`已保存接入配置：${data.provider?.name || 'Provider'}`);
      return true;
    } catch (err) {
      showToast(`保存失败: ${err.message}`);
      return false;
    }
  }

  async function testProviderById(id) {
    try {
      const data = await api(`/api/providers/${encodeURIComponent(id)}/test`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      appState.providers = data.providers || appState.providers;
      renderSettingsProviders();
      const r = data.result;
      showToast(r?.ok ? `连接通过：${r.detail}` : `连接失败：${r?.detail || '未知错误'}`);
    } catch (err) {
      showToast(`测试连接失败: ${err.message}`);
    }
  }

  async function deleteProviderById(id) {
    try {
      const data = await api(`/api/providers/${encodeURIComponent(id)}`, { method: 'DELETE' });
      appState.providers = data.providers || [];
      renderSettingsProviders();
      if (String(el('selectGeminiModel')?.value || '').startsWith(`provider:${id}:`)) {
        setGeminiModelValue('gemini-4-neon-high');
      }
      if (appState.activePicker === 'gemini') renderGeminiPicker();
      if (appState.stageView === 'workflow') renderWorkflowCanvas();
      showToast('已删除该外部 Agent / API 接入');
    } catch (err) {
      showToast(`删除失败: ${err.message}`);
    }
  }

  function useProviderInChat(provider) {
    if (!provider) return;
    const ref = `provider:${provider.id}:${provider.defaultModel || ''}`;
    setModeValue('agent-chat');
    setGeminiModelValue(ref);
    switchStageView('chat');
    showToast(`已切换自由对话至外部引擎：${provider.name}`);
    el('inputPrompt')?.focus();
  }

  function syncUpdateBadge() {
    const info = appState.updateInfo;
    const relBtn = el('btnOpenReleases');
    if (relBtn && info?.releasesUrl) {
      relBtn.href = info.releasesUrl;
    }
    const badge = el('settingsUpdateBadge');
    if (!badge) return;
    const hasNew = Boolean(info?.lastCheck?.ok && info?.lastCheck?.hasUpdate);
    badge.textContent = hasNew ? `v${info.lastCheck.latestVersion}` : `v${info?.currentVersion || '1.0.0'}`;
    badge.classList.toggle('is-new', hasNew);
  }

  function renderSettingsUpdates() {
    syncUpdateBadge();
    workspacePanels?.renderUpdatesInto(el('settingsUpdatesMount'), {
      info: appState.updateInfo,
      checking: appState.updateChecking,
      autoCheck: appState.autoCheckUpdates,
    });
  }

  async function loadUpdateInfo() {
    try {
      appState.updateInfo = await api('/api/update/info');
      syncUpdateBadge();
      if (appState.stageView === 'settings' && appState.settingsSection === 'updates') {
        renderSettingsUpdates();
      }
    } catch {
      // Non-fatal
    }
  }

  async function checkForAppUpdates(silent = false) {
    if (appState.updateChecking) return;
    appState.updateChecking = true;
    const checkBtn = el('btnCheckUpdates');
    if (checkBtn) {
      checkBtn.disabled = true;
      checkBtn.textContent = '检测中...';
    }
    if (appState.stageView === 'settings' && appState.settingsSection === 'updates') {
      renderSettingsUpdates();
    }
    try {
      const data = await api('/api/update/check', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (data.info) appState.updateInfo = data.info;
      else if (appState.updateInfo) appState.updateInfo.lastCheck = data;
      syncUpdateBadge();
      if (!silent) {
        if (!data.ok) showToast(data.error || '更新检测失败');
        else if (data.hasUpdate) showToast(`发现新版本 TENON v${data.latestVersion}，可在设置页一键下载更新`);
        else showToast(`当前已是最新版本 v${data.currentVersion}`);
      } else if (data.ok && data.hasUpdate) {
        showToast(`发现新版本 TENON v${data.latestVersion}，前往「设置 → 软件更新与版本」查看`);
      }
    } catch (err) {
      if (!silent) showToast(`检测更新失败: ${err.message}`);
    } finally {
      appState.updateChecking = false;
      if (checkBtn) {
        checkBtn.disabled = false;
        checkBtn.textContent = '立即检测更新';
      }
      if (appState.stageView === 'settings' && appState.settingsSection === 'updates') {
        renderSettingsUpdates();
      }
    }
  }

  function stopUpdateDownloadPoll() {
    if (appState.updatePollTimer) {
      clearInterval(appState.updatePollTimer);
      appState.updatePollTimer = null;
    }
    appState.updatePollInFlight = false;
  }

  async function startAppUpdateDownload() {
    try {
      const data = await api('/api/update/download', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      appState.updateInfo = appState.updateInfo || {};
      if (data.download) {
        appState.updateInfo.download = data.download;
      }
      renderSettingsUpdates();
      showToast('正在后台下载新版安装包...');
      stopUpdateDownloadPoll();
      appState.updatePollTimer = setInterval(async () => {
        if (appState.updatePollInFlight) return;
        appState.updatePollInFlight = true;
        try {
          const st = await api('/api/update/status');
          appState.updateInfo = appState.updateInfo || {};
          if (st.download) {
            appState.updateInfo.download = st.download;
          }
          if (appState.stageView === 'settings' && appState.settingsSection === 'updates') {
            renderSettingsUpdates();
          }
          if (st.download?.state === 'downloaded') {
            stopUpdateDownloadPoll();
            showToast('新版安装包下载完成，点击「立即启动安装程序」完成升级');
          } else if (st.download?.state === 'error') {
            stopUpdateDownloadPoll();
            showToast(`安装包下载失败: ${st.download.error || '未知错误'}`);
          } else if (st.download?.state === 'idle') {
            stopUpdateDownloadPoll();
          }
        } catch {
          stopUpdateDownloadPoll();
        } finally {
          appState.updatePollInFlight = false;
        }
      }, 450);
    } catch (err) {
      showToast(`开始下载失败: ${err.message}`);
    }
  }

  async function launchAppUpdateInstaller() {
    try {
      const res = await api('/api/update/install', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      showToast(
        res.willQuitApp
          ? '已拉起新版安装向导，应用将自动退出以完成无缝升级...'
          : '已启动新版 Windows 安装程序，请按向导完成安装'
      );
    } catch (err) {
      showToast(`启动安装程序失败: ${err.message}`);
    }
  }

  function toggleAutoCheckUpdates() {
    appState.autoCheckUpdates = !appState.autoCheckUpdates;
    try { localStorage.setItem('tenon_auto_check_updates', appState.autoCheckUpdates ? '1' : '0'); } catch {}
    renderSettingsUpdates();
    showToast(appState.autoCheckUpdates ? '已开启启动时自动检测更新' : '已关闭启动时自动检测更新');
  }

  function openSettingsSection(section = 'appearance') {
    const valid = new Set(['appearance', 'providers', 'telemetry', 'instructions', 'memory', 'env', 'scripts', 'shortcuts', 'updates']);
    const sec = valid.has(section) ? section : 'appearance';
    appState.settingsSection = sec;

    document.querySelectorAll('[data-settings-sec]').forEach((btn) => {
      const active = btn.dataset.settingsSec === sec;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('[data-settings-pane]').forEach((pane) => {
      pane.classList.toggle('hidden', pane.dataset.settingsPane !== sec);
    });
    document.querySelectorAll('[data-sidebar-sec]').forEach((btn) => {
      const isSettings = appState.stageView === 'settings';
      const match =
        btn.dataset.sidebarSec === sec ||
        (btn.dataset.sidebarSec === 'instructions' && sec === 'memory');
      btn.classList.toggle('is-active', isSettings && match);
    });

    if (sec === 'providers') {
      renderSettingsProviders();
      loadProviders(false);
    }
    if (sec === 'updates') {
      renderSettingsUpdates();
      loadUpdateInfo();
    }
    if (sec === 'scripts' && !appState.assets) loadAssets();
    if (sec === 'env') loadHealth();
    if (sec === 'telemetry') renderSettingsTelemetry();
    if (sec === 'instructions') workspacePanels?.renderInstructionsInto(el('settingsInstructionsMount'));
    if (sec === 'memory') workspacePanels?.renderMemoryInto(el('settingsMemoryMount'));
    if (sec === 'shortcuts') workspacePanels?.renderShortcutsInto(el('settingsShortcutsMount'));
  }

  function renderSettingsTelemetry() {
    workspacePanels?.renderTelemetryInto(el('settingsTelemetryMount'), {
      runs: appState.runs,
      health: appState.health,
      geminiModels: appState.models?.agy?.models || [],
      codexModels: appState.models?.codex || [],
      workspaceDir: el('inputWorkspace')?.value.trim() || '',
    });
  }

  function switchStageView(view, settingsSection = null) {
    const next = view === 'workflow' ? 'workflow' : view === 'settings' ? 'settings' : 'chat';
    if (appState.stageView === 'chat' || appState.stageView === 'workflow') {
      appState.lastWorkView = appState.stageView;
    }
    appState.stageView = next;
    el('conversationViewport').classList.toggle('hidden', next !== 'chat');
    el('workflowStage').classList.toggle('hidden', next !== 'workflow');
    el('settingsStage')?.classList.toggle('hidden', next !== 'settings');
    const topbar = document.querySelector('.stage-topbar');
    if (topbar) topbar.classList.toggle('is-workflow-mode', next === 'workflow');
    const composerDock = document.querySelector('.composer-dock');
    if (composerDock) composerDock.classList.toggle('hidden', next !== 'chat');
    closeAllPopovers();
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

    if (next === 'settings') {
      openSettingsSection(settingsSection || appState.settingsSection || 'appearance');
    } else {
      document.querySelectorAll('[data-sidebar-sec]').forEach((b) => b.classList.remove('is-active'));
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

  function normalizeWsKey(p) {
    return String(p || '').trim().replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase();
  }

  function loadSavedWorkspace() {
    try {
      return String(localStorage.getItem('tenon_last_workspace') || '').trim();
    } catch {
      return '';
    }
  }

  function saveWorkspacePath(dir) {
    try {
      const clean = String(dir || '').trim();
      if (clean) localStorage.setItem('tenon_last_workspace', clean);
    } catch {
      // Ignore storage quota / private mode
    }
  }

  function formatSourceLabel(src, activeAgent) {
    if (src === 'codex') return activeAgent ? 'CODEX 活跃' : 'CODEX';
    if (src === 'claude') return 'CLAUDE';
    if (src === 'gemini') return 'GEMINI';
    if (src === 'tenon') return 'TENON';
    if (src === 'git') return 'GIT';
    return String(src || '').toUpperCase();
  }

  function renderDiscoveredWorkspaces() {
    const list = el('wsDiscoveredList');
    const summaryEl = el('wsDiscoverSummary');
    if (!list) return;

    const items = appState.discoveredWorkspaces || [];
    const s = appState.discoveredSummary;
    if (summaryEl) {
      if (appState.wsDiscovering) {
        summaryEl.textContent = '正在扫描本机 Codex / Claude / Git 仓库...';
      } else if (appState.wsDiscoverError) {
        summaryEl.textContent = `扫描失败：${appState.wsDiscoverError}`;
      } else if (s && s.total > 0) {
        const parts = [];
        if (s.codex) parts.push(`Codex ${s.codex}`);
        if (s.claude) parts.push(`Claude ${s.claude}`);
        if (s.gemini) parts.push(`Gemini ${s.gemini}`);
        if (s.tenon) parts.push(`历史 ${s.tenon}`);
        if (s.git) parts.push(`Git ${s.git}`);
        summaryEl.textContent = `自动探测 ${s.total} 项${parts.length ? `（${parts.join(' · ')}）` : ''}`;
      } else {
        summaryEl.textContent = '未探测到活跃 Agent 目录，请手动输入路径';
      }
    }

    el('wsFilterPills')?.querySelectorAll('.ws-filter-pill').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.wsFilter === appState.wsDiscoverFilter);
    });

    if (appState.wsDiscovering && items.length === 0) {
      list.innerHTML = '<div class="ws-discover-empty mono-xs">正在扫描 Codex / Claude / 本机 Git 仓库...</div>';
      return;
    }

    if (appState.wsDiscoverError && items.length === 0) {
      list.innerHTML = `<div class="ws-discover-empty mono-xs is-error">扫描工作目录失败：${escapeHtml(appState.wsDiscoverError)}（可点击「重新扫描」或下方手动输入路径）</div>`;
      return;
    }

    const filtered = items.filter((w) => {
      if (appState.wsDiscoverFilter === 'agent') {
        return (w.sources || []).some((src) => src !== 'git');
      }
      if (appState.wsDiscoverFilter === 'dirty') {
        return Number(w.changedCount) > 0;
      }
      return true;
    });

    if (filtered.length === 0) {
      const hint = appState.wsDiscoverFilter === 'dirty'
        ? '当前探测到的仓库均无未提交变更'
        : appState.wsDiscoverFilter === 'agent'
          ? '未检测到 Codex / Claude / Gemini 历史工作目录'
          : '未探测到本机工程目录，可在下方手动填写路径';
      list.innerHTML = `<div class="ws-discover-empty mono-xs">${escapeHtml(hint)}</div>`;
      return;
    }

    const activeKey = normalizeWsKey(el('inputWorkspace')?.value || '');
    list.innerHTML = '';

    filtered.forEach((w) => {
      const isActive = activeKey && normalizeWsKey(w.path) === activeKey;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `ws-discover-item${isActive ? ' is-active' : ''}`;
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', String(Boolean(isActive)));
      btn.title = w.path;

      const agentSources = (w.sources || []).filter((src) => src !== 'git');
      const displaySources = agentSources.length > 0 ? agentSources.slice(0, 2) : ['git'];
      const srcHtml = displaySources
        .map((src) => {
          const isLive = Boolean(w.activeAgent && src === 'codex');
          return `<span class="ws-src-tag${isLive ? ' is-live' : ''}">${escapeHtml(formatSourceLabel(src, isLive))}</span>`;
        })
        .join('');

      let dirtyHtml = '';
      if (w.isGitRepo && w.highRiskCount > 0) {
        dirtyHtml = `<span class="ws-dirty-tag is-risk">${w.changedCount} 变更 · 高危</span>`;
      } else if (w.isGitRepo && w.changedCount > 0) {
        dirtyHtml = `<span class="ws-dirty-tag">${w.changedCount} 变更</span>`;
      } else if (!w.isGitRepo) {
        dirtyHtml = '<span class="ws-dirty-tag">NO-GIT</span>';
      }

      const branchText = w.isGitRepo ? (w.branch || 'HEAD') : '';

      btn.innerHTML = `
        <div class="ws-item-top">
          <div class="ws-item-title-group">
            <span class="ws-item-dot" aria-hidden="true"></span>
            <span class="ws-item-name">${escapeHtml(w.name)}</span>
          </div>
          <div class="ws-item-badges">${srcHtml}${dirtyHtml}</div>
        </div>
        <div class="ws-item-bottom">
          <span class="ws-item-path">${escapeHtml(w.path)}</span>
          ${branchText ? `<span class="ws-item-branch">${escapeHtml(branchText)}</span>` : ''}
        </div>
      `;

      btn.addEventListener('click', () => {
        selectWorkspace(w.path, { closePopover: true, notify: true });
      });

      list.appendChild(btn);
    });
  }

  async function loadDiscoveredWorkspaces(force = false) {
    appState.wsDiscovering = true;
    appState.wsDiscoverError = '';
    renderDiscoveredWorkspaces();
    try {
      const data = await api(`/api/workspace/discover${force ? '?refresh=1' : ''}`);
      appState.discoveredWorkspaces = Array.isArray(data.workspaces) ? data.workspaces : [];
      appState.discoveredSummary = data.summary || null;
      appState.wsDiscoverError = '';
      if (force) {
        showToast(`已扫描完成：发现 ${appState.discoveredWorkspaces.length} 个工作目录`);
      }
    } catch (err) {
      appState.wsDiscoverError = err.message || '网络或文件系统异常';
      if (force) showToast(`自动探测目录失败: ${err.message}`);
    } finally {
      appState.wsDiscovering = false;
      renderDiscoveredWorkspaces();
    }
  }

  function validateWorkspaceFolderName(rawName) {
    const name = String(rawName || '').trim();
    if (!name) return '请输入工程名称';
    if (name === '.' || name === '..') return '工程名称不能为 . 或 ..';
    if (/[<>:"/\\|?*\x00-\x1f]/.test(name)) return '名称包含非法路径字符（<>:"/\\|?*）';
    if (/[. ]$/.test(name)) return 'Windows 目录名不能以句点或空格结尾';
    return '';
  }

  function formatTodayStamp() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function updateNewWsPreview() {
    const preview = el('wsCreatePreview');
    if (!preview) return;
    const rawName = (el('inputNewWsName')?.value || '').trim();
    const parent = (el('inputNewWsParent')?.value || '').trim().replace(/[\\/]+$/, '');
    const withDate = Boolean(el('chkNewWsDate')?.checked);
    preview.classList.remove('is-error');
    if (!rawName) {
      preview.textContent = '请输入工程名称以预览创建路径';
      return;
    }
    const nameErr = validateWorkspaceFolderName(rawName);
    if (nameErr) {
      preview.classList.add('is-error');
      preview.textContent = `路径校验未通过：${nameErr}`;
      return;
    }
    const hasDate = /_\d{4}-\d{2}-\d{2}$/.test(rawName);
    const folder = withDate && !hasDate ? `${rawName}_${formatTodayStamp()}` : rawName;
    const sep = parent.includes('/') && !parent.includes('\\') ? '/' : '\\';
    preview.textContent = parent ? `将创建：${parent}${sep}${folder}` : `将创建：${folder}`;
  }

  function setWsPopoverMode(mode) {
    const isCreate = mode === 'create';
    el('wsBrowseView')?.classList.toggle('hidden', isCreate);
    el('wsCreatePanel')?.classList.toggle('hidden', !isCreate);
    el('btnRescanWs')?.classList.toggle('hidden', isCreate);
    const toggleBtn = el('btnToggleNewWs');
    if (toggleBtn) toggleBtn.textContent = isCreate ? '返回列表' : '+ 新建工程';
    const titleEl = el('wsPopoverTitle');
    if (titleEl) titleEl.textContent = isCreate ? 'WORKSPACE · 新建本地工程' : 'WORKSPACE · AGENT 自动探测';

    if (isCreate) {
      const parentInput = el('inputNewWsParent');
      if (parentInput && !parentInput.value.trim()) {
        const cur = (el('inputWorkspace')?.value || '').trim();
        const curParent = cur ? cur.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]+$/, '') : '';
        parentInput.value = appState.health?.defaultWorkspace || curParent || '';
      }
      updateNewWsPreview();
      requestAnimationFrame(() => el('inputNewWsName')?.focus());
    }
  }

  async function submitCreateWorkspace() {
    const btn = el('btnCreateWsSubmit');
    const name = (el('inputNewWsName')?.value || '').trim();
    const parentDir = (el('inputNewWsParent')?.value || '').trim();
    const appendDate = Boolean(el('chkNewWsDate')?.checked);
    const initGit = Boolean(el('chkNewWsGit')?.checked);
    const nameErr = validateWorkspaceFolderName(name);
    if (nameErr) {
      showToast(nameErr);
      updateNewWsPreview();
      el('inputNewWsName')?.focus();
      return;
    }
    if (!parentDir) {
      showToast('请指定存放父目录');
      el('inputNewWsParent')?.focus();
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.textContent = '正在创建...';
    }
    try {
      const res = await api('/api/workspace/create', {
        method: 'POST',
        body: JSON.stringify({ name, parentDir, appendDate, initGit, createReadme: true }),
      });
      if (el('inputNewWsName')) el('inputNewWsName').value = '';
      setWsPopoverMode('browse');
      await selectWorkspace(res.path, { closePopover: true, notify: false });
      loadDiscoveredWorkspaces(true);
      const gitMsg = res.gitInitialized ? '（已初始化 Git）' : '';
      showToast(`已新建并切换工程：${res.name}${gitMsg}`);
    } catch (err) {
      showToast(`新建工程失败: ${err.message}`);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '创建并切换';
      }
    }
  }

  async function selectWorkspace(dir, opts = {}) {
    const clean = String(dir || '').trim();
    if (!clean) return;
    el('inputWorkspace').value = clean;
    saveWorkspacePath(clean);
    if (appState.resumeThreadId) {
      clearResumeState();
    }
    renderDiscoveredWorkspaces();
    const ok = await inspectCurrentWorkspace({ persist: true });
    if (opts.closePopover) {
      el('wsPopover')?.classList.add('hidden');
      el('btnWsPopover')?.setAttribute('aria-expanded', 'false');
    }
    if (opts.notify && ok) {
      const baseName = clean.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || clean;
      showToast(`已切换工作目录：${baseName}`);
    }
  }

  async function inspectCurrentWorkspace(opts = {}) {
    const dir = el('inputWorkspace').value.trim();
    const box = el('wsTelemetry');
    const inspectBtn = el('btnInspectWs');
    if (!dir) {
      el('wsShortName').textContent = '选择工作目录';
      el('wsBranchPill').textContent = '—';
      el('wsSubStatus').textContent = '点击配置目录路径';
      if (box) {
        box.innerHTML = opts.explicit
          ? '<span class="risk-flag">请先输入有效的本地绝对路径，或点击「浏览...」选择文件夹</span>'
          : '';
      }
      if (opts.explicit) showToast('请先输入或选择工程目录路径');
      appState.workspaceFiles = [];
      return false;
    }

    const baseName = dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || dir;
    el('wsShortName').textContent = baseName;
    el('wsShortName').title = dir;
    el('btnWsPopover').title = `当前工作目录：${dir}\n点击切换或重新扫描 Agent 目录`;
    if (inspectBtn) inspectBtn.disabled = true;

    try {
      const info = await api(`/api/workspace/inspect?dir=${encodeURIComponent(dir)}`);
      if (opts.persist !== false) saveWorkspacePath(dir);
      const matched = (appState.discoveredWorkspaces || []).find(
        (w) => normalizeWsKey(w.path) === normalizeWsKey(dir)
      );
      const agentTags = matched ? (matched.sources || []).filter((s) => s !== 'git') : [];
      const bits = [];
      if (agentTags.length > 0) {
        bits.push(`<span class="branch-flag">AGENT: ${escapeHtml(agentTags.map((s) => s.toUpperCase()).join(' · '))}</span>`);
      }
      if (info.isGitRepo) {
        el('wsBranchPill').textContent = info.branch || 'HEAD';
        el('wsBranchPill').title = info.branch || 'HEAD';
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
      renderDiscoveredWorkspaces();
      return true;
    } catch (err) {
      el('wsBranchPill').textContent = 'ERR';
      el('wsSubStatus').textContent = err.message;
      box.innerHTML = `<span class="risk-flag">${escapeHtml(err.message)}</span>`;
      appState.workspaceFiles = [];
      return false;
    } finally {
      if (inspectBtn) inspectBtn.disabled = false;
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
     Custom Architectural Dropdown Engine (Zero Native OS <select> Popups!)
     Replaces every native <select> with a crisp Figma Weave fixed portal menu
     while keeping underlying <select>.value and change events 100% synced.
     ========================================================================= */
  const archSelectEntries = [];
  let archPortalEl = null;
  let activeArchEntry = null;

  function closeArchSelect() {
    if (activeArchEntry) {
      activeArchEntry.trigger.setAttribute('aria-expanded', 'false');
      activeArchEntry = null;
    }
    if (archPortalEl) archPortalEl.classList.add('hidden');
  }

  function syncAllArchSelects() {
    archSelectEntries.forEach((entry) => {
      const sel = entry.select;
      const opt = sel.options[sel.selectedIndex] || sel.options[0];
      entry.labelEl.textContent = opt ? opt.textContent : '—';
    });
  }

  function openArchSelect(entry) {
    if (!archPortalEl) return;
    if (activeArchEntry === entry) {
      closeArchSelect();
      return;
    }
    closeArchSelect();
    activeArchEntry = entry;
    entry.trigger.setAttribute('aria-expanded', 'true');

    const sel = entry.select;
    const opts = Array.from(sel.options);
    archPortalEl.innerHTML = opts
      .map((o, idx) => {
        const selected = idx === sel.selectedIndex;
        return `
          <button type="button" class="arch-select-opt ${selected ? 'is-selected' : ''}" role="option" aria-selected="${selected}" data-opt-idx="${idx}">
            <span class="arch-select-opt-text">${escapeHtml(o.textContent)}</span>
            ${selected ? '<span class="arch-select-check" aria-hidden="true">✓</span>' : ''}
          </button>`;
      })
      .join('');

    archPortalEl.querySelectorAll('[data-opt-idx]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = Number(btn.dataset.optIdx);
        if (sel.selectedIndex !== idx && sel.options[idx]) {
          sel.selectedIndex = idx;
          sel.value = sel.options[idx].value;
          syncAllArchSelects();
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
        closeArchSelect();
      });
    });

    archPortalEl.classList.remove('hidden');
    const rect = entry.trigger.getBoundingClientRect();
    const minW = Math.max(rect.width, entry.isCompact ? 176 : 200);
    const maxW = Math.min(340, window.innerWidth - 20);
    const menuW = Math.min(maxW, minW);
    archPortalEl.style.width = `${menuW}px`;

    const menuH = Math.min(280, archPortalEl.scrollHeight + 10);
    const spaceBelow = window.innerHeight - rect.bottom - 10;
    const openUp = spaceBelow < menuH && rect.top > menuH + 10;
    const top = openUp ? Math.max(10, rect.top - menuH - 5) : Math.min(window.innerHeight - menuH - 10, rect.bottom + 5);
    const left = Math.max(10, Math.min(rect.left, window.innerWidth - menuW - 10));

    archPortalEl.style.left = `${left}px`;
    archPortalEl.style.top = `${top}px`;
    archPortalEl.dataset.dir = openUp ? 'up' : 'down';
  }

  function initArchitecturalSelects() {
    if (!archPortalEl) {
      archPortalEl = document.createElement('div');
      archPortalEl.id = 'archSelectPortal';
      archPortalEl.className = 'arch-select-menu hidden';
      archPortalEl.setAttribute('role', 'listbox');
      document.body.appendChild(archPortalEl);
    }

    document.querySelectorAll('select.select-input, select.ic-preset-select').forEach((sel) => {
      if (sel.dataset.archEnhanced) return;
      sel.dataset.archEnhanced = '1';
      const isCompact = sel.classList.contains('ic-preset-select');
      sel.classList.add('native-select-hidden');
      sel.setAttribute('tabindex', '-1');
      sel.setAttribute('aria-hidden', 'true');

      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = `arch-select-trigger ${isCompact ? 'is-compact' : 'mono'}`;
      trigger.setAttribute('aria-haspopup', 'listbox');
      trigger.setAttribute('aria-expanded', 'false');
      if (sel.getAttribute('aria-label')) trigger.setAttribute('aria-label', sel.getAttribute('aria-label'));

      const labelEl = document.createElement('span');
      labelEl.className = 'arch-select-label';
      const chev = document.createElement('span');
      chev.className = 'arch-select-chev';
      chev.setAttribute('aria-hidden', 'true');
      chev.innerHTML = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

      trigger.appendChild(labelEl);
      trigger.appendChild(chev);
      sel.insertAdjacentElement('afterend', trigger);

      const entry = { select: sel, trigger, labelEl, isCompact };
      archSelectEntries.push(entry);

      trigger.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openArchSelect(entry);
      });

      trigger.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          openArchSelect(entry);
        } else if (e.key === 'Escape') {
          closeArchSelect();
        }
      });

      sel.addEventListener('change', syncAllArchSelects);
      if (typeof MutationObserver !== 'undefined') {
        new MutationObserver(syncAllArchSelects).observe(sel, { childList: true, subtree: true, attributes: true });
      }
    });

    syncAllArchSelects();
    window.addEventListener('resize', closeArchSelect);
    window.addEventListener(
      'scroll',
      (e) => {
        if (archPortalEl && (e.target === archPortalEl || archPortalEl.contains(e.target))) return;
        closeArchSelect();
      },
      true
    );
  }

  /* =========================================================================
     Popovers, Drawers & Event Wiring
     ========================================================================= */
  function closeAllPopovers(exceptId = '') {
    closeArchSelect();
    ['wsPopover', 'guardrailsPopover', 'composerOrbPopover'].forEach((id) => {
      if (id !== exceptId) el(id)?.classList.add('hidden');
    });
    if (exceptId !== 'wsPopover') {
      el('btnWsPopover')?.setAttribute('aria-expanded', 'false');
    }
    if (exceptId !== 'guardrailsPopover') {
      el('btnGuardrailsPopover')?.setAttribute('aria-expanded', 'false');
    }
    if (exceptId !== 'composerOrbPopover') {
      el('btnQuickPlan')?.setAttribute('aria-expanded', 'false');
    }
    if (!exceptId) closePickers();
  }

  function closeMobileDrawers() {
    el('sidebar')?.classList.remove('is-mobile-open');
    el('drawerBackdrop')?.classList.add('hidden');
  }

  function toggleTweaks(forceOpen = null) {
    if (forceOpen === false) {
      if (appState.stageView === 'settings') switchStageView(appState.lastWorkView || 'chat');
      return;
    }
    if (appState.stageView === 'settings' && appState.settingsSection === 'appearance' && forceOpen === null) {
      switchStageView(appState.lastWorkView || 'chat');
    } else {
      switchStageView('settings', 'appearance');
    }
  }

  function bindEvents() {
    initFluidTrack(el('inspectorTabs'));
    initFluidTrack(el('stageViewTabs'));

    // Topbar View Switcher (对话流 / 节点画布)
    el('stageViewTabs')?.querySelectorAll('.stage-view-tab').forEach((btn) => {
      btn.addEventListener('click', () => switchStageView(btn.dataset.stageView));
    });

    // Blender-Style Infinite Canvas Floating HUD Controls
    document.querySelectorAll('[data-ic-add]').forEach((btn) => {
      btn.addEventListener('click', () => { if (canvasEngine) canvasEngine.addNode(btn.dataset.icAdd); });
    });
    el('selectWfPreset')?.addEventListener('change', (e) => {
      if (canvasEngine && e.target.value) canvasEngine.loadPreset(e.target.value);
    });
    document.querySelectorAll('[data-ic-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-ic-preset]').forEach((b) => b.classList.toggle('is-active', b === btn));
        if (canvasEngine) canvasEngine.loadPreset(btn.dataset.icPreset);
      });
    });
    el('btnWfRunAll')?.addEventListener('click', () => { if (canvasEngine) canvasEngine.dispatchFlowReal(); });
    el('btnWfPreviewAll')?.addEventListener('click', () => { if (canvasEngine) canvasEngine.runClusterDemo(); });
    el('btnWfDrawerToggle')?.addEventListener('click', () => { if (canvasEngine) canvasEngine.toggleResultDrawer(); });
    el('btnWfDrawerClose')?.addEventListener('click', () => { if (canvasEngine) canvasEngine.closeResultDrawer(); });
    el('btnWfLayout')?.addEventListener('click', () => { if (canvasEngine) canvasEngine.autoLayout(); });
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

    const fireCanvasCmd = () => {
      const inp = el('inputWfCommand');
      const txt = (inp?.value || '').trim();
      if (canvasEngine) canvasEngine.dispatchFlowReal(txt);
    };
    el('btnWfCommandRun')?.addEventListener('click', fireCanvasCmd);
    el('inputWfCommand')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); fireCanvasCmd(); }
    });

    const fireDrawerFollowup = () => {
      const inp = el('inputWfFollowup');
      const txt = (inp?.value || '').trim();
      if (!txt) return;
      if (el('inputWfCommand')) el('inputWfCommand').value = txt;
      inp.value = '';
      if (canvasEngine) canvasEngine.dispatchFlowReal(txt);
    };
    el('btnWfFollowupSend')?.addEventListener('click', fireDrawerFollowup);
    el('inputWfFollowup')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); fireDrawerFollowup(); }
    });
    ['chkApproval', 'chkWorktree', 'chkCodexNetwork', 'selectSandbox', 'selectCodexEffort', 'selectCodexReviewModel', 'selectMaxRounds'].forEach((id) => {
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
      reclampPanesFn();
      setTimeout(() => {
        if (waveEngine) waveEngine.resize();
        syncAllFluidTracks();
      }, 240);
    });

    window.addEventListener('resize', () => {
      reclampPanesFn();
      if (window.innerWidth > 820 && el('sidebar').classList.contains('is-mobile-open')) {
        closeMobileDrawers();
      }
      document.querySelectorAll('.branch-deck-wrap').forEach((wrap) => {
        const rid = wrap.dataset.branchRun;
        const expanded = appState.currentRun?.status === 'running' ? true : Boolean(appState.branchDeckOpen.get(rid));
        const selectedId = appState.branchSelected.get(rid) || wrap.dataset.branchSelected || 'contract-gate';
        applyBranchDeckLayout(wrap, expanded, selectedId);
      });
      requestAnimationFrame(syncAllFluidTracks);
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

    // Starter copy cards + direct Canvas entry on clean App Empty State
    el('btnStarterOpenCanvas')?.addEventListener('click', () => {
      switchStageView('workflow');
    });
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
        if (appState.currentRun) {
          appState.currentRun.codex = appState.currentRun.codex || {};
          appState.currentRun.codex.diff = info.diff || '';
        } else {
          appState.standaloneDiff = info.diff || '';
        }
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
      el('btnWsPopover')?.setAttribute('aria-expanded', String(open));
      if (open) {
        setWsPopoverMode('browse');
        if (appState.discoveredWorkspaces.length === 0 && !appState.wsDiscovering) {
          loadDiscoveredWorkspaces(false);
        } else {
          renderDiscoveredWorkspaces();
        }
      }
    });
    el('btnCloseWsPopover').addEventListener('click', () => {
      setWsPopoverMode('browse');
      el('wsPopover').classList.add('hidden');
      el('btnWsPopover')?.setAttribute('aria-expanded', 'false');
    });
    el('btnToggleNewWs')?.addEventListener('click', () => {
      const inCreate = !el('wsCreatePanel')?.classList.contains('hidden');
      setWsPopoverMode(inCreate ? 'browse' : 'create');
    });
    el('btnCancelNewWs')?.addEventListener('click', () => setWsPopoverMode('browse'));
    el('inputNewWsName')?.addEventListener('input', updateNewWsPreview);
    el('inputNewWsParent')?.addEventListener('input', updateNewWsPreview);
    el('chkNewWsDate')?.addEventListener('change', updateNewWsPreview);
    el('inputNewWsName')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitCreateWorkspace();
      }
    });
    el('btnCreateWsSubmit')?.addEventListener('click', submitCreateWorkspace);
    el('btnPickNewWsParent')?.addEventListener('click', async () => {
      const btn = el('btnPickNewWsParent');
      if (btn?.disabled) return;
      if (btn) btn.disabled = true;
      try {
        const res = await api('/api/workspace/pick', {
          method: 'POST',
          body: JSON.stringify({ defaultPath: el('inputNewWsParent')?.value.trim() || '' }),
        });
        if (res.supported === false) {
          showToast('当前环境不支持原生文件夹选择器，请直接粘贴父目录路径');
        } else if (res.path && el('inputNewWsParent')) {
          el('inputNewWsParent').value = res.path;
          updateNewWsPreview();
        }
      } catch (err) {
        showToast(`选择父目录失败: ${err.message}`);
      } finally {
        if (btn) btn.disabled = false;
      }
    });
    el('btnRescanWs')?.addEventListener('click', () => loadDiscoveredWorkspaces(true));
    el('wsFilterPills')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.ws-filter-pill');
      if (!btn || !btn.dataset.wsFilter) return;
      appState.wsDiscoverFilter = btn.dataset.wsFilter;
      renderDiscoveredWorkspaces();
    });
    el('btnPickWsFolder')?.addEventListener('click', async () => {
      const btn = el('btnPickWsFolder');
      if (btn?.disabled) return;
      if (btn) btn.disabled = true;
      try {
        const res = await api('/api/workspace/pick', {
          method: 'POST',
          body: JSON.stringify({ defaultPath: el('inputWorkspace').value.trim() }),
        });
        if (res.supported === false) {
          showToast('当前环境不支持原生文件夹选择器，请直接粘贴目录路径');
        } else if (res.path) {
          await selectWorkspace(res.path, { closePopover: true, notify: true });
        }
      } catch (err) {
        showToast(`打开文件夹选择器失败: ${err.message}`);
      } finally {
        if (btn) btn.disabled = false;
      }
    });
    el('btnInspectWs').addEventListener('click', () => inspectCurrentWorkspace({ persist: true, explicit: true }));
    el('inputWorkspace').addEventListener('change', () => {
      if (appState.resumeThreadId) {
        clearResumeState();
      }
      inspectCurrentWorkspace({ persist: true });
    });
    el('inputWorkspace').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        inspectCurrentWorkspace({ persist: true });
      }
    });

    el('btnGuardrailsPopover').addEventListener('click', () => {
      const open = el('guardrailsPopover').classList.contains('hidden');
      closeAllPopovers(open ? 'guardrailsPopover' : '');
      el('guardrailsPopover').classList.toggle('hidden', !open);
      el('btnGuardrailsPopover').setAttribute('aria-expanded', String(open));
      if (open && effortSlider) requestAnimationFrame(() => effortSlider.syncTheme());
    });

    el('btnCommandPalette')?.addEventListener('click', () => workspacePanels?.openPalette());
    el('btnOpenPreferences')?.addEventListener('click', () => {
      closeMobileDrawers();
      switchStageView('settings', 'instructions');
    });
    el('btnOpenShortcuts')?.addEventListener('click', () => {
      closeMobileDrawers();
      switchStageView('settings', 'shortcuts');
    });
    el('btnEnvPopover')?.addEventListener('click', () => {
      closeMobileDrawers();
      switchStageView('settings', 'env');
    });
    el('btnOpenStudio')?.addEventListener('click', () => {
      closeMobileDrawers();
      switchStageView('settings', 'scripts');
    });
    el('btnSettingsBack')?.addEventListener('click', () => {
      switchStageView(appState.lastWorkView || 'chat');
    });
    document.querySelectorAll('[data-settings-sec]').forEach((btn) => {
      btn.addEventListener('click', () => openSettingsSection(btn.dataset.settingsSec));
    });
    el('btnRefreshHealth')?.addEventListener('click', loadHealth);
    el('btnRefreshModels')?.addEventListener('click', () => loadModels(true));
    el('btnSettingsRefreshModels')?.addEventListener('click', () => loadModels(true));
    el('btnRefreshTelemetry')?.addEventListener('click', () => {
      loadRunsList();
      renderSettingsTelemetry();
      showToast('已刷新协同遥测指标');
    });

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
    bindTrigger('btnAttachContext', '@');

    // One-Click Topbar Light/Dark Theme Toggle (21st.dev #37503)
    el('btnThemeToggle')?.addEventListener('click', (e) => toggleLightDarkTheme(e));

    // Infinite Canvas Blender Node Group & Dot-Grid / Drafting Grid / Solid Cycle
    el('btnWfAddGroup')?.addEventListener('click', () => canvasEngine?.createNodeGroup());
    el('btnWfGridCycle')?.addEventListener('click', () => {
      const order = ['dots', 'grid', 'solid'];
      const cur = appState.tweaks.canvasGrid || 'dots';
      const next = order[(order.indexOf(cur) + 1) % order.length];
      appState.tweaks.canvasGrid = next;
      applyTweaks();
      saveTweaks();
      const names = { dots: '点状网格', grid: '制图细格', solid: '纯粹素面' };
      showToast(`无限画布底纹已切换为：${names[next]}`);
    });

    promptTa.addEventListener('input', () => {
      cancelBlur();
      autoGrowTextarea(promptTa);
      evaluatePromptTrigger();
      if (appState.orbPreviewState) {
        clearOrbDemoTimers();
        appState.orbPreviewState = null;
      }
      syncTopbarOrb(appState.currentRun);
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
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        startRun();
        return;
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
      clearOrbDemoTimers();
      appState.orbPreviewState = null;
      appState.orbPaused = false;
      closeAllPopovers();
      if (appState.stageView === 'workflow') switchStageView('chat');
      startRun();
    });
    el('btnQuickPlan').addEventListener('click', (e) => {
      e.stopPropagation();
      const pop = el('composerOrbPopover');
      if (!pop) return;
      const opening = pop.classList.contains('hidden');
      closeAllPopovers(opening ? 'composerOrbPopover' : '');
      pop.classList.toggle('hidden', !opening);
      el('btnQuickPlan')?.setAttribute('aria-expanded', String(opening));
      if (opening) {
        renderComposerOrbPopoverGrid();
        syncTopbarOrb(appState.currentRun);
      }
    });
    el('btnOrbPopPrimary')?.addEventListener('click', async () => {
      const isRunActive = Boolean(appState.currentRun && (appState.currentRun.status === 'running' || appState.currentRun.status === 'awaiting_approval'));
      if (isRunActive) {
        await cancelCurrentRun();
        return;
      }
      closeAllPopovers();
      if ((el('inputPrompt')?.value || '').trim()) {
        startRun();
      } else {
        el('inputPrompt')?.focus();
        showToast('请在对话框输入需求，按 Ctrl+Enter 立即启动');
      }
    });
    el('btnOrbPopPause')?.addEventListener('click', () => {
      clearOrbDemoTimers();
      appState.orbPaused = !appState.orbPaused;
      syncTopbarOrb(appState.currentRun);
      showToast(appState.orbPaused ? '对话流信号动效已暂停' : '对话流信号动效已恢复');
    });
    el('btnOrbPopDemo')?.addEventListener('click', () => {
      clearOrbDemoTimers();
      appState.orbPaused = false;
      const seq = ['listening', 'thinking', 'tool-call', 'tool-result', 'reasoning', 'streaming', 'waiting-approval', 'error', 'done'];
      seq.forEach((st, idx) => {
        appState.orbDemoTimers.push(setTimeout(() => {
          appState.orbPreviewState = st;
          syncTopbarOrb(appState.currentRun);
        }, idx * 1050));
      });
      appState.orbDemoTimers.push(setTimeout(() => {
        appState.orbPreviewState = null;
        syncTopbarOrb(appState.currentRun);
      }, seq.length * 1050 + 900));
    });
    el('btnCancelRun').addEventListener('click', () => {
      cancelCurrentRun();
    });

    el('btnClearResume').addEventListener('click', () => {
      clearResumeState();
    });
    el('btnResumeNow')?.addEventListener('click', () => {
      const ta = el('inputPrompt');
      if (ta && !ta.value.trim()) {
        ta.value = '请从上次中断处继续完成刚才的任务。';
        autoGrowTextarea(ta);
      }
      startRun();
    });

    // Dedicated Settings Page Appearance & Canvas Resolution Controls
    el('btnScanProviders')?.addEventListener('click', () => loadProviders(true));
    el('btnCheckUpdates')?.addEventListener('click', () => checkForAppUpdates(false));
    el('btnAddProvider')?.addEventListener('click', () => {
      workspacePanels?.openNewProviderEditor(el('settingsProvidersMount'), {
        providers: appState.providers,
        localAgents: appState.localAgents,
        presets: appState.providerPresets,
      });
    });
    el('btnToggleTweaks')?.addEventListener('click', () => {
      closeMobileDrawers();
      toggleTweaks();
    });

    document.querySelectorAll('.tweak-pills').forEach((group) => {
      const key = group.dataset.tweak;
      group.querySelectorAll('button').forEach((btn) => {
        btn.addEventListener('click', () => {
          appState.tweaks[key] = btn.dataset.val;
          if (key === 'inspector') {
            try { localStorage.removeItem('tenon_inspector_w'); } catch {}
          }
          applyTweaks();
          if (key === 'inspector') reclampPanesFn();
          saveTweaks();
          if (key === 'canvasScale') {
            showToast(`画布渲染分辨率已切换至 ${btn.textContent}`);
          }
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
      try {
        localStorage.removeItem('tenon_sidebar_w');
        localStorage.removeItem('tenon_inspector_w');
      } catch {}
      applyTweaks();
      reclampPanesFn();
      saveTweaks();
      showToast('已恢复 Figma Weave 建筑白昼默认值');
    });

    // Global Keyboard & Outside-Click Dismiss
    document.addEventListener('keydown', (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (e.key === 'Escape') {
        closeArchSelect();
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
      if (archPortalEl && !archPortalEl.classList.contains('hidden')) {
        if (archPortalEl.contains(e.target)) return;
        if (!activeArchEntry || !activeArchEntry.trigger.contains(e.target)) {
          closeArchSelect();
        }
      }
      const pairs = [
        ['wsPopover', 'btnWsPopover'],
        ['guardrailsPopover', 'btnGuardrailsPopover'],
        ['composerOrbPopover', 'btnQuickPlan'],
      ];
      pairs.forEach(([popId, btnId]) => {
        const pop = el(popId);
        const btn = el(btnId);
        if (pop && btn && !pop.classList.contains('hidden') && !pop.contains(e.target) && !btn.contains(e.target)) {
          pop.classList.add('hidden');
          if (btnId === 'btnGuardrailsPopover' || btnId === 'btnQuickPlan') btn.setAttribute('aria-expanded', 'false');
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

  /* =========================================================================
     Architectural Floating Hairline Scroll Rails (Zero Native Windows Bars)
     - Replaces chunky OS scrollbars with whisper-thin floating rails, smooth
       60fps drag-scrubbing, soft top/bottom edge fades & conversation turn ticks
     ========================================================================= */
  let archScrollSystem = null;

  function initArchitecturalScrollRails() {
    if (archScrollSystem) return archScrollSystem;
    const host = document.createElement('div');
    host.className = 'arch-scroll-overlay';
    host.setAttribute('aria-hidden', 'true');
    document.body.appendChild(host);

    const targets = [
      { id: 'conversationViewport', milestones: true, fadeBg: 'var(--bg-canvas)' },
      { id: 'threadList', milestones: false, fadeBg: 'var(--bg-surface-1)' },
      { id: 'inspectorBody', milestones: false, fadeBg: 'var(--bg-surface-1)' },
      { id: 'settingsStage', milestones: false, fadeBg: 'var(--bg-canvas)' },
      { id: 'wfResultBody', milestones: false, fadeBg: 'var(--bg-surface-1)' },
    ];

    const entries = targets
      .map((cfg) => {
        const node = el(cfg.id);
        if (!node) return null;
        const rail = document.createElement('div');
        rail.className = 'arch-scroll-rail';
        rail.dataset.scrollTarget = cfg.id;
        rail.innerHTML = `
          <div class="arch-scroll-axis"></div>
          ${cfg.milestones ? '<div class="arch-scroll-ticks"></div>' : ''}
          <div class="arch-scroll-thumb"></div>
          <div class="arch-scroll-hud">0%</div>`;
        const fadeTop = document.createElement('div');
        fadeTop.className = 'arch-scroll-fade-top';
        fadeTop.style.setProperty('--scroll-fade-bg', cfg.fadeBg);
        const fadeBot = document.createElement('div');
        fadeBot.className = 'arch-scroll-fade-bot';
        fadeBot.style.setProperty('--scroll-fade-bg', cfg.fadeBg);
        host.appendChild(fadeTop);
        host.appendChild(fadeBot);
        host.appendChild(rail);
        return {
          cfg,
          node,
          rail,
          thumb: rail.querySelector('.arch-scroll-thumb'),
          ticks: rail.querySelector('.arch-scroll-ticks'),
          hud: rail.querySelector('.arch-scroll-hud'),
          fadeTop,
          fadeBot,
          hideTimer: null,
          dragging: null,
          lastTickSig: '',
        };
      })
      .filter(Boolean);

    function syncEntry(e, reveal = false) {
      const rect = e.node.getBoundingClientRect();
      const cs = getComputedStyle(e.node);
      const hidden = cs.display === 'none' || cs.visibility === 'hidden' || rect.width < 40 || rect.height < 60;
      const sh = e.node.scrollHeight;
      const ch = e.node.clientHeight;
      const maxScroll = Math.max(0, sh - ch);
      if (hidden || maxScroll <= 4) {
        e.rail.classList.remove('is-scrollable', 'is-visible', 'is-dragging');
        e.fadeTop.classList.remove('is-on');
        e.fadeBot.classList.remove('is-on');
        return;
      }

      const padY = 10;
      const trackH = Math.max(36, rect.height - padY * 2);
      const ratio = Math.min(1, ch / sh);
      const thumbH = Math.max(28, Math.round(trackH * ratio));
      const prog = Math.max(0, Math.min(1, e.node.scrollTop / maxScroll));
      const thumbTop = Math.round(prog * (trackH - thumbH));

      e.rail.style.left = `${Math.round(rect.right - 14)}px`;
      e.rail.style.top = `${Math.round(rect.top + padY)}px`;
      e.rail.style.height = `${Math.round(trackH)}px`;
      e.rail.classList.add('is-scrollable');

      e.thumb.style.height = `${thumbH}px`;
      e.thumb.style.top = `${thumbTop}px`;

      const pct = Math.round(prog * 100);
      e.hud.textContent = `${pct}%`;
      e.hud.style.top = `${Math.round(thumbTop + thumbH / 2)}px`;

      // Soft top/bottom atmospheric edge fades
      const fadeW = Math.max(0, Math.round(rect.width - 2));
      e.fadeTop.style.left = `${Math.round(rect.left + 1)}px`;
      e.fadeTop.style.top = `${Math.round(rect.top)}px`;
      e.fadeTop.style.width = `${fadeW}px`;
      e.fadeTop.classList.toggle('is-on', e.node.scrollTop > 8);

      e.fadeBot.style.left = `${Math.round(rect.left + 1)}px`;
      e.fadeBot.style.top = `${Math.round(rect.bottom - 22)}px`;
      e.fadeBot.style.width = `${fadeW}px`;
      e.fadeBot.classList.toggle('is-on', e.node.scrollTop < maxScroll - 8);

      // Build editorial turn milestone ticks for Dialogue Stream
      if (e.ticks) {
        const blocks = e.node.querySelectorAll('.research-progress-card, .catchup-card, .agent-turn, .inline-gate-card');
        const sig = `${blocks.length}:${sh}`;
        if (sig !== e.lastTickSig) {
          e.lastTickSig = sig;
          e.ticks.innerHTML = '';
          const baseTop = e.node.getBoundingClientRect().top - e.node.scrollTop;
          blocks.forEach((blk) => {
            const relY = blk.getBoundingClientRect().top - baseTop;
            const frac = Math.max(0.02, Math.min(0.98, relY / Math.max(1, sh)));
            const tick = document.createElement('span');
            tick.className = `arch-scroll-tick ${blk.classList.contains('inline-gate-card') ? 'is-gate' : ''}`;
            tick.style.top = `${Math.round(frac * trackH)}px`;
            tick.addEventListener('click', (ev) => {
              ev.stopPropagation();
              e.node.scrollTo({ top: Math.max(0, relY - 18), behavior: 'smooth' });
            });
            e.ticks.appendChild(tick);
          });
        }
      }

      if (reveal) {
        e.rail.classList.add('is-visible');
        if (e.hideTimer) clearTimeout(e.hideTimer);
        e.hideTimer = setTimeout(() => {
          if (!e.dragging) e.rail.classList.remove('is-visible');
        }, 1150);
      }
    }

    function syncAll(reveal = false) {
      entries.forEach((e) => syncEntry(e, reveal));
    }

    entries.forEach((e) => {
      e.node.addEventListener('scroll', () => syncEntry(e, true), { passive: true });
      e.node.addEventListener('pointerenter', () => syncEntry(e, true));

      // Click anywhere on floating rail to jump smoothly
      e.rail.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0) return;
        ev.preventDefault();
        ev.stopPropagation();
        const railRect = e.rail.getBoundingClientRect();
        const thumbH = e.thumb.offsetHeight || 28;
        const trackRange = Math.max(1, railRect.height - thumbH);
        const maxScroll = Math.max(0, e.node.scrollHeight - e.node.clientHeight);
        if (ev.target !== e.thumb) {
          const clickY = ev.clientY - railRect.top - thumbH / 2;
          const nextFrac = Math.max(0, Math.min(1, clickY / trackRange));
          e.node.scrollTop = nextFrac * maxScroll;
          syncEntry(e, true);
        }
        e.dragging = {
          startY: ev.clientY,
          startScrollTop: e.node.scrollTop,
          trackRange,
          maxScroll,
          pointerId: ev.pointerId,
        };
        e.rail.classList.add('is-dragging', 'is-visible');
        try { e.rail.setPointerCapture(ev.pointerId); } catch {}
      });

      e.rail.addEventListener('pointermove', (ev) => {
        if (!e.dragging || ev.pointerId !== e.dragging.pointerId) return;
        const dy = ev.clientY - e.dragging.startY;
        const deltaScroll = (dy / e.dragging.trackRange) * e.dragging.maxScroll;
        e.node.scrollTop = Math.max(0, Math.min(e.dragging.maxScroll, e.dragging.startScrollTop + deltaScroll));
        syncEntry(e, true);
      });

      const endDrag = (ev) => {
        if (!e.dragging || ev.pointerId !== e.dragging.pointerId) return;
        try { e.rail.releasePointerCapture(ev.pointerId); } catch {}
        e.dragging = null;
        e.rail.classList.remove('is-dragging');
        syncEntry(e, true);
      };
      e.rail.addEventListener('pointerup', endDrag);
      e.rail.addEventListener('pointercancel', endDrag);
    });

    let syncRaf = 0;
    const scheduleSync = () => {
      if (syncRaf) return;
      syncRaf = requestAnimationFrame(() => {
        syncRaf = 0;
        syncAll(false);
      });
    };

    const ro = new ResizeObserver(scheduleSync);
    entries.forEach((e) => ro.observe(e.node));
    window.addEventListener('resize', scheduleSync);
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        if (!host.contains(m.target)) {
          scheduleSync();
          return;
        }
      }
    });
    mo.observe(el('appShell') || document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    const htmlMo = new MutationObserver(scheduleSync);
    htmlMo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-surface'] });

    scheduleSync();
    archScrollSystem = { syncAll };
    return archScrollSystem;
  }

  // Bootstrap
  let inkDiagrams = null;
  applyTweaks();
  initArchitecturalSelects();
  initArchitecturalScrollRails();
  if (window.ConduitEffortSlider && el('guardrailsEffortSlider')) {
    effortSlider = window.ConduitEffortSlider.mount(el('guardrailsEffortSlider'), {
      defaultValue: el('selectCodexEffort')?.value || 'high',
      recommended: 'high',
      title: 'Codex 推理深度',
      onChange: (level) => {
        const sel = el('selectCodexEffort');
        if (sel) {
          sel.value = level;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
        showToast(
          level === 'ultracode'
            ? '已激活 Ultracode 档位（自动映射 xhigh + 多 Agent 深度推演）'
            : `推理深度已设为 ${level}`
        );
      },
    });
  }
  if (window.ConduitPanels) {
    workspacePanels = window.ConduitPanels.create({
      getContext: () => ({
        runs: appState.runs,
        geminiModels: appState.models?.agy?.models || [],
        providers: appState.providers || [],
      }),
      onNewChat: () => {
        switchStageView('chat');
        resetToNewChat();
        el('inputPrompt').focus();
      },
      onSwitchView: (v) => switchStageView(v),
      onQuickMedia: (kind) => {
        switchStageView('chat');
        runLocalMediaGeneration(kind === 'video' ? 'video-gen' : 'image-gen', '');
      },
      onOpenInspector: (tab) => openInspector(tab),
      onNavigateSettings: (sec) => switchStageView('settings', sec),
      onToggleTweaks: () => switchStageView('settings', 'appearance'),
      onSelectRun: (rid) => openRunById(rid),
      onPickGemini: (id) => {
        setGeminiModelValue(id);
        showToast(`Gemini 模型已切换为 ${formatGeminiShort(id)}`);
      },
      onSaveProvider: (payload) => saveProviderConfig(payload),
      onTestProvider: (id) => testProviderById(id),
      onDeleteProvider: (id) => deleteProviderById(id),
      onUseProvider: (prov) => useProviderInChat(prov),
      onRefreshProvidersView: () => renderSettingsProviders(),
      onCheckUpdates: () => checkForAppUpdates(false),
      onDownloadUpdate: () => startAppUpdateDownload(),
      onInstallUpdate: () => launchAppUpdateInstaller(),
      onToggleAutoUpdate: () => toggleAutoCheckUpdates(),
      onToast: showToast,
    });
  }
  bindEvents();
  initPaneResizers();
  waveEngine = initWaveEngine();
  inkDiagrams = initInkOrbitDiagrams();
  canvasEngine = initInfiniteWorkflowCanvas();
  if (window.ConduitOrbs) window.ConduitOrbs.mountAll(document);
  syncTopbarOrb(null);
  setModeValue('agent-chat');
  initGlobalEvents();
  window.addEventListener('beforeunload', () => {
    closeActiveStream();
    if (appState.globalStream) {
      try { appState.globalStream.close(); } catch {}
      appState.globalStream = null;
    }
    if (appState.globalStreamReconnectTimer) {
      clearTimeout(appState.globalStreamReconnectTimer);
      appState.globalStreamReconnectTimer = null;
    }
    if (globalRunsSyncTimer) {
      clearTimeout(globalRunsSyncTimer);
      globalRunsSyncTimer = null;
    }
    stopUpdateDownloadPoll();
  });
  loadHealth();
  loadModels(false);
  loadProviders(false);
  loadUpdateInfo();
  loadRunsList();
  if (appState.autoCheckUpdates) {
    setTimeout(() => checkForAppUpdates(true), 2600);
  }
})();
