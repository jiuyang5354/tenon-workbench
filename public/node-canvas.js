(() => {
  'use strict';

  /**
   * CONDUIT Infinite Agent Cluster Canvas (Blender-style Node Editor)
   * Zero-dependency infinite pan/zoom/drag/wire DAG engine:
   * - Infinite panning (drag background, middle-mouse drag, or Space+drag)
   * - Cursor-centered smooth wheel zoom (0.30x - 2.00x) + Fit All (F) + Reset (1)
   * - Free 60fps node dragging (Shift snaps to 24px grid) with live Bezier noodles
   * - Port-to-port interactive wiring (drag output -> input, or click-to-connect) + DAG cycle guard
   * - Multi-Agent Cluster & Merge Hub presets (parallel Codex workers converging into Merge Hub)
   * - Topological parallel wave execution (Kahn layering) + Undo (Ctrl+Z) + Live Minimap + JSON export
   */

  const NODE_WIDTH = 286;
  const PORT_Y = 34;
  const GRID_SNAP = 24;
  const MIN_ZOOM = 0.3;
  const MAX_ZOOM = 2.0;

  const NODE_TEMPLATES = {
    'gemini-plan': {
      kind: 'gemini-plan',
      title: 'Gemini · 架构规划师',
      subtitle: '需求拆解与接口契约设计',
      mode: 'plan-only',
      orbIdle: ['base', 'default'],
      orbRun: ['reasoning', 'twins'],
      inLabel: '上游需求',
      outLabel: 'Spec 契约',
      showIn: true,
      showOut: true,
      accent: 'cobalt',
      errorMessage: '规划阶段未产出有效契约，请检查 agy CLI 登录态后重试。',
    },
    'codex-exec': {
      kind: 'codex-exec',
      title: 'Codex · 沙箱工位',
      subtitle: '独立沙箱编写代码与单测',
      mode: 'codex-exec',
      orbIdle: ['base', 'default'],
      orbRun: ['working', 'gyro'],
      inLabel: 'Spec 契约',
      outLabel: 'Branch Diff',
      showIn: true,
      showOut: true,
      accent: 'cobalt',
      errorMessage: 'Codex 沙箱执行失败，请检查 CODEX_HOME 凭据或目录权限。',
    },
    'cluster-merge': {
      kind: 'cluster-merge',
      title: '集群聚合合并器',
      subtitle: '汇合多路 Agent 产物与分支冲突仲裁',
      mode: 'full-pipeline',
      orbIdle: ['base', 'default'],
      orbRun: ['compacting', 'fuse'],
      inLabel: '多路并行输入',
      outLabel: 'Merged Patch',
      showIn: true,
      showOut: true,
      accent: 'cyan',
      errorMessage: '多路分支合并检测到接口契约冲突，请人工确认合并策略。',
    },
    'codex-review': {
      kind: 'codex-review',
      title: 'Pre-CI 审查与终局汇报',
      subtitle: '分级阻断审查 + Gemini 10秒汇报',
      mode: 'codex-review',
      orbIdle: ['base', 'default'],
      orbRun: ['searching', 'lighthouse'],
      inLabel: 'Merged Diff',
      outLabel: 'Release Pass',
      showIn: true,
      showOut: true,
      accent: 'cobalt',
      errorMessage: 'Pre-CI 审查拦截：命中高危鉴权路径 [BLOCKING]，已暂停发布。',
    },
    'gemini-copy': {
      kind: 'gemini-copy',
      title: 'Gemini · 文案与交互顾问',
      subtitle: '去除 AI 解释腔，打磨界面文案',
      mode: 'copy-polish',
      orbIdle: ['base', 'default'],
      orbRun: ['reasoning', 'default'],
      inLabel: '产品草稿',
      outLabel: '定稿文案',
      showIn: true,
      showOut: true,
      accent: 'cobalt',
      errorMessage: '文案润色超时，请点击重试。',
    },
  };

  function makeClusterPreset() {
    return {
      nodes: [
        {
          id: 'n-plan',
          kind: 'gemini-plan',
          title: 'Gemini · 总架构规划师',
          subtitle: '拆解契约并分发双路并行任务',
          x: 60,
          y: 210,
          status: 'idle',
          params: [
            { k: 'Model', dynamic: 'geminiModel' },
            { k: 'Branching', v: '3 路思路权衡' },
          ],
          toggles: [
            { key: 'approval', label: '人工拍板闸门', desc: '派发集群前人工确认' },
          ],
        },
        {
          id: 'n-codex-fe',
          kind: 'codex-exec',
          title: 'Codex · 前端工位 #1',
          subtitle: '并行实现 UI 组件与交互动效',
          x: 420,
          y: 48,
          status: 'idle',
          params: [
            { k: 'Model', dynamic: 'codexModel' },
            { k: 'Worktree', v: 'wt/agent-fe' },
          ],
          toggles: [
            { key: 'worktree', label: 'Worktree 隔离', desc: '独立分支零污染' },
          ],
        },
        {
          id: 'n-codex-be',
          kind: 'codex-exec',
          title: 'Codex · 后端工位 #2',
          subtitle: '并行实现接口契约与单元测试',
          x: 420,
          y: 356,
          status: 'idle',
          params: [
            { k: 'Model', dynamic: 'codexModel' },
            { k: 'Effort', dynamic: 'codexEffort' },
          ],
          toggles: [
            { key: 'writable', label: '沙箱写权限', desc: 'workspace-write' },
          ],
        },
        {
          id: 'n-merge',
          kind: 'cluster-merge',
          title: '集群聚合合并器',
          subtitle: '汇合双路 Diff 并统一对齐接口',
          x: 790,
          y: 204,
          status: 'idle',
          params: [
            { k: 'Strategy', v: '3-Way Merge' },
            { k: 'Inputs', dynamic: 'inCount' },
          ],
          toggles: [
            { key: 'autoNewDiff', label: '合并新建未跟踪文件', desc: '纳入统一 Diff 视图' },
          ],
        },
        {
          id: 'n-review',
          kind: 'codex-review',
          title: 'Pre-CI 门禁与终局汇报',
          subtitle: '两级阻断审查 + 10秒人话总结',
          x: 1150,
          y: 204,
          status: 'idle',
          params: [
            { k: 'Max Rounds', dynamic: 'maxRounds' },
            { k: 'High-Risk', v: '自动升 xhigh' },
          ],
          toggles: [
            { key: 'humanReport', label: 'Gemini 终局汇报', desc: '输出人类速览结论' },
          ],
        },
      ],
      edges: [
        { id: 'e-1', source: 'n-plan', target: 'n-codex-fe' },
        { id: 'e-2', source: 'n-plan', target: 'n-codex-be' },
        { id: 'e-3', source: 'n-codex-fe', target: 'n-merge' },
        { id: 'e-4', source: 'n-codex-be', target: 'n-merge' },
        { id: 'e-5', source: 'n-merge', target: 'n-review' },
      ],
    };
  }

  function makeLinearPreset() {
    return {
      nodes: [
        {
          id: 'n-plan',
          kind: 'gemini-plan',
          title: 'Gemini · 架构规划师',
          subtitle: '需求拆解与接口契约设计',
          x: 80,
          y: 160,
          status: 'idle',
          params: [
            { k: 'Model', dynamic: 'geminiModel' },
            { k: 'Approach', v: '3 路分支权衡' },
          ],
          toggles: [{ key: 'approval', label: '人工拍板闸门', desc: '派发前允许修改契约' }],
        },
        {
          id: 'n-codex',
          kind: 'codex-exec',
          title: 'Codex · 沙箱工程师',
          subtitle: '安全隔离区内编写并验证代码',
          x: 470,
          y: 210,
          status: 'idle',
          params: [
            { k: 'Model', dynamic: 'codexModel' },
            { k: 'Sandbox', dynamic: 'sandbox' },
          ],
          toggles: [{ key: 'worktree', label: 'Git Worktree 隔离', desc: '独立分支目录施工' }],
        },
        {
          id: 'n-review',
          kind: 'codex-review',
          title: 'Pre-CI 门禁与终局汇报',
          subtitle: '分级阻断审查 + Gemini 10秒汇报',
          x: 860,
          y: 160,
          status: 'idle',
          params: [
            { k: 'Max Rounds', dynamic: 'maxRounds' },
            { k: 'High-Risk', v: '自动升 xhigh' },
          ],
          toggles: [{ key: 'humanReport', label: 'Gemini 终局汇报', desc: '将审查翻译为人话' }],
        },
      ],
      edges: [
        { id: 'e-lin-1', source: 'n-plan', target: 'n-codex' },
        { id: 'e-lin-2', source: 'n-codex', target: 'n-review' },
      ],
    };
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function cloneGraph(g) {
    return {
      nodes: g.nodes.map((n) => ({
        ...n,
        params: (n.params || []).map((p) => ({ ...p })),
        toggles: (n.toggles || []).map((t) => ({ ...t })),
      })),
      edges: g.edges.map((e) => ({ ...e })),
    };
  }

  /** Reject duplicate links, self-links and DAG cycles (from 21st.dev #43113). */
  function canConnect(graph, source, target) {
    if (!source || !target || source === target) return false;
    if (!graph.nodes.some((n) => n.id === source) || !graph.nodes.some((n) => n.id === target)) return false;
    if (graph.edges.some((e) => e.source === source && e.target === target)) return false;
    const visited = new Set();
    const reachesSource = (id) => {
      if (id === source) return true;
      if (visited.has(id)) return false;
      visited.add(id);
      return graph.edges.filter((e) => e.source === id).some((e) => reachesSource(e.target));
    };
    return !reachesSource(target);
  }

  function bezierPath(x1, y1, x2, y2) {
    const dx = Math.abs(x2 - x1);
    const offset = Math.max(70, Math.min(240, dx * 0.48));
    return `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${(x1 + offset).toFixed(1)} ${y1.toFixed(1)}, ${(x2 - offset).toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }

  /** Topological parallel waves via Kahn's algorithm so parallel workers run concurrently! */
  function topoWaves(graph) {
    const inDeg = new Map();
    const adj = new Map();
    graph.nodes.forEach((n) => {
      inDeg.set(n.id, 0);
      adj.set(n.id, []);
    });
    graph.edges.forEach((e) => {
      if (inDeg.has(e.source) && inDeg.has(e.target)) {
        adj.get(e.source).push(e.target);
        inDeg.set(e.target, inDeg.get(e.target) + 1);
      }
    });
    const waves = [];
    const remaining = new Set(graph.nodes.map((n) => n.id));
    while (remaining.size > 0) {
      const wave = [];
      remaining.forEach((id) => {
        if ((inDeg.get(id) || 0) === 0) wave.push(id);
      });
      if (wave.length === 0) {
        waves.push(Array.from(remaining));
        break;
      }
      waves.push(wave);
      wave.forEach((id) => {
        remaining.delete(id);
        (adj.get(id) || []).forEach((nxt) => inDeg.set(nxt, Math.max(0, (inDeg.get(nxt) || 0) - 1)));
      });
    }
    return waves;
  }

  function createInfiniteCanvas(opts) {
    const {
      viewportEl,
      worldEl,
      edgesSvgEl,
      nodesLayerEl,
      minimapCanvasEl,
      zoomLabelEl,
      statusBarEl,
      getContext,
      onToggleSync,
      onRunSingleNode,
      onStatusChange,
      onToast,
    } = opts;

    const state = {
      graph: makeClusterPreset(),
      history: [],
      selectedId: 'n-plan',
      panX: 48,
      panY: 42,
      zoom: 0.88,
      seq: 10,
      failLast: false,
      demoRunning: false,
      demoToken: 0,
      spaceDown: false,
      statusMsg: '无限画布就绪：拖空白处无限平移 · 滚轮缩放 · 拖卡片自由排布 · 拖右端口至左端口即可连线合并集群。',
      panning: null,
      dragging: null,
      wiring: null, // { sourceId, x, y, hoverTargetId }
      extraToggles: { autoNewDiff: true, humanReport: true },
    };

    const nodeEls = new Map(); // id -> HTMLElement

    function setStatus(msg) {
      state.statusMsg = msg;
      if (statusBarEl) statusBarEl.textContent = msg;
    }

    function pushHistory() {
      state.history.push(cloneGraph(state.graph));
      if (state.history.length > 25) state.history.shift();
    }

    function screenToWorld(clientX, clientY) {
      const rect = viewportEl.getBoundingClientRect();
      return {
        x: (clientX - rect.left - state.panX) / state.zoom,
        y: (clientY - rect.top - state.panY) / state.zoom,
      };
    }

    function applyTransform() {
      worldEl.style.transform = `translate3d(${state.panX.toFixed(1)}px, ${state.panY.toFixed(1)}px, 0) scale(${state.zoom.toFixed(4)})`;
      const minor = 24 * state.zoom;
      const major = 120 * state.zoom;
      viewportEl.style.backgroundSize = `${minor.toFixed(2)}px ${minor.toFixed(2)}px, ${major.toFixed(2)}px ${major.toFixed(2)}px, ${major.toFixed(2)}px ${major.toFixed(2)}px`;
      viewportEl.style.backgroundPosition = `${state.panX.toFixed(1)}px ${state.panY.toFixed(1)}px, ${state.panX.toFixed(1)}px ${state.panY.toFixed(1)}px, ${state.panX.toFixed(1)}px ${state.panY.toFixed(1)}px`;
      if (zoomLabelEl) zoomLabelEl.textContent = `${Math.round(state.zoom * 100)}%`;
      drawMinimap();
    }

    function fitView(animate = false) {
      const rect = viewportEl.getBoundingClientRect();
      if (!rect.width || !rect.height || state.graph.nodes.length === 0) return;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      state.graph.nodes.forEach((n) => {
        const el = nodeEls.get(n.id);
        const h = el ? el.offsetHeight || 220 : 220;
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + NODE_WIDTH);
        maxY = Math.max(maxY, n.y + h);
      });
      const padX = 72;
      const padY = 86;
      const contentW = Math.max(300, maxX - minX);
      const contentH = Math.max(240, maxY - minY);
      const nextZoom = Math.max(0.42, Math.min(1.02, Math.min((rect.width - padX * 2) / contentW, (rect.height - padY * 2) / contentH)));
      state.zoom = nextZoom;
      state.panX = (rect.width - contentW * nextZoom) / 2 - minX * nextZoom;
      state.panY = (rect.height - contentH * nextZoom) / 2 - minY * nextZoom + 12;
      if (animate) {
        worldEl.style.transition = 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)';
        applyTransform();
        setTimeout(() => { worldEl.style.transition = ''; }, 270);
      } else {
        applyTransform();
      }
    }

    function zoomAt(factor, clientX = null, clientY = null) {
      const rect = viewportEl.getBoundingClientRect();
      const sx = clientX !== null ? clientX - rect.left : rect.width / 2;
      const sy = clientY !== null ? clientY - rect.top : rect.height / 2;
      const wx = (sx - state.panX) / state.zoom;
      const wy = (sy - state.panY) / state.zoom;
      const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.zoom * factor));
      state.zoom = nextZoom;
      state.panX = sx - wx * nextZoom;
      state.panY = sy - wy * nextZoom;
      applyTransform();
    }

    function effectiveStatuses() {
      const ctx = getContext ? getContext() : {};
      const run = ctx.currentRun;
      if (!run || state.demoRunning) {
        const map = new Map();
        state.graph.nodes.forEach((n) => map.set(n.id, n.status || 'idle'));
        return map;
      }
      const map = new Map();
      const g = run.gemini || {};
      const c = run.codex || {};
      state.graph.nodes.forEach((n) => {
        let st = n.status || 'idle';
        if (n.kind === 'gemini-plan' || n.kind === 'gemini-copy') {
          if (g.status === 'running' && run.activeStage !== 'summary') st = 'running';
          else if (g.planText || g.copyText || run.status === 'completed') st = 'completed';
          else if (g.status === 'failed') st = 'error';
        } else if (n.kind === 'codex-exec') {
          if (c.status === 'running' && run.activeStage === 'exec') st = 'running';
          else if (c.execText || run.reviewRound > 0 || run.status === 'completed') st = 'completed';
          else if (c.status === 'failed' && run.activeStage === 'exec') st = 'error';
        } else if (n.kind === 'cluster-merge') {
          if (run.activeStage === 'review' || run.status === 'completed') st = 'completed';
          else if (c.status === 'running') st = 'idle';
        } else if (n.kind === 'codex-review') {
          if (run.activeStage === 'review' || run.activeStage === 'summary') st = run.status === 'running' ? 'running' : run.status === 'blocked' ? 'error' : 'completed';
          else if (run.status === 'completed') st = 'completed';
          else if (run.status === 'blocked') st = 'error';
        }
        map.set(n.id, st);
      });
      return map;
    }

    function renderEdges() {
      const statusMap = effectiveStatuses();
      const motionOn = document.documentElement.dataset.motion !== 'off';
      const byId = new Map(state.graph.nodes.map((n) => [n.id, n]));

      const paths = state.graph.edges
        .map((e) => {
          const src = byId.get(e.source);
          const dst = byId.get(e.target);
          if (!src || !dst) return '';
          const x1 = src.x + NODE_WIDTH;
          const y1 = src.y + PORT_Y;
          const x2 = dst.x;
          const y2 = dst.y + PORT_Y;
          const d = bezierPath(x1, y1, x2, y2);
          const srcSt = statusMap.get(src.id) || 'idle';
          const dstSt = statusMap.get(dst.id) || 'idle';
          const isRunning = srcSt === 'running' || dstSt === 'running';
          const isDone = srcSt === 'completed' && (dstSt === 'completed' || dstSt === 'running');
          const isErr = srcSt === 'error' || dstSt === 'error';
          const stroke = isErr ? 'var(--state-err)' : isRunning || isDone ? 'var(--accent-hex)' : 'var(--line-strong)';
          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;

          return `
            <g class="ic-edge-group" data-edge-id="${escapeHtml(e.id)}">
              <path d="${d}" class="ic-edge-hit" />
              <path d="${d}" class="ic-edge-halo" style="stroke:${stroke};opacity:${isRunning ? '0.32' : '0.12'}" />
              <path d="${d}" class="ic-edge-line ${isRunning ? 'is-flowing' : ''}" style="stroke:${stroke}" stroke-dasharray="${isDone && !isRunning ? 'none' : '7 6'}" />
              ${
                isRunning && motionOn
                  ? `<circle r="3.6" fill="var(--accent-hex)"><animateMotion dur="1.05s" repeatCount="indefinite" path="${d}" /></circle>`
                  : ''
              }
              <g class="ic-edge-del" transform="translate(${midX.toFixed(1)},${midY.toFixed(1)})" data-del-edge="${escapeHtml(e.id)}" role="button" tabindex="0" aria-label="断开连线">
                <circle r="9" class="ic-edge-del-bg" />
                <path d="M-3 -3 L3 3 M3 -3 L-3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
              </g>
            </g>`;
        })
        .join('');

      let draftWire = '';
      if (state.wiring) {
        const src = byId.get(state.wiring.sourceId);
        if (src) {
          const d = bezierPath(src.x + NODE_WIDTH, src.y + PORT_Y, state.wiring.x, state.wiring.y);
          draftWire = `
            <g class="ic-edge-draft">
              <path d="${d}" class="ic-edge-halo" style="stroke:var(--accent-hex);opacity:0.35" />
              <path d="${d}" class="ic-edge-line is-flowing" style="stroke:var(--accent-hex)" stroke-dasharray="6 5" />
              <circle cx="${state.wiring.x.toFixed(1)}" cy="${state.wiring.y.toFixed(1)}" r="4.5" fill="var(--accent-hex)" />
            </g>`;
        }
      }

      edgesSvgEl.innerHTML = paths + draftWire;
      edgesSvgEl.querySelectorAll('[data-del-edge]').forEach((btn) => {
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const eid = btn.dataset.delEdge;
          pushHistory();
          state.graph.edges = state.graph.edges.filter((e) => e.id !== eid);
          renderAll();
          setStatus('已断开连线（按 Ctrl+Z 可撤销）。');
        });
      });
      drawMinimap();
    }

    function resolveParamValue(p, node) {
      const ctx = getContext ? getContext() : {};
      if (!p.dynamic) return p.v || '—';
      if (p.dynamic === 'geminiModel') return ctx.geminiModelShort || 'Neon · High';
      if (p.dynamic === 'codexModel') return ctx.codexModelShort || 'Codex · 默认';
      if (p.dynamic === 'codexEffort') return ctx.codexEffort || 'high';
      if (p.dynamic === 'sandbox') return ctx.sandbox || 'workspace-write';
      if (p.dynamic === 'maxRounds') return `${ctx.maxRounds || 2} 轮复审`;
      if (p.dynamic === 'inCount') {
        const cnt = state.graph.edges.filter((e) => e.target === node.id).length;
        return `${cnt} 路汇入`;
      }
      return p.v || '—';
    }

    function resolveToggleChecked(key) {
      const ctx = getContext ? getContext() : {};
      if (key === 'approval') return Boolean(ctx.approval);
      if (key === 'worktree') return Boolean(ctx.worktree);
      if (key === 'writable') return (ctx.sandbox || 'workspace-write') === 'workspace-write';
      return Boolean(state.extraToggles[key]);
    }

    function renderNodes() {
      const statusMap = effectiveStatuses();
      const statusMeta = {
        idle: { label: '就绪', btn: '单步执行' },
        running: { label: '运行中', btn: '运行中...' },
        completed: { label: '已完成', btn: '重跑' },
        error: { label: '已拦截', btn: '重试' },
      };

      const incomingSet = new Set(state.graph.edges.map((e) => e.target));
      const outgoingSet = new Set(state.graph.edges.map((e) => e.source));

      nodeEls.clear();
      nodesLayerEl.innerHTML = state.graph.nodes
        .map((n) => {
          const tpl = NODE_TEMPLATES[n.kind] || NODE_TEMPLATES['codex-exec'];
          const st = statusMap.get(n.id) || 'idle';
          const running = st === 'running';
          const sel = state.selectedId === n.id;
          const meta = statusMeta[st] || statusMeta.idle;
          const [orbState, orbVariant] = running ? tpl.orbRun : st === 'error' ? ['retrying', 'default'] : tpl.orbIdle;
          const isMerge = n.kind === 'cluster-merge';
          const inCount = state.graph.edges.filter((e) => e.target === n.id).length;

          const chipIcon =
            st === 'completed'
              ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
              : st === 'error'
                ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>'
                : `<span class="wf-chip-dot-wrap">${running ? '<span class="wf-chip-ping"></span>' : ''}<span class="wf-chip-dot"></span></span>`;

          const paramsHtml = (n.params || [])
            .map(
              (p) => `
              <div class="wf-param-row">
                <dt class="wf-param-label">${escapeHtml(p.k)}</dt>
                <dd class="wf-param-val">${escapeHtml(resolveParamValue(p, n))}</dd>
              </div>`
            )
            .join('');

          const togglesHtml = (n.toggles || [])
            .map((t) => {
              const checked = resolveToggleChecked(t.key);
              return `
                <div class="wf-toggle-row">
                  <div class="wf-toggle-text">
                    <div class="wf-toggle-label">${escapeHtml(t.label)}</div>
                    ${t.desc ? `<div class="wf-toggle-desc">${escapeHtml(t.desc)}</div>` : ''}
                  </div>
                  <button type="button" class="wf-switch" role="switch" aria-checked="${checked}" data-ic-toggle="${escapeHtml(t.key)}" aria-label="${escapeHtml(t.label)}">
                    <span class="wf-switch-thumb"></span>
                  </button>
                </div>`;
            })
            .join('');

          return `
            <div class="ic-node-wrap ${sel ? 'is-selected' : ''} ${isMerge ? 'is-merge-hub' : ''}" data-node-id="${escapeHtml(n.id)}" style="transform:translate3d(${n.x}px,${n.y}px,0)">
              <div class="agent-node ${sel ? 'is-selected' : ''}" data-status="${st}">
                ${running ? '<span class="agent-node-glow" aria-hidden="true"></span>' : ''}
                <div class="agent-node-surface">
                  ${running ? '<span class="agent-node-sweep-track" aria-hidden="true"><span class="agent-node-sweep"></span></span>' : ''}
                  <header class="agent-node-head ic-drag-handle" title="按住拖拽自由移动节点（按住 Shift 对齐网格）">
                    <span class="agent-node-icon">
                      <svg class="thinking-orb" width="22" height="22" viewBox="0 0 22 22" data-orb-state="${orbState}" data-orb-variant="${orbVariant}" data-orb-size="22" aria-hidden="true"></svg>
                    </span>
                    <div class="agent-node-titles">
                      <h3 class="agent-node-title">${escapeHtml(n.title)}</h3>
                      <p class="agent-node-sub">${escapeHtml(n.subtitle)}</p>
                    </div>
                    <span class="wf-status-chip ${st}">${chipIcon}<span>${meta.label}</span></span>
                  </header>

                  <div class="agent-node-body">
                    ${paramsHtml ? `<dl class="wf-params">${paramsHtml}</dl>` : ''}
                    ${togglesHtml ? `<div class="wf-toggles">${togglesHtml}</div>` : ''}
                  </div>

                  ${st === 'error' ? `<div class="wf-node-error" role="alert">${escapeHtml(tpl.errorMessage)}</div>` : ''}

                  <footer class="agent-node-foot">
                    <span class="wf-foot-note mono">${isMerge ? `${inCount} 路并行汇聚` : `ID:${escapeHtml(n.id.slice(0, 10))}`}</span>
                    <div class="ic-foot-actions">
                      <button type="button" class="ic-icon-del" data-ic-del="${escapeHtml(n.id)}" title="删除此节点">×</button>
                      <button type="button" class="wf-run-btn ${st !== 'idle' ? 'is-secondary' : ''}" data-ic-run="${escapeHtml(n.id)}" ${running ? 'disabled' : ''}>
                        <span>${meta.btn}</span>
                      </button>
                    </div>
                  </footer>
                </div>
                ${running ? '<span class="agent-node-ring" aria-hidden="true"></span>' : ''}

                ${
                  tpl.showIn
                    ? `<button type="button" class="wf-port wf-port-left ${incomingSet.has(n.id) ? 'is-connected' : ''}" data-port-side="in" data-port-node="${escapeHtml(n.id)}" aria-label="输入端口: ${escapeHtml(tpl.inLabel)}"><span class="wf-port-dot"></span><span class="wf-port-tip">${escapeHtml(tpl.inLabel)}</span></button>`
                    : ''
                }
                ${
                  tpl.showOut
                    ? `<button type="button" class="wf-port wf-port-right ${outgoingSet.has(n.id) ? 'is-connected' : ''}" data-port-side="out" data-port-node="${escapeHtml(n.id)}" aria-label="输出端口: ${escapeHtml(tpl.outLabel)}"><span class="wf-port-dot"></span><span class="wf-port-tip">拖出连线 · ${escapeHtml(tpl.outLabel)}</span></button>`
                    : ''
                }
              </div>
            </div>`;
        })
        .join('');

      nodesLayerEl.querySelectorAll('.ic-node-wrap').forEach((wrap) => {
        const nid = wrap.dataset.nodeId;
        nodeEls.set(nid, wrap);

        // Node drag (Blender-style grab anywhere on card except buttons/switches/ports)
        wrap.addEventListener('pointerdown', (e) => {
          if (e.button !== 0 || state.spaceDown) return;
          if (e.target.closest('button, [role="switch"], .wf-port')) return;
          e.stopPropagation();
          const node = state.graph.nodes.find((x) => x.id === nid);
          if (!node) return;
          if (state.selectedId !== nid) {
            state.selectedId = nid;
            nodesLayerEl.querySelectorAll('.ic-node-wrap').forEach((w) => {
              const s = w.dataset.nodeId === nid;
              w.classList.toggle('is-selected', s);
              w.querySelector('.agent-node')?.classList.toggle('is-selected', s);
            });
          }
          pushHistory();
          const startWorld = screenToWorld(e.clientX, e.clientY);
          state.dragging = {
            id: nid,
            offsetX: startWorld.x - node.x,
            offsetY: startWorld.y - node.y,
            moved: false,
            pointerId: e.pointerId,
          };
          wrap.classList.add('is-dragging');
          try { viewportEl.setPointerCapture(e.pointerId); } catch {}
        });
      });

      // Output port drag-to-connect (Blender noodle wiring!)
      nodesLayerEl.querySelectorAll('[data-port-side="out"]').forEach((portBtn) => {
        portBtn.addEventListener('pointerdown', (e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          const sourceId = portBtn.dataset.portNode;
          const pt = screenToWorld(e.clientX, e.clientY);
          state.wiring = { sourceId, x: pt.x, y: pt.y, hoverTargetId: null, pointerId: e.pointerId };
          try { viewportEl.setPointerCapture(e.pointerId); } catch {}
          setStatus('正在拉出连线：拖至任意其他节点的左侧输入端口松手即可合并连接。');
          renderEdges();
        });
      });

      // Click input port when wiring or inspecting
      nodesLayerEl.querySelectorAll('[data-port-side="in"]').forEach((portBtn) => {
        portBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const nid = portBtn.dataset.portNode;
          const count = state.graph.edges.filter((ed) => ed.target === nid).length;
          setStatus(`输入端口状态：当前共有 ${count} 路 Agent 上游连线汇入此节点。`);
        });
      });

      // Node toggles
      nodesLayerEl.querySelectorAll('[data-ic-toggle]').forEach((sw) => {
        sw.addEventListener('click', (e) => {
          e.stopPropagation();
          const key = sw.dataset.icToggle;
          if (key === 'approval' || key === 'worktree' || key === 'writable') {
            if (onToggleSync) onToggleSync(key);
          } else {
            state.extraToggles[key] = !state.extraToggles[key];
          }
          renderAll();
        });
      });

      // Node delete
      nodesLayerEl.querySelectorAll('[data-ic-del]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          removeNode(btn.dataset.icDel);
        });
      });

      // Single node run
      nodesLayerEl.querySelectorAll('[data-ic-run]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const nid = btn.dataset.icRun;
          const node = state.graph.nodes.find((x) => x.id === nid);
          if (!node) return;
          if (onRunSingleNode && onRunSingleNode(node)) return;
          runSinglePreview(nid);
        });
      });

      if (window.ConduitOrbs) window.ConduitOrbs.mountAll(nodesLayerEl);
    }

    function renderAll() {
      renderNodes();
      renderEdges();
      applyTransform();
    }

    function drawMinimap() {
      if (!minimapCanvasEl) return;
      const ctx = minimapCanvasEl.getContext('2d');
      if (!ctx) return;
      const w = minimapCanvasEl.clientWidth || 164;
      const h = minimapCanvasEl.clientHeight || 100;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (minimapCanvasEl.width !== Math.round(w * dpr) || minimapCanvasEl.height !== Math.round(h * dpr)) {
        minimapCanvasEl.width = Math.round(w * dpr);
        minimapCanvasEl.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const vpRect = viewportEl.getBoundingClientRect();
      if (!vpRect.width || !vpRect.height) return;
      const viewX0 = -state.panX / state.zoom;
      const viewY0 = -state.panY / state.zoom;
      const viewX1 = (vpRect.width - state.panX) / state.zoom;
      const viewY1 = (vpRect.height - state.panY) / state.zoom;

      let minX = viewX0;
      let minY = viewY0;
      let maxX = viewX1;
      let maxY = viewY1;
      state.graph.nodes.forEach((n) => {
        minX = Math.min(minX, n.x - 80);
        minY = Math.min(minY, n.y - 80);
        maxX = Math.max(maxX, n.x + NODE_WIDTH + 80);
        maxY = Math.max(maxY, n.y + 260);
      });
      const spanX = Math.max(400, maxX - minX);
      const spanY = Math.max(300, maxY - minY);
      const scale = Math.min((w - 14) / spanX, (h - 14) / spanY);
      const ox = (w - spanX * scale) / 2 - minX * scale;
      const oy = (h - spanY * scale) / 2 - minY * scale;

      const byId = new Map(state.graph.nodes.map((n) => [n.id, n]));
      const statusMap = effectiveStatuses();

      // Edges
      ctx.strokeStyle = 'rgba(130, 150, 190, 0.45)';
      ctx.lineWidth = 1;
      state.graph.edges.forEach((e) => {
        const s = byId.get(e.source);
        const t = byId.get(e.target);
        if (!s || !t) return;
        ctx.beginPath();
        ctx.moveTo(ox + (s.x + NODE_WIDTH) * scale, oy + (s.y + PORT_Y) * scale);
        ctx.lineTo(ox + t.x * scale, oy + (t.y + PORT_Y) * scale);
        ctx.stroke();
      });

      // Nodes
      state.graph.nodes.forEach((n) => {
        const st = statusMap.get(n.id) || 'idle';
        ctx.fillStyle =
          st === 'running'
            ? '#1b66ff'
            : st === 'completed'
              ? '#10b981'
              : st === 'error'
                ? '#ef4444'
                : n.id === state.selectedId
                  ? '#ffffff'
                  : 'rgba(162, 167, 178, 0.55)';
        ctx.fillRect(ox + n.x * scale, oy + n.y * scale, Math.max(8, NODE_WIDTH * scale), Math.max(6, 175 * scale));
      });

      // Current viewport rect
      ctx.strokeStyle = '#1b66ff';
      ctx.fillStyle = 'rgba(27, 102, 255, 0.12)';
      ctx.lineWidth = 1.25;
      const vx = ox + viewX0 * scale;
      const vy = oy + viewY0 * scale;
      const vw = (viewX1 - viewX0) * scale;
      const vh = (viewY1 - viewY0) * scale;
      ctx.fillRect(vx, vy, vw, vh);
      ctx.strokeRect(vx, vy, vw, vh);
    }

    function addNode(kind) {
      const tpl = NODE_TEMPLATES[kind] || NODE_TEMPLATES['codex-exec'];
      pushHistory();
      const rect = viewportEl.getBoundingClientRect();
      const cx = (rect.width / 2 - state.panX) / state.zoom - NODE_WIDTH / 2;
      const cy = (rect.height / 2 - state.panY) / state.zoom - 90;
      let x = Math.round(cx / GRID_SNAP) * GRID_SNAP;
      let y = Math.round(cy / GRID_SNAP) * GRID_SNAP;
      while (state.graph.nodes.some((n) => Math.abs(n.x - x) < 40 && Math.abs(n.y - y) < 40)) {
        x += 36;
        y += 36;
      }

      const id = `n-${kind.split('-')[1] || 'agent'}-${++state.seq}`;
      const num = state.graph.nodes.filter((n) => n.kind === kind).length + 1;
      const node = {
        id,
        kind,
        title: `${tpl.title} #${num}`,
        subtitle: tpl.subtitle,
        x,
        y,
        status: 'idle',
        params:
          kind === 'gemini-plan'
            ? [{ k: 'Model', dynamic: 'geminiModel' }, { k: 'Branching', v: '3 路权衡' }]
            : kind === 'codex-exec'
              ? [{ k: 'Model', dynamic: 'codexModel' }, { k: 'Worktree', v: `wt/worker-${num}` }]
              : kind === 'cluster-merge'
                ? [{ k: 'Strategy', v: '3-Way Merge' }, { k: 'Inputs', dynamic: 'inCount' }]
                : kind === 'codex-review'
                  ? [{ k: 'Max Rounds', dynamic: 'maxRounds' }, { k: 'High-Risk', v: '自动升 xhigh' }]
                  : [{ k: 'Model', dynamic: 'geminiModel' }, { k: 'Style', v: '去 AI 解释腔' }],
        toggles:
          kind === 'codex-exec'
            ? [{ key: 'worktree', label: 'Worktree 隔离', desc: '独立分支防冲突' }]
            : kind === 'cluster-merge'
              ? [{ key: 'autoNewDiff', label: '合并新建文件', desc: '汇总进统一 Diff' }]
              : [],
      };
      state.graph.nodes.push(node);

      // Auto-wire nicely if a previous node is selected and no cycle
      const prev = state.graph.nodes.find((n) => n.id === state.selectedId);
      if (prev && prev.id !== id && canConnect(state.graph, prev.id, id)) {
        state.graph.edges.push({ id: `e-${++state.seq}`, source: prev.id, target: id });
      }
      state.selectedId = id;
      renderAll();
      setStatus(`已添加「${node.title}」到画布，可自由拖动位置或拖拽端口与其他 Agent 合并连线。`);
      if (onToast) onToast(`已添加节点：${node.title}`);
    }

    function removeNode(id) {
      if (state.graph.nodes.length <= 1) {
        if (onToast) onToast('至少保留一个节点');
        return;
      }
      const target = state.graph.nodes.find((n) => n.id === id);
      if (!target) return;
      pushHistory();
      const inc = state.graph.edges.filter((e) => e.target === id);
      const out = state.graph.edges.filter((e) => e.source === id);
      state.graph.nodes = state.graph.nodes.filter((n) => n.id !== id);
      state.graph.edges = state.graph.edges.filter((e) => e.source !== id && e.target !== id);
      // Auto-bridge if 1-in 1-out (from 21st.dev #43113)
      if (inc.length === 1 && out.length === 1 && canConnect(state.graph, inc[0].source, out[0].target)) {
        state.graph.edges.push({ id: `e-${++state.seq}`, source: inc[0].source, target: out[0].target });
      }
      if (state.selectedId === id) state.selectedId = state.graph.nodes[0]?.id || '';
      renderAll();
      setStatus(`已移除「${target.title}」（按 Ctrl+Z 可撤销）。`);
    }

    function undo() {
      if (state.history.length === 0) {
        if (onToast) onToast('没有可撤销的画布操作');
        return;
      }
      state.graph = state.history.pop();
      renderAll();
      setStatus('已撤销上一步画布操作。');
    }

    function loadPreset(name) {
      pushHistory();
      state.demoToken += 1;
      state.demoRunning = false;
      state.graph = name === 'linear' ? makeLinearPreset() : makeClusterPreset();
      state.selectedId = state.graph.nodes[0]?.id || '';
      renderAll();
      requestAnimationFrame(() => fitView(true));
      setStatus(
        name === 'linear'
          ? '已载入经典 3 节点流水线（支持自由拖拽、缩放与添加节点）。'
          : '已载入「双路并行 + 集群聚合合并」5 节点编排模板，拖拽任意节点或端口即可改造集群拓扑！'
      );
      if (onStatusChange) onStatusChange();
    }

    function wait(ms) {
      return new Promise((r) => setTimeout(r, ms));
    }

    async function runClusterDemo() {
      const token = ++state.demoToken;
      state.demoRunning = true;
      state.graph.nodes.forEach((n) => { n.status = 'idle'; });
      const waves = topoWaves(state.graph);
      setStatus(`正在按拓扑分层并发调度 ${state.graph.nodes.length} 个 Agent 节点（共 ${waves.length} 波次）...`);
      renderAll();
      if (onStatusChange) onStatusChange();

      for (let w = 0; w < waves.length; w += 1) {
        if (token !== state.demoToken) return;
        const ids = waves[w];
        const names = ids.map((id) => state.graph.nodes.find((n) => n.id === id)?.title || id).join(' ＋ ');
        ids.forEach((id) => {
          const n = state.graph.nodes.find((x) => x.id === id);
          if (n) n.status = 'running';
        });
        state.selectedId = ids[0];
        setStatus(`波次 ${w + 1}/${waves.length} 并发执行中：${names}`);
        renderAll();
        if (onStatusChange) onStatusChange();

        await wait(ids.length > 1 ? 1650 : 1250);
        if (token !== state.demoToken) return;

        let blocked = false;
        ids.forEach((id) => {
          const n = state.graph.nodes.find((x) => x.id === id);
          if (!n) return;
          if (state.failLast && w === waves.length - 1) {
            n.status = 'error';
            blocked = true;
          } else {
            n.status = 'completed';
          }
        });
        renderAll();
        if (blocked) {
          state.demoRunning = false;
          setStatus('集群演练在终局门禁处触发 [BLOCKING] 阻断，请查看红框提示并点击「重试」。');
          if (onStatusChange) onStatusChange();
          return;
        }
      }

      state.demoRunning = false;
      setStatus(`集群拓扑全链路 PASS：共 ${state.graph.nodes.length} 个节点、${state.graph.edges.length} 条数据通道完成汇聚交付！`);
      renderAll();
      if (onStatusChange) onStatusChange();
    }

    async function runSinglePreview(nid) {
      const token = ++state.demoToken;
      const node = state.graph.nodes.find((n) => n.id === nid);
      if (!node) return;
      state.demoRunning = true;
      state.selectedId = nid;
      node.status = 'running';
      setStatus(`正在单步预演「${node.title}」（切回对话流输入需求即可直调真实本机 CLI）...`);
      renderAll();
      if (onStatusChange) onStatusChange();
      await wait(1200);
      if (token !== state.demoToken) return;
      node.status = state.failLast && node.kind === 'codex-review' ? 'error' : 'completed';
      state.demoRunning = false;
      setStatus(`「${node.title}」${node.status === 'error' ? '触发模拟拦截。' : '预演完成。'}`);
      renderAll();
      if (onStatusChange) onStatusChange();
    }

    function resetDemo() {
      state.demoToken += 1;
      state.demoRunning = false;
      state.graph.nodes.forEach((n) => { n.status = 'idle'; });
      setStatus('所有节点已重置为就绪态。');
      renderAll();
      if (onStatusChange) onStatusChange();
    }

    function exportJson() {
      const payload = JSON.stringify(
        {
          engine: 'CONDUIT Infinite Agent Cluster Canvas',
          nodes: state.graph.nodes.map(({ id, kind, title, x, y }) => ({ id, kind, title, x, y })),
          edges: state.graph.edges,
        },
        null,
        2
      );
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(payload).then(() => {
          if (onToast) onToast('已复制集群拓扑 JSON 到剪贴板');
        }).catch(() => {});
      }
      setStatus('已导出当前集群拓扑 JSON。');
    }

    // --- Pointer & Wheel Events on Infinite Viewport ---
    viewportEl.addEventListener('pointerdown', (e) => {
      // Middle-mouse drag anywhere, or Left-mouse drag on empty background / Space+drag
      const isBg = !e.target.closest('.ic-node-wrap, .ic-hud-panel, .ic-floating-bar, .ic-minimap-card');
      if (e.button === 1 || (e.button === 0 && (isBg || state.spaceDown))) {
        e.preventDefault();
        state.panning = {
          startX: e.clientX,
          startY: e.clientY,
          originPanX: state.panX,
          originPanY: state.panY,
          pointerId: e.pointerId,
        };
        viewportEl.classList.add('is-panning');
        try { viewportEl.setPointerCapture(e.pointerId); } catch {}
      }
    });

    viewportEl.addEventListener('pointermove', (e) => {
      if (state.panning) {
        state.panX = state.panning.originPanX + (e.clientX - state.panning.startX);
        state.panY = state.panning.originPanY + (e.clientY - state.panning.startY);
        applyTransform();
        return;
      }

      if (state.dragging) {
        const node = state.graph.nodes.find((n) => n.id === state.dragging.id);
        if (!node) return;
        const pt = screenToWorld(e.clientX, e.clientY);
        let nx = pt.x - state.dragging.offsetX;
        let ny = pt.y - state.dragging.offsetY;
        if (e.shiftKey) {
          nx = Math.round(nx / GRID_SNAP) * GRID_SNAP;
          ny = Math.round(ny / GRID_SNAP) * GRID_SNAP;
        }
        node.x = Math.round(nx);
        node.y = Math.round(ny);
        state.dragging.moved = true;
        const el = nodeEls.get(node.id);
        if (el) el.style.transform = `translate3d(${node.x}px,${node.y}px,0)`;
        renderEdges();
        return;
      }

      if (state.wiring) {
        const pt = screenToWorld(e.clientX, e.clientY);
        state.wiring.x = pt.x;
        state.wiring.y = pt.y;
        // Hit-test target input ports
        const hit = document.elementsFromPoint(e.clientX, e.clientY).find((el) => el.dataset?.portSide === 'in');
        const nextHover = hit ? hit.dataset.portNode : null;
        if (state.wiring.hoverTargetId !== nextHover) {
          nodesLayerEl.querySelectorAll('.wf-port.is-drop-target').forEach((p) => p.classList.remove('is-drop-target'));
          if (hit && nextHover && canConnect(state.graph, state.wiring.sourceId, nextHover)) {
            hit.classList.add('is-drop-target');
          }
          state.wiring.hoverTargetId = nextHover;
        }
        renderEdges();
      }
    });

    const finishPointer = (e) => {
      if (state.panning) {
        try { viewportEl.releasePointerCapture(state.panning.pointerId); } catch {}
        state.panning = null;
        viewportEl.classList.remove('is-panning');
      }
      if (state.dragging) {
        const wrap = nodeEls.get(state.dragging.id);
        if (wrap) wrap.classList.remove('is-dragging');
        if (!state.dragging.moved && state.history.length > 0) state.history.pop();
        try { viewportEl.releasePointerCapture(state.dragging.pointerId); } catch {}
        state.dragging = null;
        drawMinimap();
      }
      if (state.wiring) {
        const { sourceId, pointerId } = state.wiring;
        const hit = document.elementsFromPoint(e.clientX, e.clientY).find((el) => el.dataset?.portSide === 'in');
        const targetId = hit ? hit.dataset.portNode : state.wiring.hoverTargetId;
        nodesLayerEl.querySelectorAll('.wf-port.is-drop-target').forEach((p) => p.classList.remove('is-drop-target'));
        try { viewportEl.releasePointerCapture(pointerId); } catch {}
        state.wiring = null;

        if (targetId) {
          if (canConnect(state.graph, sourceId, targetId)) {
            pushHistory();
            state.graph.edges.push({ id: `e-${++state.seq}`, source: sourceId, target: targetId });
            const srcName = state.graph.nodes.find((n) => n.id === sourceId)?.title || sourceId;
            const dstName = state.graph.nodes.find((n) => n.id === targetId)?.title || targetId;
            setStatus(`已连线合并：「${srcName}」 → 「${dstName}」`);
            if (onToast) onToast('节点连线成功');
            renderAll();
          } else {
            setStatus('无法连接：不可自连、重复连线或形成循环依赖。');
            if (onToast) onToast('拒绝形成循环依赖或重复连线');
            renderEdges();
          }
        } else {
          renderEdges();
        }
      }
    };

    viewportEl.addEventListener('pointerup', finishPointer);
    viewportEl.addEventListener('pointercancel', finishPointer);

    // Smooth wheel zoom centered at cursor (Blender-style)
    viewportEl.addEventListener(
      'wheel',
      (e) => {
        if (e.target.closest('.ic-hud-panel, .ic-floating-bar')) return;
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        zoomAt(factor, e.clientX, e.clientY);
      },
      { passive: false }
    );

    // Keyboard shortcuts while Workflow Canvas is active
    window.addEventListener('keydown', (e) => {
      if (viewportEl.closest('.hidden')) return;
      const tag = (e.target?.tagName || '').toLowerCase();
      if (['input', 'textarea', 'select'].includes(tag)) return;
      if (e.code === 'Space' && !e.repeat) {
        state.spaceDown = true;
        viewportEl.classList.add('is-space-pan');
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      } else if (e.key.toLowerCase() === 'f' || e.key === 'Home') {
        e.preventDefault();
        fitView(true);
      } else if (e.key === '1') {
        state.zoom = 1;
        applyTransform();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedId) {
        e.preventDefault();
        removeNode(state.selectedId);
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        state.spaceDown = false;
        viewportEl.classList.remove('is-space-pan');
      }
    });

    // Click minimap to jump viewport
    if (minimapCanvasEl) {
      minimapCanvasEl.addEventListener('click', () => fitView(true));
    }

    renderAll();

    return {
      render: renderAll,
      fitView,
      zoomIn: () => zoomAt(1.18),
      zoomOut: () => zoomAt(1 / 1.18),
      resetZoom: () => { state.zoom = 1; applyTransform(); },
      addNode,
      undo,
      loadPreset,
      runClusterDemo,
      resetDemo,
      exportJson,
      setFailLast: (v) => { state.failLast = Boolean(v); },
      selectKind: (idx) => {
        const n = state.graph.nodes[idx] || state.graph.nodes[0];
        if (n) {
          state.selectedId = n.id;
          renderAll();
        }
      },
      isDemoRunning: () => state.demoRunning,
      getActiveOrb: () => {
        if (!state.demoRunning) return null;
        const running = state.graph.nodes.find((n) => n.status === 'running');
        if (!running) return null;
        const tpl = NODE_TEMPLATES[running.kind];
        return tpl ? tpl.orbRun : ['working', 'gyro'];
      },
    };
  }

  window.ConduitCanvas = { createInfiniteCanvas, NODE_TEMPLATES };
})();
