(() => {
  'use strict';

  const MODE_LABELS = {
    'full-pipeline': '全链路协同',
    'plan-only': '独立规划',
    'codex-exec': 'Codex 直派',
    'codex-review': '审查门禁',
    'copy-polish': '文案顾问',
  };

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
    fontSize: 14,
    waveAmplitude: 75,
    crosshairs: true,
    motion: true,
  };

  const appState = {
    health: null,
    models: { agy: [], codex: [] },
    assets: null,
    runs: [],
    searchQuery: '',
    workspaceFiles: [],
    activeAsset: 'GEMINI.md',
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
    palette: { open: false, trigger: '', query: '', startPos: 0, items: [], selectedIdx: 0 },
    tweaks: loadTweaks(),
  };

  let waveEngine = null;
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
    root.dataset.crosshairs = t.crosshairs ? 'on' : 'off';
    root.style.setProperty('--base-font-size', `${t.fontSize}px`);

    el('tweakFontRange').value = String(t.fontSize);
    el('tweakFontVal').textContent = `${t.fontSize}px`;
    el('tweakWaveRange').value = String(t.waveAmplitude);
    el('tweakWaveVal').textContent = `${t.waveAmplitude}%`;
    el('tweakCrosshairs').checked = Boolean(t.crosshairs);
    el('tweakMotion').checked = Boolean(t.motion);

    document.querySelectorAll('.tweak-pills').forEach((group) => {
      const key = group.dataset.tweak;
      group.querySelectorAll('button').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.val === t[key]);
      });
    });

    if (waveEngine) waveEngine.sync();
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
     DeepBook Dual Telemetry Wave Engine (Hero Welcome + Sidebar Mini Wave)
     ========================================================================= */
  function initWaveEngine() {
    const heroCanvas = el('heroWaveCanvas');
    const miniCanvas = el('miniWaveCanvas');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let phase = 0;
    let rafId = null;
    let colors = { accent: '#1B66FF', warn: '#f59e0b', tick: '#313640' };
    const dims = new Map();

    function refreshColors() {
      const cs = getComputedStyle(document.documentElement);
      colors = {
        accent: cs.getPropertyValue('--accent-hex').trim() || '#1B66FF',
        warn: cs.getPropertyValue('--state-warn').trim() || '#f59e0b',
        tick: cs.getPropertyValue('--line-strong').trim() || '#313640',
      };
    }

    function sizeCanvas(canvas) {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dims.set(canvas, { w: rect.width, h: rect.height, ctx });
    }

    function drawOne(canvas, gap, ampMult) {
      const info = dims.get(canvas);
      if (!info) return;
      const { w, h, ctx } = info;
      ctx.clearRect(0, 0, w, h);

      const run = appState.currentRun;
      const isStreaming = Boolean(run && run.status === 'running');
      const isGate = Boolean(run && run.status === 'awaiting_approval');
      const ampScale = (Number(appState.tweaks.waveAmplitude) || 0) / 100;
      const count = Math.floor((w - 16) / gap);
      const midY = h * 0.48;

      for (let i = 0; i < count; i += 1) {
        const x = 8 + i * gap;
        const norm = count > 1 ? i / (count - 1) : 0.5;
        const env = Math.sin(norm * Math.PI);
        const w1 = Math.sin(norm * 8.5 - phase);
        const w2 = Math.cos(norm * 14.5 + phase * 1.3) * 0.42;
        const energy = (isStreaming ? 0.92 : 0.38) * ampScale;
        const barH = Math.max(3, (4 + Math.abs(w1 + w2) * ampMult * energy) * (0.35 + 0.65 * env));
        const pulse = (phase * 0.14) % 1;
        const dist = Math.min(Math.abs(norm - pulse), 1 - Math.abs(norm - pulse));
        const hot = isStreaming ? dist < 0.24 : dist < 0.13;

        ctx.fillStyle = isGate && hot ? colors.warn : hot ? colors.accent : colors.tick;
        ctx.globalAlpha = hot ? 0.95 : 0.52;
        ctx.fillRect(x, midY - barH / 2, 1.5, barH);
      }
      ctx.globalAlpha = 1;
    }

    function drawAll(advance = true) {
      const isStreaming = Boolean(appState.currentRun && appState.currentRun.status === 'running');
      if (advance && appState.tweaks.motion && !reducedMotion) {
        phase += isStreaming ? 0.065 : 0.015;
      }
      if (!el('welcomeStage').classList.contains('hidden')) drawOne(heroCanvas, 7, 26);
      drawOne(miniCanvas, 5, 11);
    }

    function loop() {
      if (!appState.tweaks.motion || reducedMotion) {
        rafId = null;
        return;
      }
      drawAll(true);
      rafId = requestAnimationFrame(loop);
    }

    function resize() {
      sizeCanvas(heroCanvas);
      sizeCanvas(miniCanvas);
      drawAll(false);
    }

    function sync() {
      refreshColors();
      resize();
      if (appState.tweaks.motion && !reducedMotion && !rafId) {
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
    return { sync, redraw: () => drawAll(false), resize };
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
      el('selectMode').value = item.mode;
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
    el('btnStartRun').classList.remove('hidden');
    el('composerShell').classList.remove('is-streaming');
    updatePipelinePills(null);
    renderSidebarThreads();
    if (waveEngine) waveEngine.resize();
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

  function renderToolTraceHtml(events, sourceFilter) {
    const items = (events || []).filter((e) => {
      if (sourceFilter && e.source !== sourceFilter) return false;
      return ['command', 'file_change', 'reasoning', 'step', 'stage', 'worktree'].includes(e.kind);
    });
    if (items.length === 0) return '';

    return `<div class="tool-trace-list">${items
      .slice(-12)
      .map((ev) => {
        let tag = ev.kind.toUpperCase();
        let detail = ev.text || '';
        let body = ev.output || ev.text || '';
        if (ev.kind === 'command') {
          tag = ev.exitCode === 0 ? 'CMD OK' : ev.exitCode != null ? `CMD ${ev.exitCode}` : 'CMD';
          detail = ev.command || '运行命令';
          body = ev.output || `(exit=${ev.exitCode ?? 'running'})`;
        } else if (ev.kind === 'file_change') {
          tag = 'EDIT';
          const paths = (ev.changes || []).map((c) => c.path || c).join(', ');
          detail = paths || '文件变更';
          body = JSON.stringify(ev.changes || [], null, 2);
        } else if (ev.kind === 'reasoning') {
          tag = 'THINK';
          detail = (ev.text || '').slice(0, 72);
        } else if (ev.kind === 'step') {
          tag = 'STEP';
          detail = `${ev.stepType || 'step'} (${ev.state || ''})`;
          body = detail;
        }
        return `
          <details class="tool-call-card">
            <summary class="tool-call-summary">
              <span class="tool-call-left">
                <span class="tool-call-tag">${escapeHtml(tag)}</span>
                <span class="tool-call-detail">${escapeHtml(detail)}</span>
              </span>
              <span class="mono-xs">▾</span>
            </summary>
            <div class="tool-call-body">${escapeHtml(body)}</div>
          </details>`;
      })
      .join('')}</div>`;
  }

  function renderConversationThread(run) {
    if (!run) return;
    el('welcomeStage').classList.add('hidden');
    const container = el('threadMessages');
    container.classList.remove('hidden');

    const isActive = run.status === 'running' || run.status === 'awaiting_approval';
    el('btnCancelRun').classList.toggle('hidden', !isActive);
    el('btnStartRun').classList.toggle('hidden', isActive);
    el('composerShell').classList.toggle('is-streaming', run.status === 'running');

    const totalTokens = (run.metrics?.geminiTokens || 0) + (run.metrics?.codexTokens || 0);
    const totalSec = (((run.gemini?.durationMs || 0) + (run.codex?.durationMs || 0)) / 1000).toFixed(1);
    el('topbarTitle').textContent = run.title || '协同会话';
    el('topbarMeta').textContent = `${MODE_LABELS[run.mode] || run.mode} · ${totalTokens.toLocaleString()} TOKENS · ${totalSec}s`;
    updatePipelinePills(run);

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
              <span class="agent-avatar gemini">G</span>
              <span class="agent-role-name">${titleLabel}</span>
              <span class="agent-model-tag">${escapeHtml(run.config?.geminiModel || '')}</span>
            </div>
            <span class="agent-status-pill ${escapeHtml(g.status || '')} ${isStreamingG ? 'is-shimmer' : ''}">${statusText}</span>
          </header>
          ${renderToolTraceHtml(run.events, 'gemini')}
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
              <span class="agent-avatar codex">C</span>
              <span class="agent-role-name">Codex · 沙箱工程师</span>
              <span class="agent-model-tag">${escapeHtml(run.config?.codexModel || '默认')} · ${escapeHtml(run.config?.codexEffort || 'high')} · ${escapeHtml(run.config?.sandbox || 'workspace-write')}${run.worktreePath ? ' · WT' : ''}</span>
            </div>
            <span class="agent-status-pill ${escapeHtml(c.status || '')} ${isStreamingC ? 'is-shimmer' : ''}">${statusText}</span>
          </header>
          ${renderToolTraceHtml(run.events, 'codex')}
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
              <span class="agent-avatar codex">R</span>
              <span class="agent-role-name">Pre-CI 代码审查门禁</span>
              <span class="agent-model-tag">ROUND ${run.reviewRound || 1} / ${run.mode === 'codex-review' ? 1 : (run.config?.maxReviewRounds || 2)}</span>
            </div>
            <span class="agent-status-pill ${v ? (v.passed ? 'done' : 'failed') : (isStreamingR ? 'running' : '')} ${isStreamingR ? 'is-shimmer' : ''}">
              ${isStreamingR ? '深度审查中...' : v ? (v.passed ? 'PASS' : 'BLOCK') : 'PENDING'}
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
              <span class="agent-avatar gemini">G</span>
              <span class="agent-role-name">Gemini · 最终交付汇报</span>
            </div>
            <span class="agent-status-pill ${escapeHtml(g.status || '')} ${isStreamingS ? 'is-shimmer' : ''}">${isStreamingS ? '正在汇总汇报...' : 'REPORT'}</span>
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
    renderInspectorContent(run);

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
        el('selectMode').value = 'codex-exec';
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

  async function loadModels(refresh = false) {
    try {
      const data = await api(`/api/models${refresh ? '?refresh=1' : ''}`);
      appState.models = data;

      const agySel = el('selectGeminiModel');
      const prevAgy = agySel.value;
      agySel.innerHTML = '';
      (data.agy?.models || []).forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.label || m.id;
        agySel.appendChild(opt);
      });
      if (prevAgy && Array.from(agySel.options).some((o) => o.value === prevAgy)) agySel.value = prevAgy;
      else if (Array.from(agySel.options).some((o) => o.value === 'gemini-4-neon-high')) agySel.value = 'gemini-4-neon-high';

      const fillCodex = (selId) => {
        const sel = el(selId);
        const prev = sel.value;
        sel.innerHTML = '';
        (data.codex || []).forEach((m) => {
          const opt = document.createElement('option');
          opt.value = m.id;
          opt.textContent = m.label;
          sel.appendChild(opt);
        });
        if (prev && Array.from(sel.options).some((o) => o.value === prev)) sel.value = prev;
      };
      fillCodex('selectCodexModel');
      fillCodex('selectCodexReviewModel');

      if (refresh) showToast('已刷新本机 agy Gemini 模型列表');
      renderCliCommandCards();
    } catch (err) {
      showToast(`模型列表加载失败: ${err.message}`);
    }
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
    });

    el('btnMobileSidebar').addEventListener('click', () => {
      el('sidebar').classList.add('is-mobile-open');
      el('drawerBackdrop').classList.remove('hidden');
    });

    el('drawerBackdrop').addEventListener('click', closeMobileDrawers);
    el('btnNewChat').addEventListener('click', () => {
      closeMobileDrawers();
      resetToNewChat();
      el('inputPrompt').focus();
    });

    el('inputSearchThreads').addEventListener('input', (e) => {
      appState.searchQuery = e.target.value;
      renderSidebarThreads();
    });

    // Starter prompt cards
    document.querySelectorAll('.starter-card').forEach((card) => {
      card.addEventListener('click', () => {
        el('selectMode').value = card.dataset.starterMode;
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

    el('btnStartRun').addEventListener('click', startRun);
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
    el('tweakMotion').addEventListener('change', (e) => {
      appState.tweaks.motion = e.target.checked;
      applyTweaks();
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
    });
  }

  // Bootstrap
  applyTweaks();
  bindEvents();
  waveEngine = initWaveEngine();
  initGlobalEvents();
  loadHealth();
  loadModels(false);
  loadRunsList();
})();
