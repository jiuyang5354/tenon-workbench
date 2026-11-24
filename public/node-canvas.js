(() => {
  'use strict';

  /**
   * CONDUIT Infinite Agent Cluster Canvas v6.1 (Hardened Blender-Grade Node IDE)
   * - Per-Node Custom Model & Effort Picker right on every card & in Node Detail Drawer
   * - Blender infinite pan/zoom, free node drag (4px threshold + Shift snap), port-to-port wiring (DAG cycle guard)
   * - Edge-aware Right-Click Context Menu (21st.dev #23560) & Shift+A Quick-Add Menu
   * - In-Card Collapsible Tree Chain-of-Thought (21st.dev #28391) stepping live per wave
   * - Multi-Cluster Hierarchical Merge Presets + Blank Canvas + Save/Load Custom Templates
   * - Hardened: XSS-safe enum whitelisting, IME/focus preservation, capture-leak protection, Daylight contrast
   */

  const NODE_WIDTH = 296;
  const MIN_NODE_W = 240;
  const MAX_NODE_W = 680;
  const MIN_NODE_H = 190;
  const MAX_NODE_H = 760;
  const PORT_Y = 58;
  const GRID_SNAP = 24;
  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 2.0;
  const DRAG_THRESHOLD = 4;
  const CUSTOM_STORAGE_KEY = 'conduit_custom_cluster_graph_v1';

  const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const nodeWidth = (n) => (n && Number.isFinite(Number(n.w)) ? clampNum(Math.round(Number(n.w)), MIN_NODE_W, MAX_NODE_W) : NODE_WIDTH);
  const nodeHeight = (n) => (n && Number.isFinite(Number(n.h)) && Number(n.h) > 0 ? clampNum(Math.round(Number(n.h)), MIN_NODE_H, MAX_NODE_H) : null);

  const VALID_NODE_STATUS = new Set(['idle', 'running', 'completed', 'error']);
  const VALID_STEP_STATUS = new Set(['pending', 'active', 'completed', 'error']);
  const EFFORT_OPTIONS = [
    { id: '', label: '跟随全局默认', badge: 'AUTO' },
    { id: 'low', label: 'low（极速）', badge: 'LOW' },
    { id: 'medium', label: 'medium（均衡）', badge: 'MED' },
    { id: 'high', label: 'high（推荐）', badge: 'HIGH' },
    { id: 'xhigh', label: 'xhigh（深度）', badge: 'EXTRA' },
    { id: 'max', label: 'max（极限）', badge: 'MAX' },
    { id: 'ultracode', label: 'ultracode（Ultracode）', badge: 'ULTRA' },
  ];

  const NODE_TEMPLATES = {
    'gemini-plan': {
      kind: 'gemini-plan',
      roleCode: 'PLANNER',
      provider: 'gemini',
      title: 'Gemini · 架构规划师',
      subtitle: '需求拆解与接口契约设计',
      mode: 'plan-only',
      orbIdle: ['reasoning', 'default'],
      orbRun: ['reasoning', 'twins'],
      inLabel: '上游需求',
      outLabel: 'Spec 契约',
      inType: 'prompt',
      outType: 'spec',
      showIn: true,
      showOut: true,
      defaultPrompt: '只读分析工程目录边界，输出接口契约、多路并行子任务切分与验收标准。',
      stepTemplates: [
        { verb: '扫描目录与模块边界', detail: '只读索引核心文件树，识别共享类型与高耦合边界' },
        { verb: '并行权衡 3 条架构路线', detail: '评估 最小补丁(76) / 模块解耦(85) / 契约双门禁(94·采纳)' },
        { verb: '锁定接口契约与子任务单', detail: '产出结构化接口 Spec 并向下游并行工位派发任务' },
      ],
      errorMessage: '规划阶段未产出有效契约，请检查 agy CLI 登录态后重试。',
    },
    'codex-exec': {
      kind: 'codex-exec',
      roleCode: 'WORKER',
      provider: 'codex',
      title: 'Codex · 沙箱工位',
      subtitle: '独立沙箱编写代码与单测',
      mode: 'codex-exec',
      orbIdle: ['working', 'gyro'],
      orbRun: ['working', 'gyro'],
      inLabel: 'Spec 契约',
      outLabel: 'Branch Diff',
      inType: 'spec',
      outType: 'diff',
      showIn: true,
      showOut: true,
      defaultPrompt: '在 workspace-write 隔离工作树中严格按接口契约实现代码并补全自动化测试。',
      stepTemplates: [
        { verb: '初始化受管隔离沙箱', detail: '锁定 workspace-write 与独立 Worktree，确保主干零污染' },
        { verb: '编写核心实现与边界校验', detail: '按接口契约完成代码变更并补齐异常路径处理' },
        { verb: '执行静态语法与单元测试', detail: 'node --check 全量通过 · 自动化测试套件 PASS (exit 0)' },
      ],
      errorMessage: 'Codex 沙箱执行失败，请检查 CODEX_HOME 凭据或目录权限。',
    },
    'cluster-merge': {
      kind: 'cluster-merge',
      roleCode: 'MERGE HUB',
      provider: 'both',
      title: '集群聚合合并器',
      subtitle: '汇合多路 Agent 产物与冲突仲裁',
      mode: 'full-pipeline',
      orbIdle: ['compacting', 'squeeze'],
      orbRun: ['compacting', 'fuse'],
      inLabel: '多路并行输入',
      outLabel: 'Merged Patch',
      inType: 'multi',
      outType: 'diff',
      showIn: true,
      showOut: true,
      defaultPrompt: '汇合全部上游并行 Agent 分支 Diff，执行三路语义合并、消除类型/接口冲突并生成统一补丁。',
      stepTemplates: [
        { verb: '拉取多路并行分支 Diff', detail: '汇集全部上游工位改动与新建未跟踪文件快照' },
        { verb: '执行 3-Way 语义合并仲裁', detail: '校验跨模块契约一致性，0 处未解决冲突' },
        { verb: '封装统一 Merged Patch', detail: '生成完整统一差异包并交付下游合并器或门禁审查' },
      ],
      errorMessage: '多路分支合并检测到接口契约冲突，请打开详情面板查看冲突段。',
    },
    'codex-review': {
      kind: 'codex-review',
      roleCode: 'PRE-CI GATE',
      provider: 'codex',
      title: 'Pre-CI 审查与终局汇报',
      subtitle: '分级阻断审查 + Gemini 10秒汇报',
      mode: 'codex-review',
      orbIdle: ['searching', 'lighthouse'],
      orbRun: ['searching', 'lighthouse'],
      inLabel: 'Merged Diff',
      outLabel: 'Release Pass',
      inType: 'diff',
      outType: 'gate',
      showIn: true,
      showOut: true,
      defaultPrompt: '只读审查统一合并后的 Git Diff，区分 BLOCKING 与 SUGGESTION，命中高危路径自动升档 xhigh。',
      stepTemplates: [
        { verb: '扫描高危安全路径', detail: '检测 auth / payment / permission / deploy 敏感改动并判定档位' },
        { verb: '执行两级门禁裁决', detail: '逐行排查数据丢失、越权与竞态缺陷（BLOCKING: 0）' },
        { verb: 'Gemini 汇总 10 秒交付汇报', detail: '将技术 Diff 与审查结果转译为人类一眼看懂的交付结论' },
      ],
      errorMessage: 'Pre-CI 审查拦截：命中高危鉴权路径 [BLOCKING]，已阻断发布等待人工复核。',
    },
    'gemini-copy': {
      kind: 'gemini-copy',
      roleCode: 'COPY ADVISOR',
      provider: 'gemini',
      title: 'Gemini · 文案与交互顾问',
      subtitle: '去除 AI 解释腔，打磨界面文案',
      mode: 'copy-polish',
      orbIdle: ['background', 'spiral'],
      orbRun: ['reasoning', 'default'],
      inLabel: '产品草稿',
      outLabel: '定稿文案',
      showIn: true,
      showOut: true,
      defaultPrompt: '审视界面空状态、按钮与报错文案，剔除 AI 腔并输出前后对比表。',
      stepTemplates: [
        { verb: '扫描高频 AI 营销套话', detail: '识别冗余解释句与机械过渡词' },
        { verb: '重写精炼交互文案', detail: '压缩字数 45%，强化动词与即时反馈感' },
        { verb: '输出前后对照交付表', detail: '附带场景说明与推荐直接替换的最终文案' },
      ],
      errorMessage: '文案润色超时，请点击重试。',
    },
    'image-gen': {
      kind: 'image-gen',
      roleCode: 'IMAGE STUDIO',
      provider: 'gemini',
      title: '图像生成与变体工位',
      subtitle: '渐进扫描揭示 · 4 组变体 · Lightbox',
      mode: 'image-gen',
      orbIdle: ['waiting', 'default'],
      orbRun: ['working', 'gyro'],
      inLabel: '视觉提示词',
      outLabel: '图像产物',
      showIn: true,
      showOut: true,
      defaultPrompt: 'Figma Weave 风格冷矿物建筑白昼光影雕塑，极简几何结构与纸张肌理',
      stepTemplates: [
        { verb: '构图与比例锁定', detail: '按 4:3 画幅初始化 4 组变体插槽与胶片噪点基底' },
        { verb: '渐进扫描渲染细节', detail: '从上至下同步推进清晰度扫描线并计算平滑 ETA' },
        { verb: '完成 4 组变体并开放放大', detail: '支持变体切换、2× 高清放大、微调变体与全屏 Lightbox' },
      ],
      errorMessage: '图像生成节点渲染中断，请重试。',
    },
    'video-gen': {
      kind: 'video-gen',
      roleCode: 'VIDEO STUDIO',
      provider: 'gemini',
      title: '视频渲染与播放工位',
      subtitle: '帧渐进揭示 · 悬浮控制栏播放器',
      mode: 'video-gen',
      orbIdle: ['background', 'spiral'],
      orbRun: ['working', 'gyro'],
      inLabel: '分镜 / 首帧',
      outLabel: '视频片段',
      showIn: true,
      showOut: true,
      defaultPrompt: '极简暗夜静水上的同心涟漪，俯视慢镜头，细微胶片颗粒与柠黄微光',
      stepTemplates: [
        { verb: '解析镜头脚本与首帧海报', detail: '锁定 16:9 · 1080p · 24fps 构图与首帧渐进揭示基底' },
        { verb: '逐帧渲染动态波形', detail: '实时写入视频流并推进扫描进度条' },
        { verb: '封装播放并就绪下载', detail: '挂载自定义悬浮播放器（支持 K/M/F 快捷键与拖拽）' },
      ],
      errorMessage: '视频渲染节点编码中止，请重试。',
    },
  };

  function makeStepsForNode(kind, customDetail = '') {
    const tpl = NODE_TEMPLATES[kind] || NODE_TEMPLATES['codex-exec'];
    return tpl.stepTemplates.map((s, idx) => ({
      id: `s-${idx + 1}`,
      verb: s.verb,
      detail: idx === 0 && customDetail ? customDetail : s.detail,
      status: 'pending',
      ms: 0,
    }));
  }

  function sanitizeStatus(val, allowed, fallback) {
    return typeof val === 'string' && allowed.has(val) ? val : fallback;
  }

  function hydrateNode(raw) {
    const obj = raw && typeof raw === 'object' ? raw : {};
    const kind = Object.prototype.hasOwnProperty.call(NODE_TEMPLATES, obj.kind) ? obj.kind : 'codex-exec';
    const tpl = NODE_TEMPLATES[kind];
    const safeParams = Array.isArray(obj.params)
      ? obj.params.filter((p) => p && typeof p === 'object').map((p) => ({ ...p }))
      : [];
    // Ensure every node exposes an interactive Model row!
    if (!safeParams.some((p) => p.dynamic === 'nodeModel')) {
      safeParams.unshift({ k: 'Model', dynamic: 'nodeModel' });
    }
    const safeToggles = Array.isArray(obj.toggles)
      ? obj.toggles.filter((t) => t && typeof t === 'object').map((t) => ({ ...t }))
      : [];
    const safeSteps =
      Array.isArray(obj.steps) && obj.steps.length > 0
        ? obj.steps
            .filter((s) => s && typeof s === 'object')
            .map((s, idx) => ({
              id: typeof s.id === 'string' && s.id ? s.id : `s-${idx + 1}`,
              verb: String(s.verb || `步骤 ${idx + 1}`),
              detail: String(s.detail || ''),
              status: sanitizeStatus(s.status, VALID_STEP_STATUS, 'pending'),
              ms: Number.isFinite(Number(s.ms)) ? Number(s.ms) : 0,
            }))
        : makeStepsForNode(kind);

    return {
      id: typeof obj.id === 'string' && obj.id.trim() ? obj.id.trim() : `n-${Math.random().toString(36).slice(2, 8)}`,
      kind,
      title: typeof obj.title === 'string' && obj.title ? obj.title : tpl.title,
      subtitle: typeof obj.subtitle === 'string' && obj.subtitle ? obj.subtitle : tpl.subtitle,
      prompt: typeof obj.prompt === 'string' && obj.prompt ? obj.prompt : tpl.defaultPrompt,
      model: typeof obj.model === 'string' ? obj.model.trim() : '',
      effort: typeof obj.effort === 'string' ? obj.effort.trim() : '',
      x: Number.isFinite(Number(obj.x)) ? Number(obj.x) : 80,
      y: Number.isFinite(Number(obj.y)) ? Number(obj.y) : 120,
      w: Number.isFinite(Number(obj.w)) ? clampNum(Math.round(Number(obj.w)), MIN_NODE_W, MAX_NODE_W) : NODE_WIDTH,
      h: Number.isFinite(Number(obj.h)) && Number(obj.h) > 0 ? clampNum(Math.round(Number(obj.h)), MIN_NODE_H, MAX_NODE_H) : null,
      status: sanitizeStatus(obj.status, VALID_NODE_STATUS, 'idle'),
      muted: Boolean(obj.muted),
      collapsed: Boolean(obj.collapsed),
      cotOpen: Boolean(obj.cotOpen),
      params: safeParams,
      toggles: safeToggles,
      steps: safeSteps,
      outputMd: typeof obj.outputMd === 'string' ? obj.outputMd : '',
      durationMs: Number.isFinite(Number(obj.durationMs)) ? Number(obj.durationMs) : 0,
    };
  }

  function makeClusterPreset() {
    return {
      nodes: [
        hydrateNode({
          id: 'n-plan',
          kind: 'gemini-plan',
          title: 'Gemini · 总架构规划师',
          subtitle: '拆解契约并分发双路并行任务',
          x: 60,
          y: 230,
          params: [{ k: 'Model', dynamic: 'nodeModel' }, { k: 'Branching', v: '3 路权衡' }],
          toggles: [{ key: 'approval', label: '人工拍板闸门', desc: '派发集群前人工确认' }],
        }),
        hydrateNode({
          id: 'n-codex-fe',
          kind: 'codex-exec',
          title: 'Codex · 前端工位 #1',
          subtitle: '并行实现 UI 组件与交互动效',
          x: 460,
          y: -36,
          params: [{ k: 'Model', dynamic: 'nodeModel' }, { k: 'Effort', dynamic: 'nodeEffort' }, { k: 'Worktree', v: 'wt/agent-fe' }],
          toggles: [{ key: 'worktree', label: 'Worktree 隔离', desc: '独立分支零污染' }],
        }),
        hydrateNode({
          id: 'n-codex-be',
          kind: 'codex-exec',
          title: 'Codex · 后端工位 #2',
          subtitle: '并行实现接口契约与单元测试',
          x: 460,
          y: 516,
          params: [{ k: 'Model', dynamic: 'nodeModel' }, { k: 'Effort', dynamic: 'nodeEffort' }],
          toggles: [{ key: 'writable', label: '沙箱写权限', desc: 'workspace-write' }],
        }),
        hydrateNode({
          id: 'n-merge',
          kind: 'cluster-merge',
          title: '集群聚合合并器',
          subtitle: '汇合双路 Diff 并统一对齐接口',
          x: 860,
          y: 230,
          params: [{ k: 'Model', dynamic: 'nodeModel' }, { k: 'Inputs', dynamic: 'inCount' }],
          toggles: [{ key: 'autoNewDiff', label: '合并新建未跟踪文件', desc: '纳入统一 Diff 视图' }],
        }),
        hydrateNode({
          id: 'n-review',
          kind: 'codex-review',
          title: 'Pre-CI 门禁与终局汇报',
          subtitle: '两级阻断审查 + 10秒人话总结',
          x: 1260,
          y: 230,
          params: [{ k: 'Model', dynamic: 'nodeModel' }, { k: 'Effort', dynamic: 'nodeEffort' }, { k: 'Max Rounds', dynamic: 'maxRounds' }],
          toggles: [{ key: 'humanReport', label: 'Gemini 终局汇报', desc: '输出人类速览结论' }],
        }),
      ],
      edges: [
        { id: 'e-1', source: 'n-plan', target: 'n-codex-fe' },
        { id: 'e-2', source: 'n-plan', target: 'n-codex-be' },
        { id: 'e-3', source: 'n-codex-fe', target: 'n-merge' },
        { id: 'e-4', source: 'n-codex-be', target: 'n-merge' },
        { id: 'e-5', source: 'n-merge', target: 'n-review' },
      ],
      groups: [
        {
          id: 'grp-codex-workers',
          title: '并行施工节点组 · CODEX GROUP',
          accent: 'sage',
          nodeIds: ['n-codex-fe', 'n-codex-be'],
          collapsed: false,
        },
      ],
    };
  }

  function makeMultiClusterPreset() {
    return {
      nodes: [
        hydrateNode({
          id: 'mc-plan',
          kind: 'gemini-plan',
          title: 'Gemini · 总控编排中枢',
          subtitle: '拆分前端集群与后端集群两大战线',
          x: 40,
          y: 310,
          params: [{ k: 'Model', dynamic: 'nodeModel' }, { k: 'Clusters', v: '2 组并行集群' }],
        }),
        hydrateNode({
          id: 'mc-fe-1',
          kind: 'codex-exec',
          title: '集群A · UI 组件工位',
          subtitle: '独立构建界面视图与主题变量',
          x: 410,
          y: 16,
          params: [{ k: 'Model', dynamic: 'nodeModel' }, { k: 'Worktree', v: 'wt/clusterA-ui' }],
        }),
        hydrateNode({
          id: 'mc-fe-2',
          kind: 'gemini-copy',
          title: '集群A · 交互文案顾问',
          subtitle: '同步润色微交互与空状态文案',
          x: 410,
          y: 230,
          params: [{ k: 'Model', dynamic: 'nodeModel' }],
        }),
        hydrateNode({
          id: 'mc-be-1',
          kind: 'codex-exec',
          title: '集群B · API 引擎工位',
          subtitle: '实现核心状态机与路由鉴权',
          x: 410,
          y: 444,
          params: [{ k: 'Model', dynamic: 'nodeModel' }, { k: 'Worktree', v: 'wt/clusterB-api' }],
        }),
        hydrateNode({
          id: 'mc-be-2',
          kind: 'codex-exec',
          title: '集群B · 回归测试工位',
          subtitle: '编写端到端与边界用例单测',
          x: 410,
          y: 658,
          params: [{ k: 'Model', dynamic: 'nodeModel' }, { k: 'Worktree', v: 'wt/clusterB-test' }],
        }),
        hydrateNode({
          id: 'mc-merge-a',
          kind: 'cluster-merge',
          title: '合并器 A · 前端集群汇聚',
          subtitle: '对齐 UI 组件与定稿文案',
          x: 790,
          y: 120,
          params: [{ k: 'Model', dynamic: 'nodeModel' }, { k: 'Inputs', dynamic: 'inCount' }],
        }),
        hydrateNode({
          id: 'mc-merge-b',
          kind: 'cluster-merge',
          title: '合并器 B · 后端集群汇聚',
          subtitle: '汇总接口实现与测试验证集',
          x: 790,
          y: 545,
          params: [{ k: 'Model', dynamic: 'nodeModel' }, { k: 'Inputs', dynamic: 'inCount' }],
        }),
        hydrateNode({
          id: 'mc-master',
          kind: 'cluster-merge',
          title: '总控终极合并器',
          subtitle: '二级跨集群合并 · 锁定全栈补丁',
          x: 1170,
          y: 315,
          params: [{ k: 'Model', dynamic: 'nodeModel' }, { k: 'Inputs', dynamic: 'inCount' }],
        }),
        hydrateNode({
          id: 'mc-review',
          kind: 'codex-review',
          title: 'Pre-CI 终局门禁',
          subtitle: '全栈安全审查 + 10秒人话汇报',
          x: 1540,
          y: 315,
          params: [{ k: 'Model', dynamic: 'nodeModel' }, { k: 'Max Rounds', dynamic: 'maxRounds' }],
        }),
      ],
      edges: [
        { id: 'me-1', source: 'mc-plan', target: 'mc-fe-1' },
        { id: 'me-2', source: 'mc-plan', target: 'mc-fe-2' },
        { id: 'me-3', source: 'mc-plan', target: 'mc-be-1' },
        { id: 'me-4', source: 'mc-plan', target: 'mc-be-2' },
        { id: 'me-5', source: 'mc-fe-1', target: 'mc-merge-a' },
        { id: 'me-6', source: 'mc-fe-2', target: 'mc-merge-a' },
        { id: 'me-7', source: 'mc-be-1', target: 'mc-merge-b' },
        { id: 'me-8', source: 'mc-be-2', target: 'mc-merge-b' },
        { id: 'me-9', source: 'mc-merge-a', target: 'mc-master' },
        { id: 'me-10', source: 'mc-merge-b', target: 'mc-master' },
        { id: 'me-11', source: 'mc-master', target: 'mc-review' },
      ],
      groups: [
        {
          id: 'grp-cluster-a',
          title: '集群 A · 前端界面节点组',
          accent: 'slate',
          nodeIds: ['mc-fe-1', 'mc-fe-2'],
          collapsed: false,
        },
        {
          id: 'grp-cluster-b',
          title: '集群 B · 后端与单测节点组',
          accent: 'sage',
          nodeIds: ['mc-be-1', 'mc-be-2'],
          collapsed: false,
        },
      ],
    };
  }

  function makeLinearPreset() {
    return {
      nodes: [
        hydrateNode({
          id: 'n-plan',
          kind: 'gemini-plan',
          title: 'Gemini · 架构规划师',
          subtitle: '需求拆解与接口契约设计',
          x: 80,
          y: 160,
          params: [{ k: 'Model', dynamic: 'nodeModel' }, { k: 'Approach', v: '3 路权衡' }],
          toggles: [{ key: 'approval', label: '人工拍板闸门', desc: '派发前允许修改契约' }],
        }),
        hydrateNode({
          id: 'n-codex',
          kind: 'codex-exec',
          title: 'Codex · 沙箱工程师',
          subtitle: '安全隔离区内编写并验证代码',
          x: 480,
          y: 210,
          params: [{ k: 'Model', dynamic: 'nodeModel' }, { k: 'Effort', dynamic: 'nodeEffort' }, { k: 'Sandbox', dynamic: 'sandbox' }],
          toggles: [{ key: 'worktree', label: 'Git Worktree 隔离', desc: '独立分支目录施工' }],
        }),
        hydrateNode({
          id: 'n-review',
          kind: 'codex-review',
          title: 'Pre-CI 门禁与终局汇报',
          subtitle: '分级阻断审查 + Gemini 10秒汇报',
          x: 880,
          y: 160,
          params: [{ k: 'Model', dynamic: 'nodeModel' }, { k: 'Max Rounds', dynamic: 'maxRounds' }],
          toggles: [{ key: 'humanReport', label: 'Gemini 终局汇报', desc: '将审查翻译为人话' }],
        }),
      ],
      edges: [
        { id: 'e-lin-1', source: 'n-plan', target: 'n-codex' },
        { id: 'e-lin-2', source: 'n-codex', target: 'n-review' },
      ],
    };
  }

  function makeBlankPreset() {
    return {
      nodes: [
        hydrateNode({
          id: 'n-root-1',
          kind: 'gemini-plan',
          title: '自定义起始节点 · Gemini',
          subtitle: '右键空白画布可随时在光标处新增任意节点',
          x: 200,
          y: 200,
          params: [{ k: 'Model', dynamic: 'nodeModel' }],
        }),
      ],
      edges: [],
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
      nodes: (g.nodes || []).map((n) => hydrateNode(n)),
      edges: (g.edges || []).map((e) => ({ ...e })),
      groups: (g.groups || []).map((gr) => ({
        id: String(gr.id || `grp-${Math.random().toString(36).slice(2, 7)}`),
        title: String(gr.title || '节点组'),
        accent: String(gr.accent || 'sage'),
        nodeIds: Array.isArray(gr.nodeIds) ? [...gr.nodeIds] : [],
        collapsed: Boolean(gr.collapsed),
      })),
    };
  }

  function maxNumericSuffix(graph) {
    let max = 20;
    const scan = (id) => {
      const m = String(id || '').match(/(\d+)$/);
      if (m) max = Math.max(max, Number(m[1]));
    };
    (graph.nodes || []).forEach((n) => scan(n.id));
    (graph.edges || []).forEach((e) => scan(e.id));
    return max;
  }

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

  function buildNodeDeliverable(node, modelLabel, taskPrompt, upstreamTitles, failed = false) {
    const topic = taskPrompt || '当前工程多模型协同任务';
    const upStr = upstreamTitles.length ? upstreamTitles.join('、') : '用户输入需求';
    if (failed) {
      return `## ${node.title} · 拦截报告\n\n- **使用模型**：\`${modelLabel}\`\n- **上游输入**：${upStr}\n- **触发原因**：检出 \`[BLOCKING]\` 高危边界风险（需人工确认权限与回滚策略）\n- **建议处理**：检查节点配置或放行条件后，点击卡片右下角「重试」。`;
    }
    if (node.kind === 'gemini-plan') {
      return `## ${node.title} · 架构契约产出\n\n- **使用模型**：\`${modelLabel}\`\n- **任务目标**：${topic}\n- **路由决策**：已完成 3 条候选方案权衡，采纳「契约驱动 + 并行隔离施工」路线（94/100）\n- **接口约束**：锁定前后端数据边界与错误处理规范，已生成并行施工单向下游派发。`;
    }
    if (node.kind === 'codex-exec') {
      return `## ${node.title} · 沙箱施工回报\n\n- **使用模型**：\`${modelLabel}\`\n- **承接上游**：${upStr}\n- **任务聚焦**：${node.prompt}\n- **测试结果**：静态语法检查 \`exit 0\`，自动化单测全绿，已捕获完整 Patch 与新建文件 Diff。`;
    }
    if (node.kind === 'cluster-merge') {
      return `## ${node.title} · 多路集群合并报告\n\n- **仲裁引擎**：\`${modelLabel}\`\n- **汇入分支数**：共汇合 **${upstreamTitles.length || 1} 路**并行 Agent 产物（${upStr}）\n- **冲突仲裁**：0 处未解决冲突，所有新建未跟踪文件已并入统一补丁包。`;
    }
    if (node.kind === 'codex-review') {
      return `## ${node.title} · 门禁裁决与 10 秒终局汇报\n\n- **审查模型**：\`${modelLabel}\`\n- **审查结论**：**PASS（放行）** · \`BLOCKING: 0\` / \`SUGGESTION: 1\`\n- **10 秒人话总结**：针对「${topic}」的多模型集群已完成架构拆解、多工位并行开发与无冲突合并，代码安全性和边界条件均已过检。`;
    }
    return `## ${node.title} · 文案润色交付\n\n- **使用模型**：\`${modelLabel}\`\n- **审校对象**：${topic}\n- **改进亮点**：去除解释腔与模板修饰词，信息密度提升 40%。`;
  }

  function createInfiniteCanvas(opts) {
    const {
      viewportEl,
      worldEl,
      framesLayerEl,
      edgesSvgEl,
      nodesLayerEl,
      minimapCanvasEl,
      contextMenuEl,
      resultDrawerEl,
      resultBodyEl,
      resultTabsEl,
      zoomLabelEl,
      statusBarEl,
      commandInputEl,
      renderMarkdown,
      getContext,
      onToggleSync,
      onDispatchRealCli,
      onPresetChange,
      onStatusChange,
      onToast,
    } = opts;

    const state = {
      graph: makeClusterPreset(),
      history: [],
      selectedId: 'n-plan',
      panX: 48,
      panY: 42,
      zoom: 0.84,
      seq: 30,
      failLast: false,
      demoRunning: false,
      demoToken: 0,
      spaceDown: false,
      lastTaskPrompt: '',
      lastClusterReportMd: '',
      drawerOpen: false,
      drawerTab: 'summary',
      stepDetailOpen: new Set(),
      statusMsg: '无限画布就绪：点击任意节点 Model 胶囊即可独立切换模型 · 右键画布呼出 Blender 菜单 · 拖端口自由连线。',
      panning: null,
      dragging: null,
      draggingGroup: null,
      resizing: null,
      wiring: null,
      extraToggles: { autoNewDiff: true, humanReport: true },
      ctxMenu: { open: false, kind: 'menu', worldX: 200, worldY: 200, nodeId: null },
    };

    const nodeEls = new Map();
    const OVERLAY_SEL = '.ic-hud-panel, .ic-floating-bar, .ic-minimap-card, .ic-ctx-menu, .ic-result-drawer, .ic-cmd-bar, .ic-bottom-stack';

    function setStatus(msg) {
      state.statusMsg = msg;
      if (statusBarEl) statusBarEl.textContent = msg;
    }

    function pushHistory() {
      state.history.push(cloneGraph(state.graph));
      if (state.history.length > 30) state.history.shift();
    }

    function cancelActiveDemo(clearReport = false) {
      state.demoToken += 1;
      state.demoRunning = false;
      if (clearReport) state.lastClusterReportMd = '';
    }

    function isEditingInDrawer() {
      const ae = document.activeElement;
      return Boolean(ae && resultDrawerEl && resultDrawerEl.contains(ae) && (ae.id === 'icEditTitle' || ae.id === 'icEditPrompt'));
    }

    function screenToWorld(clientX, clientY) {
      const rect = viewportEl.getBoundingClientRect();
      return {
        x: (clientX - rect.left - state.panX) / state.zoom,
        y: (clientY - rect.top - state.panY) / state.zoom,
      };
    }

    function formatNodeModelLabel(node) {
      const ctx = getContext ? getContext() : {};
      const tpl = NODE_TEMPLATES[node.kind] || NODE_TEMPLATES['codex-exec'];
      if (node.model) {
        if (ctx.formatGeminiShort && /^gemini-|^orchestrator-/i.test(node.model)) {
          return ctx.formatGeminiShort(node.model);
        }
        if (ctx.formatCodexShort) return ctx.formatCodexShort(node.model);
        return node.model;
      }
      if (tpl.provider === 'gemini') return ctx.geminiModelShort || 'Neon · High';
      if (tpl.provider === 'both') return '3-Way 自动';
      return ctx.codexModelShort || 'Codex · 默认';
    }

    function formatNodeEffortLabel(node) {
      const ctx = getContext ? getContext() : {};
      return node.effort || ctx.codexEffort || 'high';
    }

    function applyTransform() {
      const px = Math.round(state.panX);
      const py = Math.round(state.panY);
      const z = Number(state.zoom.toFixed(4));
      worldEl.style.transform = Math.abs(z - 1) < 0.001
        ? `translate(${px}px, ${py}px)`
        : `translate(${px}px, ${py}px) scale(${z})`;
      const minor = 24 * state.zoom;
      const major = 120 * state.zoom;
      const p = `${px}px ${py}px`;
      const bgSize = `${minor.toFixed(2)}px ${minor.toFixed(2)}px, ${minor.toFixed(2)}px ${minor.toFixed(2)}px, ${major.toFixed(2)}px ${major.toFixed(2)}px, ${major.toFixed(2)}px ${major.toFixed(2)}px`;
      const bgPos = `${p}, ${p}, ${p}, ${p}`;
      viewportEl.style.setProperty('--ic-bg-size', bgSize);
      viewportEl.style.setProperty('--ic-bg-pos', bgPos);
      viewportEl.style.setProperty('--ic-dot-size', `${minor.toFixed(2)}px ${minor.toFixed(2)}px`);
      viewportEl.style.setProperty('--ic-dot-pos', p);
      if (zoomLabelEl) zoomLabelEl.textContent = `${Math.round(state.zoom * 100)}%`;
      drawMinimap();
    }

    function fitView(animate = false) {
      const rect = viewportEl.getBoundingClientRect();
      if (!rect.width || !rect.height || state.graph.nodes.length === 0) return;
      const drawerPad = state.drawerOpen && rect.width > 760 ? Math.min(410, rect.width * 0.36) : 0;
      const availW = Math.max(300, rect.width - drawerPad);
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      state.graph.nodes.forEach((n) => {
        const nodeEl = nodeEls.get(n.id);
        const h = nodeEl ? nodeEl.offsetHeight || (nodeHeight(n) || 260) : (nodeHeight(n) || 260);
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + nodeWidth(n));
        maxY = Math.max(maxY, n.y + h);
      });
      const padX = 56;
      const padY = 104;
      const contentW = Math.max(300, maxX - minX);
      const contentH = Math.max(240, maxY - minY);
      const nextZoom = Math.max(0.32, Math.min(0.98, Math.min((availW - padX * 2) / contentW, (rect.height - padY * 2) / contentH)));
      state.zoom = nextZoom;
      state.panX = (availW - contentW * nextZoom) / 2 - minX * nextZoom;
      state.panY = (rect.height - contentH * nextZoom) / 2 - minY * nextZoom - 12;
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

    function autoLayout() {
      pushHistory();
      const waves = topoWaves(state.graph);
      const colGap = 408;
      const rowGap = 400;
      waves.forEach((wave, col) => {
        const totalH = (wave.length - 1) * rowGap;
        wave.forEach((id, row) => {
          const n = state.graph.nodes.find((x) => x.id === id);
          if (!n) return;
          n.x = 64 + col * colGap;
          n.y = Math.round(350 - totalH / 2 + row * rowGap);
        });
      });
      renderAll();
      requestAnimationFrame(() => fitView(true));
      setStatus('已按拓扑层级自动整理对齐全部节点。');
    }

    function effectiveStatuses() {
      const ctx = getContext ? getContext() : {};
      const run = ctx.currentRun;
      if (state.demoRunning || !run || run.status === 'idle' || state.lastClusterReportMd) {
        const map = new Map();
        state.graph.nodes.forEach((n) => map.set(n.id, n.muted ? 'idle' : sanitizeStatus(n.status, VALID_NODE_STATUS, 'idle')));
        return map;
      }
      const map = new Map();
      const g = run.gemini || {};
      const c = run.codex || {};
      state.graph.nodes.forEach((n) => {
        if (n.muted) { map.set(n.id, 'idle'); return; }
        let st = sanitizeStatus(n.status, VALID_NODE_STATUS, 'idle');
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
        } else if (n.kind === 'codex-review') {
          if (run.activeStage === 'review' || run.activeStage === 'summary') st = run.status === 'running' ? 'running' : run.status === 'blocked' ? 'error' : 'completed';
          else if (run.status === 'completed') st = 'completed';
          else if (run.status === 'blocked') st = 'error';
        }
        map.set(n.id, st);
      });
      return map;
    }

    function getCollapsedGroupForNode(nid) {
      const groups = state.graph.groups || [];
      return groups.find((g) => g.collapsed && g.nodeIds.includes(nid)) || null;
    }

    function computeGroupBounds(group) {
      const members = (group.nodeIds || [])
        .map((id) => state.graph.nodes.find((n) => n.id === id))
        .filter(Boolean);
      if (members.length === 0) return null;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      members.forEach((n) => {
        const elWrap = nodeEls.get(n.id);
        const h = n.collapsed ? 74 : (elWrap ? elWrap.offsetHeight || (nodeHeight(n) || 272) : (nodeHeight(n) || 272));
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + nodeWidth(n));
        maxY = Math.max(maxY, n.y + h);
      });
      if (group.collapsed) {
        const cx = minX;
        const cy = Math.round((minY + maxY) / 2 - 58);
        return { x: cx, y: cy, w: NODE_WIDTH, h: 116, members };
      }
      const padX = 24;
      const padTop = 44;
      const padBottom = 22;
      return {
        x: Math.round(minX - padX),
        y: Math.round(minY - padTop),
        w: Math.round(maxX - minX + padX * 2),
        h: Math.round(maxY - minY + padTop + padBottom),
        members,
      };
    }

    function renderGroups() {
      if (!framesLayerEl) return;
      const groups = state.graph.groups || [];
      const statusMap = effectiveStatuses();
      framesLayerEl.innerHTML = groups
        .map((g) => {
          const b = computeGroupBounds(g);
          if (!b) return '';
          const liveCount = b.members.filter((n) => statusMap.get(n.id) === 'running').length;
          const doneCount = b.members.filter((n) => statusMap.get(n.id) === 'completed').length;
          const badgeText = liveCount > 0 ? `${liveCount} 运行中` : doneCount === b.members.length ? '全部就绪 ✓' : `${b.members.length} 节点`;
          return `
            <div class="ic-node-group is-accent-${escapeHtml(g.accent || 'sage')} ${g.collapsed ? 'is-collapsed' : ''}" data-group-id="${escapeHtml(g.id)}" style="transform:translate(${b.x}px,${b.y}px);width:${b.w}px;height:${b.h}px">
              <div class="ic-group-head" data-group-drag="${escapeHtml(g.id)}" title="拖动标题栏可整体平移组内节点 · 点击名称可直接改名">
                <div class="ic-group-title-wrap">
                  <span class="ic-group-pip" aria-hidden="true"></span>
                  <input type="text" class="ic-group-title-input mono" data-group-rename="${escapeHtml(g.id)}" value="${escapeHtml(g.title)}" aria-label="节点组名称" />
                  <span class="ic-group-count mono-xs">${escapeHtml(badgeText)}</span>
                </div>
                <div class="ic-group-actions">
                  <button type="button" class="ic-group-btn" data-group-toggle="${escapeHtml(g.id)}" title="${g.collapsed ? '展开节点组 (Tab)' : '折叠为单个节点组代理 (Tab)'}">${g.collapsed ? '展开' : '折叠'}</button>
                  <button type="button" class="ic-group-btn" data-group-ungroup="${escapeHtml(g.id)}" title="拆散此节点组">拆散</button>
                </div>
              </div>
              ${
                g.collapsed
                  ? `<div class="ic-group-proxy-body">
                      <div class="ic-group-proxy-members">
                        ${b.members.map((m) => `<span class="ic-proxy-chip mono-xs">${escapeHtml(m.title)}</span>`).join('')}
                      </div>
                      <span class="ic-group-port is-in" aria-hidden="true"></span>
                      <span class="ic-group-port is-out" aria-hidden="true"></span>
                    </div>`
                  : ''
              }
            </div>`;
        })
        .join('');

      framesLayerEl.querySelectorAll('[data-group-toggle]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const g = (state.graph.groups || []).find((x) => x.id === btn.dataset.groupToggle);
          if (!g) return;
          pushHistory();
          g.collapsed = !g.collapsed;
          renderAll();
          setStatus(g.collapsed ? `已折叠节点组「${g.title}」（双击或点展开可恢复）。` : `已展开节点组「${g.title}」。`);
        });
      });

      framesLayerEl.querySelectorAll('[data-group-ungroup]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const gid = btn.dataset.groupUngroup;
          pushHistory();
          state.graph.groups = (state.graph.groups || []).filter((x) => x.id !== gid);
          renderAll();
          setStatus('已拆散节点组（组内节点与连线完整保留）。');
          if (onToast) onToast('已拆散节点组');
        });
      });

      framesLayerEl.querySelectorAll('[data-group-rename]').forEach((inp) => {
        inp.addEventListener('pointerdown', (e) => e.stopPropagation());
        inp.addEventListener('dblclick', (e) => e.stopPropagation());
        inp.addEventListener('input', () => {
          const g = (state.graph.groups || []).find((x) => x.id === inp.dataset.groupRename);
          if (g) g.title = inp.value;
        });
      });

      framesLayerEl.querySelectorAll('[data-group-drag]').forEach((head) => {
        head.addEventListener('dblclick', (e) => {
          if (e.target.closest('button, input')) return;
          e.stopPropagation();
          const g = (state.graph.groups || []).find((x) => x.id === head.dataset.groupDrag);
          if (!g) return;
          pushHistory();
          g.collapsed = !g.collapsed;
          renderAll();
        });
        head.addEventListener('pointerdown', (e) => {
          if (e.button !== 0 || e.target.closest('button, input') || state.spaceDown || state.panning || state.wiring) return;
          e.stopPropagation();
          closeContextMenu();
          const gid = head.dataset.groupDrag;
          const g = (state.graph.groups || []).find((x) => x.id === gid);
          if (!g) return;
          const startWorld = screenToWorld(e.clientX, e.clientY);
          const origins = new Map();
          g.nodeIds.forEach((nid) => {
            const n = state.graph.nodes.find((x) => x.id === nid);
            if (n) origins.set(nid, { x: n.x, y: n.y });
          });
          state.draggingGroup = {
            id: gid,
            startClientX: e.clientX,
            startClientY: e.clientY,
            startWorldX: startWorld.x,
            startWorldY: startWorld.y,
            origins,
            moved: false,
            captured: false,
            pointerId: e.pointerId,
          };
        });
      });
    }

    function createNodeGroup() {
      if (!state.graph.groups) state.graph.groups = [];
      const existingGrouped = new Set(state.graph.groups.flatMap((g) => g.nodeIds));
      const sel = state.graph.nodes.find((n) => n.id === state.selectedId);
      let picks = [];
      if (sel) {
        // Pack selected node + parallel siblings of same kind (or nearby ungrouped nodes)
        picks = state.graph.nodes
          .filter((n) => !existingGrouped.has(n.id) && (n.id === sel.id || (n.kind === sel.kind && Math.abs(n.x - sel.x) < 160)))
          .map((n) => n.id);
      }
      if (picks.length === 0) {
        picks = state.graph.nodes.filter((n) => !existingGrouped.has(n.id)).slice(0, 2).map((n) => n.id);
      }
      if (picks.length === 0) {
        if (onToast) onToast('当前所有节点均已在节点组内，请先新增节点或拆散已有组');
        return;
      }
      pushHistory();
      const idx = state.graph.groups.length + 1;
      const accents = ['sage', 'slate', 'amber'];
      state.graph.groups.push({
        id: `grp-${++state.seq}`,
        title: `自定义节点组 #${idx}`,
        accent: accents[(idx - 1) % accents.length],
        nodeIds: picks,
        collapsed: false,
      });
      renderAll();
      setStatus(`已创建 Blender 风格节点组（包含 ${picks.length} 个节点），可拖动组标题整体移动或一键折叠。`);
      if (onToast) onToast(`已打包 ${picks.length} 个节点为节点组`);
    }

    function renderEdges() {
      const statusMap = effectiveStatuses();
      const motionOn = document.documentElement.dataset.motion !== 'off';
      const byId = new Map(state.graph.nodes.map((n) => [n.id, n]));
      const groupBoundsCache = new Map();
      (state.graph.groups || []).forEach((g) => {
        if (g.collapsed) {
          const b = computeGroupBounds(g);
          if (b) groupBoundsCache.set(g.id, b);
        }
      });

      const paths = state.graph.edges
        .map((e) => {
          const src = byId.get(e.source);
          const dst = byId.get(e.target);
          if (!src || !dst) return '';
          const srcGrp = getCollapsedGroupForNode(src.id);
          const dstGrp = getCollapsedGroupForNode(dst.id);
          if (srcGrp && dstGrp && srcGrp.id === dstGrp.id) return '';
          const srcB = srcGrp ? groupBoundsCache.get(srcGrp.id) : null;
          const dstB = dstGrp ? groupBoundsCache.get(dstGrp.id) : null;
          const x1 = srcB ? srcB.x + srcB.w : src.x + nodeWidth(src);
          const y1 = srcB ? srcB.y + 66 : src.y + (src.collapsed ? 42 : PORT_Y);
          const x2 = dstB ? dstB.x : dst.x;
          const y2 = dstB ? dstB.y + 66 : dst.y + (dst.collapsed ? 42 : PORT_Y);
          const d = bezierPath(x1, y1, x2, y2);
          const srcSt = statusMap.get(src.id) || 'idle';
          const dstSt = statusMap.get(dst.id) || 'idle';
          const muted = src.muted || dst.muted;
          const isRunning = !muted && (srcSt === 'running' || dstSt === 'running');
          const isDone = !muted && srcSt === 'completed' && (dstSt === 'completed' || dstSt === 'running');
          const isErr = !muted && (srcSt === 'error' || dstSt === 'error');
          const stroke = muted
            ? 'var(--line-subtle)'
            : isErr
              ? 'var(--state-err)'
              : isRunning
                ? 'var(--wire-active)'
                : isDone
                  ? 'var(--wire-done)'
                  : 'var(--wire-idle)';
          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;

          return `
            <g class="ic-edge-group" data-edge-id="${escapeHtml(e.id)}">
              <path d="${d}" class="ic-edge-hit" />
              <path d="${d}" class="ic-edge-line ${isRunning ? 'is-flowing' : ''} ${isDone ? 'is-done' : ''}" style="stroke:${stroke}" stroke-dasharray="${isRunning ? '5 5' : 'none'}" />
              ${
                isRunning && motionOn
                  ? `<circle r="3" fill="var(--wire-active)"><animateMotion dur="1.15s" repeatCount="indefinite" path="${d}" /></circle>`
                  : ''
              }
              <g class="ic-edge-del" transform="translate(${midX.toFixed(1)},${midY.toFixed(1)})" data-del-edge="${escapeHtml(e.id)}" role="button" tabindex="0" aria-label="断开连线">
                <circle r="8.5" class="ic-edge-del-bg" />
                <path d="M-2.8 -2.8 L2.8 2.8 M2.8 -2.8 L-2.8 2.8" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" />
              </g>
            </g>`;
        })
        .join('');

      let draftWire = '';
      if (state.wiring) {
        const src = byId.get(state.wiring.sourceId);
        if (src) {
          const d = bezierPath(src.x + nodeWidth(src), src.y + PORT_Y, state.wiring.x, state.wiring.y);
          draftWire = `
            <g class="ic-edge-draft">
              <path d="${d}" class="ic-edge-line is-flowing" style="stroke:var(--wire-active)" stroke-dasharray="5 4" />
              <circle cx="${state.wiring.x.toFixed(1)}" cy="${state.wiring.y.toFixed(1)}" r="3.5" fill="var(--wire-active)" />
            </g>`;
        }
      }

      edgesSvgEl.innerHTML = paths + draftWire;
      const deleteEdgeById = (eid) => {
        pushHistory();
        state.graph.edges = state.graph.edges.filter((e) => e.id !== eid);
        renderAll();
        setStatus('已断开连线（按 Ctrl+Z 可撤销）。');
      };
      edgesSvgEl.querySelectorAll('[data-del-edge]').forEach((btn) => {
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          deleteEdgeById(btn.dataset.delEdge);
        });
        btn.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            ev.stopPropagation();
            deleteEdgeById(btn.dataset.delEdge);
          }
        });
      });
      drawMinimap();
    }

    function resolveParamHtml(p, node, paramIdx) {
      const ctx = getContext ? getContext() : {};
      if (p.dynamic === 'nodeModel') {
        const label = formatNodeModelLabel(node);
        const isCustom = Boolean(node.model);
        return `<button type="button" class="wf-param-val is-pickable ${isCustom ? 'is-custom' : ''}" data-ic-pick-model="${escapeHtml(node.id)}" title="点击为此节点独立切换模型">${escapeHtml(label)} <span class="ic-pick-chev">▾</span></button>`;
      }
      if (p.dynamic === 'nodeEffort') {
        const eff = formatNodeEffortLabel(node);
        return `<button type="button" class="wf-param-val is-pickable ${node.effort ? 'is-custom' : ''}" data-ic-pick-effort="${escapeHtml(node.id)}" title="点击切换此节点推理深度">${escapeHtml(eff)} <span class="ic-pick-chev">▾</span></button>`;
      }
      if (!p.dynamic) {
        return `<dd class="wf-param-val is-editable"><input type="text" class="wf-param-input mono" data-ic-param-node="${escapeHtml(node.id)}" data-ic-param-idx="${paramIdx}" value="${escapeHtml(p.v || '')}" placeholder="点击修改..." aria-label="${escapeHtml(p.k)}" /></dd>`;
      }
      let val = p.v || '—';
      if (p.dynamic === 'sandbox') val = ctx.sandbox || 'workspace-write';
      else if (p.dynamic === 'maxRounds') val = `${ctx.maxRounds || 2} 轮复审`;
      else if (p.dynamic === 'inCount') val = `${state.graph.edges.filter((e) => e.target === node.id).length} 路汇入`;
      return `<dd class="wf-param-val">${escapeHtml(val)}</dd>`;
    }

    function resolveToggleChecked(key) {
      const ctx = getContext ? getContext() : {};
      if (key === 'approval') return Boolean(ctx.approval);
      if (key === 'worktree') return Boolean(ctx.worktree);
      if (key === 'writable') return (ctx.sandbox || 'workspace-write') === 'workspace-write';
      return Boolean(state.extraToggles[key]);
    }

    function renderNodeCoTTree(node, nodeStatus) {
      const steps = node.steps || [];
      const doneCount = steps.filter((s) => s.status === 'completed').length;
      const activeStep = steps.find((s) => s.status === 'active');
      const isRunning = nodeStatus === 'running';
      const isOpen = isRunning || Boolean(node.cotOpen);

      const summary = isRunning
        ? (activeStep ? `思考链 · ${activeStep.verb}...` : '正在推演思考工作流...')
        : doneCount > 0
          ? `思考工作流 · ${doneCount}/${steps.length} 步已完成`
          : `思考工作流 · ${steps.length} 步待执行`;

      const rowsHtml = steps
        .map((s, idx) => {
          const isLast = idx === steps.length - 1;
          const stepKey = `${node.id}:${s.id}`;
          const expanded = state.stepDetailOpen.has(stepKey) || s.status === 'active';
          const safeSt = sanitizeStatus(s.status, VALID_STEP_STATUS, 'pending');
          const dotCls =
            safeSt === 'completed' ? 'is-done' : safeSt === 'active' ? 'is-active' : safeSt === 'error' ? 'is-err' : 'is-pend';
          return `
            <div class="cot-step ${dotCls} ${expanded ? 'is-open' : ''}">
              <svg class="cot-rail-svg" width="18" height="24" aria-hidden="true">
                <line x1="8.5" y1="${idx === 0 ? 0 : -4}" x2="8.5" y2="8" class="cot-rail-line" />
                <path d="M8.5 8 Q8.5 12 12.5 12 H18" fill="none" class="cot-rail-line" />
                ${!isLast ? '<line x1="8.5" y1="8" x2="8.5" y2="100%" class="cot-rail-line" />' : ''}
              </svg>
              <button type="button" class="cot-step-btn" data-cot-step="${escapeHtml(stepKey)}">
                <span class="cot-dot ${dotCls}"></span>
                <span class="cot-verb ${safeSt === 'active' ? 'is-shimmer' : ''}">${escapeHtml(s.verb)}</span>
                ${s.ms ? `<span class="cot-ms mono">${(s.ms / 1000).toFixed(1)}s</span>` : ''}
              </button>
              ${expanded ? `<div class="cot-step-detail">${escapeHtml(s.detail)}</div>` : ''}
            </div>`;
        })
        .join('');

      return `
        <div class="node-cot-box ${isOpen ? 'is-open' : ''}">
          <button type="button" class="node-cot-trigger" data-cot-toggle="${escapeHtml(node.id)}" aria-expanded="${isOpen}">
            <svg class="cot-chev" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <span class="cot-trigger-label ${isRunning ? 'is-shimmer' : ''}">${escapeHtml(summary)}</span>
          </button>
          <div class="node-cot-tree">
            <div class="node-cot-inner">${rowsHtml}</div>
          </div>
        </div>`;
    }

    function renderNodes() {
      const statusMap = effectiveStatuses();
      const statusMeta = {
        idle: { label: '就绪', btn: '单步执行' },
        running: { label: '运行中', btn: '运行中...' },
        completed: { label: '已完成', btn: '查看成果' },
        error: { label: '已拦截', btn: '重试' },
      };

      const incomingSet = new Set(state.graph.edges.map((e) => e.target));
      const outgoingSet = new Set(state.graph.edges.map((e) => e.source));

      nodeEls.clear();
      nodesLayerEl.innerHTML = state.graph.nodes
        .map((n) => {
          const tpl = NODE_TEMPLATES[n.kind] || NODE_TEMPLATES['codex-exec'];
          const st = n.muted ? 'idle' : sanitizeStatus(statusMap.get(n.id), VALID_NODE_STATUS, 'idle');
          const safeSt = escapeHtml(st);
          const running = st === 'running';
          const sel = state.selectedId === n.id;
          const meta = statusMeta[st] || statusMeta.idle;
          const [orbState, orbVariant] = running ? tpl.orbRun : st === 'error' ? ['retrying', 'default'] : tpl.orbIdle;
          const isMerge = n.kind === 'cluster-merge';

          const paramsHtml = (n.params || [])
            .map(
              (p, idx) => `
              <div class="wf-param-row">
                <dt class="wf-param-label">${escapeHtml(p.k)}</dt>
                ${resolveParamHtml(p, n, idx)}
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

          const extRole = tpl.roleCode || 'AGENT';
          const extModel = formatNodeModelLabel(n);
          const hiddenInGroup = Boolean(getCollapsedGroupForNode(n.id));
          const inSocketType = tpl.inType || 'spec';
          const outSocketType = tpl.outType || 'diff';
          const nw = nodeWidth(n);
          const nh = !n.collapsed ? nodeHeight(n) : null;

          return `
            <div class="ic-node-wrap ${sel ? 'is-selected' : ''} ${isMerge ? 'is-merge-hub' : ''} ${n.muted ? 'is-muted' : ''} ${n.collapsed ? 'is-collapsed' : ''} ${hiddenInGroup ? 'is-group-hidden' : ''}" data-node-id="${escapeHtml(n.id)}" data-status="${safeSt}" style="width:${nw}px;transform:translate(${Math.round(n.x)}px,${Math.round(n.y)}px)">
              <div class="ic-node-ext-meta mono">
                <div class="ic-ext-left">
                  <span class="ic-ext-role">${escapeHtml(extRole)}</span>
                  <button type="button" class="ic-ext-model" data-ic-pick-model="${escapeHtml(n.id)}" title="点击快速切换此节点模型">${escapeHtml(extModel)}</button>
                </div>
                <span class="ic-ext-status ${safeSt}">
                  <span class="ic-ext-dot ${running ? 'is-pulse' : ''}"></span>
                  <span>${n.muted ? '已静音' : meta.label}</span>
                </span>
              </div>
              <div class="agent-node ${sel ? 'is-selected' : ''} ${n.collapsed ? 'is-collapsed' : ''} ${nh ? 'is-custom-h' : ''}" data-status="${safeSt}">
                <div class="agent-node-surface" ${nh ? `style="min-height:${nh}px;height:${nh}px"` : ''}>
                  ${running ? '<span class="agent-node-sweep-track" aria-hidden="true"><span class="agent-node-sweep"></span></span>' : ''}
                  <header class="agent-node-head ic-drag-handle" title="拖拽空白区移动 · 点击名称或简介可直接编辑 · 按 H 折叠节点">
                    <span class="agent-node-icon">
                      <svg class="thinking-orb" width="26" height="26" viewBox="0 0 26 26" data-orb-state="${orbState}" data-orb-variant="${orbVariant}" data-orb-size="26" aria-hidden="true"></svg>
                    </span>
                    <div class="agent-node-titles">
                      <input type="text" class="ic-inline-title" data-ic-title="${escapeHtml(n.id)}" value="${escapeHtml(n.title)}" aria-label="节点标题" />
                      <input type="text" class="ic-inline-sub" data-ic-sub="${escapeHtml(n.id)}" value="${escapeHtml(n.subtitle)}" aria-label="节点说明" />
                    </div>
                    <button type="button" class="ic-node-fold-btn" data-ic-fold="${escapeHtml(n.id)}" title="${n.collapsed ? '展开节点 (H)' : '折叠节点为紧凑标题栏 (H)'}" aria-expanded="${!n.collapsed}">
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <path d="${n.collapsed ? 'M6 4L10 8L6 12' : 'M4 6L8 10L12 6'}" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                      </svg>
                    </button>
                  </header>

                  <div class="agent-node-body">
                    <div class="ic-node-prompt-box">
                      <div class="ic-prompt-head">
                        <span class="mono-xs">任务需求 · PROMPT</span>
                        <span class="mono-xs ic-prompt-hint">Ctrl+Enter 执行</span>
                      </div>
                      <textarea class="ic-inline-prompt" rows="2" data-ic-prompt="${escapeHtml(n.id)}" placeholder="直接输入该节点的任务需求或指令...">${escapeHtml(n.prompt)}</textarea>
                    </div>
                    ${paramsHtml ? `<dl class="wf-params">${paramsHtml}</dl>` : ''}
                    ${renderNodeCoTTree(n, st)}
                    ${togglesHtml ? `<div class="wf-toggles">${togglesHtml}</div>` : ''}
                  </div>

                  ${st === 'error' ? `<div class="wf-node-error" role="alert">${escapeHtml(tpl.errorMessage)}</div>` : ''}

                  <footer class="agent-node-foot">
                    <button type="button" class="ic-inspect-link mono" data-ic-inspect="${escapeHtml(n.id)}" title="打开节点成果、模型配置与思考链抽屉">
                      ${n.outputMd ? '交付详情 →' : '配置节点'}
                    </button>
                    <div class="ic-foot-actions">
                      <button type="button" class="ic-icon-del" data-ic-del="${escapeHtml(n.id)}" title="删除此节点">×</button>
                      <button type="button" class="wf-run-btn ${st !== 'idle' ? 'is-secondary' : ''}" data-ic-run="${escapeHtml(n.id)}" ${running || n.muted ? 'disabled' : ''}>
                        <span>${n.muted ? '已静音' : meta.btn}</span>
                      </button>
                    </div>
                  </footer>
                </div>

                ${
                  tpl.showIn
                    ? `<button type="button" class="wf-port wf-port-left ${incomingSet.has(n.id) ? 'is-connected' : ''} ${inSocketType === 'multi' ? 'is-multi-socket' : ''}" data-socket-type="${escapeHtml(inSocketType)}" data-port-side="in" data-port-node="${escapeHtml(n.id)}" aria-label="输入端口: ${escapeHtml(tpl.inLabel)}"><span class="wf-port-dot"></span><span class="wf-port-tip">${escapeHtml(tpl.inLabel)}</span></button>`
                    : ''
                }
                ${
                  tpl.showOut
                    ? `<button type="button" class="wf-port wf-port-right ${outgoingSet.has(n.id) ? 'is-connected' : ''}" data-socket-type="${escapeHtml(outSocketType)}" data-port-side="out" data-port-node="${escapeHtml(n.id)}" aria-label="输出端口: ${escapeHtml(tpl.outLabel)}"><span class="wf-port-dot"></span><span class="wf-port-tip">拖出连线 · ${escapeHtml(tpl.outLabel)}</span></button>`
                    : ''
                }
                ${
                  !n.collapsed
                    ? `<div class="ic-resize-handle is-w" data-ic-resize="w" data-resize-node="${escapeHtml(n.id)}" title="拖拽左侧边缘缩放宽度"></div>
                       <div class="ic-resize-handle is-e" data-ic-resize="e" data-resize-node="${escapeHtml(n.id)}" title="拖拽右侧边缘缩放宽度"></div>
                       <div class="ic-resize-handle is-s" data-ic-resize="s" data-resize-node="${escapeHtml(n.id)}" title="拖拽底边缩放高度"></div>
                       <div class="ic-resize-handle is-se" data-ic-resize="se" data-resize-node="${escapeHtml(n.id)}" title="拖拽自由缩放宽高 · 双击恢复默认尺寸"></div>`
                    : ''
                }
              </div>
            </div>`;
        })
        .join('');

      nodesLayerEl.querySelectorAll('.ic-node-wrap').forEach((wrap) => {
        const nid = wrap.dataset.nodeId;
        nodeEls.set(nid, wrap);

        // Delayed pointer capture (4px threshold preserves native dblclick & avoids wasted undo entries!)
        wrap.addEventListener('pointerdown', (e) => {
          if (e.button !== 0 || state.spaceDown || state.panning || state.wiring || state.resizing) return;
          if (e.target.closest('button, input, textarea, select, [role="switch"], .wf-port, .ic-resize-handle')) return;
          e.stopPropagation();
          closeContextMenu();
          if (document.activeElement instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
            document.activeElement.blur();
          }
          const node = state.graph.nodes.find((x) => x.id === nid);
          if (!node) return;
          if (state.selectedId !== nid) {
            state.selectedId = nid;
            nodesLayerEl.querySelectorAll('.ic-node-wrap').forEach((w) => {
              const s = w.dataset.nodeId === nid;
              w.classList.toggle('is-selected', s);
              w.querySelector('.agent-node')?.classList.toggle('is-selected', s);
            });
            if (state.drawerOpen && state.drawerTab === 'node') renderResultDrawer();
          }
          const startWorld = screenToWorld(e.clientX, e.clientY);
          state.dragging = {
            id: nid,
            startClientX: e.clientX,
            startClientY: e.clientY,
            offsetX: startWorld.x - node.x,
            offsetY: startWorld.y - node.y,
            moved: false,
            captured: false,
            pointerId: e.pointerId,
          };
        });

        wrap.addEventListener('dblclick', (e) => {
          if (e.target.closest('button, input, textarea, select, [role="switch"], .wf-port, .ic-resize-handle')) return;
          e.stopPropagation();
          state.selectedId = nid;
          openResultDrawer('node');
        });
      });

      // Blender/Figma Free Per-Node Resize Handles (W / E / S / SE + delayed capture so dblclick reset works 100%!)
      nodesLayerEl.querySelectorAll('[data-ic-resize]').forEach((handle) => {
        handle.addEventListener('pointerdown', (e) => {
          if (e.button !== 0 || state.panning || state.dragging || state.wiring) return;
          e.stopPropagation();
          closeContextMenu();
          const nid = handle.dataset.resizeNode;
          const dir = handle.dataset.icResize;
          const node = state.graph.nodes.find((x) => x.id === nid);
          const wrap = nodeEls.get(nid);
          const surface = wrap?.querySelector('.agent-node-surface');
          if (!node || !wrap || !surface) return;
          selectNodeQuietly(nid);
          const startW = nodeWidth(node);
          const startH = Math.round(surface.getBoundingClientRect().height / state.zoom);
          state.resizing = {
            id: nid,
            dir,
            startClientX: e.clientX,
            startClientY: e.clientY,
            startX: node.x,
            startW,
            startH: Math.max(MIN_NODE_H, startH),
            moved: false,
            captured: false,
            pointerId: e.pointerId,
          };
        });

        if (handle.dataset.icResize === 'se') {
          handle.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            const node = state.graph.nodes.find((x) => x.id === handle.dataset.resizeNode);
            if (!node) return;
            pushHistory();
            node.w = NODE_WIDTH;
            node.h = null;
            renderAll();
            if (onToast) onToast('已恢复节点默认尺寸');
          });
        }
      });

      // Inline In-Card Editors: Title, Subtitle, Task Prompt & Editable Params (IME & focus safe!)
      const selectNodeQuietly = (nid) => {
        if (state.selectedId === nid) return;
        state.selectedId = nid;
        nodesLayerEl.querySelectorAll('.ic-node-wrap').forEach((w) => {
          const s = w.dataset.nodeId === nid;
          w.classList.toggle('is-selected', s);
          w.querySelector('.agent-node')?.classList.toggle('is-selected', s);
        });
      };

      nodesLayerEl.querySelectorAll('[data-ic-title]').forEach((inp) => {
        inp.addEventListener('pointerdown', (e) => { e.stopPropagation(); selectNodeQuietly(inp.dataset.icTitle); });
        inp.addEventListener('input', () => {
          const n = state.graph.nodes.find((x) => x.id === inp.dataset.icTitle);
          if (!n) return;
          n.title = inp.value;
          const drawerTitle = resultDrawerEl?.querySelector('#icEditTitle');
          if (drawerTitle && state.selectedId === n.id) drawerTitle.value = inp.value;
        });
      });

      nodesLayerEl.querySelectorAll('[data-ic-sub]').forEach((inp) => {
        inp.addEventListener('pointerdown', (e) => { e.stopPropagation(); selectNodeQuietly(inp.dataset.icSub); });
        inp.addEventListener('input', () => {
          const n = state.graph.nodes.find((x) => x.id === inp.dataset.icSub);
          if (n) n.subtitle = inp.value;
        });
      });

      nodesLayerEl.querySelectorAll('[data-ic-prompt]').forEach((ta) => {
        ta.addEventListener('pointerdown', (e) => { e.stopPropagation(); selectNodeQuietly(ta.dataset.icPrompt); });
        ta.addEventListener('wheel', (e) => {
          if (ta.scrollHeight > ta.clientHeight) e.stopPropagation();
        }, { passive: true });
        ta.addEventListener('input', () => {
          const n = state.graph.nodes.find((x) => x.id === ta.dataset.icPrompt);
          if (!n) return;
          n.prompt = ta.value;
          const drawerPrompt = resultDrawerEl?.querySelector('#icEditPrompt');
          if (drawerPrompt && state.selectedId === n.id) drawerPrompt.value = ta.value;
        });
        ta.addEventListener('keydown', (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            runSinglePreview(ta.dataset.icPrompt);
          }
        });
      });

      nodesLayerEl.querySelectorAll('[data-ic-param-node]').forEach((inp) => {
        inp.addEventListener('pointerdown', (e) => { e.stopPropagation(); selectNodeQuietly(inp.dataset.icParamNode); });
        inp.addEventListener('input', () => {
          const n = state.graph.nodes.find((x) => x.id === inp.dataset.icParamNode);
          const idx = Number(inp.dataset.icParamIdx);
          if (n && n.params && n.params[idx]) {
            n.params[idx].v = inp.value;
          }
        });
      });

      // Also update external micro-caption model label cleanly on title/render
      const extModelBtns = nodesLayerEl.querySelectorAll('[data-ic-pick-model]');
      extModelBtns.forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const r = btn.getBoundingClientRect();
          openModelPicker(btn.dataset.icPickModel, r.left, r.bottom + 6);
        });
      });

      // Click Effort pill right on card -> Per-node Effort Picker!
      nodesLayerEl.querySelectorAll('[data-ic-pick-effort]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const r = btn.getBoundingClientRect();
          openEffortPicker(btn.dataset.icPickEffort, r.left, r.bottom + 6);
        });
      });

      nodesLayerEl.querySelectorAll('[data-port-side="out"]').forEach((portBtn) => {
        portBtn.addEventListener('pointerdown', (e) => {
          if (e.button !== 0 || state.panning || state.dragging) return;
          e.stopPropagation();
          closeContextMenu();
          const sourceId = portBtn.dataset.portNode;
          const pt = screenToWorld(e.clientX, e.clientY);
          state.wiring = { sourceId, x: pt.x, y: pt.y, hoverTargetId: null, pointerId: e.pointerId };
          try { viewportEl.setPointerCapture(e.pointerId); } catch {}
          setStatus('正在拉出连线：拖至任意其他节点的左侧输入端口松手即可合并连接。');
          renderEdges();
        });
      });

      nodesLayerEl.querySelectorAll('[data-port-side="in"]').forEach((portBtn) => {
        portBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const nid = portBtn.dataset.portNode;
          const count = state.graph.edges.filter((ed) => ed.target === nid).length;
          setStatus(`输入端口状态：当前共有 ${count} 路 Agent 上游连线汇入此节点。`);
        });
      });

      nodesLayerEl.querySelectorAll('[data-cot-toggle]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const node = state.graph.nodes.find((x) => x.id === btn.dataset.cotToggle);
          if (!node) return;
          node.cotOpen = !node.cotOpen;
          renderNodes();
          renderEdges();
        });
      });

      nodesLayerEl.querySelectorAll('[data-cot-step]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const key = btn.dataset.cotStep;
          if (state.stepDetailOpen.has(key)) state.stepDetailOpen.delete(key);
          else state.stepDetailOpen.add(key);
          renderNodes();
        });
      });

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

      nodesLayerEl.querySelectorAll('[data-ic-inspect]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          state.selectedId = btn.dataset.icInspect;
          openResultDrawer('node');
        });
      });

      nodesLayerEl.querySelectorAll('[data-ic-fold]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const n = state.graph.nodes.find((x) => x.id === btn.dataset.icFold);
          if (!n) return;
          pushHistory();
          n.collapsed = !n.collapsed;
          renderAll();
        });
      });

      nodesLayerEl.querySelectorAll('[data-ic-del]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          removeNode(btn.dataset.icDel);
        });
      });

      nodesLayerEl.querySelectorAll('[data-ic-run]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const nid = btn.dataset.icRun;
          const node = state.graph.nodes.find((x) => x.id === nid);
          if (!node) return;
          if (node.muted) {
            if (onToast) onToast('该节点已静音，请先右键取消静音后再运行');
            return;
          }
          const curSt = effectiveStatuses().get(nid);
          if (curSt === 'completed' && node.outputMd) {
            state.selectedId = nid;
            openResultDrawer('node');
            return;
          }
          runSinglePreview(nid);
        });
      });

      if (window.ConduitOrbs) window.ConduitOrbs.mountAll(nodesLayerEl);
    }

    function renderAll() {
      renderNodes();
      renderGroups();
      renderEdges();
      applyTransform();
      if (state.drawerOpen) renderResultDrawer();
    }

    /* =========================================================================
       Shared Edge-Aware Floating Popover: Blender Context Menu + Per-Node Model Picker
       ========================================================================= */
    function closeContextMenu() {
      if (!state.ctxMenu.open) return;
      state.ctxMenu.open = false;
      if (contextMenuEl) contextMenuEl.classList.add('hidden');
    }

    function placeMenuEdgeAware(clientX, clientY, menuW = 268) {
      const vpRect = viewportEl.getBoundingClientRect();
      const maxH = Math.max(180, Math.min(410, vpRect.height - 20));
      const measuredH = Math.min(maxH, contextMenuEl.offsetHeight || 340);
      const localX = clientX - vpRect.left;
      const localY = clientY - vpRect.top;
      const left = Math.max(10, Math.min(localX + menuW <= vpRect.width - 10 ? localX : localX - menuW, vpRect.width - menuW - 10));
      const top = Math.max(10, Math.min(localY + measuredH <= vpRect.height - 10 ? localY : localY - measuredH, vpRect.height - measuredH - 10));
      contextMenuEl.style.width = `${menuW}px`;
      contextMenuEl.style.left = `${left}px`;
      contextMenuEl.style.top = `${top}px`;
      contextMenuEl.style.transformOrigin = `${Math.max(0, Math.min(menuW, localX - left))}px ${Math.max(0, Math.min(measuredH, localY - top))}px`;
    }

    /** Per-Node Model Picker (Gemini grouped models / Codex presets + custom input / Merge both!) */
    function openModelPicker(nodeId, clientX, clientY) {
      if (!contextMenuEl) return;
      const node = state.graph.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const tpl = NODE_TEMPLATES[node.kind] || NODE_TEMPLATES['codex-exec'];
      const ctx = getContext ? getContext() : {};
      const geminiModels = ctx.geminiModels || [];
      const codexModels = ctx.codexModels || [{ id: '', label: '默认（读取本机 CODEX_HOME 配置）' }];

      state.selectedId = nodeId;
      state.ctxMenu = { open: true, kind: 'model', worldX: node.x, worldY: node.y, nodeId };

      const showGemini = tpl.provider === 'gemini' || tpl.provider === 'both';
      const showCodex = tpl.provider === 'codex' || tpl.provider === 'both';

      const buildOptions = (q = '') => {
        const needle = q.trim().toLowerCase();
        const rows = [];
        const match = (id, label) => !needle || String(id).toLowerCase().includes(needle) || String(label).toLowerCase().includes(needle);

        // Default / inherit option
        const defLabel = tpl.provider === 'both' ? '3-Way 本地自动合并（默认）' : '跟随全局工作台默认模型';
        if (match('', defLabel)) {
          rows.push({ type: 'item', id: '', label: defLabel, sub: 'AUTO', badge: '默认', selected: !node.model });
        }

        if (showGemini && geminiModels.length > 0) {
          const groups = [
            { title: 'GEMINI 4 NEON · 推荐', items: [] },
            { title: 'GEMINI 4 SERIES', items: [] },
            { title: 'ORCHESTRATOR & FLASH', items: [] },
          ];
          geminiModels.forEach((m) => {
            if (!match(m.id, m.label || m.id)) return;
            const lid = String(m.id || '').toLowerCase();
            if (lid.includes('neon') && lid.startsWith('gemini-4')) groups[0].items.push(m);
            else if (lid.startsWith('gemini-4')) groups[1].items.push(m);
            else groups[2].items.push(m);
          });
          groups.forEach((g) => {
            if (g.items.length === 0) return;
            rows.push({ type: 'group', label: g.title });
            g.items.forEach((m) => {
              const effM = String(m.id).match(/-(xhigh|high|medium|low)$/i);
              rows.push({
                type: 'item',
                id: m.id,
                label: m.label || m.id,
                sub: m.id,
                badge: effM ? effM[1].toUpperCase() : 'GEM',
                selected: node.model === m.id,
              });
            });
          });
        }

        if (showCodex) {
          const codexFiltered = codexModels.filter((m) => m.id && match(m.id, m.label || m.id));
          if (codexFiltered.length > 0) {
            rows.push({ type: 'group', label: 'CODEX MODELS · 施工/审查' });
            codexFiltered.forEach((m) => {
              rows.push({
                type: 'item',
                id: m.id,
                label: m.label || m.id,
                sub: m.id,
                badge: 'CDX',
                selected: node.model === m.id,
              });
            });
          }
        }
        return rows;
      };

      const renderList = (q = '') => {
        const rows = buildOptions(q);
        const bodyEl = contextMenuEl.querySelector('.ic-ctx-body');
        if (!bodyEl) return;
        bodyEl.innerHTML =
          rows
            .map((r) => {
              if (r.type === 'group') return `<div class="ic-ctx-group">${escapeHtml(r.label)}</div>`;
              return `
                <button type="button" class="ic-ctx-item ic-ctx-model-item ${r.selected ? 'is-selected' : ''}" data-pick-node-model="${escapeHtml(r.id)}">
                  <span class="ic-ctx-model-main">
                    <span class="ic-ctx-model-title">${escapeHtml(r.label)}</span>
                    <span class="ic-ctx-model-sub mono">${escapeHtml(r.sub)}</span>
                  </span>
                  <span class="ic-ctx-model-right">
                    ${r.badge ? `<kbd class="ic-ctx-kbd">${escapeHtml(r.badge)}</kbd>` : ''}
                    ${r.selected ? '<span class="picker-check">✓</span>' : ''}
                  </span>
                </button>`;
            })
            .join('') || '<div class="ic-ctx-group">无匹配模型</div>';

        bodyEl.querySelectorAll('[data-pick-node-model]').forEach((b) => {
          b.addEventListener('click', (ev) => {
            ev.stopPropagation();
            applyNodeModel(nodeId, b.dataset.pickNodeModel);
          });
        });
      };

      contextMenuEl.innerHTML = `
        <div class="ic-ctx-search-wrap">
          <input type="text" class="ic-ctx-search" id="icCtxSearch" placeholder="搜索节点专属模型..." autocomplete="off" />
        </div>
        <div class="ic-ctx-body"></div>
        ${
          showCodex
            ? `<div class="ic-ctx-custom-row">
                <input type="text" class="ic-ctx-search mono" id="icCustomNodeModel" placeholder="输入自定义模型名回车..." autocomplete="off" />
                <button type="button" class="btn-primary-sm wf-btn" id="btnApplyNodeCustomModel">应用</button>
              </div>`
            : ''
        }`;

      renderList('');
      contextMenuEl.classList.remove('hidden');
      placeMenuEdgeAware(clientX, clientY, 292);

      const inp = contextMenuEl.querySelector('#icCtxSearch');
      if (inp) {
        inp.addEventListener('input', (e) => renderList(e.target.value));
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') { e.preventDefault(); closeContextMenu(); }
        });
        setTimeout(() => inp.focus(), 10);
      }

      const applyCustom = () => {
        const val = (contextMenuEl.querySelector('#icCustomNodeModel')?.value || '').trim();
        if (!val) return;
        applyNodeModel(nodeId, val);
      };
      contextMenuEl.querySelector('#btnApplyNodeCustomModel')?.addEventListener('click', (e) => {
        e.stopPropagation();
        applyCustom();
      });
      contextMenuEl.querySelector('#icCustomNodeModel')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); applyCustom(); }
        else if (e.key === 'Escape') { e.preventDefault(); closeContextMenu(); }
      });
    }

    function applyNodeModel(nodeId, modelId) {
      const node = state.graph.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      pushHistory();
      node.model = String(modelId || '').trim();
      closeContextMenu();
      renderAll();
      const disp = formatNodeModelLabel(node);
      setStatus(`已将节点「${node.title}」的模型切换为：${disp}`);
      if (onToast) onToast(`节点模型已切换：${disp}`);
    }

    function openEffortPicker(nodeId, clientX, clientY) {
      if (!contextMenuEl) return;
      const node = state.graph.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      state.selectedId = nodeId;
      state.ctxMenu = { open: true, kind: 'effort', worldX: node.x, worldY: node.y, nodeId };

      contextMenuEl.innerHTML = `
        <div class="ic-ctx-body">
          <div class="ic-ctx-group">节点推理深度 · EFFORT</div>
          ${EFFORT_OPTIONS.map(
            (opt) => `
            <button type="button" class="ic-ctx-item ${node.effort === opt.id ? 'is-selected' : ''}" data-pick-effort="${escapeHtml(opt.id)}">
              <span>${escapeHtml(opt.label)}</span>
              <span class="ic-ctx-model-right">
                <kbd class="ic-ctx-kbd">${escapeHtml(opt.badge)}</kbd>
                ${node.effort === opt.id ? '<span class="picker-check">✓</span>' : ''}
              </span>
            </button>`
          ).join('')}
        </div>`;

      contextMenuEl.classList.remove('hidden');
      placeMenuEdgeAware(clientX, clientY, 236);

      contextMenuEl.querySelectorAll('[data-pick-effort]').forEach((btn) => {
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          pushHistory();
          node.effort = btn.dataset.pickEffort;
          closeContextMenu();
          renderAll();
          setStatus(`节点「${node.title}」推理深度已设为：${formatNodeEffortLabel(node)}`);
        });
      });
    }

    function openContextMenu(clientX, clientY, nodeId = null) {
      if (!contextMenuEl) return;
      const worldPt = screenToWorld(clientX, clientY);
      state.ctxMenu = {
        open: true,
        kind: 'menu',
        worldX: Math.round(worldPt.x),
        worldY: Math.round(worldPt.y),
        nodeId,
      };

      let hasSaved = false;
      try { hasSaved = Boolean(localStorage.getItem(CUSTOM_STORAGE_KEY)); } catch {}
      const targetNode = nodeId ? state.graph.nodes.find((n) => n.id === nodeId) : null;

      const items = targetNode
        ? [
            { type: 'group', label: `节点操作 · ${targetNode.title.slice(0, 18)}` },
            { id: 'node:model', label: '切换此节点专属模型', shortcut: 'Model', accent: true },
            { id: 'node:inspect', label: '查看思考链与交付成果', shortcut: 'Enter' },
            { id: 'node:run', label: '单步执行此节点', shortcut: 'R' },
            { id: 'node:cli', label: '带此节点模型与指令直调 CLI', shortcut: 'CLI' },
            { type: 'sep' },
            { id: 'node:dup', label: '复制节点 (Duplicate)', shortcut: 'Shift+D' },
            { id: 'node:mute', label: targetNode.muted ? '取消静音 (恢复执行)' : '静音跳过节点 (Mute)', shortcut: 'M' },
            { id: 'node:disconnect', label: '断开全部输入/输出连线', shortcut: '' },
            { type: 'sep' },
            { id: 'node:delete', label: '删除节点', shortcut: 'Del', danger: true },
          ]
        : [
            { type: 'group', label: '新建 Agent 节点（落点在鼠标处）' },
            { id: 'add:gemini-plan', label: '+ Gemini · 架构规划师', shortcut: 'PLAN' },
            { id: 'add:codex-exec', label: '+ Codex · 沙箱工位', shortcut: 'WORK' },
            { id: 'add:cluster-merge', label: '+ 集群聚合合并器 (Merge Hub)', shortcut: 'MERGE', accent: true },
            { id: 'add:codex-review', label: '+ Pre-CI 审查门禁', shortcut: 'GATE' },
            { id: 'add:gemini-copy', label: '+ Gemini · 文案与交互顾问', shortcut: 'COPY' },
            { id: 'add:image-gen', label: '+ 图像生成与变体工位', shortcut: 'IMG' },
            { id: 'add:video-gen', label: '+ 视频渲染与播放工位', shortcut: 'VID' },
            { type: 'sep' },
            { type: 'group', label: '画布编排与自定义集群' },
            { id: 'act:layout', label: '自动拓扑对齐排列', shortcut: 'L' },
            { id: 'act:fit', label: '适配全览全部节点', shortcut: 'F' },
            { id: 'act:save', label: '保存当前拓扑为我的自定义模板', shortcut: 'Save' },
            ...(hasSaved ? [{ id: 'act:load', label: '载入我的已保存自定义模板', shortcut: 'Load' }] : []),
            { id: 'act:blank', label: '新建空白自定义画布', shortcut: 'New' },
            { id: 'act:undo', label: '撤销上一步操作', shortcut: 'Ctrl+Z' },
          ];

      const renderMenuItems = (q = '') => {
        const needle = q.trim().toLowerCase();
        const filtered = needle
          ? items.filter((it) => it.id && (it.label.toLowerCase().includes(needle) || (it.shortcut || '').toLowerCase().includes(needle)))
          : items;

        const bodyEl = contextMenuEl.querySelector('.ic-ctx-body');
        if (!bodyEl) return;
        bodyEl.innerHTML =
          filtered
            .map((it) => {
              if (it.type === 'group') return `<div class="ic-ctx-group">${escapeHtml(it.label)}</div>`;
              if (it.type === 'sep') return '<div class="ic-ctx-sep"></div>';
              return `
                <button type="button" class="ic-ctx-item ${it.danger ? 'is-danger' : ''} ${it.accent ? 'is-accent' : ''}" data-ctx-act="${escapeHtml(it.id)}">
                  <span>${escapeHtml(it.label)}</span>
                  ${it.shortcut ? `<kbd class="ic-ctx-kbd">${escapeHtml(it.shortcut)}</kbd>` : ''}
                </button>`;
            })
            .join('') || '<div class="ic-ctx-group">无匹配动作</div>';

        bodyEl.querySelectorAll('[data-ctx-act]').forEach((btn) => {
          btn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            executeContextAction(btn.dataset.ctxAct, ev.clientX, ev.clientY);
          });
        });
      };

      contextMenuEl.innerHTML = `
        <div class="ic-ctx-search-wrap">
          <input type="text" class="ic-ctx-search" id="icCtxSearch" placeholder="${targetNode ? '搜索节点操作...' : '搜索并新建节点 (Shift+A)...'}" autocomplete="off" />
        </div>
        <div class="ic-ctx-body"></div>`;

      renderMenuItems('');
      contextMenuEl.classList.remove('hidden');
      placeMenuEdgeAware(clientX, clientY, 264);

      const inp = contextMenuEl.querySelector('#icCtxSearch');
      if (inp) {
        inp.addEventListener('input', (e) => renderMenuItems(e.target.value));
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') { e.preventDefault(); closeContextMenu(); }
          else if (e.key === 'Enter') {
            const firstBtn = contextMenuEl.querySelector('[data-ctx-act]');
            if (firstBtn) {
              e.preventDefault();
              const r = firstBtn.getBoundingClientRect();
              executeContextAction(firstBtn.dataset.ctxAct, r.left, r.top);
            }
          }
        });
        setTimeout(() => inp.focus(), 10);
      }
    }

    function executeContextAction(act, clickX = 320, clickY = 220) {
      const { worldX, worldY, nodeId } = state.ctxMenu;
      closeContextMenu();
      if (!act) return;

      if (act.startsWith('add:')) {
        addNode(act.slice(4), { x: worldX - NODE_WIDTH / 2, y: worldY - 40, autoWire: false });
      } else if (act === 'act:layout') {
        autoLayout();
      } else if (act === 'act:fit') {
        fitView(true);
      } else if (act === 'act:save') {
        saveCustomTemplate();
      } else if (act === 'act:load') {
        loadCustomTemplate();
      } else if (act === 'act:blank') {
        loadPreset('blank');
      } else if (act === 'act:undo') {
        undo();
      } else if (nodeId) {
        const node = state.graph.nodes.find((n) => n.id === nodeId);
        if (!node) return;
        if (act === 'node:model') {
          openModelPicker(nodeId, clickX, clickY);
        } else if (act === 'node:inspect') {
          state.selectedId = nodeId;
          openResultDrawer('node');
        } else if (act === 'node:run') {
          runSinglePreview(nodeId);
        } else if (act === 'node:cli') {
          if (onDispatchRealCli) onDispatchRealCli(node, state.lastTaskPrompt || node.prompt);
        } else if (act === 'node:dup') {
          duplicateNode(nodeId);
        } else if (act === 'node:mute') {
          pushHistory();
          node.muted = !node.muted;
          renderAll();
          setStatus(`节点「${node.title}」已${node.muted ? '静音跳过 (Muted)' : '恢复激活'}。`);
        } else if (act === 'node:disconnect') {
          pushHistory();
          state.graph.edges = state.graph.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
          renderAll();
          setStatus(`已断开「${node.title}」的全部连线。`);
        } else if (act === 'node:delete') {
          removeNode(nodeId);
        }
      }
    }

    /* =========================================================================
       Collapsible Right-Side Deliverable & Node Config/CoT Drawer
       ========================================================================= */
    function openResultDrawer(tab = null) {
      state.drawerOpen = true;
      if (tab) state.drawerTab = tab;
      if (resultDrawerEl) resultDrawerEl.classList.remove('hidden');
      renderResultDrawer();
    }

    function closeResultDrawer() {
      state.drawerOpen = false;
      if (resultDrawerEl) resultDrawerEl.classList.add('hidden');
    }

    function renderDrawerCoTStepsHtml(node) {
      return (node.steps || [])
        .map((s, i) => {
          const safeSt = sanitizeStatus(s.status, VALID_STEP_STATUS, 'pending');
          const dotCls = safeSt === 'completed' ? 'is-done' : safeSt === 'active' ? 'is-active' : safeSt === 'error' ? 'is-err' : 'is-pend';
          return `
            <div class="ic-drawer-step is-${escapeHtml(safeSt)}">
              <div class="ic-drawer-step-head">
                <span class="cot-dot ${dotCls}"></span>
                <strong>0${i + 1} · ${escapeHtml(s.verb)}</strong>
                ${s.ms ? `<span class="mono-xs">${(s.ms / 1000).toFixed(1)}s</span>` : ''}
              </div>
              <p>${escapeHtml(s.detail)}</p>
            </div>`;
        })
        .join('');
    }

    function renderResultDrawer() {
      if (!resultBodyEl || !resultDrawerEl) return;
      if (resultTabsEl) {
        resultTabsEl.querySelectorAll('[data-drawer-tab]').forEach((b) => {
          const act = b.dataset.drawerTab === state.drawerTab;
          b.classList.toggle('active', act);
          b.setAttribute('aria-selected', String(act));
        });
      }

      const md = renderMarkdown || ((s) => `<pre>${escapeHtml(s)}</pre>`);
      const statusMap = effectiveStatuses();
      const node = state.graph.nodes.find((n) => n.id === state.selectedId) || state.graph.nodes[0];

      // Preserve active typing / IME composition inside #icEditTitle or #icEditPrompt (C2 fix)
      if (state.drawerTab === 'node' && node && isEditingInDrawer() && resultBodyEl.dataset.editingNodeId === node.id) {
        const cotEl = resultBodyEl.querySelector('.ic-drawer-cot-list');
        if (cotEl) cotEl.innerHTML = renderDrawerCoTStepsHtml(node);
        const mdEl = resultBodyEl.querySelector('.ic-drawer-md');
        if (mdEl) {
          mdEl.innerHTML = node.outputMd
            ? md(node.outputMd)
            : '<p class="mono-xs">该节点尚未执行。点击下方按钮单步运行或输入任务启动整组集群。</p>';
        }
        return;
      }

      if (state.drawerTab === 'summary') {
        resultBodyEl.dataset.editingNodeId = '';
        const completedNodes = state.graph.nodes.filter((n) => statusMap.get(n.id) === 'completed');
        const totalWaves = topoWaves(state.graph).length;
        const mergeNodes = state.graph.nodes.filter((n) => n.kind === 'cluster-merge');
        const reportMd =
          state.lastClusterReportMd ||
          `### 集群就绪 · 等待派发\n\n在下方输入框键入任务需求后回车（或点击右上角 **运行集群**），画布会按 **${totalWaves} 个拓扑波次**并发调度全部 **${state.graph.nodes.length} 个 Agent 节点**（含 ${mergeNodes.length} 个合并器），并在这里自动汇总展示完整的执行成果、思考链轨迹与合并结论。`;

        resultBodyEl.innerHTML = `
          <div class="ic-drawer-metrics">
            <div class="ic-metric-chip"><span class="mono-xs">节点完成</span><strong>${completedNodes.length}/${state.graph.nodes.length}</strong></div>
            <div class="ic-metric-chip"><span class="mono-xs">拓扑波次</span><strong>${totalWaves} 层</strong></div>
            <div class="ic-metric-chip"><span class="mono-xs">合并通道</span><strong>${state.graph.edges.length} 条</strong></div>
          </div>
          ${
            state.lastTaskPrompt
              ? `<div class="ic-drawer-prompt-box"><span class="mono-xs">当前集群任务</span><p>${escapeHtml(state.lastTaskPrompt)}</p></div>`
              : ''
          }
          <div class="ic-drawer-md markdown-output">${md(reportMd)}</div>
          <div class="ic-drawer-node-list">
            <div class="mono-xs ic-drawer-subcap">各节点模型、思考链与交付一览（点击配置/查看）</div>
            ${state.graph.nodes
              .map((n) => {
                const nst = statusMap.get(n.id) || 'idle';
                const dotCls = nst === 'running' ? 'running' : nst === 'completed' ? 'completed' : nst === 'error' ? 'failed' : '';
                return `
                  <button type="button" class="ic-drawer-node-row ${n.id === state.selectedId ? 'active' : ''}" data-pick-drawer-node="${escapeHtml(n.id)}">
                    <span class="thread-dot ${dotCls}"></span>
                    <span class="ic-drawer-node-name">${escapeHtml(n.title)}</span>
                    <span class="mono-xs">${escapeHtml(formatNodeModelLabel(n))}</span>
                  </button>`;
              })
              .join('')}
          </div>
          <div class="ic-drawer-actions">
            <button type="button" class="btn-primary-sm" id="btnDrawerDispatchCli">带此集群契约调起真实全链路 CLI</button>
            <button type="button" class="btn-secondary-sm" id="btnDrawerCopyReport">复制完整汇报</button>
          </div>`;

        resultBodyEl.querySelectorAll('[data-pick-drawer-node]').forEach((b) => {
          b.addEventListener('click', () => {
            state.selectedId = b.dataset.pickDrawerNode;
            state.drawerTab = 'node';
            renderAll();
          });
        });

        resultBodyEl.querySelector('#btnDrawerDispatchCli')?.addEventListener('click', () => {
          // M2 fix: dispatch full-pipeline (via cluster-merge kind) instead of read-only plan-only!
          const planNode = state.graph.nodes.find((n) => n.kind === 'gemini-plan');
          const codexNode = state.graph.nodes.find((n) => n.kind === 'codex-exec');
          const prompt = state.lastTaskPrompt || (commandInputEl?.value || '').trim() || planNode?.prompt || '';
          if (onDispatchRealCli) {
            onDispatchRealCli(
              {
                kind: 'cluster-merge',
                model: planNode?.model || '',
                codexModel: codexNode?.model || '',
                effort: codexNode?.effort || '',
              },
              prompt
            );
          }
        });
        resultBodyEl.querySelector('#btnDrawerCopyReport')?.addEventListener('click', () => {
          if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(state.lastClusterReportMd || reportMd).then(() => {
              if (onToast) onToast('已复制集群交付汇报');
            }).catch(() => {});
          }
        });
      } else if (node) {
        resultBodyEl.dataset.editingNodeId = node.id;
        const tpl = NODE_TEMPLATES[node.kind] || NODE_TEMPLATES['codex-exec'];
        const upNodes = state.graph.edges
          .filter((e) => e.target === node.id)
          .map((e) => state.graph.nodes.find((x) => x.id === e.source)?.title)
          .filter(Boolean);

        resultBodyEl.innerHTML = `
          <div class="ic-drawer-edit-block">
            <label class="field-block">
              <span class="field-label">节点名称（实时更新画布卡片）</span>
              <input type="text" class="text-input" id="icEditTitle" value="${escapeHtml(node.title)}" />
            </label>
            <div class="ic-drawer-model-row">
              <div class="field-block" style="flex:1">
                <span class="field-label">节点专属模型</span>
                <button type="button" class="text-input ic-drawer-pick-btn mono" id="btnDrawerPickModel">
                  <span>${escapeHtml(formatNodeModelLabel(node))}</span>
                  <span>▾</span>
                </button>
              </div>
              ${
                tpl.provider !== 'gemini'
                  ? `<div class="field-block" style="width:116px">
                      <span class="field-label">推理深度</span>
                      <button type="button" class="text-input ic-drawer-pick-btn mono" id="btnDrawerPickEffort">
                        <span>${escapeHtml(formatNodeEffortLabel(node))}</span>
                        <span>▾</span>
                      </button>
                    </div>`
                  : ''
              }
            </div>
            ${
              tpl.provider !== 'gemini'
                ? `<div class="field-block" style="margin-top:4px">
                    <div id="icDrawerEffortMount"></div>
                  </div>`
                : ''
            }
            <label class="field-block">
              <span class="field-label">节点专属任务 Prompt（自定义该工位职责）</span>
              <textarea class="gate-editor" id="icEditPrompt" rows="3">${escapeHtml(node.prompt || '')}</textarea>
            </label>
            <div class="ic-drawer-meta-row mono-xs">
              <span>上游汇入：${escapeHtml(upNodes.length ? upNodes.join(' + ') : '无（起始节点）')}</span>
            </div>
          </div>

          ${
            node.kind === 'image-gen' || node.kind === 'video-gen'
              ? '<div class="ic-drawer-media-mount" id="icDrawerMediaMount"></div>'
              : ''
          }

          <div class="ic-drawer-cot-section">
            <div class="mono-xs ic-drawer-subcap">树状思考工作流（${node.steps.length} 步）</div>
            <div class="ic-drawer-cot-list">${renderDrawerCoTStepsHtml(node)}</div>
          </div>

          <div class="ic-drawer-md markdown-output">
            ${
              node.outputMd
                ? md(node.outputMd)
                : '<p class="mono-xs">该节点尚未执行。点击下方按钮单步运行或输入任务启动整组集群。</p>'
            }
          </div>

          <div class="ic-drawer-actions">
            <button type="button" class="btn-primary-sm" id="btnDrawerRunNode" ${node.muted ? 'disabled' : ''}>单步演练此节点</button>
            <button type="button" class="btn-secondary-sm" id="btnDrawerRealCli">以此模型调起真实 CLI</button>
          </div>`;

        // M6 fix: patch card title textContent directly without nuking canvas DOM or orbs!
        let titlePushed = false;
        const titleInp = resultBodyEl.querySelector('#icEditTitle');
        titleInp?.addEventListener('focus', () => { titlePushed = false; });
        titleInp?.addEventListener('input', (e) => {
          if (!titlePushed) { pushHistory(); titlePushed = true; }
          node.title = e.target.value;
          const titleEl = nodeEls.get(node.id)?.querySelector('.agent-node-title');
          if (titleEl) titleEl.textContent = node.title;
        });

        let promptPushed = false;
        const promptInp = resultBodyEl.querySelector('#icEditPrompt');
        promptInp?.addEventListener('focus', () => { promptPushed = false; });
        promptInp?.addEventListener('input', (e) => {
          if (!promptPushed) { pushHistory(); promptPushed = true; }
          node.prompt = e.target.value;
        });

        resultBodyEl.querySelector('#btnDrawerPickModel')?.addEventListener('click', (e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          openModelPicker(node.id, r.left, r.bottom + 6);
        });
        resultBodyEl.querySelector('#btnDrawerPickEffort')?.addEventListener('click', (e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          openEffortPicker(node.id, r.left, r.bottom + 6);
        });
        const effMount = resultBodyEl.querySelector('#icDrawerEffortMount');
        if (effMount && window.ConduitEffortSlider) {
          window.ConduitEffortSlider.mount(effMount, {
            defaultValue: node.effort || getContext()?.codexEffort || 'high',
            recommended: 'high',
            compact: true,
            title: '此节点推理深度',
            onChange: (lv) => {
              pushHistory();
              node.effort = lv;
              renderNodes();
              const btnSpan = resultBodyEl.querySelector('#btnDrawerPickEffort span');
              if (btnSpan) btnSpan.textContent = formatNodeEffortLabel(node);
            },
          });
        }
        const mediaMount = resultBodyEl.querySelector('#icDrawerMediaMount');
        if (mediaMount && window.ConduitMediaGen) {
          if (node.kind === 'image-gen') {
            if (!node._previewImages) {
              node._previewImages = [0, 1, 2, 3].map((idx) =>
                window.ConduitMediaGen.createArchitecturalImage(node.prompt || tpl.defaultPrompt, idx, 640, 480, 0)
              );
            }
            window.ConduitMediaGen.mountImageGeneration(mediaMount, {
              prompt: node.prompt || tpl.defaultPrompt,
              status: 'done',
              images: node._previewImages,
              count: 4,
              aspectRatio: '4:3',
              settings: ['画布节点产物'],
              onToast,
            });
          } else if (node.kind === 'video-gen') {
            if (!node._previewClip) {
              node._previewClip = window.ConduitMediaGen.recordKineticClip({ prompt: node.prompt || tpl.defaultPrompt, seconds: 3.0 });
            }
            const vApi = window.ConduitMediaGen.mountVideoGeneration(mediaMount, {
              prompt: node.prompt || tpl.defaultPrompt,
              status: node._previewClipUrl ? 'done' : 'generating',
              progress: node._previewClipUrl ? 100 : 72,
              posterSrc: node._previewClip.posterSrc,
              src: node._previewClipUrl || undefined,
              duration: 3,
              resolution: '1080p',
              fps: 24,
              audio: false,
              aspectRatio: '16:9',
              settings: ['画布节点产物'],
              autoPlay: false,
              loop: true,
              onToast,
            });
            if (!node._previewClipUrl) {
              node._previewClip.videoPromise.then((u) => {
                if (u) {
                  node._previewClipUrl = u;
                  vApi?.update({ status: 'done', progress: 100, src: u });
                }
              });
            }
          }
        }
        resultBodyEl.querySelector('#btnDrawerRunNode')?.addEventListener('click', () => runSinglePreview(node.id));
        resultBodyEl.querySelector('#btnDrawerRealCli')?.addEventListener('click', () => {
          if (onDispatchRealCli) onDispatchRealCli(node, state.lastTaskPrompt || node.prompt);
        });
      }
    }

    function drawMinimap() {
      if (!minimapCanvasEl) return;
      const ctx = minimapCanvasEl.getContext('2d');
      if (!ctx) return;
      const w = minimapCanvasEl.clientWidth || 164;
      const h = minimapCanvasEl.clientHeight || 100;
      const userScale = Number(document.documentElement.dataset.canvasScale || 2);
      const dpr = Math.min(3, Math.max(window.devicePixelRatio || 1, userScale));
      if (minimapCanvasEl.width !== Math.round(w * dpr) || minimapCanvasEl.height !== Math.round(h * dpr)) {
        minimapCanvasEl.width = Math.round(w * dpr);
        minimapCanvasEl.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const vpRect = viewportEl.getBoundingClientRect();
      if (!vpRect.width || !vpRect.height) return;
      const cs = getComputedStyle(document.documentElement);
      const isDark = document.documentElement.dataset.surface === 'charcoal';
      const inkPrimary = cs.getPropertyValue('--ink-primary').trim() || '#111315';
      const wireIdle = isDark ? 'rgba(255,255,255,0.22)' : 'rgba(17,19,21,0.16)';
      const stateOk = cs.getPropertyValue('--state-ok').trim() || '#1f7a4d';
      const stateErr = cs.getPropertyValue('--state-err').trim() || '#c23b2b';
      const vpStroke = isDark ? 'rgba(238,255,130,0.45)' : 'rgba(17,19,21,0.32)';
      const vpFill = isDark ? 'rgba(238,255,130,0.05)' : 'rgba(17,19,21,0.035)';

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
        maxX = Math.max(maxX, n.x + nodeWidth(n) + 80);
        maxY = Math.max(maxY, n.y + (nodeHeight(n) || 260));
      });
      const spanX = Math.max(400, maxX - minX);
      const spanY = Math.max(300, maxY - minY);
      const scale = Math.min((w - 14) / spanX, (h - 14) / spanY);
      const ox = (w - spanX * scale) / 2 - minX * scale;
      const oy = (h - spanY * scale) / 2 - minY * scale;

      const byId = new Map(state.graph.nodes.map((n) => [n.id, n]));
      const statusMap = effectiveStatuses();

      ctx.strokeStyle = wireIdle;
      ctx.lineWidth = 0.85;
      state.graph.edges.forEach((e) => {
        const s = byId.get(e.source);
        const t = byId.get(e.target);
        if (!s || !t) return;
        ctx.beginPath();
        ctx.moveTo(ox + (s.x + nodeWidth(s)) * scale, oy + (s.y + PORT_Y) * scale);
        ctx.lineTo(ox + t.x * scale, oy + (t.y + PORT_Y) * scale);
        ctx.stroke();
      });

      state.graph.nodes.forEach((n) => {
        const st = statusMap.get(n.id) || 'idle';
        ctx.fillStyle = n.muted
          ? 'rgba(132, 139, 152, 0.22)'
          : st === 'running'
            ? inkPrimary
            : st === 'completed'
              ? stateOk
              : st === 'error'
                ? stateErr
                : n.id === state.selectedId
                  ? (isDark ? 'rgba(244,245,246,0.78)' : 'rgba(17,19,21,0.58)')
                  : (isDark ? 'rgba(255,255,255,0.22)' : 'rgba(17,19,21,0.18)');
        ctx.fillRect(ox + n.x * scale, oy + n.y * scale, Math.max(7, nodeWidth(n) * scale), Math.max(5, (nodeHeight(n) || 180) * scale));
      });

      ctx.strokeStyle = vpStroke;
      ctx.fillStyle = vpFill;
      ctx.lineWidth = 1;
      ctx.fillRect(ox + viewX0 * scale, oy + viewY0 * scale, (viewX1 - viewX0) * scale, (viewY1 - viewY0) * scale);
      ctx.strokeRect(ox + viewX0 * scale, oy + viewY0 * scale, (viewX1 - viewX0) * scale, (viewY1 - viewY0) * scale);
    }

    function addNode(kind, posOpts = {}) {
      const tpl = NODE_TEMPLATES[kind] || NODE_TEMPLATES['codex-exec'];
      pushHistory();
      const rect = viewportEl.getBoundingClientRect();
      let x = posOpts.x;
      let y = posOpts.y;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        const cx = (rect.width / 2 - state.panX) / state.zoom - NODE_WIDTH / 2;
        const cy = (rect.height / 2 - state.panY) / state.zoom - 90;
        x = Math.round(cx / GRID_SNAP) * GRID_SNAP;
        y = Math.round(cy / GRID_SNAP) * GRID_SNAP;
        while (state.graph.nodes.some((n) => Math.abs(n.x - x) < 40 && Math.abs(n.y - y) < 40)) {
          x += 36;
          y += 36;
        }
      } else {
        x = Math.round(x);
        y = Math.round(y);
      }

      const id = `n-${kind.split('-')[1] || 'agent'}-${++state.seq}`;
      const num = state.graph.nodes.filter((n) => n.kind === kind).length + 1;
      const node = hydrateNode({
        id,
        kind,
        title: `${tpl.title} #${num}`,
        subtitle: tpl.subtitle,
        x,
        y,
        params:
          kind === 'gemini-plan'
            ? [{ k: 'Model', dynamic: 'nodeModel' }, { k: 'Branching', v: '3 路权衡' }]
            : kind === 'codex-exec'
              ? [{ k: 'Model', dynamic: 'nodeModel' }, { k: 'Effort', dynamic: 'nodeEffort' }, { k: 'Worktree', v: `wt/worker-${num}` }]
              : kind === 'cluster-merge'
                ? [{ k: 'Model', dynamic: 'nodeModel' }, { k: 'Inputs', dynamic: 'inCount' }]
                : kind === 'codex-review'
                  ? [{ k: 'Model', dynamic: 'nodeModel' }, { k: 'Effort', dynamic: 'nodeEffort' }, { k: 'Max Rounds', dynamic: 'maxRounds' }]
                  : [{ k: 'Model', dynamic: 'nodeModel' }, { k: 'Style', v: '去 AI 解释腔' }],
        toggles:
          kind === 'codex-exec'
            ? [{ key: 'worktree', label: 'Worktree 隔离', desc: '独立分支防冲突' }]
            : kind === 'cluster-merge'
              ? [{ key: 'autoNewDiff', label: '合并新建文件', desc: '汇总进统一 Diff' }]
              : [],
      });
      state.graph.nodes.push(node);

      if (posOpts.autoWire !== false) {
        const prev = state.graph.nodes.find((n) => n.id === state.selectedId);
        if (prev && prev.id !== id && canConnect(state.graph, prev.id, id)) {
          state.graph.edges.push({ id: `e-${++state.seq}`, source: prev.id, target: id });
        }
      }
      state.selectedId = id;
      renderAll();
      setStatus(`已新建「${node.title}」—— 点击卡片上 Model 胶囊即可独立切换模型。`);
      if (onToast) onToast(`已新建节点：${node.title}`);
    }

    function duplicateNode(nid) {
      const orig = state.graph.nodes.find((n) => n.id === nid);
      if (!orig) return;
      pushHistory();
      const copy = hydrateNode({
        ...orig,
        id: `n-dup-${++state.seq}`,
        title: `${orig.title} 副本`,
        x: orig.x + 48,
        y: orig.y + 48,
        status: 'idle',
        outputMd: '',
        steps: makeStepsForNode(orig.kind),
      });
      state.graph.nodes.push(copy);
      state.selectedId = copy.id;
      renderAll();
      setStatus(`已复制节点「${copy.title}」(Shift+D)。`);
      if (onToast) onToast(`已复制节点：${copy.title}`);
    }

    function removeNode(id) {
      if (state.graph.nodes.length <= 1) {
        if (onToast) onToast('画布至少保留一个节点');
        return;
      }
      const target = state.graph.nodes.find((n) => n.id === id);
      if (!target) return;
      pushHistory();
      const inc = state.graph.edges.filter((e) => e.target === id);
      const out = state.graph.edges.filter((e) => e.source === id);
      state.graph.nodes = state.graph.nodes.filter((n) => n.id !== id);
      state.graph.edges = state.graph.edges.filter((e) => e.source !== id && e.target !== id);
      if (Array.isArray(state.graph.groups)) {
        state.graph.groups = state.graph.groups
          .map((g) => ({ ...g, nodeIds: g.nodeIds.filter((nid) => nid !== id) }))
          .filter((g) => g.nodeIds.length > 0);
      }
      if (inc.length === 1 && out.length === 1 && canConnect(state.graph, inc[0].source, out[0].target)) {
        state.graph.edges.push({ id: `e-${++state.seq}`, source: inc[0].source, target: out[0].target });
      }
      if (state.selectedId === id) state.selectedId = state.graph.nodes[0]?.id || '';
      renderAll();
      setStatus(`已移除「${target.title}」（按 Ctrl+Z 可撤销）。`);
    }

    function saveCustomTemplate() {
      try {
        localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(state.graph));
        setStatus(`已保存自定义拓扑（${state.graph.nodes.length} 节点 / ${state.graph.edges.length} 连线，含各节点专属模型）到本地。`);
        if (onToast) onToast('已保存为自定义集群模板');
      } catch {
        if (onToast) onToast('保存失败');
      }
    }

    function loadCustomTemplate() {
      try {
        const raw = JSON.parse(localStorage.getItem(CUSTOM_STORAGE_KEY) || 'null');
        if (!raw || !Array.isArray(raw.nodes) || raw.nodes.length === 0) {
          if (onToast) onToast('尚未保存过自定义模板');
          return;
        }
        // Validate & hydrate BEFORE pushHistory() (H3 fix)
        const hydratedNodes = raw.nodes.filter((n) => n && typeof n === 'object').map((n) => hydrateNode(n));
        if (hydratedNodes.length === 0) {
          if (onToast) onToast('自定义模板格式无效');
          return;
        }
        const idSet = new Set(hydratedNodes.map((n) => n.id));
        const safeEdges = Array.isArray(raw.edges)
          ? raw.edges
              .filter((e) => e && typeof e === 'object' && idSet.has(e.source) && idSet.has(e.target) && e.source !== e.target)
              .map((e, idx) => ({ id: typeof e.id === 'string' && e.id ? e.id : `e-load-${idx + 1}`, source: e.source, target: e.target }))
          : [];

        cancelActiveDemo(true);
        pushHistory();
        state.graph = { nodes: hydratedNodes, edges: safeEdges };
        state.seq = Math.max(state.seq, maxNumericSuffix(state.graph) + 1);
        state.selectedId = state.graph.nodes[0]?.id || '';
        if (onPresetChange) onPresetChange('');
        renderAll();
        requestAnimationFrame(() => fitView(true));
        if (onStatusChange) onStatusChange();
        if (onToast) onToast(`已载入自定义模板（${state.graph.nodes.length} 节点）`);
      } catch {
        if (onToast) onToast('读取自定义模板失败');
      }
    }

    function undo() {
      if (state.history.length === 0) {
        if (onToast) onToast('没有可撤销的画布操作');
        return;
      }
      cancelActiveDemo(true);
      state.graph = state.history.pop();
      state.seq = Math.max(state.seq, maxNumericSuffix(state.graph) + 1);
      if (!state.graph.nodes.some((n) => n.id === state.selectedId)) {
        state.selectedId = state.graph.nodes[0]?.id || '';
      }
      renderAll();
      if (onStatusChange) onStatusChange();
      setStatus('已撤销上一步画布操作。');
    }

    function loadPreset(name) {
      cancelActiveDemo(true);
      pushHistory();
      if (name === 'linear') state.graph = makeLinearPreset();
      else if (name === 'multi') state.graph = makeMultiClusterPreset();
      else if (name === 'blank') state.graph = makeBlankPreset();
      else state.graph = makeClusterPreset();
      state.seq = Math.max(state.seq, maxNumericSuffix(state.graph) + 1);
      state.selectedId = state.graph.nodes[0]?.id || '';
      if (onPresetChange) onPresetChange(name);
      renderAll();
      requestAnimationFrame(() => fitView(true));
      const hintMap = {
        linear: '已载入 3 节点精简流水线（点击卡片 Model 可独立切换模型）。',
        multi: '已载入「9 节点双集群二级合并」架构：集群 A 与集群 B 各自汇总后再汇聚至总控终极合并器！',
        blank: '已切换为空白自定义画布：在任意空白处右键（或按 Shift+A）即可新建节点并自由拉线编排。',
        cluster: '已载入「5 节点双路并行 + 合并器」拓扑，每个节点都可点击 Model 独立选模型！',
      };
      setStatus(hintMap[name] || hintMap.cluster);
      if (onStatusChange) onStatusChange();
    }

    function wait(ms) {
      return new Promise((r) => setTimeout(r, ms));
    }

    async function animateNodeSteps(nodesList, token, isLastWave) {
      const maxSteps = Math.max(...nodesList.map((n) => n.steps.length), 1);
      for (let sIdx = 0; sIdx < maxSteps; sIdx += 1) {
        if (token !== state.demoToken) return false;
        nodesList.forEach((n) => {
          const st = n.steps[sIdx];
          if (st) st.status = 'active';
        });
        renderAll();
        await wait(440);
        if (token !== state.demoToken) return false;

        let waveBlocked = false;
        nodesList.forEach((n) => {
          const st = n.steps[sIdx];
          if (!st) return;
          if (state.failLast && isLastWave && sIdx === maxSteps - 1) {
            st.status = 'error';
            st.detail = '命中高危鉴权边界变更 [BLOCKING]，已暂停放行并输出阻塞详情。';
            st.ms = 440;
            waveBlocked = true;
          } else {
            st.status = 'completed';
            st.ms = 380 + Math.floor(Math.random() * 260);
          }
        });
        if (waveBlocked) return 'blocked';
      }
      return 'ok';
    }

    async function runClusterDemo(customPrompt = '') {
      const allActive = state.graph.nodes.filter((n) => !n.muted);
      if (allActive.length === 0) {
        if (onToast) onToast('当前所有节点均处于静音状态，请至少取消静音一个节点');
        setStatus('无法运行：当前画布中所有节点均被静音跳过。');
        return;
      }

      const token = ++state.demoToken;
      const prompt = (customPrompt || commandInputEl?.value || state.lastTaskPrompt || '').trim();
      if (prompt) state.lastTaskPrompt = prompt;
      state.demoRunning = true;
      state.lastClusterReportMd = '';

      state.graph.nodes.forEach((n) => {
        n.status = 'idle';
        n.outputMd = '';
        n.steps = makeStepsForNode(n.kind, prompt ? `承接任务「${prompt.slice(0, 32)}」 · 模型 ${formatNodeModelLabel(n)}` : '');
        n.cotOpen = false;
      });

      const waves = topoWaves(state.graph).filter((w) => w.some((id) => !state.graph.nodes.find((n) => n.id === id)?.muted));
      setStatus(`正在按 ${waves.length} 个拓扑波次并发调度集群（任务：${prompt || '默认协同演练'}）...`);
      renderAll();
      if (onStatusChange) onStatusChange();

      const completedLog = [];

      for (let w = 0; w < waves.length; w += 1) {
        if (token !== state.demoToken) return;
        const activeNodes = waves[w]
          .map((id) => state.graph.nodes.find((n) => n.id === id))
          .filter((n) => n && !n.muted);
        if (activeNodes.length === 0) continue;

        const names = activeNodes.map((n) => n.title).join(' ＋ ');
        activeNodes.forEach((n) => {
          n.status = 'running';
          n.cotOpen = true;
        });
        if (!isEditingInDrawer()) state.selectedId = activeNodes[0].id;
        setStatus(`波次 ${w + 1}/${waves.length} 并发推演思考链中：${names}`);
        renderAll();
        if (onStatusChange) onStatusChange();

        const res = await animateNodeSteps(activeNodes, token, w === waves.length - 1);
        if (res === false || token !== state.demoToken) return;

        activeNodes.forEach((n) => {
          const upTitles = state.graph.edges
            .filter((e) => e.target === n.id)
            .map((e) => state.graph.nodes.find((x) => x.id === e.source)?.title)
            .filter(Boolean);
          const failed = res === 'blocked';
          n.status = failed ? 'error' : 'completed';
          n.outputMd = buildNodeDeliverable(n, formatNodeModelLabel(n), prompt, upTitles, failed);
          completedLog.push(
            `- **波次 ${w + 1} · ${n.title}**（\`${formatNodeModelLabel(n)}\`）：${failed ? '触发 BLOCKING 阻断' : `完成全部 ${n.steps.length} 步思考工作流并向后交付`}`
          );
        });

        renderAll();
        if (res === 'blocked') {
          state.demoRunning = false;
          state.lastClusterReportMd = `## 集群执行在终局门禁处被拦截\n\n- **下发需求**：${prompt || '默认多模型集群演练'}\n- **阻断位置**：${names}\n\n### 执行轨迹\n${completedLog.join('\n')}\n\n> 请检查右侧节点详情或取消「模拟拦截」后重新触发。`;
          setStatus('集群在终局门禁触发 [BLOCKING] 阻断，已在右侧打开交付与排查报告！');
          openResultDrawer('summary');
          if (onStatusChange) onStatusChange();
          return;
        }
      }

      state.demoRunning = false;
      const mergeCount = allActive.filter((n) => n.kind === 'cluster-merge').length;
      state.lastClusterReportMd = `## 集群全链路协同交付完成（PASS）\n\n- **任务需求**：${prompt || '默认多模型集群协同演练'}\n- **调度规模**：共 **${waves.length} 个拓扑波次** · **${allActive.length} 个活跃节点** · **${mergeCount} 级聚合合并**\n- **门禁状态**：\`BLOCKING: 0\` · 所有并行分支无冲突合入并已通过审查\n\n### 各波次交付流水\n${completedLog.join('\n')}\n\n> 点击下方任意节点可查看或修改它的专属模型、思考链与 Prompt，或点击下方按钮调起本机真实全链路 CLI。`;
      setStatus('集群全部完成！已在右侧「集群总汇报」展示完整交付成果与各节点思考链。');
      openResultDrawer('summary');
      if (onStatusChange) onStatusChange();
    }

    async function runSinglePreview(nid) {
      const node = state.graph.nodes.find((n) => n.id === nid);
      if (!node) return;
      if (node.muted) {
        if (onToast) onToast('该节点已静音，请先右键取消静音后再运行');
        return;
      }
      const token = ++state.demoToken;
      const prompt = (node.prompt || commandInputEl?.value || state.lastTaskPrompt || '').trim();
      state.demoRunning = true;
      if (!isEditingInDrawer()) state.selectedId = nid;
      node.status = 'running';
      node.cotOpen = true;
      node.steps = makeStepsForNode(node.kind, prompt ? `模型 ${formatNodeModelLabel(node)} · 任务：${prompt.slice(0, 28)}` : '');
      setStatus(`正在单步推演「${node.title}」（${formatNodeModelLabel(node)}）...`);
      renderAll();
      if (onStatusChange) onStatusChange();

      const res = await animateNodeSteps([node], token, node.kind === 'codex-review');
      if (res === false || token !== state.demoToken) return;
      const upTitles = state.graph.edges
        .filter((e) => e.target === node.id)
        .map((e) => state.graph.nodes.find((x) => x.id === e.source)?.title)
        .filter(Boolean);
      const failed = res === 'blocked';
      node.status = failed ? 'error' : 'completed';
      node.outputMd = buildNodeDeliverable(node, formatNodeModelLabel(node), prompt, upTitles, failed);
      state.demoRunning = false;
      setStatus(`「${node.title}」${failed ? '触发拦截。' : '已完成，可在右侧查看思考链与交付成果。'}`);
      renderAll();
      openResultDrawer('node');
      if (onStatusChange) onStatusChange();
    }

    function resetDemo() {
      cancelActiveDemo(true);
      state.graph.nodes.forEach((n) => {
        n.status = 'idle';
        n.outputMd = '';
        n.cotOpen = false;
        n.steps = makeStepsForNode(n.kind);
      });
      setStatus('所有节点与思考工作流已重置为就绪态。');
      renderAll();
      if (onStatusChange) onStatusChange();
    }

    function exportJson() {
      const payload = JSON.stringify(
        {
          engine: 'CONDUIT Infinite Agent Cluster Canvas v6.1',
          nodes: state.graph.nodes.map(({ id, kind, title, model, effort, prompt, x, y, w, h, muted }) => ({
            id, kind, title, model: model || 'global-default', effort: effort || 'global-default', prompt, x, y, w: w || NODE_WIDTH, h: h || null, muted,
          })),
          edges: state.graph.edges,
        },
        null,
        2
      );
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(payload).then(() => {
          if (onToast) onToast('已复制集群拓扑 JSON（含各节点模型）到剪贴板');
        }).catch(() => {});
      }
      setStatus('已导出当前集群拓扑 JSON。');
    }

    // --- Context Menu & Global Outside-Click Dismissal (H5 fix) ---
    document.addEventListener('pointerdown', (e) => {
      if (state.ctxMenu.open && contextMenuEl && !contextMenuEl.contains(e.target)) {
        closeContextMenu();
      }
    });

    viewportEl.addEventListener('contextmenu', (e) => {
      if (e.target.closest(OVERLAY_SEL)) return;
      e.preventDefault();
      const nodeWrap = e.target.closest('.ic-node-wrap');
      const nid = nodeWrap ? nodeWrap.dataset.nodeId : null;
      if (nid && state.selectedId !== nid) {
        state.selectedId = nid;
        renderNodes();
        if (state.drawerOpen && state.drawerTab === 'node') renderResultDrawer();
      }
      openContextMenu(e.clientX, e.clientY, nid);
    });

    // --- Pointer & Wheel Events on Infinite Viewport (H1, H2, H4, C2 fixes) ---
    viewportEl.addEventListener('pointerdown', (e) => {
      const isUi = Boolean(e.target.closest(OVERLAY_SEL));
      if (isUi || state.dragging || state.wiring || state.resizing) return;
      if (e.target.closest('input, textarea, select, .ic-resize-handle')) return;
      const isBg = !e.target.closest('.ic-node-wrap, .ic-group-head, .ic-node-group.is-collapsed');
      if (e.button === 1 || (e.button === 0 && (isBg || state.spaceDown))) {
        if (document.activeElement instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
          document.activeElement.blur();
        }
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
      if (state.panning && e.pointerId === state.panning.pointerId) {
        state.panX = state.panning.originPanX + (e.clientX - state.panning.startX);
        state.panY = state.panning.originPanY + (e.clientY - state.panning.startY);
        applyTransform();
        return;
      }

      if (state.resizing && e.pointerId === state.resizing.pointerId) {
        const rs = state.resizing;
        const node = state.graph.nodes.find((n) => n.id === rs.id);
        const wrap = nodeEls.get(rs.id);
        const card = wrap?.querySelector('.agent-node');
        const surface = wrap?.querySelector('.agent-node-surface');
        if (!node || !wrap || !surface) return;
        if (!rs.moved) {
          if (Math.hypot(e.clientX - rs.startClientX, e.clientY - rs.startClientY) < 3) return;
          rs.moved = true;
          pushHistory();
          wrap.classList.add('is-resizing');
          try {
            viewportEl.setPointerCapture(e.pointerId);
            rs.captured = true;
          } catch {}
        }
        const dx = (e.clientX - rs.startClientX) / state.zoom;
        const dy = (e.clientY - rs.startClientY) / state.zoom;

        if (rs.dir === 'e' || rs.dir === 'se') {
          let nextW = clampNum(Math.round(rs.startW + dx), MIN_NODE_W, MAX_NODE_W);
          if (e.shiftKey) nextW = clampNum(Math.round(nextW / GRID_SNAP) * GRID_SNAP, MIN_NODE_W, MAX_NODE_W);
          node.w = nextW;
          wrap.style.width = `${nextW}px`;
        } else if (rs.dir === 'w') {
          let nextW = clampNum(Math.round(rs.startW - dx), MIN_NODE_W, MAX_NODE_W);
          if (e.shiftKey) nextW = clampNum(Math.round(nextW / GRID_SNAP) * GRID_SNAP, MIN_NODE_W, MAX_NODE_W);
          node.x = Math.round(rs.startX + (rs.startW - nextW));
          node.w = nextW;
          wrap.style.width = `${nextW}px`;
          wrap.style.transform = `translate(${node.x}px,${Math.round(node.y)}px)`;
        }

        if (rs.dir === 's' || rs.dir === 'se') {
          let nextH = clampNum(Math.round(rs.startH + dy), MIN_NODE_H, MAX_NODE_H);
          if (e.shiftKey) nextH = clampNum(Math.round(nextH / GRID_SNAP) * GRID_SNAP, MIN_NODE_H, MAX_NODE_H);
          node.h = nextH;
          surface.style.minHeight = `${nextH}px`;
          surface.style.height = `${nextH}px`;
          if (card) card.classList.add('is-custom-h');
        }

        renderGroups();
        renderEdges();
        return;
      }

      if (state.dragging && e.pointerId === state.dragging.pointerId) {
        const node = state.graph.nodes.find((n) => n.id === state.dragging.id);
        if (!node) return;
        if (!state.dragging.moved) {
          const dist = Math.hypot(e.clientX - state.dragging.startClientX, e.clientY - state.dragging.startClientY);
          if (dist < DRAG_THRESHOLD) return;
          state.dragging.moved = true;
          pushHistory();
          const wrap = nodeEls.get(node.id);
          if (wrap) wrap.classList.add('is-dragging');
          try {
            viewportEl.setPointerCapture(e.pointerId);
            state.dragging.captured = true;
          } catch {}
        }
        const pt = screenToWorld(e.clientX, e.clientY);
        let nx = pt.x - state.dragging.offsetX;
        let ny = pt.y - state.dragging.offsetY;
        if (e.shiftKey) {
          nx = Math.round(nx / GRID_SNAP) * GRID_SNAP;
          ny = Math.round(ny / GRID_SNAP) * GRID_SNAP;
        }
        node.x = Math.round(nx);
        node.y = Math.round(ny);
        const nodeEl = nodeEls.get(node.id);
        if (nodeEl) nodeEl.style.transform = `translate(${Math.round(node.x)}px,${Math.round(node.y)}px)`;
        renderGroups();
        renderEdges();
        return;
      }

      if (state.draggingGroup && e.pointerId === state.draggingGroup.pointerId) {
        const g = (state.graph.groups || []).find((x) => x.id === state.draggingGroup.id);
        if (!g) return;
        if (!state.draggingGroup.moved) {
          const dist = Math.hypot(e.clientX - state.draggingGroup.startClientX, e.clientY - state.draggingGroup.startClientY);
          if (dist < DRAG_THRESHOLD) return;
          state.draggingGroup.moved = true;
          pushHistory();
          try {
            viewportEl.setPointerCapture(e.pointerId);
            state.draggingGroup.captured = true;
          } catch {}
        }
        const pt = screenToWorld(e.clientX, e.clientY);
        let dx = pt.x - state.draggingGroup.startWorldX;
        let dy = pt.y - state.draggingGroup.startWorldY;
        if (e.shiftKey) {
          dx = Math.round(dx / GRID_SNAP) * GRID_SNAP;
          dy = Math.round(dy / GRID_SNAP) * GRID_SNAP;
        }
        state.draggingGroup.origins.forEach((orig, nid) => {
          const n = state.graph.nodes.find((x) => x.id === nid);
          if (!n) return;
          n.x = Math.round(orig.x + dx);
          n.y = Math.round(orig.y + dy);
          const wrap = nodeEls.get(nid);
          if (wrap) wrap.style.transform = `translate(${n.x}px,${n.y}px)`;
        });
        renderGroups();
        renderEdges();
        return;
      }

      if (state.wiring && e.pointerId === state.wiring.pointerId) {
        const pt = screenToWorld(e.clientX, e.clientY);
        state.wiring.x = pt.x;
        state.wiring.y = pt.y;
        // H4 fix: abort port hit-test if pointer is over opaque overlay/drawer
        const stack = document.elementsFromPoint(e.clientX, e.clientY);
        const blockedByUi = stack.length > 0 && Boolean(stack[0].closest(OVERLAY_SEL));
        const hit = blockedByUi ? null : stack.find((el) => el.dataset?.portSide === 'in');
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

    function finishPointer(e, cancel = false) {
      if (state.panning && (cancel || e.pointerId === state.panning.pointerId)) {
        try { viewportEl.releasePointerCapture(state.panning.pointerId); } catch {}
        state.panning = null;
        viewportEl.classList.remove('is-panning');
      }
      if (state.resizing && (cancel || e.pointerId === state.resizing.pointerId)) {
        const wrap = nodeEls.get(state.resizing.id);
        if (wrap) wrap.classList.remove('is-resizing');
        if (state.resizing.captured) {
          try { viewportEl.releasePointerCapture(state.resizing.pointerId); } catch {}
        }
        state.resizing = null;
        drawMinimap();
      }
      if (state.dragging && (cancel || e.pointerId === state.dragging.pointerId)) {
        const wrap = nodeEls.get(state.dragging.id);
        if (wrap) wrap.classList.remove('is-dragging');
        if (state.dragging.captured) {
          try { viewportEl.releasePointerCapture(state.dragging.pointerId); } catch {}
        }
        state.dragging = null;
        drawMinimap();
      }
      if (state.draggingGroup && (cancel || e.pointerId === state.draggingGroup.pointerId)) {
        if (state.draggingGroup.captured) {
          try { viewportEl.releasePointerCapture(state.draggingGroup.pointerId); } catch {}
        }
        state.draggingGroup = null;
        drawMinimap();
      }
      if (state.wiring && (cancel || e.pointerId === state.wiring.pointerId)) {
        const { sourceId, pointerId } = state.wiring;
        nodesLayerEl.querySelectorAll('.wf-port.is-drop-target').forEach((p) => p.classList.remove('is-drop-target'));
        try { viewportEl.releasePointerCapture(pointerId); } catch {}
        let targetId = null;
        if (!cancel) {
          const stack = document.elementsFromPoint(e.clientX, e.clientY);
          const blockedByUi = stack.length > 0 && Boolean(stack[0].closest(OVERLAY_SEL));
          const hit = blockedByUi ? null : stack.find((el) => el.dataset?.portSide === 'in');
          targetId = hit ? hit.dataset.portNode : state.wiring.hoverTargetId;
        }
        state.wiring = null;

        if (!cancel && targetId) {
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
    }

    viewportEl.addEventListener('pointerup', (e) => finishPointer(e, false));
    viewportEl.addEventListener('pointercancel', (e) => finishPointer(e, true));
    viewportEl.addEventListener('lostpointercapture', (e) => finishPointer(e, true));

    viewportEl.addEventListener(
      'wheel',
      (e) => {
        if (e.target.closest(OVERLAY_SEL)) return;
        e.preventDefault();
        closeContextMenu();
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        zoomAt(factor, e.clientX, e.clientY);
      },
      { passive: false }
    );

    // Blender Keyboard Shortcuts (H2 + L2 hardened)
    window.addEventListener('keydown', (e) => {
      if (viewportEl.closest('.hidden') || e.isComposing) return;
      if (e.key === 'Escape') {
        closeContextMenu();
        return;
      }
      const tag = (e.target?.tagName || '').toLowerCase();
      if (['input', 'textarea', 'select'].includes(tag)) return;
      if (e.target?.closest?.('.ic-result-drawer, .studio-drawer, .inspector-pane, .tweaks-panel, .floating-popover, .ic-ctx-menu')) return;
      const studioOpen = !document.getElementById('studioDrawer')?.classList.contains('hidden');
      if (studioOpen) return;

      const hasMod = e.ctrlKey || e.metaKey || e.altKey;
      const keyLower = e.key.toLowerCase();

      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && keyLower === 'z') {
        e.preventDefault();
        undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && keyLower === 'g') {
        e.preventDefault();
        createNodeGroup();
        return;
      }
      if (hasMod) return;

      if (e.code === 'Space' && !e.repeat && tag !== 'button') {
        e.preventDefault();
        state.spaceDown = true;
        viewportEl.classList.add('is-space-pan');
      } else if (e.shiftKey && keyLower === 'a') {
        e.preventDefault();
        const r = viewportEl.getBoundingClientRect();
        openContextMenu(r.left + r.width / 2, r.top + r.height / 2, null);
      } else if (e.shiftKey && keyLower === 'd' && state.selectedId) {
        e.preventDefault();
        duplicateNode(state.selectedId);
      } else if (!e.shiftKey && keyLower === 'h' && state.selectedId) {
        e.preventDefault();
        const n = state.graph.nodes.find((x) => x.id === state.selectedId);
        if (n) { pushHistory(); n.collapsed = !n.collapsed; renderAll(); }
      } else if (!e.shiftKey && e.key === 'Tab' && state.selectedId) {
        const grp = (state.graph.groups || []).find((g) => g.nodeIds.includes(state.selectedId));
        if (grp) {
          e.preventDefault();
          pushHistory();
          grp.collapsed = !grp.collapsed;
          renderAll();
        }
      } else if (!e.shiftKey && keyLower === 'm' && state.selectedId) {
        e.preventDefault();
        const n = state.graph.nodes.find((x) => x.id === state.selectedId);
        if (n) { pushHistory(); n.muted = !n.muted; renderAll(); }
      } else if (!e.shiftKey && keyLower === 'l') {
        e.preventDefault();
        autoLayout();
      } else if (!e.shiftKey && (keyLower === 'f' || e.key === 'Home')) {
        e.preventDefault();
        fitView(true);
      } else if (!e.shiftKey && e.key === '1') {
        state.zoom = 1;
        applyTransform();
      } else if (!e.shiftKey && e.key === 'Enter' && state.selectedId && tag !== 'button') {
        e.preventDefault();
        openResultDrawer('node');
      } else if (!e.shiftKey && keyLower === 'r' && state.selectedId) {
        e.preventDefault();
        runSinglePreview(state.selectedId);
      } else if (!e.shiftKey && (e.key === 'Delete' || e.key === 'Backspace') && state.selectedId) {
        e.preventDefault();
        removeNode(state.selectedId);
      }
    });

    const resetSpace = () => {
      state.spaceDown = false;
      viewportEl.classList.remove('is-space-pan');
    };
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') resetSpace(); });
    window.addEventListener('blur', resetSpace);

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => drawMinimap());
      ro.observe(viewportEl);
    }

    if (minimapCanvasEl) {
      minimapCanvasEl.addEventListener('click', () => fitView(true));
    }

    if (resultTabsEl) {
      resultTabsEl.querySelectorAll('[data-drawer-tab]').forEach((btn) => {
        btn.addEventListener('click', () => {
          state.drawerTab = btn.dataset.drawerTab;
          renderResultDrawer();
        });
      });
    }

    renderAll();

    return {
      render: renderAll,
      fitView,
      autoLayout,
      zoomIn: () => zoomAt(1.18),
      zoomOut: () => zoomAt(1 / 1.18),
      resetZoom: () => { state.zoom = 1; applyTransform(); },
      addNode,
      createNodeGroup,
      undo,
      loadPreset,
      saveCustomTemplate,
      loadCustomTemplate,
      runClusterDemo,
      resetDemo,
      exportJson,
      openResultDrawer,
      closeResultDrawer,
      clearDemoOverlay: () => { cancelActiveDemo(true); },
      toggleResultDrawer: () => (state.drawerOpen ? closeResultDrawer() : openResultDrawer()),
      setFailLast: (v) => { state.failLast = Boolean(v); },
      // M3 fix: match by node kind instead of raw array index!
      selectKind: (idx) => {
        const kindOrder = ['gemini-plan', 'codex-exec', 'codex-review'];
        const wantKind = kindOrder[idx] || 'gemini-plan';
        const n = state.graph.nodes.find((x) => x.kind === wantKind) || state.graph.nodes[0];
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
