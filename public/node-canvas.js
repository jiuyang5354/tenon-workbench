(() => {
  'use strict';

  /**
   * TENON Multi-Agent Node Canvas v7.0
   * - Clean Chinese terminology, transparent preview vs real execution
   * - Forgiving two-way port wiring (drag OR click-to-connect, forward OR reverse, card drop target)
   * - Selectable & keyboard-deletable edges, double-click canvas to add node, Shift+snap drag & resize
   * - Per-node model & effort picker, collapsible groups, undo history, minimap
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
  const DRAFT_STORAGE_KEY = 'tenon_canvas_draft_v2';
  const CANVAS_MODE_STORAGE_KEY = 'tenon_canvas_mode_v1';
  const GROUP_ACCENTS = ['sage', 'slate', 'amber', 'violet', 'rose'];
  const GROUP_ACCENT_LABELS = { sage: '鼠尾草绿', slate: '晴空蓝', amber: '琥珀金', violet: '暮紫', rose: '珊瑚红' };
  const DEFAULT_GUIDE_TEXT = '左键框选节点 · 中键/空格拖动画布 · 右键快捷面板与合并成组 · 滚轮缩放';
  const PRO_GUIDE_TEXT = '专业模式：左键框选多选 · 中键/空格平移 · 右键快捷菜单与合并成组 (Ctrl+G) · 滚轮缩放 · Ctrl+S 保存';

  const ADD_NODE_MENU_ITEMS = [
    { kind: 'gemini-plan', tag: '规划', title: '需求分析与规划', desc: '先看懂任务和项目目录，理出要改动的文件与步骤' },
    { kind: 'codex-exec', tag: '开发', title: '代码实现', desc: '按上一步方案真正修改代码、补边界处理并自检' },
    { kind: 'custom-agent', tag: '外部模型', title: '外部模型节点', desc: '接入 Claude Code / Ollama / DeepSeek 等外部模型参与这一步' },
    { kind: 'cluster-merge', tag: '汇总', title: '多路结果汇总', desc: '把前面多条分支的结果合并成一份统一结论' },
    { kind: 'codex-review', tag: '审查', title: '代码审查', desc: '只读检查潜在 Bug、数据丢失或权限越界风险' },
    { kind: 'summary-card', tag: '总结框', title: '画布卡片总结框', desc: '放在流程末尾，自动提炼最终结论并用大白话复述给你', highlight: true },
    { kind: 'gemini-copy', tag: '文案', title: '界面文案润色', desc: '优化按钮、提示和说明文字，去掉生硬术语' },
    { kind: '__group__', tag: '分组', title: '新建节点分组', desc: '把相关节点装进一个框里，方便一起拖动和折叠' },
  ];

  const BUILTIN_TEMPLATES = [
    { id: 'linear', name: '标准四步流程', desc: '需求分析 → 代码实现 → 代码审查 → 总结框（推荐新手）' },
    { id: 'cluster', name: '前后端并行开发 (6节点)', desc: '拆出前端与后端同时推进，再汇总、审查、总结' },
    { id: 'multi', name: '全栈分层协作 (10节点)', desc: '前端+文案、后端+测试 两组并行后总汇总' },
    { id: 'blank', name: '空白画布', desc: '只留 1 个起点卡片，从零自由搭建' },
  ];

  const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const nodeWidth = (n) => (n && Number.isFinite(Number(n.w)) ? clampNum(Math.round(Number(n.w)), MIN_NODE_W, MAX_NODE_W) : NODE_WIDTH);
  const nodeHeight = (n) => (n && Number.isFinite(Number(n.h)) && Number(n.h) > 0 ? clampNum(Math.round(Number(n.h)), MIN_NODE_H, MAX_NODE_H) : null);

  const VALID_NODE_STATUS = new Set(['idle', 'running', 'completed', 'error']);
  const VALID_STEP_STATUS = new Set(['pending', 'active', 'completed', 'error']);
  const EFFORT_OPTIONS = [
    { id: '', label: '跟随全局默认', badge: '默认' },
    { id: 'low', label: 'low（快速）', badge: 'LOW' },
    { id: 'medium', label: 'medium（均衡）', badge: 'MED' },
    { id: 'high', label: 'high（推荐）', badge: 'HIGH' },
    { id: 'xhigh', label: 'xhigh（深入）', badge: 'XHIGH' },
    { id: 'max', label: 'max（最高）', badge: 'MAX' },
    { id: 'ultracode', label: 'ultracode（深度代码）', badge: 'ULTRA' },
  ];

  const NODE_TEMPLATES = {
    'gemini-plan': {
      kind: 'gemini-plan',
      roleCode: '规划',
      provider: 'gemini',
      title: '需求分析与规划',
      subtitle: '梳理代码边界、拆分任务与方案',
      mode: 'plan-only',
      orbIdle: ['reasoning', 'default'],
      orbRun: ['reasoning', 'twins'],
      inLabel: '任务需求',
      outLabel: '方案输出',
      inType: 'prompt',
      outType: 'spec',
      showIn: true,
      showOut: true,
      defaultPrompt: '只读分析当前项目结构，拆解改动范围、接口约定与验证要点。',
      stepTemplates: [
        { verb: '扫描目录与相关模块', detail: '只读梳理核心文件边界与依赖关系' },
        { verb: '比较可行实现方案', detail: '评估改动范围、风险与可维护性，选定最优路线' },
        { verb: '输出任务拆分与验收要点', detail: '整理明确的改动清单，传递给下游开发节点' },
      ],
      errorMessage: '规划阶段未返回有效结果，请检查 Gemini (agy) 登录状态后重试。',
    },
    'codex-exec': {
      kind: 'codex-exec',
      roleCode: '开发',
      provider: 'codex',
      title: '代码实现',
      subtitle: '在安全沙箱内修改代码并自检',
      mode: 'codex-exec',
      orbIdle: ['working', 'gyro'],
      orbRun: ['working', 'gyro'],
      inLabel: '方案输入',
      outLabel: '代码改动',
      inType: 'spec',
      outType: 'diff',
      showIn: true,
      showOut: true,
      defaultPrompt: '按照上游方案修改对应代码，补全边界处理并运行语法与单元测试。',
      stepTemplates: [
        { verb: '进入沙箱工作区', detail: '加载工作目录上下文并确认写权限范围' },
        { verb: '编写代码与边界处理', detail: '按要求落实功能改动并保持无关代码整洁' },
        { verb: '运行检查与测试', detail: '执行语法校验与相关单测，记录完整代码差异' },
      ],
      errorMessage: '代码实现阶段执行失败，请检查 Codex 配置档或工作目录权限。',
    },
    'cluster-merge': {
      kind: 'cluster-merge',
      roleCode: '汇总',
      provider: 'both',
      title: '结果汇总',
      subtitle: '合并多路改动并核对接口一致',
      mode: 'full-pipeline',
      orbIdle: ['compacting', 'squeeze'],
      orbRun: ['compacting', 'fuse'],
      inLabel: '多路输入',
      outLabel: '合并改动',
      inType: 'multi',
      outType: 'diff',
      showIn: true,
      showOut: true,
      defaultPrompt: '汇总所有上游节点的改动与说明，核对接口一致性并整理为统一变更集。',
      stepTemplates: [
        { verb: '收集上游各路输出', detail: '拉取并行节点产出的修改内容与新增文件' },
        { verb: '检查接口与字段冲突', detail: '核对跨模块数据结构与调用边界是否一致' },
        { verb: '整理统一变更清单', detail: '打包汇总后的代码改动，送交下游审查' },
      ],
      errorMessage: '汇总阶段发现跨模块冲突，请打开节点详情查看具体差异。',
    },
    'codex-review': {
      kind: 'codex-review',
      roleCode: '审查',
      provider: 'codex',
      title: '代码审查与总结',
      subtitle: '排查严重缺陷并生成简明说明',
      mode: 'codex-review',
      orbIdle: ['searching', 'lighthouse'],
      orbRun: ['searching', 'lighthouse'],
      inLabel: '待审改动',
      outLabel: '审查结论',
      inType: 'diff',
      outType: 'gate',
      showIn: true,
      showOut: true,
      defaultPrompt: '只读审查代码改动，重点排查数据丢失、权限越界和崩溃风险，并给出简明总结。',
      stepTemplates: [
        { verb: '识别高风险改动路径', detail: '检查是否涉及鉴权、支付、配置或发布脚本' },
        { verb: '分级排查阻塞性问题', detail: '区分必须修复的严重缺陷与一般优化建议' },
        { verb: '生成简明交付说明', detail: '用直白语言总结本次改动内容、测试情况与注意事项' },
      ],
      errorMessage: '代码审查发现严重问题，已拦截并等待人工确认处理方式。',
    },
    'gemini-copy': {
      kind: 'gemini-copy',
      roleCode: '文案',
      provider: 'gemini',
      title: '界面文案润色',
      subtitle: '精简生硬表述，提升可读性',
      mode: 'copy-polish',
      orbIdle: ['background', 'spiral'],
      orbRun: ['reasoning', 'default'],
      inLabel: '原始文案',
      outLabel: '润色结果',
      showIn: true,
      showOut: true,
      defaultPrompt: '检查按钮、提示和空状态文案，去掉晦涩术语和冗余解释，给出修改前后对比。',
      stepTemplates: [
        { verb: '定位生硬与冗余表述', detail: '标记不自然的翻译腔、黑话和重复信息' },
        { verb: '重写简洁操作文案', detail: '用更直接的动词与清晰反馈替代抽象描述' },
        { verb: '输出修改对照表', detail: '按场景列出原文、建议文案与改动原因' },
      ],
      errorMessage: '文案润色执行失败，请重试。',
    },
    'image-gen': {
      kind: 'image-gen',
      roleCode: '图像',
      provider: 'gemini',
      title: '图像生成',
      subtitle: '生成 4 组候选图并支持放大预览',
      mode: 'image-gen',
      orbIdle: ['waiting', 'default'],
      orbRun: ['working', 'gyro'],
      inLabel: '画面描述',
      outLabel: '图像输出',
      showIn: true,
      showOut: true,
      defaultPrompt: '极简建筑光影构图，浅灰石膏质感与克制几何留白，高清晰度平面视觉',
      stepTemplates: [
        { verb: '确定画幅与构图', detail: '按 4:3 比例初始化 4 组候选画面' },
        { verb: '逐步渲染画面细节', detail: '从整体轮廓到细部材质推进生成' },
        { verb: '生成完成可放大查看', detail: '支持切换候选图、高清放大与全屏预览' },
      ],
      errorMessage: '图像生成中断，请重试。',
    },
    'video-gen': {
      kind: 'video-gen',
      roleCode: '视频',
      provider: 'gemini',
      title: '视频生成',
      subtitle: '生成动态预览片段并支持导出',
      mode: 'video-gen',
      orbIdle: ['background', 'spiral'],
      orbRun: ['working', 'gyro'],
      inLabel: '脚本 / 首帧',
      outLabel: '视频片段',
      showIn: true,
      showOut: true,
      defaultPrompt: '暗色静水面同心涟漪俯拍慢镜头，细微颗粒质感与柔和轮廓光',
      stepTemplates: [
        { verb: '解析镜头描述与首帧', detail: '准备 16:9 · 1080p · 24fps 画面基准' },
        { verb: '逐帧渲染动态画面', detail: '连续生成视频帧并同步进度' },
        { verb: '封装播放器可导出', detail: '支持播放控制、进度拖拽与本地下载' },
      ],
      errorMessage: '视频生成中断，请重试。',
    },
    'custom-agent': {
      kind: 'custom-agent',
      roleCode: '外部模型',
      provider: 'external',
      title: '外部模型节点',
      subtitle: '直连 Claude Code / Ollama / 自定义 API',
      mode: 'custom-agent',
      orbIdle: ['reasoning', 'default'],
      orbRun: ['working', 'gyro'],
      inLabel: '输入内容',
      outLabel: '输出结果',
      inType: 'prompt',
      outType: 'spec',
      showIn: true,
      showOut: true,
      defaultPrompt: '结合当前项目目录，给出清晰可落地的分析或实现建议。',
      stepTemplates: [
        { verb: '连接外部模型或 CLI', detail: '按配置协议建立本机命令行或接口连接' },
        { verb: '流式接收推理与正文', detail: '同步记录思考过程与返回正文' },
        { verb: '整理节点输出结果', detail: '写入右侧详情面板供查看与复制' },
      ],
      errorMessage: '外部模型调用失败，请在「设置 → Agent 与 API 接入」中检查配置。',
    },
    'summary-card': {
      kind: 'summary-card',
      roleCode: '总结框',
      provider: 'any',
      title: '画布卡片总结框',
      subtitle: '汇总最终结论并用直白语言复述核心内容',
      mode: 'agent-chat',
      orbIdle: ['reasoning', 'default'],
      orbRun: ['reasoning', 'twins'],
      inLabel: '上游结果',
      outLabel: '结论输出',
      inType: 'multi',
      outType: 'gate',
      showIn: true,
      showOut: true,
      defaultWidth: 368,
      defaultPrompt: '基于上游全部节点的输出，提炼清晰准确的最终结论，并用通俗易懂的口语化中文向我复述核心改动、关键发现与后续建议。',
      stepTemplates: [
        { verb: '汇总上游节点结论', detail: '收集所有接入上游节点的产出与对话执行记录' },
        { verb: '提炼最终核心结论', detail: '按选定模型提炼关键结果、改动影响与风险提示' },
        { verb: '生成复述内容并呈现', detail: '以清晰易读的要点直接展示在画布总结框卡片内' },
      ],
      errorMessage: '生成总结失败，请检查所选模型登录态或外部 API 配置后重试。',
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
      safeParams.unshift({ k: '模型', dynamic: 'nodeModel' });
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
      w: Number.isFinite(Number(obj.w)) ? clampNum(Math.round(Number(obj.w)), MIN_NODE_W, MAX_NODE_W) : (tpl.defaultWidth || NODE_WIDTH),
      h: Number.isFinite(Number(obj.h)) && Number(obj.h) > 0 ? clampNum(Math.round(Number(obj.h)), MIN_NODE_H, MAX_NODE_H) : null,
      status: sanitizeStatus(obj.status, VALID_NODE_STATUS, 'idle'),
      muted: Boolean(obj.muted),
      collapsed: Boolean(obj.collapsed),
      cotOpen: Boolean(obj.cotOpen),
      params: safeParams,
      toggles: safeToggles,
      steps: safeSteps,
      outputMd: typeof obj.outputMd === 'string' ? obj.outputMd : '',
      summarySource: typeof obj.summarySource === 'string' ? obj.summarySource : '',
      durationMs: Number.isFinite(Number(obj.durationMs)) ? Number(obj.durationMs) : 0,
    };
  }

  function makeClusterPreset() {
    return {
      nodes: [
        hydrateNode({
          id: 'n-plan',
          kind: 'gemini-plan',
          title: '需求分析与规划',
          subtitle: '拆分前后端改动清单与接口约定',
          x: 60,
          y: 230,
          params: [{ k: '模型', dynamic: 'nodeModel' }, { k: '方案策略', v: '多方案对比' }],
          toggles: [{ key: 'approval', label: '执行前人工确认', desc: '派发开发前允许编辑方案' }],
        }),
        hydrateNode({
          id: 'n-codex-fe',
          kind: 'codex-exec',
          title: '前端开发',
          subtitle: '实现页面组件、样式与交互逻辑',
          x: 460,
          y: -36,
          params: [{ k: '模型', dynamic: 'nodeModel' }, { k: '推理深度', dynamic: 'nodeEffort' }, { k: '工作分支', v: 'wt/frontend' }],
          toggles: [{ key: 'worktree', label: '独立分支隔离', desc: '在独立 Worktree 中修改' }],
        }),
        hydrateNode({
          id: 'n-codex-be',
          kind: 'codex-exec',
          title: '后端开发',
          subtitle: '实现接口逻辑、数据处理与单测',
          x: 460,
          y: 516,
          params: [{ k: '模型', dynamic: 'nodeModel' }, { k: '推理深度', dynamic: 'nodeEffort' }],
          toggles: [{ key: 'writable', label: '允许写入文件', desc: 'workspace-write' }],
        }),
        hydrateNode({
          id: 'n-merge',
          kind: 'cluster-merge',
          title: '结果汇总',
          subtitle: '合并前后端改动并核对接口一致',
          x: 860,
          y: 230,
          params: [{ k: '模型', dynamic: 'nodeModel' }, { k: '输入路数', dynamic: 'inCount' }],
          toggles: [{ key: 'autoNewDiff', label: '包含新建文件', desc: '一并纳入代码对比视图' }],
        }),
        hydrateNode({
          id: 'n-review',
          kind: 'codex-review',
          title: '代码审查',
          subtitle: '排查严重缺陷并核对改动风险',
          x: 1260,
          y: 230,
          params: [{ k: '模型', dynamic: 'nodeModel' }, { k: '推理深度', dynamic: 'nodeEffort' }, { k: '复审上限', dynamic: 'maxRounds' }],
        }),
        hydrateNode({
          id: 'n-summary',
          kind: 'summary-card',
          title: '画布卡片总结框',
          subtitle: '汇总最终结论并用直白语言复述核心内容',
          x: 1656,
          y: 196,
          w: 368,
          params: [{ k: '模型', dynamic: 'nodeModel' }, { k: '输入路数', dynamic: 'inCount' }],
        }),
      ],
      edges: [
        { id: 'e-1', source: 'n-plan', target: 'n-codex-fe' },
        { id: 'e-2', source: 'n-plan', target: 'n-codex-be' },
        { id: 'e-3', source: 'n-codex-fe', target: 'n-merge' },
        { id: 'e-4', source: 'n-codex-be', target: 'n-merge' },
        { id: 'e-5', source: 'n-merge', target: 'n-review' },
        { id: 'e-6', source: 'n-review', target: 'n-summary' },
      ],
      groups: [
        {
          id: 'grp-codex-workers',
          title: '并行开发组',
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
          title: '总任务拆解',
          subtitle: '拆分为前端与后端两条并行路线',
          x: 40,
          y: 310,
          params: [{ k: '模型', dynamic: 'nodeModel' }, { k: '并行组数', v: '2 组' }],
        }),
        hydrateNode({
          id: 'mc-fe-1',
          kind: 'codex-exec',
          title: '界面组件开发',
          subtitle: '构建页面布局与主题样式',
          x: 410,
          y: 16,
          params: [{ k: '模型', dynamic: 'nodeModel' }, { k: '工作分支', v: 'wt/ui' }],
        }),
        hydrateNode({
          id: 'mc-fe-2',
          kind: 'gemini-copy',
          title: '界面文案润色',
          subtitle: '打磨按钮、提示与空状态文案',
          x: 410,
          y: 230,
          params: [{ k: '模型', dynamic: 'nodeModel' }],
        }),
        hydrateNode({
          id: 'mc-be-1',
          kind: 'codex-exec',
          title: '接口与状态逻辑',
          subtitle: '实现核心业务接口与权限校验',
          x: 410,
          y: 444,
          params: [{ k: '模型', dynamic: 'nodeModel' }, { k: '工作分支', v: 'wt/api' }],
        }),
        hydrateNode({
          id: 'mc-be-2',
          kind: 'codex-exec',
          title: '回归测试编写',
          subtitle: '补充边界条件与端到端测试',
          x: 410,
          y: 658,
          params: [{ k: '模型', dynamic: 'nodeModel' }, { k: '工作分支', v: 'wt/test' }],
        }),
        hydrateNode({
          id: 'mc-merge-a',
          kind: 'cluster-merge',
          title: '前端结果汇总',
          subtitle: '对齐页面组件与定稿文案',
          x: 790,
          y: 120,
          params: [{ k: '模型', dynamic: 'nodeModel' }, { k: '输入路数', dynamic: 'inCount' }],
        }),
        hydrateNode({
          id: 'mc-merge-b',
          kind: 'cluster-merge',
          title: '后端结果汇总',
          subtitle: '汇总接口改动与测试结果',
          x: 790,
          y: 545,
          params: [{ k: '模型', dynamic: 'nodeModel' }, { k: '输入路数', dynamic: 'inCount' }],
        }),
        hydrateNode({
          id: 'mc-master',
          kind: 'cluster-merge',
          title: '最终汇总',
          subtitle: '合并前后端改动形成完整变更',
          x: 1170,
          y: 315,
          params: [{ k: '模型', dynamic: 'nodeModel' }, { k: '输入路数', dynamic: 'inCount' }],
        }),
        hydrateNode({
          id: 'mc-review',
          kind: 'codex-review',
          title: '最终代码审查',
          subtitle: '全面排查隐患并核验改动质量',
          x: 1540,
          y: 315,
          params: [{ k: '模型', dynamic: 'nodeModel' }, { k: '复审上限', dynamic: 'maxRounds' }],
        }),
        hydrateNode({
          id: 'mc-summary',
          kind: 'summary-card',
          title: '画布卡片总结框',
          subtitle: '汇总最终结论并用直白语言复述核心内容',
          x: 1930,
          y: 280,
          w: 368,
          params: [{ k: '模型', dynamic: 'nodeModel' }, { k: '输入路数', dynamic: 'inCount' }],
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
        { id: 'me-12', source: 'mc-review', target: 'mc-summary' },
      ],
      groups: [
        {
          id: 'grp-cluster-a',
          title: '前端任务组',
          accent: 'slate',
          nodeIds: ['mc-fe-1', 'mc-fe-2'],
          collapsed: false,
        },
        {
          id: 'grp-cluster-b',
          title: '后端与测试组',
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
          title: '① 需求分析与规划',
          subtitle: '先看懂任务和代码，列出要改的文件和步骤',
          x: 60,
          y: 168,
          params: [{ k: '模型', dynamic: 'nodeModel' }],
        }),
        hydrateNode({
          id: 'n-codex',
          kind: 'codex-exec',
          title: '② 代码实现',
          subtitle: '承接上一步方案，在安全沙箱内修改代码并自检',
          x: 420,
          y: 168,
          params: [{ k: '模型', dynamic: 'nodeModel' }, { k: '推理深度', dynamic: 'nodeEffort' }],
        }),
        hydrateNode({
          id: 'n-review',
          kind: 'codex-review',
          title: '③ 代码审查',
          subtitle: '只读检查明显 Bug、边界问题和高风险改动',
          x: 780,
          y: 168,
          params: [{ k: '模型', dynamic: 'nodeModel' }],
        }),
        hydrateNode({
          id: 'n-summary',
          kind: 'summary-card',
          title: '④ 画布卡片总结框',
          subtitle: '提炼最终结论，并用通俗的话把结果复述给你',
          x: 1140,
          y: 120,
          w: 376,
          params: [{ k: '模型', dynamic: 'nodeModel' }],
        }),
      ],
      edges: [
        { id: 'e-lin-1', source: 'n-plan', target: 'n-codex' },
        { id: 'e-lin-2', source: 'n-codex', target: 'n-review' },
        { id: 'e-lin-3', source: 'n-review', target: 'n-summary' },
      ],
      groups: [],
    };
  }

  function makeBlankPreset() {
    return {
      nodes: [
        hydrateNode({
          id: 'n-root-1',
          kind: 'gemini-plan',
          title: '起始节点 · 需求规划',
          subtitle: '双击或右键空白画布可随时新建更多节点',
          x: 200,
          y: 200,
          params: [{ k: '模型', dynamic: 'nodeModel' }],
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
    const topic = taskPrompt || '当前流程预演';
    const upStr = upstreamTitles.length ? upstreamTitles.join('、') : '用户输入任务';
    const notice = '> **流程预演说明**：此处仅演示节点依赖关系与执行顺序，尚未调用本机 CLI 或修改工作区文件。如需真实执行，请点击下方「真实执行」按钮。';
    if (failed) {
      return `## ${node.title} · 预演拦截示意\n\n${notice}\n\n- **配置模型**：\`${modelLabel}\`\n- **上游输入**：${upStr}\n- **拦截说明**：模拟命中严重风险项并暂停流转，可取消顶部「预演拦截」后重新演示。`;
    }
    if (node.kind === 'gemini-plan') {
      return `## ${node.title} · 预演输出\n\n${notice}\n\n- **配置模型**：\`${modelLabel}\`\n- **任务目标**：${topic}\n- **阶段职责**：${node.prompt}`;
    }
    if (node.kind === 'codex-exec') {
      return `## ${node.title} · 预演输出\n\n${notice}\n\n- **配置模型**：\`${modelLabel}\`\n- **承接上游**：${upStr}\n- **阶段职责**：${node.prompt}`;
    }
    if (node.kind === 'cluster-merge') {
      return `## ${node.title} · 预演输出\n\n${notice}\n\n- **汇总方式**：\`${modelLabel}\`\n- **汇入上游**：共 **${upstreamTitles.length || 1} 路**（${upStr}）\n- **阶段职责**：核对上游各路接口一致性并整理统一改动。`;
    }
    if (node.kind === 'codex-review') {
      return `## ${node.title} · 预演输出\n\n${notice}\n\n- **审查模型**：\`${modelLabel}\`\n- **承接上游**：${upStr}\n- **阶段职责**：只读排查高风险隐患并输出审查结论。`;
    }
    if (node.kind === 'summary-card') {
      return `### 最终结论（流程预演）\n\n已汇合 **${upStr}** 的全部上游步骤，流程依赖清晰完整。\n\n### 给你的复述要点\n- **目标范围**：${topic}\n- **总结模型**：\`${modelLabel}\`（可随时点击卡片上方模型自由切换）\n- **下一步**：点击本卡片下方 **「生成总结」**，即可直接调用选定模型汇总真实内容并在这里复述。`;
    }
    return `## ${node.title} · 预演输出\n\n${notice}\n\n- **配置模型**：\`${modelLabel}\`\n- **处理内容**：${topic}`;
  }

  function createInfiniteCanvas(opts) {
    const {
      viewportEl,
      stageEl,
      modeSwitchEl,
      worldEl,
      framesLayerEl,
      edgesSvgEl,
      nodesLayerEl,
      minimapCanvasEl,
      contextMenuEl,
      marqueeBoxEl,
      selectionBarEl,
      resultDrawerEl,
      resultBodyEl,
      resultTabsEl,
      zoomLabelEl,
      statusBarEl,
      commandInputEl,
      libraryBtnEl,
      libraryPopoverEl,
      activeNameEl,
      saveStateEl,
      addMenuBtnEl,
      addMenuPopoverEl,
      runLiveBtnEl,
      runLiveLabelEl,
      liveSteerBarEl,
      pauseLiveBtnEl,
      dropOverlayEl,
      renderMarkdown,
      getContext,
      onToggleSync,
      onDispatchRealCli,
      onOpenProviderHub,
      onRunProviderNode,
      onRunCanvasNode,
      onLoadWorkflows,
      onSaveDraft,
      onSaveNamedWorkflow,
      onRenameWorkflow,
      onDeleteWorkflow,
      onPresetChange,
      onStatusChange,
      onToast,
    } = opts;

    let initialCanvasMode = 'simple';
    try {
      if (localStorage.getItem(CANVAS_MODE_STORAGE_KEY) === 'pro') initialCanvasMode = 'pro';
    } catch {}

    const state = {
      canvasMode: initialCanvasMode,
      graph: makeLinearPreset(),
      history: [],
      selectedId: 'n-plan',
      selectedIds: new Set(['n-plan']),
      selectedEdgeId: null,
      pendingWire: null,
      panX: 48,
      panY: 42,
      zoom: 0.84,
      seq: 30,
      failLast: false,
      demoRunning: false,
      demoToken: 0,
      liveAbortController: null,
      activeRunPrompt: '',
      goalAmendmentNote: '',
      pauseRequested: false,
      pausedCheckpoint: null,
      liveStepInfo: null,
      spaceDown: false,
      lastTaskPrompt: '',
      lastClusterReportMd: '',
      activeWorkflowId: null,
      activeWorkflowName: '标准四步流程',
      savedWorkflows: [],
      saveStatus: 'saved',
      lastSavedAt: '',
      restoredViewport: false,
      libraryOpen: false,
      addMenuOpen: false,
      drawerOpen: false,
      drawerTab: 'summary',
      stepDetailOpen: new Set(),
      statusMsg: DEFAULT_GUIDE_TEXT,
      panning: null,
      marquee: null,
      dragging: null,
      draggingGroup: null,
      resizing: null,
      wiring: null,
      extraToggles: { autoNewDiff: true, humanReport: true },
      ctxMenu: { open: false, kind: 'menu', worldX: 200, worldY: 200, nodeId: null, groupId: null },
    };

    const nodeEls = new Map();
    const OVERLAY_SEL = '.ic-hud-panel, .ic-floating-bar, .ic-minimap-card, .ic-ctx-menu, .ic-wf-popover, .ic-add-popover, .ic-result-drawer, .ic-cmd-bar, .ic-bottom-stack, .ic-selection-bar';
    let autoSaveTimer = null;
    let suppressAutoSave = false;

    function syncSelectionClasses() {
      const multi = state.selectedIds.size > 1;
      nodesLayerEl.querySelectorAll('.ic-node-wrap').forEach((w) => {
        const nid = w.dataset.nodeId;
        const isSel = state.selectedIds.has(nid);
        w.classList.toggle('is-selected', isSel);
        w.classList.toggle('is-multi-selected', isSel && multi);
        w.querySelector('.agent-node')?.classList.toggle('is-selected', isSel);
      });
    }

    function getSelectedNodes() {
      const validIds = new Set(state.graph.nodes.map((n) => n.id));
      Array.from(state.selectedIds).forEach((id) => {
        if (!validIds.has(id)) state.selectedIds.delete(id);
      });
      return state.graph.nodes.filter((n) => state.selectedIds.has(n.id));
    }

    function syncSelectionBar() {
      if (!selectionBarEl) return;
      const selNodes = getSelectedNodes();
      if (selNodes.length < 2) {
        selectionBarEl.classList.add('hidden');
        selectionBarEl.innerHTML = '';
        return;
      }
      const allMuted = selNodes.every((n) => n.muted);
      selectionBarEl.classList.remove('hidden');
      selectionBarEl.innerHTML = `
        <span class="ic-sel-count mono-xs">已选 ${selNodes.length} 个节点</span>
        <button type="button" class="ic-sel-btn is-primary" data-sel-act="group" title="将所选节点合并为一个分组框 (Ctrl+G)">合并成组</button>
        <button type="button" class="ic-sel-btn" data-sel-act="run" title="按拓扑顺序运行当前选中的节点">运行所选</button>
        <span class="ic-sel-sep" aria-hidden="true"></span>
        <button type="button" class="ic-sel-btn" data-sel-act="align-top" title="顶部水平对齐所选节点">顶对齐</button>
        <button type="button" class="ic-sel-btn" data-sel-act="align-left" title="左侧垂直对齐所选节点">左对齐</button>
        <button type="button" class="ic-sel-btn" data-sel-act="dup" title="批量复制所选节点与内部连线 (Ctrl+D)">复制</button>
        <button type="button" class="ic-sel-btn" data-sel-act="mute" title="批量跳过或恢复所选节点 (M)">${allMuted ? '恢复' : '跳过'}</button>
        <button type="button" class="ic-sel-btn is-danger" data-sel-act="del" title="批量删除所选节点 (Del)">删除</button>
        <button type="button" class="ic-sel-btn" data-sel-act="clear" title="取消多选 (Esc)">✕</button>`;

      selectionBarEl.querySelectorAll('[data-sel-act]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const act = btn.dataset.selAct;
          if (act === 'group') createNodeGroup();
          else if (act === 'run') runSelectedNodes();
          else if (act === 'align-top') alignSelectedNodes('top');
          else if (act === 'align-left') alignSelectedNodes('left');
          else if (act === 'dup') duplicateSelectedNodes();
          else if (act === 'mute') toggleMuteSelectedNodes();
          else if (act === 'del') removeSelectedNodes();
          else if (act === 'clear') clearSelection();
        });
      });
    }

    function setSelection(ids, primaryId = null, { updateDrawer = true } = {}) {
      const validIds = new Set(state.graph.nodes.map((n) => n.id));
      const clean = Array.from(ids || []).filter((id) => validIds.has(id));
      state.selectedIds = new Set(clean);
      if (primaryId && state.selectedIds.has(primaryId)) {
        state.selectedId = primaryId;
      } else {
        state.selectedId = clean[clean.length - 1] || '';
      }
      syncSelectionClasses();
      syncSelectionBar();
      if (updateDrawer && state.drawerOpen && state.drawerTab === 'node') renderResultDrawer();
    }

    function toggleNodeSelection(nid) {
      if (!state.graph.nodes.some((n) => n.id === nid)) return;
      const next = new Set(state.selectedIds);
      let primary = state.selectedId;
      if (next.has(nid)) {
        next.delete(nid);
        if (primary === nid) primary = Array.from(next)[next.length - 1] || '';
      } else {
        next.add(nid);
        primary = nid;
      }
      setSelection(next, primary);
    }

    function clearSelection() {
      if (state.selectedIds.size === 0 && !state.selectedId) return;
      state.selectedIds = new Set();
      state.selectedId = '';
      syncSelectionClasses();
      syncSelectionBar();
    }

    function selectAllNodes() {
      const visibleIds = state.graph.nodes
        .filter((n) => !getCollapsedGroupForNode(n.id))
        .map((n) => n.id);
      if (visibleIds.length === 0) return;
      setSelection(visibleIds, visibleIds[0]);
      setStatus(`已全选 ${visibleIds.length} 个节点（可整体拖动、按 Ctrl+G 合并成组，或右键打开快捷面板）。`);
    }

    function setStatus(msg) {
      state.statusMsg = msg;
      if (statusBarEl) statusBarEl.textContent = msg;
    }

    function pushHistory() {
      state.history.push(cloneGraph(state.graph));
      if (state.history.length > 30) state.history.shift();
    }

    function syncRunButtonUi() {
      if (runLiveBtnEl) {
        const running = Boolean(state.demoRunning);
        runLiveBtnEl.classList.toggle('is-stop', running);
        runLiveBtnEl.title = running
          ? '点击立即中途打断当前运行（已完成步骤的结果会自动保留，可修改目标后从断点继续）'
          : '在画布中按连线顺序逐步调用各节点选定的模型运行';
        const ico = runLiveBtnEl.querySelector('.ic-run-ico');
        if (ico) {
          ico.innerHTML = running
            ? '<rect x="5" y="5" width="14" height="14" rx="2" />'
            : '<path d="M7 4.5v15l12-7.5Z" />';
        }
        if (runLiveLabelEl) {
          runLiveLabelEl.textContent = running
            ? '中途打断'
            : (state.pausedCheckpoint ? '继续运行' : '运行工作流');
        }
      }
      if (pauseLiveBtnEl) {
        const showPause = Boolean(state.demoRunning && state.liveStepInfo && state.liveStepInfo.totalWaves > 1);
        pauseLiveBtnEl.classList.toggle('hidden', !showPause);
        pauseLiveBtnEl.classList.toggle('is-armed', Boolean(state.pauseRequested));
        pauseLiveBtnEl.textContent = state.pauseRequested ? '已预约暂停' : '暂停下步';
      }
      syncLiveSteerBar();
    }

    function hasModifiedGoalWhileRunning(candidateText = '') {
      if (!state.demoRunning) return false;
      const cur = String(candidateText || commandInputEl?.value || '').trim();
      return Boolean(cur && state.activeRunPrompt && cur !== state.activeRunPrompt);
    }

    function syncLiveSteerBar() {
      if (!liveSteerBarEl) return;
      const draftPrompt = String(commandInputEl?.value || state.lastTaskPrompt || '').trim();

      if (state.demoRunning) {
        const info = state.liveStepInfo;
        const stepTag = info
          ? `第 ${info.currentWaveIndex + 1}/${info.totalWaves} 步 · ${info.activeTitles}`
          : '节点运行中';
        const modified = hasModifiedGoalWhileRunning(draftPrompt);

        liveSteerBarEl.classList.remove('hidden', 'is-paused');
        liveSteerBarEl.innerHTML = `
          <div class="ic-live-steer-copy">
            <span class="steer-live-dot" aria-hidden="true"></span>
            <span class="ic-live-steer-text">${
              modified
                ? `运行中目标已修改（${escapeHtml(stepTag)}）`
                : state.pauseRequested
                  ? `已预约暂停：${escapeHtml(stepTag)} 完成后暂停等待你调整`
                  : `运行中 · ${escapeHtml(stepTag)} · 可随时在下方修改目标`
            }</span>
          </div>
          <div class="ic-live-steer-btns">
            ${
              modified
                ? `<button type="button" class="ic-steer-pill" data-wf-steer="next" title="不打断当前正在跑的节点，当前步完成后所有下游节点自动按新目标执行">下步生效</button>
                   <button type="button" class="ic-steer-pill is-primary" data-wf-steer="interrupt" title="立刻打断当前正在跑的节点，保留上游已完成结果，用新目标重跑当前步">打断重跑当前步</button>`
                : ''
            }
          </div>`;

        liveSteerBarEl.querySelectorAll('[data-wf-steer]').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            steerCanvasGoal(btn.dataset.wfSteer, draftPrompt);
          });
        });
        return;
      }

      if (state.pausedCheckpoint) {
        const cp = state.pausedCheckpoint;
        const label = cp.reason === 'interrupted' ? '已中途打断' : '已中途暂停';
        liveSteerBarEl.classList.remove('hidden');
        liveSteerBarEl.classList.add('is-paused');
        liveSteerBarEl.innerHTML = `
          <div class="ic-live-steer-copy">
            <span class="ic-live-steer-text">${escapeHtml(label)} · 停在第 ${cp.waveIndex + 1}/${cp.totalWaves} 步（上游结果已保留，改完目标/提示词/模型后可直接续跑）</span>
          </div>
          <div class="ic-live-steer-btns">
            <button type="button" class="ic-steer-pill is-primary" data-wf-cp="resume">从断点继续</button>
            <button type="button" class="ic-steer-pill" data-wf-cp="restart">从头重跑</button>
            <button type="button" class="ic-steer-pill" data-wf-cp="clear">关闭</button>
          </div>`;

        liveSteerBarEl.querySelector('[data-wf-cp="resume"]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          resumeFromCheckpoint();
        });
        liveSteerBarEl.querySelector('[data-wf-cp="restart"]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          state.pausedCheckpoint = null;
          runWorkflowLive(String(commandInputEl?.value || state.lastTaskPrompt || '').trim(), { forceRestart: true });
        });
        liveSteerBarEl.querySelector('[data-wf-cp="clear"]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          state.pausedCheckpoint = null;
          syncRunButtonUi();
        });
        return;
      }

      liveSteerBarEl.classList.add('hidden');
      liveSteerBarEl.classList.remove('is-paused');
      liveSteerBarEl.innerHTML = '';
    }

    function cancelActiveDemo(clearReport = false) {
      state.demoToken += 1;
      if (state.liveAbortController) {
        try { state.liveAbortController.abort(); } catch {}
        state.liveAbortController = null;
      }
      state.demoRunning = false;
      state.pauseRequested = false;
      state.liveStepInfo = null;
      if (clearReport) {
        state.lastClusterReportMd = '';
        state.pausedCheckpoint = null;
        state.goalAmendmentNote = '';
      }
      syncRunButtonUi();
    }

    function formatShortTime(iso) {
      if (!iso) return '';
      try {
        return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
      } catch {
        return '';
      }
    }

    function updateWorkflowHeaderHud() {
      if (activeNameEl) {
        activeNameEl.textContent = state.activeWorkflowName || '未命名工作流';
      }
      if (saveStateEl) {
        saveStateEl.classList.remove('is-saved', 'is-dirty');
        if (state.saveStatus === 'saving') {
          saveStateEl.textContent = '保存中...';
          saveStateEl.classList.add('is-dirty');
        } else if (state.saveStatus === 'dirty') {
          saveStateEl.textContent = '待保存';
          saveStateEl.classList.add('is-dirty');
        } else if (state.saveStatus === 'error') {
          saveStateEl.textContent = '仅本地保存';
          saveStateEl.classList.add('is-dirty');
        } else {
          const t = formatShortTime(state.lastSavedAt);
          saveStateEl.textContent = t ? `已保存 ${t}` : '自动保存';
          saveStateEl.classList.add('is-saved');
        }
      }
    }

    function serializeGraphForSave() {
      return {
        nodes: (state.graph.nodes || []).map((n) => ({
          id: n.id,
          kind: n.kind,
          title: n.title,
          subtitle: n.subtitle,
          prompt: n.prompt,
          model: n.model || '',
          effort: n.effort || '',
          x: Math.round(n.x),
          y: Math.round(n.y),
          w: nodeWidth(n),
          h: nodeHeight(n),
          status: n.status === 'running' ? 'idle' : sanitizeStatus(n.status, VALID_NODE_STATUS, 'idle'),
          muted: Boolean(n.muted),
          collapsed: Boolean(n.collapsed),
          cotOpen: false,
          params: Array.isArray(n.params) ? n.params : [],
          toggles: Array.isArray(n.toggles) ? n.toggles : [],
          outputMd: typeof n.outputMd === 'string' ? n.outputMd : '',
          summarySource: typeof n.summarySource === 'string' ? n.summarySource : '',
          durationMs: Number.isFinite(Number(n.durationMs)) ? Number(n.durationMs) : 0,
        })),
        edges: (state.graph.edges || []).map((e) => ({ id: e.id, source: e.source, target: e.target })),
        groups: (state.graph.groups || []).map((g) => ({
          id: g.id,
          title: g.title,
          accent: g.accent || 'sage',
          nodeIds: Array.isArray(g.nodeIds) ? [...g.nodeIds] : [],
          collapsed: Boolean(g.collapsed),
        })),
      };
    }

    function buildDraftSnapshot() {
      return {
        schema: 'tenon-workflow/v1',
        name: state.activeWorkflowName || '未命名工作流',
        activeWorkflowId: state.activeWorkflowId || null,
        graph: serializeGraphForSave(),
        viewport: {
          panX: Math.round(state.panX * 100) / 100,
          panY: Math.round(state.panY * 100) / 100,
          zoom: Math.round(state.zoom * 1000) / 1000,
        },
        lastTaskPrompt: state.lastTaskPrompt || '',
        lastClusterReportMd: state.lastClusterReportMd || '',
        updatedAt: new Date().toISOString(),
      };
    }

    function saveDraftLocal(snapshot) {
      try {
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(snapshot));
      } catch {
        // Storage quota fallback — disk API still persists
      }
    }

    function persistDraftNow(keepalive = false) {
      if (suppressAutoSave) return;
      const snap = buildDraftSnapshot();
      saveDraftLocal(snap);
      if (!onSaveDraft) {
        state.saveStatus = 'saved';
        state.lastSavedAt = snap.updatedAt;
        updateWorkflowHeaderHud();
        return;
      }
      state.saveStatus = 'saving';
      updateWorkflowHeaderHud();
      onSaveDraft(snap, { keepalive })
        .then((res) => {
          state.saveStatus = 'saved';
          state.lastSavedAt = res?.updatedAt || snap.updatedAt;
          updateWorkflowHeaderHud();
        })
        .catch(() => {
          state.saveStatus = 'error';
          updateWorkflowHeaderHud();
        });
    }

    function scheduleAutoSave(delayMs = 450) {
      if (suppressAutoSave) return;
      const snap = buildDraftSnapshot();
      saveDraftLocal(snap);
      state.saveStatus = 'dirty';
      updateWorkflowHeaderHud();
      if (autoSaveTimer) clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(() => {
        autoSaveTimer = null;
        persistDraftNow(false);
      }, delayMs);
    }

    function flushDraft(keepalive = false) {
      if (autoSaveTimer) {
        clearTimeout(autoSaveTimer);
        autoSaveTimer = null;
      }
      persistDraftNow(keepalive);
    }

    function parseAndSanitizeRawGraph(rawGraph) {
      if (!rawGraph || !Array.isArray(rawGraph.nodes) || rawGraph.nodes.length === 0) return null;
      const hydratedNodes = rawGraph.nodes
        .filter((n) => n && typeof n === 'object')
        .map((n) => {
          const hn = hydrateNode(n);
          if (hn.status === 'running') hn.status = 'idle';
          return hn;
        });
      if (hydratedNodes.length === 0) return null;
      const idSet = new Set(hydratedNodes.map((n) => n.id));
      const safeEdges = Array.isArray(rawGraph.edges)
        ? rawGraph.edges
            .filter((e) => e && typeof e === 'object' && idSet.has(e.source) && idSet.has(e.target) && e.source !== e.target)
            .map((e, idx) => ({ id: typeof e.id === 'string' && e.id ? e.id : `e-load-${idx + 1}`, source: e.source, target: e.target }))
        : [];
      const validAccents = new Set(GROUP_ACCENTS);
      const safeGroups = Array.isArray(rawGraph.groups)
        ? rawGraph.groups
            .filter((g) => g && typeof g === 'object' && Array.isArray(g.nodeIds))
            .map((g, idx) => ({
              id: typeof g.id === 'string' && g.id ? g.id : `grp-load-${idx + 1}`,
              title: typeof g.title === 'string' && g.title.trim() ? g.title.trim() : `节点组 #${idx + 1}`,
              accent: validAccents.has(g.accent) ? g.accent : 'sage',
              nodeIds: Array.from(new Set(g.nodeIds.filter((nid) => idSet.has(nid)))),
              collapsed: Boolean(g.collapsed),
            }))
            .filter((g) => g.nodeIds.length > 0)
        : [];
      return { nodes: hydratedNodes, edges: safeEdges, groups: safeGroups };
    }

    function applyLoadedSnapshot(snap, { recordHistory = false, triggerSave = false, animateFit = false } = {}) {
      const cleanGraph = parseAndSanitizeRawGraph(snap?.graph || snap);
      if (!cleanGraph) return false;
      cancelActiveDemo(false);
      if (recordHistory) pushHistory();
      const prevSup = suppressAutoSave;
      suppressAutoSave = !triggerSave;
      state.graph = cleanGraph;
      state.seq = Math.max(state.seq, maxNumericSuffix(state.graph) + 1);
      const firstId = state.graph.nodes[0]?.id || '';
      state.selectedId = firstId;
      state.selectedIds = firstId ? new Set([firstId]) : new Set();
      state.selectedEdgeId = null;
      state.pendingWire = null;
      if (typeof snap?.name === 'string' && snap.name.trim()) {
        state.activeWorkflowName = snap.name.trim();
      }
      if (snap && Object.prototype.hasOwnProperty.call(snap, 'activeWorkflowId')) {
        state.activeWorkflowId = snap.activeWorkflowId || null;
      }
      if (typeof snap?.lastTaskPrompt === 'string') {
        state.lastTaskPrompt = snap.lastTaskPrompt;
        if (commandInputEl) commandInputEl.value = snap.lastTaskPrompt;
      }
      if (typeof snap?.lastClusterReportMd === 'string') {
        state.lastClusterReportMd = snap.lastClusterReportMd;
      }
      if (snap?.viewport && Number.isFinite(Number(snap.viewport.panX)) && Number.isFinite(Number(snap.viewport.panY)) && Number.isFinite(Number(snap.viewport.zoom))) {
        state.panX = Number(snap.viewport.panX);
        state.panY = Number(snap.viewport.panY);
        state.zoom = clampNum(Number(snap.viewport.zoom), MIN_ZOOM, MAX_ZOOM);
        state.restoredViewport = true;
      } else {
        state.restoredViewport = false;
      }
      if (snap?.updatedAt) {
        state.lastSavedAt = snap.updatedAt;
        state.saveStatus = 'saved';
      }
      renderAll();
      if (!state.restoredViewport) {
        requestAnimationFrame(() => fitView(animateFit));
      }
      updateWorkflowHeaderHud();
      suppressAutoSave = prevSup;
      if (triggerSave) scheduleAutoSave(200);
      return true;
    }

    function restoreFromLocalSync() {
      try {
        const raw = JSON.parse(localStorage.getItem(DRAFT_STORAGE_KEY) || 'null');
        if (raw && raw.graph && Array.isArray(raw.graph.nodes) && raw.graph.nodes.length > 0) {
          applyLoadedSnapshot(raw, { recordHistory: false, triggerSave: false });
          return raw.updatedAt || '';
        }
      } catch {
        // Ignore corrupted local cache
      }
      return '';
    }

    async function syncFromServerAsync(localUpdatedAt = '') {
      if (!onLoadWorkflows) return;
      try {
        const data = await onLoadWorkflows();
        if (Array.isArray(data?.workflows)) {
          state.savedWorkflows = data.workflows;
        }
        const diskDraft = data?.draft;
        const diskTs = diskDraft?.updatedAt ? Date.parse(diskDraft.updatedAt) : 0;
        const localTs = localUpdatedAt ? Date.parse(localUpdatedAt) : 0;
        if (diskDraft && diskDraft.graph && (!localTs || diskTs >= localTs)) {
          applyLoadedSnapshot(diskDraft, { recordHistory: false, triggerSave: false });
          saveDraftLocal(buildDraftSnapshot());
        } else if (!diskDraft && localUpdatedAt) {
          // Migrate existing local draft onto disk cleanly
          persistDraftNow(false);
        }
        if (state.libraryOpen) renderLibraryPopover();
        updateWorkflowHeaderHud();
      } catch {
        // Keep local draft silently if offline
      }
    }

    function closeLibraryPopover() {
      state.libraryOpen = false;
      if (libraryPopoverEl) libraryPopoverEl.classList.add('hidden');
      if (libraryBtnEl) libraryBtnEl.setAttribute('aria-expanded', 'false');
    }

    function closeAddMenuPopover() {
      state.addMenuOpen = false;
      if (addMenuPopoverEl) addMenuPopoverEl.classList.add('hidden');
      if (addMenuBtnEl) addMenuBtnEl.setAttribute('aria-expanded', 'false');
    }

    function closeAllCanvasPopovers() {
      closeContextMenu();
      closeLibraryPopover();
      closeAddMenuPopover();
    }

    function renderLibraryPopover(focusNameInput = false) {
      if (!libraryPopoverEl) return;
      const list = state.savedWorkflows || [];
      const activeId = state.activeWorkflowId;
      const suggestedName = activeId
        ? state.activeWorkflowName
        : (state.activeWorkflowName && state.activeWorkflowName !== '标准四步流程' ? state.activeWorkflowName : '');

      const savedRowsHtml = list.length > 0
        ? list.map((wf) => {
            const isAct = wf.id === activeId;
            const timeTxt = formatShortTime(wf.updatedAt);
            return `
              <div class="ic-wf-item ${isAct ? 'is-active' : ''}" data-wf-row="${escapeHtml(wf.id)}">
                <button type="button" class="ic-wf-item-main" data-wf-load="${escapeHtml(wf.id)}" title="点击载入工作流「${escapeHtml(wf.name)}」">
                  <span class="ic-wf-item-name">${escapeHtml(wf.name)}</span>
                  <span class="ic-wf-item-meta mono-xs">${wf.nodeCount || wf.graph?.nodes?.length || 0} 节点 · ${wf.edgeCount || wf.graph?.edges?.length || 0} 连线${timeTxt ? ` · ${timeTxt}` : ''}</span>
                </button>
                <div class="ic-wf-item-acts">
                  <button type="button" class="ic-wf-mini-btn" data-wf-rename="${escapeHtml(wf.id)}" title="重命名">改名</button>
                  <button type="button" class="ic-wf-mini-btn is-danger" data-wf-del="${escapeHtml(wf.id)}" title="删除此工作流">删</button>
                </div>
              </div>`;
          }).join('')
        : '<div class="ic-pop-empty">暂无命名保存的工作流。<br/>当前画布每次修改都会自动保存草稿，在上方输入名称可另存到列表。</div>';

      const tplRowsHtml = BUILTIN_TEMPLATES.map((t) => `
        <button type="button" class="ic-add-card-btn" data-wf-tpl="${escapeHtml(t.id)}">
          <span class="ic-add-card-top">
            <span class="ic-add-card-title">${escapeHtml(t.name)}</span>
            <span class="ic-add-card-tag mono-xs">模板</span>
          </span>
          <span class="ic-add-card-desc">${escapeHtml(t.desc)}</span>
        </button>`).join('');

      libraryPopoverEl.innerHTML = `
        <div class="ic-pop-head">
          <span class="ic-pop-title">工作流保存与管理（类似 ComfyUI）</span>
          <button type="button" class="ic-wf-mini-btn" id="btnWfLibClose">关闭</button>
        </div>
        <div class="ic-pop-body">
          <div>
            <div class="ic-pop-sec-label mono-xs"><span>保存当前画布到工作流库</span><span>Ctrl+S</span></div>
            <div class="ic-pop-save-row">
              <input type="text" class="text-input" id="wfSaveNameInput" placeholder="输入工作流名称，如：前端重构流水线" value="${escapeHtml(suggestedName)}" autocomplete="off" />
              <button type="button" class="btn-primary-sm wf-btn" id="btnWfSaveSubmit">保存</button>
            </div>
          </div>

          <div>
            <div class="ic-pop-sec-label mono-xs"><span>我的已保存工作流（磁盘持久保存）</span><span>${list.length}</span></div>
            <div class="ic-pop-list">${savedRowsHtml}</div>
          </div>

          <div>
            <div class="ic-pop-sec-label mono-xs"><span>文件导出与导入</span><span>.json</span></div>
            <div class="ic-pop-io-grid">
              <button type="button" class="ic-pop-io-btn" id="btnWfPopExport">导出 .json 文件</button>
              <button type="button" class="ic-pop-io-btn" id="btnWfPopImport">导入 .json 文件</button>
            </div>
            <div class="ic-wf-item-meta" style="margin-top:5px">提示：也可直接把 .json 工作流文件拖放到画布中导入</div>
          </div>

          <div>
            <div class="ic-pop-sec-label mono-xs"><span>快速切换内置模板</span><span>${BUILTIN_TEMPLATES.length}</span></div>
            <div class="ic-pop-list">${tplRowsHtml}</div>
          </div>
        </div>`;

      libraryPopoverEl.querySelector('#btnWfLibClose')?.addEventListener('click', (e) => {
        e.stopPropagation();
        closeLibraryPopover();
      });

      const doSave = async () => {
        const inp = libraryPopoverEl.querySelector('#wfSaveNameInput');
        const name = (inp?.value || '').trim();
        if (!name) {
          if (onToast) onToast('请先输入一个工作流名称');
          inp?.focus();
          return;
        }
        const overwriteCurrent = Boolean(state.activeWorkflowId && name === state.activeWorkflowName);
        await saveNamedWorkflow(name, { overwriteCurrent });
      };

      libraryPopoverEl.querySelector('#btnWfSaveSubmit')?.addEventListener('click', (e) => {
        e.stopPropagation();
        doSave();
      });
      const nameInp = libraryPopoverEl.querySelector('#wfSaveNameInput');
      if (nameInp) {
        nameInp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.isComposing) {
            e.preventDefault();
            doSave();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            closeLibraryPopover();
          }
        });
        if (focusNameInput) setTimeout(() => { nameInp.focus(); nameInp.select(); }, 15);
      }

      libraryPopoverEl.querySelectorAll('[data-wf-load]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          loadSavedWorkflow(btn.dataset.wfLoad);
          closeLibraryPopover();
        });
      });

      libraryPopoverEl.querySelectorAll('[data-wf-rename]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const wf = state.savedWorkflows.find((x) => x.id === btn.dataset.wfRename);
          if (!wf) return;
          const row = btn.closest('.ic-wf-item');
          if (!row) return;
          row.innerHTML = `
            <div class="ic-pop-save-row" style="width:100%">
              <input type="text" class="text-input" data-wf-rename-inp value="${escapeHtml(wf.name)}" />
              <button type="button" class="btn-primary-sm wf-btn" data-wf-rename-ok>确定</button>
            </div>`;
          const rInp = row.querySelector('[data-wf-rename-inp]');
          const submitRename = async () => {
            const nextName = (rInp?.value || '').trim();
            if (!nextName) return;
            await renameSavedWorkflow(wf.id, nextName);
          };
          row.querySelector('[data-wf-rename-ok]')?.addEventListener('click', (ev) => {
            ev.stopPropagation();
            submitRename();
          });
          rInp?.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); submitRename(); }
            else if (ev.key === 'Escape') { ev.preventDefault(); renderLibraryPopover(); }
          });
          setTimeout(() => { rInp?.focus(); rInp?.select(); }, 10);
        });
      });

      libraryPopoverEl.querySelectorAll('[data-wf-del]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteSavedWorkflow(btn.dataset.wfDel);
        });
      });

      libraryPopoverEl.querySelector('#btnWfPopExport')?.addEventListener('click', (e) => {
        e.stopPropagation();
        exportWorkflowFile();
        closeLibraryPopover();
      });
      libraryPopoverEl.querySelector('#btnWfPopImport')?.addEventListener('click', (e) => {
        e.stopPropagation();
        closeLibraryPopover();
        document.getElementById('inputWfImportFile')?.click();
      });

      libraryPopoverEl.querySelectorAll('[data-wf-tpl]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          loadPreset(btn.dataset.wfTpl);
          closeLibraryPopover();
        });
      });
    }

    function openLibraryPopover(focusNameInput = false) {
      if (!libraryPopoverEl) return;
      closeContextMenu();
      closeAddMenuPopover();
      state.libraryOpen = true;
      renderLibraryPopover(focusNameInput);
      libraryPopoverEl.classList.remove('hidden');
      if (libraryBtnEl) libraryBtnEl.setAttribute('aria-expanded', 'true');
    }

    function renderAddMenuPopover() {
      if (!addMenuPopoverEl) return;
      addMenuPopoverEl.innerHTML = `
        <div class="ic-pop-head">
          <span class="ic-pop-title">选择要添加的节点</span>
          <span class="mono-xs" style="color:var(--ink-muted)">也可右键画布新建</span>
        </div>
        <div class="ic-pop-body">
          <div class="ic-pop-list">
            ${ADD_NODE_MENU_ITEMS.map((item) => `
              <button type="button" class="ic-add-card-btn ${item.highlight ? 'is-highlight' : ''}" data-add-menu-kind="${escapeHtml(item.kind)}">
                <span class="ic-add-card-top">
                  <span class="ic-add-card-title">${escapeHtml(item.title)}</span>
                  <span class="ic-add-card-tag mono-xs">${escapeHtml(item.tag)}</span>
                </span>
                <span class="ic-add-card-desc">${escapeHtml(item.desc)}</span>
              </button>`).join('')}
          </div>
        </div>`;

      addMenuPopoverEl.querySelectorAll('[data-add-menu-kind]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const kind = btn.dataset.addMenuKind;
          closeAddMenuPopover();
          if (kind === '__group__') createNodeGroup();
          else addNode(kind);
        });
      });
    }

    function openAddMenuPopover() {
      if (!addMenuPopoverEl) return;
      closeContextMenu();
      closeLibraryPopover();
      state.addMenuOpen = true;
      renderAddMenuPopover();
      addMenuPopoverEl.classList.remove('hidden');
      if (addMenuBtnEl) addMenuBtnEl.setAttribute('aria-expanded', 'true');
    }

    async function saveNamedWorkflow(name, { overwriteCurrent = false } = {}) {
      const cleanName = String(name || '').trim();
      if (!cleanName) {
        openLibraryPopover(true);
        return;
      }
      const snap = buildDraftSnapshot();
      const payload = {
        id: overwriteCurrent && state.activeWorkflowId ? state.activeWorkflowId : undefined,
        name: cleanName,
        graph: snap.graph,
        viewport: snap.viewport,
        lastTaskPrompt: snap.lastTaskPrompt,
        lastClusterReportMd: snap.lastClusterReportMd,
      };
      try {
        if (onSaveNamedWorkflow) {
          const res = await onSaveNamedWorkflow(payload);
          if (Array.isArray(res?.workflows)) state.savedWorkflows = res.workflows;
          state.activeWorkflowId = res?.workflow?.id || res?.activeWorkflowId || state.activeWorkflowId;
          state.activeWorkflowName = res?.workflow?.name || cleanName;
          state.lastSavedAt = res?.workflow?.updatedAt || new Date().toISOString();
          state.saveStatus = 'saved';
        } else {
          state.activeWorkflowName = cleanName;
          state.lastSavedAt = new Date().toISOString();
          state.saveStatus = 'saved';
        }
        saveDraftLocal(buildDraftSnapshot());
        updateWorkflowHeaderHud();
        if (state.libraryOpen) renderLibraryPopover(false);
        setStatus(`已将工作流「${state.activeWorkflowName}」保存到本地磁盘。`);
        if (onToast) onToast(`已保存工作流「${state.activeWorkflowName}」`);
      } catch (err) {
        if (onToast) onToast(`保存工作流失败：${err.message || err}`);
      }
    }

    function quickSaveWorkflow() {
      if (state.activeWorkflowId) {
        saveNamedWorkflow(state.activeWorkflowName, { overwriteCurrent: true });
      } else {
        openLibraryPopover(true);
      }
    }

    function loadSavedWorkflow(wfId) {
      const wf = state.savedWorkflows.find((w) => w.id === wfId);
      if (!wf) return;
      const ok = applyLoadedSnapshot(
        {
          name: wf.name,
          activeWorkflowId: wf.id,
          graph: wf.graph,
          viewport: wf.viewport,
          lastTaskPrompt: wf.lastTaskPrompt || '',
          updatedAt: wf.updatedAt,
        },
        { recordHistory: true, triggerSave: true, animateFit: true }
      );
      if (ok) {
        setStatus(`已载入工作流「${wf.name}」（${state.graph.nodes.length} 个节点）。`);
        if (onToast) onToast(`已切换工作流：${wf.name}`);
      }
    }

    async function renameSavedWorkflow(wfId, nextName) {
      if (!onRenameWorkflow) return;
      try {
        const res = await onRenameWorkflow(wfId, nextName);
        if (Array.isArray(res?.workflows)) state.savedWorkflows = res.workflows;
        if (state.activeWorkflowId === wfId) {
          state.activeWorkflowName = res?.workflow?.name || nextName;
          saveDraftLocal(buildDraftSnapshot());
          updateWorkflowHeaderHud();
        }
        if (state.libraryOpen) renderLibraryPopover(false);
        if (onToast) onToast(`已重命名为「${nextName}」`);
      } catch (err) {
        if (onToast) onToast(`重命名失败：${err.message || err}`);
      }
    }

    async function deleteSavedWorkflow(wfId) {
      if (!onDeleteWorkflow) return;
      const target = state.savedWorkflows.find((w) => w.id === wfId);
      try {
        const res = await onDeleteWorkflow(wfId);
        if (Array.isArray(res?.workflows)) state.savedWorkflows = res.workflows;
        if (state.activeWorkflowId === wfId) {
          state.activeWorkflowId = null;
          updateWorkflowHeaderHud();
        }
        if (state.libraryOpen) renderLibraryPopover(false);
        if (onToast) onToast(`已删除工作流${target ? `「${target.name}」` : ''}`);
      } catch (err) {
        if (onToast) onToast(`删除失败：${err.message || err}`);
      }
    }

    function exportWorkflowFile() {
      const snap = buildDraftSnapshot();
      const exportObj = {
        schema: 'tenon-workflow/v1',
        app: 'TENON',
        name: state.activeWorkflowName || 'TENON工作流',
        exportedAt: new Date().toISOString(),
        lastTaskPrompt: snap.lastTaskPrompt,
        viewport: snap.viewport,
        graph: snap.graph,
      };
      const jsonText = JSON.stringify(exportObj, null, 2);
      const safeFileBase = (exportObj.name || 'tenon-workflow')
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
        .replace(/\s+/g, '_')
        .slice(0, 60) || 'tenon-workflow';
      const filename = `${safeFileBase}.tenon-workflow.json`;

      try {
        const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        setStatus(`已导出工作流文件：${filename}（含全部节点、模型、提示词与输出）。`);
        if (onToast) onToast(`已下载工作流文件：${filename}`);
      } catch {
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(jsonText).catch(() => {});
          if (onToast) onToast('已复制工作流 JSON 到剪贴板');
        }
      }
    }

    function importWorkflowJsonText(rawText, filename = '') {
      let parsed;
      try {
        parsed = JSON.parse(String(rawText || ''));
      } catch {
        if (onToast) onToast('导入失败：文件不是合法的 JSON 格式');
        return false;
      }
      const rawGraph = parsed?.graph && Array.isArray(parsed.graph.nodes) ? parsed.graph : parsed;
      const cleanName = (typeof parsed?.name === 'string' && parsed.name.trim())
        ? parsed.name.trim()
        : String(filename || '导入的工作流').replace(/(\.tenon-workflow)?\.json$/i, '').trim() || '导入的工作流';

      const ok = applyLoadedSnapshot(
        {
          name: cleanName,
          activeWorkflowId: null,
          graph: rawGraph,
          viewport: parsed?.viewport || null,
          lastTaskPrompt: typeof parsed?.lastTaskPrompt === 'string' ? parsed.lastTaskPrompt : '',
          lastClusterReportMd: typeof parsed?.lastClusterReportMd === 'string' ? parsed.lastClusterReportMd : '',
        },
        { recordHistory: true, triggerSave: true, animateFit: true }
      );
      if (!ok) {
        if (onToast) onToast('导入失败：未在 JSON 中找到有效的节点数组 (nodes)');
        return false;
      }
      setStatus(`已导入工作流「${cleanName}」（${state.graph.nodes.length} 个节点，${state.graph.edges.length} 条连线）。`);
      if (onToast) onToast(`已导入工作流「${cleanName}」`);
      return true;
    }

    function syncCanvasModeUi() {
      const isPro = state.canvasMode === 'pro';
      if (stageEl) stageEl.dataset.canvasMode = isPro ? 'pro' : 'simple';
      if (modeSwitchEl) {
        modeSwitchEl.querySelectorAll('[data-wf-mode]').forEach((btn) => {
          const active = btn.dataset.wfMode === state.canvasMode;
          btn.classList.toggle('active', active);
          btn.setAttribute('aria-selected', String(active));
        });
      }
    }

    function setCanvasMode(mode, { announce = true } = {}) {
      const next = mode === 'pro' ? 'pro' : 'simple';
      const changed = state.canvasMode !== next;
      state.canvasMode = next;
      try { localStorage.setItem(CANVAS_MODE_STORAGE_KEY, next); } catch {}
      closeAddMenuPopover();
      closeContextMenu();
      syncCanvasModeUi();
      renderAll();
      if (changed && announce) {
        setStatus(next === 'pro' ? PRO_GUIDE_TEXT : DEFAULT_GUIDE_TEXT);
        if (onToast) {
          onToast(
            next === 'pro'
              ? '已切换为专业模式：已展开完整参数、执行步骤树、分组与流程预演'
              : '已切换为简单模式：精简卡片视图，已保存内容完整保留'
          );
        }
      }
    }

    if (modeSwitchEl) {
      modeSwitchEl.querySelectorAll('[data-wf-mode]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          setCanvasMode(btn.dataset.wfMode, { announce: true });
        });
      });
    }

    if (libraryBtnEl) {
      libraryBtnEl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (state.libraryOpen) closeLibraryPopover();
        else openLibraryPopover(false);
      });
    }
    if (addMenuBtnEl) {
      addMenuBtnEl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (state.addMenuOpen) closeAddMenuPopover();
        else openAddMenuPopover();
      });
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

    function parseNodeProviderRef(ref) {
      const s = String(ref || '').trim();
      if (!s.startsWith('provider:')) return null;
      const rest = s.slice('provider:'.length);
      const idx = rest.indexOf(':');
      if (idx < 0) return { providerId: rest, model: '' };
      return { providerId: rest.slice(0, idx), model: rest.slice(idx + 1) };
    }

    function formatNodeModelLabel(node) {
      const ctx = getContext ? getContext() : {};
      const tpl = NODE_TEMPLATES[node.kind] || NODE_TEMPLATES['codex-exec'];
      if (node.model) {
        const ext = parseNodeProviderRef(node.model);
        if (ext) {
          const prov = (ctx.providers || []).find((p) => p.id === ext.providerId);
          const pname = prov ? prov.name.replace(/\s*\([^)]*\)\s*/g, '').trim() : '外部模型';
          const out = ext.model ? `${pname} · ${ext.model}` : pname;
          return out.length > 22 ? `${out.slice(0, 21)}…` : out;
        }
        if (node.model === 'codex:default') return 'Codex · 默认';
        if (node.model.startsWith('codex:')) {
          const inner = node.model.slice('codex:'.length).trim();
          return ctx.formatCodexShort ? ctx.formatCodexShort(inner) : `Codex · ${inner}`;
        }
        if (ctx.formatGeminiShort && /^gemini-|^orchestrator-/i.test(node.model)) {
          return ctx.formatGeminiShort(node.model);
        }
        if (ctx.formatCodexShort) return ctx.formatCodexShort(node.model);
        return node.model;
      }
      if (tpl.provider === 'external') {
        const first = (ctx.providers || []).find((p) => p.enabled);
        return first ? `${first.name.replace(/\s*\([^)]*\)\s*/g, '').trim()}` : '选择外部模型';
      }
      if (tpl.provider === 'gemini' || tpl.provider === 'any') return ctx.geminiModelShort || 'Neon · High';
      if (tpl.provider === 'both') return '自动汇总';
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
      scheduleAutoSave(300);
      setStatus('已按执行顺序自动整理对齐全部节点。');
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
          if (run.activeStage === 'review') st = run.status === 'running' ? 'running' : run.status === 'blocked' ? 'error' : 'completed';
          else if (run.activeStage === 'summary' || run.status === 'completed') st = 'completed';
          else if (run.status === 'blocked') st = 'error';
        } else if (n.kind === 'summary-card') {
          if (run.activeStage === 'summary' && run.status === 'running') st = 'running';
          else if (g.summaryText || run.status === 'completed') st = 'completed';
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
          const mutedCount = b.members.filter((n) => n.muted).length;
          const badgeText = liveCount > 0
            ? `${liveCount} 运行中`
            : mutedCount === b.members.length
              ? '整组跳过'
              : doneCount === b.members.length
                ? '全部就绪 ✓'
                : `${b.members.length} 节点`;
          return `
            <div class="ic-node-group is-accent-${escapeHtml(g.accent || 'sage')} ${g.collapsed ? 'is-collapsed' : ''}" data-group-id="${escapeHtml(g.id)}" style="transform:translate(${b.x}px,${b.y}px);width:${b.w}px;height:${b.h}px">
              <div class="ic-group-head" data-group-drag="${escapeHtml(g.id)}" title="拖动标题栏可整体平移组内节点 · 右键可配色/运行/解散 · 双击折叠">
                <div class="ic-group-title-wrap">
                  <button type="button" class="ic-group-pip-btn" data-group-cycle-accent="${escapeHtml(g.id)}" title="点击切换分组配色"><span class="ic-group-pip" aria-hidden="true"></span></button>
                  <input type="text" class="ic-group-title-input mono" data-group-rename="${escapeHtml(g.id)}" value="${escapeHtml(g.title)}" aria-label="节点组名称" />
                  <span class="ic-group-count mono-xs">${escapeHtml(badgeText)}</span>
                </div>
                <div class="ic-group-actions">
                  <button type="button" class="ic-group-btn is-run" data-group-run="${escapeHtml(g.id)}" title="按连线顺序运行本组内全部节点">运行组</button>
                  <button type="button" class="ic-group-btn" data-group-toggle="${escapeHtml(g.id)}" title="${g.collapsed ? '展开分组 (Tab)' : '折叠为紧凑卡片 (Tab)'}">${g.collapsed ? '展开' : '折叠'}</button>
                  <button type="button" class="ic-group-btn" data-group-ungroup="${escapeHtml(g.id)}" title="解散此分组（保留组内节点）">解散</button>
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

      framesLayerEl.querySelectorAll('[data-group-cycle-accent]').forEach((btn) => {
        btn.addEventListener('pointerdown', (e) => e.stopPropagation());
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const g = (state.graph.groups || []).find((x) => x.id === btn.dataset.groupCycleAccent);
          if (!g) return;
          const curIdx = Math.max(0, GROUP_ACCENTS.indexOf(g.accent || 'sage'));
          const nextAccent = GROUP_ACCENTS[(curIdx + 1) % GROUP_ACCENTS.length];
          setGroupAccent(g.id, nextAccent);
        });
      });

      framesLayerEl.querySelectorAll('[data-group-run]').forEach((btn) => {
        btn.addEventListener('pointerdown', (e) => e.stopPropagation());
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          runGroupNodes(btn.dataset.groupRun);
        });
      });

      framesLayerEl.querySelectorAll('[data-group-toggle]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const g = (state.graph.groups || []).find((x) => x.id === btn.dataset.groupToggle);
          if (!g) return;
          pushHistory();
          g.collapsed = !g.collapsed;
          renderAll();
          scheduleAutoSave(300);
          setStatus(g.collapsed ? `已折叠节点组「${g.title}」（双击或点展开可恢复）。` : `已展开节点组「${g.title}」。`);
        });
      });

      framesLayerEl.querySelectorAll('[data-group-ungroup]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          ungroupById(btn.dataset.groupUngroup);
        });
      });

      framesLayerEl.querySelectorAll('[data-group-rename]').forEach((inp) => {
        inp.addEventListener('pointerdown', (e) => e.stopPropagation());
        inp.addEventListener('dblclick', (e) => e.stopPropagation());
        inp.addEventListener('input', () => {
          const g = (state.graph.groups || []).find((x) => x.id === inp.dataset.groupRename);
          if (g) {
            g.title = inp.value;
            scheduleAutoSave(450);
          }
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

    function createNodeGroup(explicitNodeIds = null, customTitle = '') {
      if (!state.graph.groups) state.graph.groups = [];
      const validIds = new Set(state.graph.nodes.map((n) => n.id));
      let picks = Array.isArray(explicitNodeIds)
        ? Array.from(new Set(explicitNodeIds.filter((id) => validIds.has(id))))
        : [];

      if (picks.length === 0 && state.selectedIds.size >= 1) {
        picks = Array.from(state.selectedIds).filter((id) => validIds.has(id));
      }
      if (picks.length === 0) {
        const existingGrouped = new Set(state.graph.groups.flatMap((g) => g.nodeIds));
        picks = state.graph.nodes.filter((n) => !existingGrouped.has(n.id)).slice(0, 2).map((n) => n.id);
      }
      if (picks.length === 0) {
        if (onToast) onToast('请先左键框选或点击至少一个节点，再合并成组');
        return null;
      }

      pushHistory();
      const pickSet = new Set(picks);
      // Remove picked nodes from any old group so a node belongs cleanly to the new group
      state.graph.groups = state.graph.groups
        .map((g) => ({ ...g, nodeIds: g.nodeIds.filter((nid) => !pickSet.has(nid)) }))
        .filter((g) => g.nodeIds.length > 0);

      const idx = state.graph.groups.length + 1;
      const newGroup = {
        id: `grp-${++state.seq}`,
        title: (customTitle || '').trim() || `任务分组 #${idx}`,
        accent: GROUP_ACCENTS[(idx - 1) % GROUP_ACCENTS.length],
        nodeIds: picks,
        collapsed: false,
      };
      state.graph.groups.push(newGroup);
      renderAll();
      scheduleAutoSave(300);
      setStatus(`已将 ${picks.length} 个节点合并成组「${newGroup.title}」：拖动标题栏可整体平移，右键分组标题可配色或运行整组。`);
      if (onToast) onToast(`已合并成组：${newGroup.title}（${picks.length} 节点）`);
      return newGroup;
    }

    function ungroupById(gid) {
      const target = (state.graph.groups || []).find((g) => g.id === gid);
      if (!target) return;
      pushHistory();
      state.graph.groups = (state.graph.groups || []).filter((g) => g.id !== gid);
      renderAll();
      scheduleAutoSave(300);
      setStatus(`已解散分组「${target.title}」（组内节点与连线已完整保留）。`);
      if (onToast) onToast(`已解散分组：${target.title}`);
    }

    function ungroupSelected() {
      const selIds = state.selectedIds.size > 0 ? state.selectedIds : (state.selectedId ? new Set([state.selectedId]) : new Set());
      if (selIds.size === 0) return;
      const hitGroups = (state.graph.groups || []).filter((g) => g.nodeIds.some((nid) => selIds.has(nid)));
      if (hitGroups.length === 0) {
        if (onToast) onToast('当前选中节点未在任何分组内');
        return;
      }
      pushHistory();
      const hitIds = new Set(hitGroups.map((g) => g.id));
      state.graph.groups = (state.graph.groups || []).filter((g) => !hitIds.has(g.id));
      renderAll();
      scheduleAutoSave(300);
      setStatus(`已解散 ${hitGroups.length} 个分组（组内节点与连线已完整保留）。`);
      if (onToast) onToast(`已解散 ${hitGroups.length} 个分组`);
    }

    function addNodesToGroup(gid, nodeIds) {
      const target = (state.graph.groups || []).find((g) => g.id === gid);
      if (!target) return;
      const addList = Array.from(new Set(nodeIds || [])).filter((id) => state.graph.nodes.some((n) => n.id === id));
      if (addList.length === 0) return;
      pushHistory();
      const addSet = new Set(addList);
      state.graph.groups = (state.graph.groups || [])
        .map((g) => (g.id === gid ? g : { ...g, nodeIds: g.nodeIds.filter((id) => !addSet.has(id)) }))
        .filter((g) => g.nodeIds.length > 0);
      target.nodeIds = Array.from(new Set([...target.nodeIds, ...addList]));
      target.collapsed = false;
      renderAll();
      scheduleAutoSave(300);
      if (onToast) onToast(`已加入分组：${target.title}`);
    }

    function removeNodesFromGroup(nodeIds) {
      const remSet = new Set(nodeIds || []);
      if (remSet.size === 0) return;
      pushHistory();
      state.graph.groups = (state.graph.groups || [])
        .map((g) => ({ ...g, nodeIds: g.nodeIds.filter((id) => !remSet.has(id)) }))
        .filter((g) => g.nodeIds.length > 0);
      renderAll();
      scheduleAutoSave(300);
      if (onToast) onToast('已移出所属分组');
    }

    function setGroupAccent(gid, accent) {
      const g = (state.graph.groups || []).find((x) => x.id === gid);
      if (!g || !GROUP_ACCENTS.includes(accent)) return;
      pushHistory();
      g.accent = accent;
      renderAll();
      scheduleAutoSave(300);
      if (onToast) onToast(`分组「${g.title}」配色已切换为${GROUP_ACCENT_LABELS[accent] || accent}`);
    }

    function toggleMuteGroup(gid) {
      const g = (state.graph.groups || []).find((x) => x.id === gid);
      if (!g) return;
      const members = g.nodeIds.map((id) => state.graph.nodes.find((n) => n.id === id)).filter(Boolean);
      if (members.length === 0) return;
      const nextMuted = !members.every((n) => n.muted);
      pushHistory();
      members.forEach((n) => { n.muted = nextMuted; });
      renderAll();
      scheduleAutoSave(300);
      setStatus(`分组「${g.title}」内 ${members.length} 个节点已${nextMuted ? '全部设为跳过' : '全部恢复启用'}。`);
      if (onToast) onToast(nextMuted ? `已跳过整组：${g.title}` : `已恢复整组：${g.title}`);
    }

    function duplicateGroup(gid) {
      const g = (state.graph.groups || []).find((x) => x.id === gid);
      if (!g) return;
      const newIds = duplicateSelectedNodes(g.nodeIds, { silent: true });
      if (!newIds || newIds.length === 0) return;
      state.graph.groups.push({
        id: `grp-${++state.seq}`,
        title: `${g.title} 副本`,
        accent: g.accent || 'sage',
        nodeIds: newIds,
        collapsed: false,
      });
      renderAll();
      scheduleAutoSave(300);
      setStatus(`已复制分组「${g.title}」（含 ${newIds.length} 个节点与内部连线）。`);
      if (onToast) onToast(`已复制分组：${g.title} 副本`);
    }

    function removeGroupWithNodes(gid) {
      const g = (state.graph.groups || []).find((x) => x.id === gid);
      if (!g) return;
      removeSelectedNodes(g.nodeIds);
    }

    function runGroupNodes(gid) {
      const g = (state.graph.groups || []).find((x) => x.id === gid);
      if (!g || g.nodeIds.length === 0) return;
      runSelectedNodes(g.nodeIds, `分组「${g.title}」`);
    }

    function runSelectedNodes(explicitIds = null, label = '所选节点') {
      const ids = Array.isArray(explicitIds) && explicitIds.length > 0
        ? explicitIds
        : Array.from(state.selectedIds);
      const targetSet = new Set(
        ids.filter((id) => {
          const n = state.graph.nodes.find((x) => x.id === id);
          return n && !n.muted;
        })
      );
      if (targetSet.size === 0) {
        if (onToast) onToast('没有可运行的选中节点（请检查是否被设为跳过）');
        return;
      }
      const prompt = String(commandInputEl?.value || state.lastTaskPrompt || '').trim();
      if (!prompt) {
        if (onToast) onToast('请先在画布底部输入框写下任务目标');
        commandInputEl?.focus();
        return;
      }
      if (!onRunCanvasNode) {
        runClusterDemo(prompt);
        return;
      }
      if (onToast) onToast(`开始按依赖顺序运行${label}（${targetSet.size} 节点）`);
      void runWorkflowWaves({
        prompt,
        startWaveIndex: 0,
        targetNodeIds: targetSet,
        preserveExistingOutputs: true,
      });
    }

    function alignSelectedNodes(mode = 'top') {
      const nodes = getSelectedNodes();
      if (nodes.length < 2) return;
      pushHistory();
      if (mode === 'top') {
        const minY = Math.min(...nodes.map((n) => n.y));
        nodes.forEach((n) => { n.y = Math.round(minY); });
      } else if (mode === 'left') {
        const minX = Math.min(...nodes.map((n) => n.x));
        nodes.forEach((n) => { n.x = Math.round(minX); });
      } else if (mode === 'distribute-h') {
        const sorted = [...nodes].sort((a, b) => a.x - b.x);
        const minY = Math.min(...sorted.map((n) => n.y));
        let cursorX = sorted[0].x;
        sorted.forEach((n) => {
          n.x = Math.round(cursorX);
          n.y = Math.round(minY);
          cursorX += nodeWidth(n) + 72;
        });
      }
      renderAll();
      scheduleAutoSave(300);
      const labelMap = { top: '顶部对齐', left: '左侧对齐', 'distribute-h': '水平均匀排列' };
      setStatus(`已对 ${nodes.length} 个选中节点执行「${labelMap[mode] || '对齐'}」。`);
      if (onToast) onToast(`已${labelMap[mode] || '对齐'} ${nodes.length} 个节点`);
    }

    function duplicateSelectedNodes(explicitIds = null, { silent = false } = {}) {
      const ids = Array.isArray(explicitIds) && explicitIds.length > 0
        ? explicitIds
        : (state.selectedIds.size > 0 ? Array.from(state.selectedIds) : (state.selectedId ? [state.selectedId] : []));
      const origs = ids.map((id) => state.graph.nodes.find((n) => n.id === id)).filter(Boolean);
      if (origs.length === 0) return [];
      if (origs.length === 1 && !silent) {
        duplicateNode(origs[0].id);
        return [state.selectedId];
      }
      pushHistory();
      const idMap = new Map();
      const created = [];
      origs.forEach((orig) => {
        const copy = hydrateNode({
          ...orig,
          id: `n-dup-${++state.seq}`,
          title: `${orig.title} 副本`,
          x: orig.x + 56,
          y: orig.y + 56,
          status: 'idle',
          outputMd: '',
          steps: makeStepsForNode(orig.kind),
        });
        idMap.set(orig.id, copy.id);
        state.graph.nodes.push(copy);
        created.push(copy.id);
      });
      // Clone internal edges connecting any two copied nodes
      const origSet = new Set(origs.map((n) => n.id));
      const internalEdges = state.graph.edges.filter((e) => origSet.has(e.source) && origSet.has(e.target));
      internalEdges.forEach((e) => {
        state.graph.edges.push({
          id: `e-${++state.seq}`,
          source: idMap.get(e.source),
          target: idMap.get(e.target),
        });
      });
      setSelection(created, created[created.length - 1]);
      renderAll();
      scheduleAutoSave(300);
      if (!silent) {
        setStatus(`已批量复制 ${created.length} 个节点（含 ${internalEdges.length} 条内部连线）。`);
        if (onToast) onToast(`已复制 ${created.length} 个节点`);
      }
      return created;
    }

    function toggleMuteSelectedNodes(explicitIds = null) {
      const ids = Array.isArray(explicitIds) && explicitIds.length > 0
        ? explicitIds
        : (state.selectedIds.size > 0 ? Array.from(state.selectedIds) : (state.selectedId ? [state.selectedId] : []));
      const targets = ids.map((id) => state.graph.nodes.find((n) => n.id === id)).filter(Boolean);
      if (targets.length === 0) return;
      const nextMuted = !targets.every((n) => n.muted);
      pushHistory();
      targets.forEach((n) => { n.muted = nextMuted; });
      renderAll();
      scheduleAutoSave(300);
      setStatus(`已将 ${targets.length} 个节点${nextMuted ? '设为跳过' : '恢复启用'}。`);
      if (onToast) onToast(`${nextMuted ? '已跳过' : '已恢复'} ${targets.length} 个节点`);
    }

    function removeSelectedNodes(explicitIds = null) {
      const ids = Array.isArray(explicitIds) && explicitIds.length > 0
        ? explicitIds
        : (state.selectedIds.size > 0 ? Array.from(state.selectedIds) : (state.selectedId ? [state.selectedId] : []));
      const uniq = Array.from(new Set(ids)).filter((id) => state.graph.nodes.some((n) => n.id === id));
      if (uniq.length === 0) return;
      if (uniq.length === 1) {
        removeNode(uniq[0]);
        return;
      }
      if (state.graph.nodes.length - uniq.length < 1) {
        if (onToast) onToast('画布至少需保留一个节点，无法全部删除');
        return;
      }
      pushHistory();
      const delSet = new Set(uniq);
      state.graph.nodes = state.graph.nodes.filter((n) => !delSet.has(n.id));
      state.graph.edges = state.graph.edges.filter((e) => !delSet.has(e.source) && !delSet.has(e.target));
      if (Array.isArray(state.graph.groups)) {
        state.graph.groups = state.graph.groups
          .map((g) => ({ ...g, nodeIds: g.nodeIds.filter((nid) => !delSet.has(nid)) }))
          .filter((g) => g.nodeIds.length > 0);
      }
      const nextFirst = state.graph.nodes[0]?.id || '';
      setSelection(nextFirst ? [nextFirst] : [], nextFirst);
      renderAll();
      scheduleAutoSave(300);
      setStatus(`已批量移除 ${uniq.length} 个节点（按 Ctrl+Z 可撤销）。`);
      if (onToast) onToast(`已移除 ${uniq.length} 个节点`);
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
          const isEdgeSel = state.selectedEdgeId === e.id;

          return `
            <g class="ic-edge-group ${isEdgeSel ? 'is-selected' : ''}" data-edge-id="${escapeHtml(e.id)}">
              <path d="${d}" class="ic-edge-hit" />
              <path d="${d}" class="ic-edge-line ${isRunning ? 'is-flowing' : ''} ${isDone ? 'is-done' : ''}" style="stroke:${stroke}" stroke-dasharray="${isRunning ? '5 5' : 'none'}" />
              ${
                isRunning && motionOn
                  ? `<circle r="3" fill="var(--wire-active)"><animateMotion dur="1.15s" repeatCount="indefinite" path="${d}" /></circle>`
                  : ''
              }
              <g class="ic-edge-del" transform="translate(${midX.toFixed(1)},${midY.toFixed(1)})" data-del-edge="${escapeHtml(e.id)}" role="button" tabindex="0" aria-label="断开连线">
                <circle r="10" class="ic-edge-del-bg" />
                <path d="M-3 -3 L3 3 M3 -3 L-3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
              </g>
            </g>`;
        })
        .join('');

      let draftWire = '';
      if (state.wiring) {
        const anchor = byId.get(state.wiring.anchorId);
        if (anchor) {
          const isFromOut = state.wiring.side === 'out';
          const ax = isFromOut ? anchor.x + nodeWidth(anchor) : anchor.x;
          const ay = anchor.y + (anchor.collapsed ? 42 : PORT_Y);
          const d = isFromOut
            ? bezierPath(ax, ay, state.wiring.x, state.wiring.y)
            : bezierPath(state.wiring.x, state.wiring.y, ax, ay);
          draftWire = `
            <g class="ic-edge-draft">
              <path d="${d}" class="ic-edge-line is-flowing" style="stroke:var(--wire-active)" stroke-dasharray="5 4" />
              <circle cx="${state.wiring.x.toFixed(1)}" cy="${state.wiring.y.toFixed(1)}" r="3.8" fill="var(--wire-active)" />
            </g>`;
        }
      }

      edgesSvgEl.innerHTML = paths + draftWire;
      const deleteEdgeById = (eid) => {
        pushHistory();
        state.graph.edges = state.graph.edges.filter((e) => e.id !== eid);
        if (state.selectedEdgeId === eid) state.selectedEdgeId = null;
        renderAll();
        scheduleAutoSave(300);
        setStatus('已断开连线（按 Ctrl+Z 可撤销）。');
      };
      edgesSvgEl.querySelectorAll('.ic-edge-group').forEach((grp) => {
        const eid = grp.dataset.edgeId;
        grp.addEventListener('pointerdown', (ev) => {
          if (ev.target.closest('[data-del-edge]')) return;
          ev.stopPropagation();
          closeContextMenu();
          state.selectedEdgeId = state.selectedEdgeId === eid ? null : eid;
          renderEdges();
          if (state.selectedEdgeId) {
            setStatus('已选中连线：按 Delete / Backspace 或点击中间 × 按钮可断开连线。');
          }
        });
        grp.addEventListener('dblclick', (ev) => {
          if (ev.target.closest('[data-del-edge]')) return;
          ev.stopPropagation();
          deleteEdgeById(eid);
        });
      });
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
        ? (activeStep ? `执行中 · ${activeStep.verb}...` : '正在执行步骤...')
        : doneCount > 0
          ? `执行步骤 · ${doneCount}/${steps.length} 已完成`
          : `执行步骤 · 共 ${steps.length} 步`;

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

    function connectNodes(sourceId, targetId) {
      if (canConnect(state.graph, sourceId, targetId)) {
        pushHistory();
        state.graph.edges.push({ id: `e-${++state.seq}`, source: sourceId, target: targetId });
        const srcName = state.graph.nodes.find((n) => n.id === sourceId)?.title || sourceId;
        const dstName = state.graph.nodes.find((n) => n.id === targetId)?.title || targetId;
        state.pendingWire = null;
        setStatus(`已连接：「${srcName}」 → 「${dstName}」`);
        if (onToast) onToast('节点连线成功');
        renderAll();
        scheduleAutoSave(300);
        return true;
      }
      setStatus('无法连接：不可连接自身、重复连线或形成闭环。');
      if (onToast) onToast('无法重复连线或形成闭环');
      return false;
    }

    function resolveSummaryCardDisplay(node) {
      if (node.outputMd && node.outputMd.trim()) {
        const srcLabel = node.summarySource === 'live'
          ? '模型生成'
          : node.summarySource === 'preview'
            ? '流程预演'
            : '已生成';
        return { text: node.outputMd, sourceLabel: srcLabel, isEmpty: false };
      }
      const ctx = getContext ? getContext() : {};
      const run = ctx.currentRun;
      if (run) {
        const g = run.gemini || {};
        const c = run.codex || {};
        if (g.summaryText && g.summaryText.trim()) {
          return { text: g.summaryText.trim(), sourceLabel: '同步当前对话', isEmpty: false };
        }
        const lastAsst = Array.isArray(run.messages)
          ? [...run.messages].reverse().find((m) => m.role === 'assistant' && m.content && m.content.trim())
          : null;
        if (lastAsst) {
          return { text: lastAsst.content.trim(), sourceLabel: '同步当前对话', isEmpty: false };
        }
        const fallbackParts = [];
        if (run.reviewVerdict?.summary) {
          fallbackParts.push(`**审查结论**：${run.reviewVerdict.passed ? '通过' : '拦截'} — ${run.reviewVerdict.summary}`);
        }
        if (c.execText && c.execText.trim()) {
          fallbackParts.push(c.execText.trim());
        } else if (g.planText && g.planText.trim()) {
          fallbackParts.push(g.planText.trim());
        }
        if (fallbackParts.length > 0) {
          return { text: fallbackParts.join('\n\n'), sourceLabel: '同步当前对话', isEmpty: false };
        }
      }
      return {
        text: '',
        sourceLabel: '等待汇总',
        isEmpty: true,
      };
    }

    function ensureProParams(node) {
      if (!Array.isArray(node.params)) node.params = [];
      if (!node.params.some((p) => p.dynamic === 'nodeModel')) {
        node.params.unshift({ k: '模型', dynamic: 'nodeModel' });
      }
      if (node.params.length <= 1) {
        if (node.kind === 'gemini-plan') {
          node.params.push({ k: '方案策略', v: '多方案对比' });
        } else if (node.kind === 'codex-exec') {
          node.params.push({ k: '推理深度', dynamic: 'nodeEffort' }, { k: '沙箱模式', dynamic: 'sandbox' });
        } else if (node.kind === 'codex-review') {
          node.params.push({ k: '推理深度', dynamic: 'nodeEffort' }, { k: '复审上限', dynamic: 'maxRounds' });
        } else if (node.kind === 'cluster-merge' || node.kind === 'summary-card') {
          node.params.push({ k: '输入路数', dynamic: 'inCount' });
        } else if (node.kind === 'custom-agent') {
          node.params.push({ k: '执行方式', v: '实时直连' });
        } else {
          node.params.push({ k: '风格', v: '简明直白' });
        }
      }
      return node.params;
    }

    function ensureProToggles(node) {
      if (Array.isArray(node.toggles) && node.toggles.length > 0) return node.toggles;
      if (node.kind === 'gemini-plan') {
        node.toggles = [{ key: 'approval', label: '执行前人工确认', desc: '派发开发前允许编辑方案' }];
      } else if (node.kind === 'codex-exec') {
        node.toggles = [{ key: 'worktree', label: '独立分支隔离', desc: '在独立 Worktree 中修改' }];
      } else if (node.kind === 'cluster-merge') {
        node.toggles = [{ key: 'autoNewDiff', label: '包含新建文件', desc: '一并纳入代码对比视图' }];
      } else {
        node.toggles = [];
      }
      return node.toggles;
    }

    function renderNodes() {
      const isPro = state.canvasMode === 'pro';
      const statusMap = effectiveStatuses();
      const statusMeta = isPro
        ? {
            idle: { label: '待运行', btn: '运行' },
            running: { label: '运行中', btn: '运行中...' },
            completed: { label: '已完成', btn: '再次运行' },
            error: { label: '已拦截', btn: '重试' },
          }
        : {
            idle: { label: '待运行', btn: '运行此步' },
            running: { label: '运行中', btn: '运行中...' },
            completed: { label: '已完成', btn: '重新运行' },
            error: { label: '出错', btn: '重试' },
          };

      const incomingSet = new Set(state.graph.edges.map((e) => e.target));
      const outgoingSet = new Set(state.graph.edges.map((e) => e.source));
      const pw = state.pendingWire;

      nodeEls.clear();
      nodesLayerEl.innerHTML = state.graph.nodes
        .map((n) => {
          const tpl = NODE_TEMPLATES[n.kind] || NODE_TEMPLATES['codex-exec'];
          const st = n.muted ? 'idle' : sanitizeStatus(statusMap.get(n.id), VALID_NODE_STATUS, 'idle');
          const safeSt = escapeHtml(st);
          const running = st === 'running';
          const sel = state.selectedIds.has(n.id) || state.selectedId === n.id;
          const multiSel = sel && state.selectedIds.size > 1;
          const meta = statusMeta[st] || statusMeta.idle;
          const [orbState, orbVariant] = running ? tpl.orbRun : st === 'error' ? ['retrying', 'default'] : tpl.orbIdle;
          const isMerge = n.kind === 'cluster-merge';
          const isSummaryCard = n.kind === 'summary-card';
          const summaryInfo = isSummaryCard ? resolveSummaryCardDisplay(n) : null;
          const mdRender = renderMarkdown || ((s) => `<pre>${escapeHtml(s)}</pre>`);
          const runBtnText = isSummaryCard
            ? (running ? '总结中...' : n.muted ? '已跳过' : (summaryInfo && !summaryInfo.isEmpty ? '重新总结' : '生成总结'))
            : (n.muted ? '已跳过' : meta.btn);

          const extRole = tpl.roleCode || '节点';
          const extModel = formatNodeModelLabel(n);
          const isCustomModel = Boolean(n.model);
          const hiddenInGroup = Boolean(getCollapsedGroupForNode(n.id));
          const inSocketType = tpl.inType || 'spec';
          const outSocketType = tpl.outType || 'diff';
          const nw = nodeWidth(n);
          const nh = !n.collapsed ? nodeHeight(n) : null;
          const hasNodeOutput = !isSummaryCard && Boolean((n.outputMd && n.outputMd.trim()) || running);
          const durSec = n.durationMs > 0 ? `${(n.durationMs / 1000).toFixed(1)}s` : '';

          const proParamsHtml = isPro
            ? ensureProParams(n)
                .map(
                  (p, idx) => `
                  <div class="wf-param-row">
                    <dt class="wf-param-label">${escapeHtml(p.k)}</dt>
                    ${resolveParamHtml(p, n, idx)}
                  </div>`
                )
                .join('')
            : '';

          const proTogglesHtml = isPro
            ? ensureProToggles(n)
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
                .join('')
            : '';

          const nodeOutputPreviewHtml = hasNodeOutput
            ? `<div class="ic-node-output-box ${running ? 'is-running' : st === 'error' ? 'is-error' : ''}">
                <div class="ic-node-output-head">
                  <span class="ic-node-output-title">${running ? '正在执行...' : st === 'error' ? '执行失败' : '本步输出结果'}</span>
                  <div class="ic-summary-panel-actions">
                    ${durSec ? `<span class="ic-summary-badge mono-xs">${escapeHtml(durSec)}</span>` : ''}
                    ${n.outputMd ? `<button type="button" class="ic-summary-copy-btn" data-ic-copy-node-out="${escapeHtml(n.id)}" title="复制本节点输出结果">复制</button>` : ''}
                  </div>
                </div>
                <div class="ic-node-output-body markdown-output">
                  ${
                    running
                      ? `<p class="ic-summary-placeholder is-shimmer">正在调用 ${escapeHtml(extModel)} 处理本步骤...</p>`
                      : mdRender(n.outputMd)
                  }
                </div>
              </div>`
            : '';

          return `
            <div class="ic-node-wrap ${sel ? 'is-selected' : ''} ${multiSel ? 'is-multi-selected' : ''} ${isMerge ? 'is-merge-hub' : ''} ${isSummaryCard ? 'is-summary-card' : ''} ${n.muted ? 'is-muted' : ''} ${n.collapsed ? 'is-collapsed' : ''} ${hiddenInGroup ? 'is-group-hidden' : ''}" data-node-id="${escapeHtml(n.id)}" data-status="${safeSt}" style="width:${nw}px;transform:translate(${Math.round(n.x)}px,${Math.round(n.y)}px)">
              <div class="ic-node-ext-meta mono">
                <div class="ic-ext-left">
                  <span class="ic-ext-role">${escapeHtml(extRole)}</span>
                  <button type="button" class="ic-ext-model" data-ic-pick-model="${escapeHtml(n.id)}" title="点击自由切换此节点使用的模型">${escapeHtml(extModel)} ▾</button>
                </div>
                <span class="ic-ext-status ${safeSt}">
                  <span class="ic-ext-dot ${running ? 'is-pulse' : ''}"></span>
                  <span>${n.muted ? '已跳过' : meta.label}</span>
                </span>
              </div>
              <div class="agent-node ${sel ? 'is-selected' : ''} ${n.collapsed ? 'is-collapsed' : ''} ${nh ? 'is-custom-h' : ''}" data-status="${safeSt}">
                <div class="agent-node-surface" ${nh ? `style="min-height:${nh}px;height:${nh}px"` : ''}>
                  ${running ? '<span class="agent-node-sweep-track" aria-hidden="true"><span class="agent-node-sweep"></span></span>' : ''}
                  <header class="agent-node-head ic-drag-handle" title="拖拽移动节点 · 点击标题可直接修改 · 双击打开高级设置">
                    <span class="agent-node-icon">
                      <svg class="thinking-orb" width="24" height="24" viewBox="0 0 24 24" data-orb-state="${orbState}" data-orb-variant="${orbVariant}" data-orb-size="24" data-orb-paused="${running ? '0' : '1'}" aria-hidden="true"></svg>
                    </span>
                    <div class="agent-node-titles">
                      <input type="text" class="ic-inline-title" data-ic-title="${escapeHtml(n.id)}" value="${escapeHtml(n.title)}" aria-label="节点标题" />
                      <input type="text" class="ic-inline-sub" data-ic-sub="${escapeHtml(n.id)}" value="${escapeHtml(n.subtitle)}" aria-label="节点一句话说明" />
                    </div>
                    <button type="button" class="ic-node-fold-btn" data-ic-fold="${escapeHtml(n.id)}" title="${n.collapsed ? '展开卡片 (H)' : '折叠卡片 (H)'}" aria-expanded="${!n.collapsed}">
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <path d="${n.collapsed ? 'M6.25 4.25L10 8L6.25 11.75' : 'M4.25 6.25L8 10L11.75 6.25'}" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                      </svg>
                    </button>
                  </header>

                  <div class="agent-node-body">
                    ${
                      !isPro
                        ? `<button type="button" class="ic-node-model-bar ${isCustomModel ? 'is-custom' : ''}" data-ic-pick-model="${escapeHtml(n.id)}" title="点击自由切换此节点模型（Gemini / Codex / 外部 API / 自定义 ID）">
                            <span class="ic-node-model-k">使用模型</span>
                            <span class="ic-node-model-v">${escapeHtml(extModel)} ▾</span>
                          </button>`
                        : ''
                    }
                    ${
                      isSummaryCard
                        ? `<div class="ic-summary-panel ${running ? 'is-live' : ''}">
                            <div class="ic-summary-panel-head">
                              <span class="ic-summary-panel-title">最终结论与复述</span>
                              <div class="ic-summary-panel-actions">
                                <span class="ic-summary-badge mono-xs">${escapeHtml(running ? '正在总结...' : summaryInfo.sourceLabel)}</span>
                                ${!summaryInfo.isEmpty ? `<button type="button" class="ic-summary-copy-btn" data-ic-copy-summary="${escapeHtml(n.id)}" title="复制总结与复述内容">复制</button>` : ''}
                              </div>
                            </div>
                            <div class="ic-summary-output markdown-output">
                              ${
                                running
                                  ? '<p class="ic-summary-placeholder is-shimmer">正在汇总上游节点输出并整理复述结论...</p>'
                                  : !summaryInfo.isEmpty
                                    ? mdRender(summaryInfo.text)
                                    : '<p class="ic-summary-placeholder">在画布底部写下任务并点「运行工作流」，所有上游结果会自动流到这里，生成最终结论和口语化复述。</p>'
                              }
                            </div>
                          </div>`
                        : ''
                    }
                    <div class="ic-node-prompt-box">
                      <div class="ic-prompt-head">
                        <span class="mono-xs">${isSummaryCard ? '总结与复述要求' : isPro ? '节点指令' : '这一步要做什么'}</span>
                        <span class="mono-xs ic-prompt-hint">${isPro ? 'Ctrl+Enter 运行' : '自动保存'}</span>
                      </div>
                      <textarea class="ic-inline-prompt" rows="2" data-ic-prompt="${escapeHtml(n.id)}" placeholder="${isSummaryCard ? '例如：用简洁直白的话总结最终结论，并列出 3 条关键要点...' : '写下这一步让模型具体完成什么任务...'}">${escapeHtml(n.prompt)}</textarea>
                    </div>
                    ${isPro && proParamsHtml ? `<dl class="wf-params">${proParamsHtml}</dl>` : ''}
                    ${isPro ? renderNodeCoTTree(n, st) : ''}
                    ${isPro && proTogglesHtml ? `<div class="wf-toggles">${proTogglesHtml}</div>` : ''}
                    ${nodeOutputPreviewHtml}
                  </div>

                  ${st === 'error' && !n.outputMd ? `<div class="wf-node-error" role="alert">${escapeHtml(tpl.errorMessage)}</div>` : ''}

                  <footer class="agent-node-foot">
                    <button type="button" class="ic-inspect-link mono" data-ic-inspect="${escapeHtml(n.id)}" title="在右侧查看完整输出或调整高级设置">
                      ${n.outputMd ? (isPro ? '查看输出 →' : '展开全文 →') : (isPro ? '节点配置 →' : '高级设置 →')}
                    </button>
                    <div class="ic-foot-actions">
                      <button type="button" class="ic-icon-del" data-ic-del="${escapeHtml(n.id)}" title="删除此节点">×</button>
                      ${
                        isPro
                          ? `<button type="button" class="wf-run-btn is-secondary" data-ic-preview="${escapeHtml(n.id)}" ${running || n.muted ? 'disabled' : ''} title="仅在画布内预演步骤，不改本地文件">
                              <span>预演</span>
                            </button>`
                          : ''
                      }
                      ${
                        running
                          ? `<button type="button" class="wf-run-btn is-stop-node" data-ic-stop-node="${escapeHtml(n.id)}" title="立刻中途打断此节点的执行，保留上游已完成结果">
                              <span>打断此步</span>
                            </button>`
                          : `<button type="button" class="wf-run-btn" data-ic-run="${escapeHtml(n.id)}" ${n.muted ? 'disabled' : ''} title="${isSummaryCard ? '调用所选模型汇总上游内容并在这里复述' : '只在画布中单独运行这一步（自动带入上游结果）'}">
                              <span>${runBtnText}</span>
                            </button>`
                      }
                    </div>
                  </footer>
                </div>

                ${
                  tpl.showIn
                    ? `<button type="button" class="wf-port wf-port-left ${incomingSet.has(n.id) ? 'is-connected' : ''} ${inSocketType === 'multi' ? 'is-multi-socket' : ''} ${pw && pw.side === 'in' && pw.nodeId === n.id ? 'is-wire-source' : ''} ${pw && pw.side === 'out' && canConnect(state.graph, pw.nodeId, n.id) ? 'is-wire-candidate' : ''}" data-socket-type="${escapeHtml(inSocketType)}" data-port-side="in" data-port-node="${escapeHtml(n.id)}" aria-label="输入端口: ${escapeHtml(tpl.inLabel)}"><span class="wf-port-dot"></span><span class="wf-port-tip">输入 · 承接上一步结果</span></button>`
                    : ''
                }
                ${
                  tpl.showOut
                    ? `<button type="button" class="wf-port wf-port-right ${outgoingSet.has(n.id) ? 'is-connected' : ''} ${pw && pw.side === 'out' && pw.nodeId === n.id ? 'is-wire-source' : ''} ${pw && pw.side === 'in' && canConnect(state.graph, n.id, pw.nodeId) ? 'is-wire-candidate' : ''}" data-socket-type="${escapeHtml(outSocketType)}" data-port-side="out" data-port-node="${escapeHtml(n.id)}" aria-label="输出端口: ${escapeHtml(tpl.outLabel)}"><span class="wf-port-dot"></span><span class="wf-port-tip">输出 · 拖到下一步连接</span></button>`
                    : ''
                }
                ${
                  !n.collapsed
                    ? `<div class="ic-resize-handle is-w" data-ic-resize="w" data-resize-node="${escapeHtml(n.id)}" title="拖拽左侧边缘调整宽度"></div>
                       <div class="ic-resize-handle is-e" data-ic-resize="e" data-resize-node="${escapeHtml(n.id)}" title="拖拽右侧边缘调整宽度"></div>
                       <div class="ic-resize-handle is-s" data-ic-resize="s" data-resize-node="${escapeHtml(n.id)}" title="拖拽底边调整高度"></div>
                       <div class="ic-resize-handle is-se" data-ic-resize="se" data-resize-node="${escapeHtml(n.id)}" title="拖拽自由缩放 · 双击恢复默认大小"></div>`
                    : ''
                }
              </div>
            </div>`;
        })
        .join('');

      nodesLayerEl.querySelectorAll('.ic-node-wrap').forEach((wrap) => {
        const nid = wrap.dataset.nodeId;
        nodeEls.set(nid, wrap);

        // Delayed pointer capture (4px threshold preserves native dblclick & supports multi-node batch dragging!)
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
          if (e.shiftKey || e.ctrlKey || e.metaKey) {
            toggleNodeSelection(nid);
            return;
          }
          let narrowOnClick = false;
          if (state.selectedIds.has(nid) && state.selectedIds.size > 1) {
            state.selectedId = nid;
            narrowOnClick = true;
          } else if (!state.selectedIds.has(nid) || state.selectedIds.size !== 1 || state.selectedId !== nid) {
            setSelection([nid], nid);
          }
          const startWorld = screenToWorld(e.clientX, e.clientY);
          const dragIds = state.selectedIds.has(nid) ? Array.from(state.selectedIds) : [nid];
          const origins = new Map();
          dragIds.forEach((id) => {
            const dn = state.graph.nodes.find((x) => x.id === id);
            if (dn) origins.set(id, { x: dn.x, y: dn.y });
          });
          state.dragging = {
            id: nid,
            startClientX: e.clientX,
            startClientY: e.clientY,
            startWorldX: startWorld.x,
            startWorldY: startWorld.y,
            offsetX: startWorld.x - node.x,
            offsetY: startWorld.y - node.y,
            origins,
            narrowOnClick,
            moved: false,
            captured: false,
            pointerId: e.pointerId,
          };
        });

        wrap.addEventListener('dblclick', (e) => {
          if (e.target.closest('button, input, textarea, select, [role="switch"], .wf-port, .ic-resize-handle')) return;
          e.stopPropagation();
          setSelection([nid], nid, { updateDrawer: false });
          openResultDrawer('node');
        });
      });

      // Inline In-Card Selection Helper (hoisted before resize handles & editors)
      const selectNodeQuietly = (nid) => {
        if (state.selectedId === nid && state.selectedIds.size === 1 && state.selectedIds.has(nid)) return;
        setSelection([nid], nid, { updateDrawer: false });
      };

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

      nodesLayerEl.querySelectorAll('[data-ic-title]').forEach((inp) => {
        inp.addEventListener('pointerdown', (e) => { e.stopPropagation(); selectNodeQuietly(inp.dataset.icTitle); });
        inp.addEventListener('input', () => {
          const n = state.graph.nodes.find((x) => x.id === inp.dataset.icTitle);
          if (!n) return;
          n.title = inp.value;
          const drawerTitle = resultDrawerEl?.querySelector('#icEditTitle');
          if (drawerTitle && state.selectedId === n.id) drawerTitle.value = inp.value;
          scheduleAutoSave(450);
        });
      });

      nodesLayerEl.querySelectorAll('[data-ic-sub]').forEach((inp) => {
        inp.addEventListener('pointerdown', (e) => { e.stopPropagation(); selectNodeQuietly(inp.dataset.icSub); });
        inp.addEventListener('input', () => {
          const n = state.graph.nodes.find((x) => x.id === inp.dataset.icSub);
          if (n) {
            n.subtitle = inp.value;
            scheduleAutoSave(450);
          }
        });
      });

      nodesLayerEl.querySelectorAll('.ic-summary-output, .ic-node-output-body').forEach((box) => {
        box.addEventListener('pointerdown', (e) => e.stopPropagation());
        box.addEventListener('wheel', (e) => {
          if (box.scrollHeight > box.clientHeight) e.stopPropagation();
        }, { passive: true });
      });

      nodesLayerEl.querySelectorAll('[data-ic-copy-summary]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const n = state.graph.nodes.find((x) => x.id === btn.dataset.icCopySummary);
          if (!n) return;
          const info = resolveSummaryCardDisplay(n);
          if (info.text && navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(info.text).then(() => {
              if (onToast) onToast('已复制总结与复述内容');
            }).catch(() => {});
          }
        });
      });

      nodesLayerEl.querySelectorAll('[data-ic-copy-node-out]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const n = state.graph.nodes.find((x) => x.id === btn.dataset.icCopyNodeOut);
          if (!n || !n.outputMd) return;
          if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(n.outputMd).then(() => {
              if (onToast) onToast(`已复制「${n.title}」的输出结果`);
            }).catch(() => {});
          }
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
          scheduleAutoSave(450);
        });
        ta.addEventListener('keydown', (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            runSingleNodeLive(ta.dataset.icPrompt);
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
            scheduleAutoSave(450);
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

      nodesLayerEl.querySelectorAll('[data-port-side]').forEach((portBtn) => {
        portBtn.addEventListener('pointerdown', (e) => {
          if (e.button !== 0 || state.panning || state.dragging) return;
          e.stopPropagation();
          closeContextMenu();
          const side = portBtn.dataset.portSide;
          const anchorId = portBtn.dataset.portNode;
          const pt = screenToWorld(e.clientX, e.clientY);
          state.wiring = {
            side,
            anchorId,
            startClientX: e.clientX,
            startClientY: e.clientY,
            x: pt.x,
            y: pt.y,
            moved: false,
            hoverTargetId: null,
            pointerId: e.pointerId,
          };
          try { viewportEl.setPointerCapture(e.pointerId); } catch {}
          renderEdges();
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
          scheduleAutoSave(300);
        });
      });

      nodesLayerEl.querySelectorAll('[data-ic-del]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          removeNode(btn.dataset.icDel);
        });
      });

      nodesLayerEl.querySelectorAll('[data-ic-preview]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const nid = btn.dataset.icPreview;
          const node = state.graph.nodes.find((x) => x.id === nid);
          if (!node) return;
          if (node.muted) {
            if (onToast) onToast('该节点已设为跳过，请先恢复');
            return;
          }
          runSinglePreview(nid);
        });
      });

      nodesLayerEl.querySelectorAll('[data-ic-stop-node]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          stopWorkflowRun();
        });
      });

      nodesLayerEl.querySelectorAll('[data-ic-run]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const nid = btn.dataset.icRun;
          const node = state.graph.nodes.find((x) => x.id === nid);
          if (!node) return;
          if (node.muted) {
            if (onToast) onToast('该节点已设为跳过，请在右侧「节点设置」中恢复');
            return;
          }
          runSingleNodeLive(nid);
        });
      });

      if (window.ConduitOrbs) window.ConduitOrbs.mountAll(nodesLayerEl);
    }

    function renderAll() {
      renderNodes();
      renderGroups();
      renderEdges();
      syncSelectionBar();
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

    /** Unrestricted Per-Node Free Model Picker (ALL Gemini + ALL Codex + ALL External APIs + Custom Model ID on EVERY node!) */
    function openModelPicker(nodeId, clientX, clientY) {
      if (!contextMenuEl) return;
      const node = state.graph.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const tpl = NODE_TEMPLATES[node.kind] || NODE_TEMPLATES['codex-exec'];
      const ctx = getContext ? getContext() : {};
      const geminiModels = ctx.geminiModels || [];
      const codexModels = ctx.codexModels || [];
      const enabledProviders = (ctx.providers || []).filter((p) => p.enabled);

      state.selectedId = nodeId;
      closeLibraryPopover();
      closeAddMenuPopover();
      state.ctxMenu = { open: true, kind: 'model', worldX: node.x, worldY: node.y, nodeId };
      let activeTab = 'all';

      const buildOptions = (q = '', tab = 'all') => {
        const needle = q.trim().toLowerCase();
        const rows = [];
        const match = (id, label) => !needle || String(id).toLowerCase().includes(needle) || String(label).toLowerCase().includes(needle);

        // Default / inherit option (always shown in 'all')
        if (tab === 'all') {
          const defLabel = tpl.provider === 'both'
            ? '自动汇总（跟随默认）'
            : tpl.provider === 'external'
              ? '自动使用首个已启用的外部模型'
              : '跟随工作台全局默认模型';
          if (match('', defLabel)) {
            rows.push({ type: 'item', id: '', label: defLabel, sub: 'AUTO', badge: '默认', selected: !node.model });
          }
        }

        // 1. External Local CLI Agents & HTTP API Providers (available on EVERY node)
        if (tab === 'all' || tab === 'external') {
          const extItems = [];
          enabledProviders.forEach((p) => {
            const models = Array.isArray(p.models) && p.models.length > 0 ? p.models : [p.defaultModel || ''];
            models.slice(0, 8).forEach((mId) => {
              const ref = `provider:${p.id}:${mId}`;
              if (match(`${p.name} ${mId} ${p.protocol}`, `${p.name} ${mId}`)) {
                extItems.push({
                  type: 'item',
                  id: ref,
                  label: p.name,
                  sub: mId || p.command || p.baseUrl || p.protocol,
                  badge: p.kind === 'cli' ? 'CLI' : 'API',
                  selected: node.model === ref,
                });
              }
            });
          });
          if (extItems.length > 0) {
            rows.push({ type: 'group', label: '外部 AGENT 与 API（实时直连）' });
            rows.push(...extItems);
          } else if (tab === 'external') {
            rows.push({ type: 'group', label: '暂未启用外部模型，可点击底部前往接入' });
          }
        }

        // 2. Gemini Models (available on EVERY node!)
        if (tab === 'all' || tab === 'gemini') {
          if (geminiModels.length > 0) {
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
          } else {
            const fallbackG = [
              { id: 'gemini-4-neon-high', label: 'Gemini 4 Neon High' },
              { id: 'gemini-4-neon-medium', label: 'Gemini 4 Neon Medium' },
              { id: 'gemini-4-pro', label: 'Gemini 4 Pro' },
            ].filter((m) => match(m.id, m.label));
            if (fallbackG.length > 0) {
              rows.push({ type: 'group', label: 'GEMINI 模型（本机 agy）' });
              fallbackG.forEach((m) => {
                rows.push({ type: 'item', id: m.id, label: m.label, sub: m.id, badge: 'GEM', selected: node.model === m.id });
              });
            }
          }
        }

        // 3. Codex Models (available on EVERY node!)
        if (tab === 'all' || tab === 'codex') {
          const codexItems = [];
          if (match('codex:default', 'Codex 默认配置档')) {
            codexItems.push({
              type: 'item',
              id: 'codex:default',
              label: 'Codex · 本机默认配置',
              sub: '读取当前 CODEX_HOME 配置档',
              badge: 'CDX',
              selected: node.model === 'codex:default',
            });
          }
          codexModels
            .filter((m) => m.id && match(m.id, m.label || m.id))
            .forEach((m) => {
              const cid = m.id.startsWith('codex:') ? m.id : `codex:${m.id}`;
              codexItems.push({
                type: 'item',
                id: cid,
                label: m.label || m.id,
                sub: m.id,
                badge: 'CDX',
                selected: node.model === cid || node.model === m.id,
              });
            });
          if (codexItems.length > 0) {
            rows.push({ type: 'group', label: 'CODEX 模型（本机 codex CLI）' });
            rows.push(...codexItems);
          }
        }

        return rows;
      };

      const renderList = (q = '') => {
        const rows = buildOptions(q, activeTab);
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
          <input type="text" class="ic-ctx-search" id="icCtxSearch" placeholder="自由搜索任意 Gemini / Codex / 外部模型..." autocomplete="off" />
          <div class="ic-model-tabs" role="tablist" aria-label="按模型来源筛选">
            <button type="button" class="ic-model-tab active" data-mtab="all">全部</button>
            <button type="button" class="ic-model-tab" data-mtab="gemini">Gemini</button>
            <button type="button" class="ic-model-tab" data-mtab="codex">Codex</button>
            <button type="button" class="ic-model-tab" data-mtab="external">外部 API</button>
          </div>
        </div>
        <div class="ic-ctx-body"></div>
        <div class="ic-ctx-custom-row">
          <input type="text" class="ic-ctx-search mono" id="icCustomNodeModel" placeholder="自由输入自定义模型 ID 回车..." autocomplete="off" />
          <button type="button" class="btn-primary-sm wf-btn" id="btnApplyNodeCustomModel">应用</button>
        </div>
        <div class="picker-manage-foot">
          <button type="button" class="picker-manage-btn" id="btnCtxManageProviders">
            <span>+ 管理外部 Agent 与 API 接入</span>
            <span class="mono-xs">${enabledProviders.length} 已启用 →</span>
          </button>
        </div>`;

      renderList('');
      contextMenuEl.classList.remove('hidden');
      placeMenuEdgeAware(clientX, clientY, 316);

      contextMenuEl.querySelectorAll('[data-mtab]').forEach((tb) => {
        tb.addEventListener('click', (e) => {
          e.stopPropagation();
          activeTab = tb.dataset.mtab || 'all';
          contextMenuEl.querySelectorAll('[data-mtab]').forEach((x) => x.classList.toggle('active', x === tb));
          renderList(contextMenuEl.querySelector('#icCtxSearch')?.value || '');
        });
      });

      contextMenuEl.querySelector('#btnCtxManageProviders')?.addEventListener('click', (e) => {
        e.stopPropagation();
        closeContextMenu();
        if (onOpenProviderHub) onOpenProviderHub();
      });

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
      scheduleAutoSave(300);
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
          scheduleAutoSave(300);
          setStatus(`节点「${node.title}」推理深度已设为：${formatNodeEffortLabel(node)}`);
        });
      });
    }

    function openContextMenu(clientX, clientY, nodeId = null, groupId = null) {
      if (!contextMenuEl) return;
      closeLibraryPopover();
      closeAddMenuPopover();
      const worldPt = screenToWorld(clientX, clientY);
      state.ctxMenu = {
        open: true,
        kind: 'menu',
        worldX: Math.round(worldPt.x),
        worldY: Math.round(worldPt.y),
        nodeId,
        groupId,
      };

      const targetGroup = groupId ? (state.graph.groups || []).find((g) => g.id === groupId) : null;
      const targetNode = !targetGroup && nodeId ? state.graph.nodes.find((n) => n.id === nodeId) : null;
      const selNodes = getSelectedNodes();
      const isMultiNodeCtx = Boolean(targetNode && state.selectedIds.has(targetNode.id) && selNodes.length >= 2);
      const isPro = state.canvasMode === 'pro';

      let items = [];
      let searchPlaceholder = '搜索并新建节点或快捷操作...';

      if (targetGroup) {
        searchPlaceholder = `搜索分组「${targetGroup.title.slice(0, 12)}」操作...`;
        const members = targetGroup.nodeIds.map((id) => state.graph.nodes.find((n) => n.id === id)).filter(Boolean);
        const allMuted = members.length > 0 && members.every((n) => n.muted);
        items = [
          { type: 'group', label: `分组操作 · ${targetGroup.title.slice(0, 16)} (${members.length} 节点)` },
          { id: 'grp:run', label: '运行组内全部节点', shortcut: '运行', accent: true },
          { id: 'grp:select', label: '选中组内全部节点', shortcut: '全选组' },
          { id: 'grp:toggle', label: targetGroup.collapsed ? '展开此分组' : '折叠为紧凑卡片', shortcut: 'Tab' },
          { type: 'swatches', groupId: targetGroup.id, activeAccent: targetGroup.accent || 'sage' },
          { type: 'sep' },
          { id: 'grp:dup', label: '复制整组（含节点与连线）', shortcut: '复制组' },
          { id: 'grp:mute', label: allMuted ? '恢复组内全部节点' : '临时跳过整组节点', shortcut: '跳过' },
          { id: 'grp:ungroup', label: '解散分组（保留节点）', shortcut: 'Ctrl+Shift+G' },
          { type: 'sep' },
          { id: 'grp:delete', label: '删除分组及组内节点', shortcut: 'Del', danger: true },
        ];
      } else if (isMultiNodeCtx) {
        searchPlaceholder = `搜索已选 ${selNodes.length} 个节点的批量操作...`;
        const allMuted = selNodes.every((n) => n.muted);
        items = [
          { type: 'group', label: `已框选 ${selNodes.length} 个节点 · 批量操作` },
          { id: 'sel:group', label: '合并成组', shortcut: 'Ctrl+G', accent: true },
          { id: 'sel:run', label: '按依赖运行所选节点', shortcut: '运行' },
          { type: 'sep' },
          { id: 'sel:align-top', label: '顶部水平对齐', shortcut: '顶对齐' },
          { id: 'sel:align-left', label: '左侧垂直对齐', shortcut: '左对齐' },
          { id: 'sel:distribute-h', label: '水平均匀排列', shortcut: '横排' },
          { type: 'sep' },
          { id: 'sel:dup', label: '批量复制所选节点', shortcut: 'Ctrl+D' },
          { id: 'sel:mute', label: allMuted ? '批量恢复启用' : '批量设为跳过', shortcut: 'M' },
          { id: 'sel:ungroup', label: '解散所选节点所属分组', shortcut: 'Ctrl+Shift+G' },
          { id: 'sel:disconnect', label: '断开所选节点外部连线', shortcut: '' },
          { type: 'sep' },
          { id: 'sel:delete', label: `删除所选 ${selNodes.length} 个节点`, shortcut: 'Del', danger: true },
        ];
      } else if (targetNode) {
        searchPlaceholder = '搜索节点操作...';
        const ownerGroup = (state.graph.groups || []).find((g) => g.nodeIds.includes(targetNode.id)) || null;
        const otherGroups = (state.graph.groups || []).filter((g) => !g.nodeIds.includes(targetNode.id)).slice(0, 3);
        items = [
          { type: 'group', label: `节点操作 · ${targetNode.title.slice(0, 18)}` },
          { id: 'node:model', label: '自由切换此节点模型', shortcut: '模型', accent: true },
          { id: 'node:cli', label: '在画布中运行此节点', shortcut: '运行' },
          { id: 'node:downstream', label: '从此节点继续跑完下游', shortcut: '续跑' },
          ...(isPro ? [{ id: 'node:run', label: '仅预演此节点步骤', shortcut: 'R' }] : []),
          { id: 'node:inspect', label: '打开高级设置与完整输出', shortcut: 'Enter' },
          { type: 'sep' },
          { type: 'group', label: '分组管理' },
          ...(ownerGroup
            ? [
                { id: 'node:leave-group', label: `移出分组「${ownerGroup.title.slice(0, 12)}」`, shortcut: '移出' },
                { id: `grp-direct-ungroup:${ownerGroup.id}`, label: `解散分组「${ownerGroup.title.slice(0, 12)}」`, shortcut: '解散' },
              ]
            : [{ id: 'node:group', label: '将此节点合并成组', shortcut: 'Ctrl+G' }]),
          ...otherGroups.map((og) => ({
            id: `node:join-group:${og.id}`,
            label: `加入已有分组「${og.title.slice(0, 12)}」`,
            shortcut: '加入',
          })),
          { type: 'sep' },
          { id: 'node:dup', label: '复制节点', shortcut: 'Shift+D' },
          { id: 'node:mute', label: targetNode.muted ? '恢复执行此节点' : '临时跳过此节点', shortcut: 'M' },
          { id: 'node:disconnect', label: '断开该节点全部连线', shortcut: '' },
          { type: 'sep' },
          { id: 'node:delete', label: '删除节点', shortcut: 'Del', danger: true },
        ];
      } else {
        searchPlaceholder = '搜索新建节点、分组或画布操作...';
        items = [
          ...(selNodes.length >= 2
            ? [
                { type: 'group', label: `当前已框选 ${selNodes.length} 个节点` },
                { id: 'sel:group', label: '将所选节点合并成组', shortcut: 'Ctrl+G', accent: true },
                { id: 'sel:align-top', label: '顶部对齐所选节点', shortcut: '对齐' },
                { id: 'sel:delete', label: `删除所选 ${selNodes.length} 个节点`, shortcut: 'Del', danger: true },
                { type: 'sep' },
              ]
            : []),
          { type: 'group', label: '在鼠标位置新建节点' },
          { id: 'add:gemini-plan', label: '+ 需求分析与规划', shortcut: '规划' },
          { id: 'add:codex-exec', label: '+ 代码实现', shortcut: '开发' },
          { id: 'add:custom-agent', label: '+ 外部模型节点', shortcut: '外部', accent: true },
          { id: 'add:cluster-merge', label: '+ 多路结果汇总', shortcut: '汇总' },
          { id: 'add:codex-review', label: '+ 代码审查', shortcut: '审查' },
          { id: 'add:summary-card', label: '+ 画布卡片总结框', shortcut: '总结框', accent: true },
          { id: 'add:gemini-copy', label: '+ 界面文案润色', shortcut: '文案' },
          ...(isPro
            ? [
                { id: 'add:image-gen', label: '+ 图像生成', shortcut: '图像' },
                { id: 'add:video-gen', label: '+ 视频生成', shortcut: '视频' },
              ]
            : []),
          { type: 'sep' },
          { type: 'group', label: '分组与画布整理' },
          { id: 'act:group', label: '合并成组 / 新建分组', shortcut: 'Ctrl+G' },
          { id: 'act:select-all', label: '全选画布节点', shortcut: 'Ctrl+A' },
          { id: 'act:layout', label: '按执行顺序自动排列', shortcut: 'L' },
          { id: 'act:fit', label: '适配全览全部节点', shortcut: 'F' },
          { type: 'sep' },
          { type: 'group', label: '工作流保存与文件' },
          { id: 'act:save', label: '保存当前工作流', shortcut: 'Ctrl+S' },
          { id: 'act:export', label: '导出工作流 (.json)', shortcut: '导出' },
          { id: 'act:blank', label: '新建空白画布', shortcut: '新建' },
          { id: 'act:undo', label: '撤销上一步操作', shortcut: 'Ctrl+Z' },
        ];
      }

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
              if (it.type === 'swatches') {
                return `
                  <div class="ic-ctx-swatch-row">
                    <span class="ic-ctx-swatch-label">分组配色</span>
                    <div class="ic-ctx-swatches">
                      ${GROUP_ACCENTS.map(
                        (ac) => `<button type="button" class="ic-ctx-swatch is-${ac} ${it.activeAccent === ac ? 'active' : ''}" data-ctx-swatch-group="${escapeHtml(it.groupId)}" data-ctx-swatch="${ac}" title="${escapeHtml(GROUP_ACCENT_LABELS[ac] || ac)}" aria-label="${escapeHtml(GROUP_ACCENT_LABELS[ac] || ac)}"></button>`
                      ).join('')}
                    </div>
                  </div>`;
              }
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

        bodyEl.querySelectorAll('[data-ctx-swatch]').forEach((btn) => {
          btn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const gid = btn.dataset.ctxSwatchGroup;
            const accent = btn.dataset.ctxSwatch;
            closeContextMenu();
            setGroupAccent(gid, accent);
          });
        });
      };

      contextMenuEl.innerHTML = `
        <div class="ic-ctx-search-wrap">
          <input type="text" class="ic-ctx-search" id="icCtxSearch" placeholder="${escapeHtml(searchPlaceholder)}" autocomplete="off" />
        </div>
        <div class="ic-ctx-body"></div>`;

      renderMenuItems('');
      contextMenuEl.classList.remove('hidden');
      placeMenuEdgeAware(clientX, clientY, 272);

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
      const { worldX, worldY, nodeId, groupId } = state.ctxMenu;
      closeContextMenu();
      if (!act) return;

      if (act.startsWith('add:')) {
        addNode(act.slice(4), { x: worldX - NODE_WIDTH / 2, y: worldY - 40, autoWire: false });
      } else if (act === 'act:group' || act === 'sel:group') {
        createNodeGroup();
      } else if (act === 'act:select-all') {
        selectAllNodes();
      } else if (act === 'act:layout') {
        autoLayout();
      } else if (act === 'act:fit') {
        fitView(true);
      } else if (act === 'act:save') {
        quickSaveWorkflow();
      } else if (act === 'act:export') {
        exportWorkflowFile();
      } else if (act === 'act:load') {
        openLibraryPopover(false);
      } else if (act === 'act:blank') {
        loadPreset('blank');
      } else if (act === 'act:undo') {
        undo();
      } else if (act === 'sel:run') {
        runSelectedNodes();
      } else if (act === 'sel:align-top') {
        alignSelectedNodes('top');
      } else if (act === 'sel:align-left') {
        alignSelectedNodes('left');
      } else if (act === 'sel:distribute-h') {
        alignSelectedNodes('distribute-h');
      } else if (act === 'sel:dup') {
        duplicateSelectedNodes();
      } else if (act === 'sel:mute') {
        toggleMuteSelectedNodes();
      } else if (act === 'sel:ungroup') {
        ungroupSelected();
      } else if (act === 'sel:disconnect') {
        const selSet = new Set(state.selectedIds);
        if (selSet.size > 0) {
          pushHistory();
          state.graph.edges = state.graph.edges.filter((e) => {
            const srcIn = selSet.has(e.source);
            const dstIn = selSet.has(e.target);
            return !(srcIn !== dstIn);
          });
          renderAll();
          scheduleAutoSave(300);
          setStatus('已断开所选节点与外部节点之间的连线。');
        }
      } else if (act === 'sel:delete') {
        removeSelectedNodes();
      } else if (act.startsWith('grp-direct-ungroup:')) {
        ungroupById(act.slice('grp-direct-ungroup:'.length));
      } else if (groupId && act.startsWith('grp:')) {
        const g = (state.graph.groups || []).find((x) => x.id === groupId);
        if (!g) return;
        if (act === 'grp:run') runGroupNodes(groupId);
        else if (act === 'grp:select') {
          if (g.collapsed) {
            pushHistory();
            g.collapsed = false;
            renderAll();
          }
          setSelection(g.nodeIds, g.nodeIds[0]);
          setStatus(`已选中分组「${g.title}」内的全部 ${g.nodeIds.length} 个节点。`);
        } else if (act === 'grp:toggle') {
          pushHistory();
          g.collapsed = !g.collapsed;
          renderAll();
          scheduleAutoSave(300);
        } else if (act === 'grp:dup') duplicateGroup(groupId);
        else if (act === 'grp:mute') toggleMuteGroup(groupId);
        else if (act === 'grp:ungroup') ungroupById(groupId);
        else if (act === 'grp:delete') removeGroupWithNodes(groupId);
      } else if (nodeId) {
        const node = state.graph.nodes.find((n) => n.id === nodeId);
        if (!node) return;
        if (act === 'node:model') {
          openModelPicker(nodeId, clickX, clickY);
        } else if (act === 'node:inspect') {
          setSelection([nodeId], nodeId, { updateDrawer: false });
          openResultDrawer('node');
        } else if (act === 'node:run') {
          runSinglePreview(nodeId);
        } else if (act === 'node:cli') {
          runSingleNodeLive(nodeId);
        } else if (act === 'node:downstream') {
          runFromNodeDownstream(nodeId);
        } else if (act === 'node:group') {
          createNodeGroup([nodeId]);
        } else if (act === 'node:leave-group') {
          removeNodesFromGroup([nodeId]);
        } else if (act.startsWith('node:join-group:')) {
          addNodesToGroup(act.slice('node:join-group:'.length), [nodeId]);
        } else if (act === 'node:dup') {
          duplicateNode(nodeId);
        } else if (act === 'node:mute') {
          pushHistory();
          node.muted = !node.muted;
          renderAll();
          scheduleAutoSave(300);
          setStatus(`节点「${node.title}」已${node.muted ? '设为跳过' : '恢复启用'}。`);
        } else if (act === 'node:disconnect') {
          pushHistory();
          state.graph.edges = state.graph.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
          renderAll();
          scheduleAutoSave(300);
          setStatus(`已断开「${node.title}」的全部连线。`);
        } else if (act === 'node:delete') {
          removeNode(nodeId);
        }
      }
    }

    /* =========================================================================
       Collapsible Right-Side Deliverable & Node Config/CoT Drawer
       ========================================================================= */
    let drawerEffortApi = null;

    function cleanupDrawerWidgets() {
      if (drawerEffortApi && typeof drawerEffortApi.destroy === 'function') {
        try { drawerEffortApi.destroy(); } catch {}
      }
      drawerEffortApi = null;
    }

    function openResultDrawer(tab = null) {
      state.drawerOpen = true;
      if (tab) state.drawerTab = tab;
      if (resultDrawerEl) resultDrawerEl.classList.remove('hidden');
      renderResultDrawer();
    }

    function closeResultDrawer() {
      state.drawerOpen = false;
      cleanupDrawerWidgets();
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

      cleanupDrawerWidgets();

      if (state.drawerTab === 'summary') {
        resultBodyEl.dataset.editingNodeId = '';
        const completedNodes = state.graph.nodes.filter((n) => statusMap.get(n.id) === 'completed');
        const totalWaves = topoWaves(state.graph).length;
        const reportMd =
          state.lastClusterReportMd ||
          `### 怎么使用这条工作流\n\n1. **在画布底部输入框写下任务**（例如：给设置页加一个导出按钮）。\n2. **按顺序检查每个节点**：点卡片上的「使用模型」可自由换成任意 Gemini / Codex / 外部 API，也可以拖拽连线调整顺序。\n3. **点「运行工作流」**：画布会按连线一步步调用真实模型，把上一步结果自动传给下一步，最后汇总到末尾的 **「画布卡片总结框」**。\n\n> 所有改动与生成结果都会像 ComfyUI 一样**自动保存到本地**；也可以点左上角「保存」命名收藏，或用左下角「导出 .json / 导入 .json」分享和复用。`;

        resultBodyEl.innerHTML = `
          <div class="ic-drawer-metrics">
            <div class="ic-metric-chip"><span class="mono-xs">已完成节点</span><strong>${completedNodes.length}/${state.graph.nodes.length}</strong></div>
            <div class="ic-metric-chip"><span class="mono-xs">执行波次</span><strong>${totalWaves} 步</strong></div>
            <div class="ic-metric-chip"><span class="mono-xs">节点连线</span><strong>${state.graph.edges.length} 条</strong></div>
          </div>
          ${
            state.lastTaskPrompt
              ? `<div class="ic-drawer-prompt-box"><span class="mono-xs">当前任务目标</span><p>${escapeHtml(state.lastTaskPrompt)}</p></div>`
              : ''
          }
          <div class="ic-drawer-md markdown-output">${md(reportMd)}</div>
          <div class="ic-drawer-node-list">
            <div class="mono-xs ic-drawer-subcap">全部节点清单（点击进入节点设置与输出）</div>
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
            <button type="button" class="btn-primary-sm" id="btnDrawerLiveRun">${state.demoRunning ? '停止运行' : '在画布中逐步运行'}</button>
            <button type="button" class="btn-secondary-sm" id="btnDrawerDispatchCli" title="切到对话流，以全链路模式执行（支持人工拍板与 Git Worktree）">转到对话流执行</button>
            <button type="button" class="btn-secondary-sm" id="btnDrawerPreviewFlow" title="不调用模型，仅演示节点流转顺序">演示顺序</button>
          </div>`;

        resultBodyEl.querySelectorAll('[data-pick-drawer-node]').forEach((b) => {
          b.addEventListener('click', () => {
            state.selectedId = b.dataset.pickDrawerNode;
            state.drawerTab = 'node';
            renderAll();
          });
        });

        resultBodyEl.querySelector('#btnDrawerLiveRun')?.addEventListener('click', () => {
          if (state.demoRunning) stopWorkflowRun();
          else runWorkflowLive();
        });
        resultBodyEl.querySelector('#btnDrawerDispatchCli')?.addEventListener('click', () => {
          dispatchFlowReal();
        });
        resultBodyEl.querySelector('#btnDrawerPreviewFlow')?.addEventListener('click', () => {
          runClusterDemo();
        });
      } else if (node) {
        resultBodyEl.dataset.editingNodeId = node.id;
        const tpl = NODE_TEMPLATES[node.kind] || NODE_TEMPLATES['codex-exec'];
        const upNodes = state.graph.edges
          .filter((e) => e.target === node.id)
          .map((e) => state.graph.nodes.find((x) => x.id === e.source)?.title)
          .filter(Boolean);
        const ctx = getContext ? getContext() : {};
        const writableOn = (ctx.sandbox || 'workspace-write') === 'workspace-write';

        resultBodyEl.innerHTML = `
          <div class="ic-drawer-edit-block">
            <label class="field-block">
              <span class="field-label">节点名称</span>
              <input type="text" class="text-input" id="icEditTitle" value="${escapeHtml(node.title)}" />
            </label>
            <div class="ic-drawer-model-row">
              <div class="field-block" style="flex:1">
                <span class="field-label">自由选择模型（支持全引擎）</span>
                <button type="button" class="text-input ic-drawer-pick-btn mono" id="btnDrawerPickModel">
                  <span>${escapeHtml(formatNodeModelLabel(node))}</span>
                  <span>▾</span>
                </button>
              </div>
              <div class="field-block" style="width:116px">
                <span class="field-label">推理深度</span>
                <button type="button" class="text-input ic-drawer-pick-btn mono" id="btnDrawerPickEffort">
                  <span>${escapeHtml(formatNodeEffortLabel(node))}</span>
                  <span>▾</span>
                </button>
              </div>
            </div>
            <div class="field-block" style="margin-top:4px">
              <div id="icDrawerEffortMount"></div>
            </div>
            <label class="field-block">
              <span class="field-label">${node.kind === 'summary-card' ? '总结与复述要求' : '这一步要做什么（节点提示词）'}</span>
              <textarea class="gate-editor" id="icEditPrompt" rows="3">${escapeHtml(node.prompt || '')}</textarea>
            </label>
            <div class="ic-drawer-meta-row mono-xs">
              <span>上游输入：${escapeHtml(upNodes.length ? upNodes.join('、') : '无（起始节点，直接接收你的任务）')}</span>
            </div>
            <div class="ic-drawer-toggles">
              <div class="wf-toggle-row">
                <div class="wf-toggle-text">
                  <div class="wf-toggle-label">临时跳过此节点</div>
                  <div class="wf-toggle-desc">开启后运行整条工作流时会跳过这一步</div>
                </div>
                <button type="button" class="wf-switch" role="switch" aria-checked="${Boolean(node.muted)}" id="btnDrawerMuteNode" aria-label="临时跳过此节点">
                  <span class="wf-switch-thumb"></span>
                </button>
              </div>
              ${
                node.kind === 'codex-exec'
                  ? `<div class="wf-toggle-row">
                      <div class="wf-toggle-text">
                        <div class="wf-toggle-label">允许写入工作区文件</div>
                        <div class="wf-toggle-desc">关闭则以只读方式分析，不修改代码</div>
                      </div>
                      <button type="button" class="wf-switch" role="switch" aria-checked="${writableOn}" data-drawer-sync="writable" aria-label="允许写入工作区文件">
                        <span class="wf-switch-thumb"></span>
                      </button>
                    </div>
                    <div class="wf-toggle-row">
                      <div class="wf-toggle-text">
                        <div class="wf-toggle-label">独立 Git 分支隔离（对话流模式）</div>
                        <div class="wf-toggle-desc">转到对话流全链路时在独立 Worktree 修改</div>
                      </div>
                      <button type="button" class="wf-switch" role="switch" aria-checked="${Boolean(ctx.worktree)}" data-drawer-sync="worktree" aria-label="独立 Git 分支隔离">
                        <span class="wf-switch-thumb"></span>
                      </button>
                    </div>`
                  : ''
              }
            </div>
          </div>

          ${
            state.canvasMode === 'pro'
              ? `<div class="ic-drawer-cot-section">
                  <div class="mono-xs ic-drawer-subcap">执行步骤（共 ${(node.steps || []).length} 步）</div>
                  <div class="ic-drawer-cot-list">${renderDrawerCoTStepsHtml(node)}</div>
                </div>`
              : ''
          }

          <div class="ic-drawer-md markdown-output">
            ${
              node.outputMd
                ? md(node.outputMd)
                : '<p class="mono-xs">该节点暂未产生输出。点击下方「单独运行此步」或底部「运行工作流」即可直接查看结果。</p>'
            }
          </div>

          <div class="ic-drawer-actions">
            <button type="button" class="btn-primary-sm" id="btnDrawerRealCli" ${node.muted ? 'disabled' : ''}>${node.kind === 'summary-card' ? '立即生成总结' : '单独运行此步'}</button>
            <button type="button" class="btn-secondary-sm" id="btnDrawerDownstream" ${node.muted ? 'disabled' : ''} title="保留上游已完成结果，从本节点开始继续执行全部下游节点">从此步续跑下游</button>
            ${state.canvasMode === 'pro' ? `<button type="button" class="btn-secondary-sm" id="btnDrawerRunNode" ${node.muted ? 'disabled' : ''}>仅预演步骤</button>` : ''}
            ${node.outputMd ? '<button type="button" class="btn-secondary-sm" id="btnDrawerCopyNodeOut">复制输出</button>' : ''}
          </div>`;

        let titlePushed = false;
        const titleInp = resultBodyEl.querySelector('#icEditTitle');
        titleInp?.addEventListener('focus', () => { titlePushed = false; });
        titleInp?.addEventListener('input', (e) => {
          if (!titlePushed) { pushHistory(); titlePushed = true; }
          node.title = e.target.value;
          const cardTitleInp = nodeEls.get(node.id)?.querySelector('.ic-inline-title');
          if (cardTitleInp) cardTitleInp.value = node.title;
          scheduleAutoSave(450);
        });

        let promptPushed = false;
        const promptInp = resultBodyEl.querySelector('#icEditPrompt');
        promptInp?.addEventListener('focus', () => { promptPushed = false; });
        promptInp?.addEventListener('input', (e) => {
          if (!promptPushed) { pushHistory(); promptPushed = true; }
          node.prompt = e.target.value;
          const cardPromptInp = nodeEls.get(node.id)?.querySelector('.ic-inline-prompt');
          if (cardPromptInp) cardPromptInp.value = node.prompt;
          scheduleAutoSave(450);
        });

        resultBodyEl.querySelector('#btnDrawerMuteNode')?.addEventListener('click', () => {
          pushHistory();
          node.muted = !node.muted;
          renderAll();
          scheduleAutoSave(300);
        });
        resultBodyEl.querySelectorAll('[data-drawer-sync]').forEach((sw) => {
          sw.addEventListener('click', () => {
            if (onToggleSync) onToggleSync(sw.dataset.drawerSync);
            renderResultDrawer();
          });
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
          drawerEffortApi = window.ConduitEffortSlider.mount(effMount, {
            defaultValue: node.effort || getContext()?.codexEffort || 'high',
            recommended: 'high',
            compact: true,
            title: '此节点推理深度',
            onChange: (lv) => {
              pushHistory();
              node.effort = lv;
              renderNodes();
              scheduleAutoSave(300);
              const btnSpan = resultBodyEl.querySelector('#btnDrawerPickEffort span');
              if (btnSpan) btnSpan.textContent = formatNodeEffortLabel(node);
            },
          });
        }
        resultBodyEl.querySelector('#btnDrawerCopyNodeOut')?.addEventListener('click', () => {
          if (node.outputMd && navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(node.outputMd).then(() => {
              if (onToast) onToast(`已复制「${node.title}」输出内容`);
            }).catch(() => {});
          }
        });
        resultBodyEl.querySelector('#btnDrawerRunNode')?.addEventListener('click', () => {
          runSinglePreview(node.id);
        });
        resultBodyEl.querySelector('#btnDrawerRealCli')?.addEventListener('click', () => {
          runSingleNodeLive(node.id);
        });
        resultBodyEl.querySelector('#btnDrawerDownstream')?.addEventListener('click', () => {
          runFromNodeDownstream(node.id);
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
      const ctx = getContext ? getContext() : {};
      const firstEnabledProv = kind === 'custom-agent' ? (ctx.providers || []).find((p) => p.enabled) : null;
      const node = hydrateNode({
        id,
        kind,
        title: kind === 'custom-agent' && firstEnabledProv
          ? `${firstEnabledProv.name} #${num}`
          : kind === 'summary-card' && num === 1
            ? '画布卡片总结框'
            : `${tpl.title} #${num}`,
        subtitle: kind === 'custom-agent' && firstEnabledProv ? `${firstEnabledProv.protocol} · 实时直连` : tpl.subtitle,
        model: firstEnabledProv ? `provider:${firstEnabledProv.id}:${firstEnabledProv.defaultModel || ''}` : '',
        x,
        y,
        w: tpl.defaultWidth || NODE_WIDTH,
        params:
          kind === 'gemini-plan'
            ? [{ k: '模型', dynamic: 'nodeModel' }, { k: '方案策略', v: '多方案对比' }]
            : kind === 'codex-exec'
              ? [{ k: '模型', dynamic: 'nodeModel' }, { k: '推理深度', dynamic: 'nodeEffort' }, { k: '工作分支', v: `wt/worker-${num}` }]
              : kind === 'custom-agent'
                ? [{ k: '模型', dynamic: 'nodeModel' }, { k: '执行方式', v: '实时直连' }]
                : kind === 'cluster-merge'
                  ? [{ k: '模型', dynamic: 'nodeModel' }, { k: '输入路数', dynamic: 'inCount' }]
                  : kind === 'codex-review'
                    ? [{ k: '模型', dynamic: 'nodeModel' }, { k: '推理深度', dynamic: 'nodeEffort' }, { k: '复审上限', dynamic: 'maxRounds' }]
                    : kind === 'summary-card'
                      ? [{ k: '模型', dynamic: 'nodeModel' }, { k: '输入路数', dynamic: 'inCount' }]
                      : [{ k: '模型', dynamic: 'nodeModel' }, { k: '风格', v: '简明直白' }],
        toggles:
          kind === 'codex-exec'
            ? [{ key: 'worktree', label: '独立分支隔离', desc: '在独立分支中开发' }]
            : kind === 'cluster-merge'
              ? [{ key: 'autoNewDiff', label: '包含新建文件', desc: '一并纳入代码对比' }]
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
      state.selectedIds = new Set([id]);
      renderAll();
      scheduleAutoSave(300);
      setStatus(`已添加「${node.title}」—— 点击卡片内「使用模型」可自由切换模型。`);
      if (onToast) onToast(`已添加节点：${node.title}`);
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
      state.selectedIds = new Set([copy.id]);
      renderAll();
      scheduleAutoSave(300);
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
      state.selectedIds.delete(id);
      if (state.selectedId === id) {
        const fallback = Array.from(state.selectedIds)[0] || state.graph.nodes[0]?.id || '';
        state.selectedId = fallback;
        if (fallback && state.selectedIds.size === 0) state.selectedIds.add(fallback);
      }
      renderAll();
      scheduleAutoSave(300);
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
        const validAccents = new Set(GROUP_ACCENTS);
        const safeGroups = Array.isArray(raw.groups)
          ? raw.groups
              .filter((g) => g && typeof g === 'object' && Array.isArray(g.nodeIds))
              .map((g, idx) => ({
                id: typeof g.id === 'string' && g.id ? g.id : `grp-load-${idx + 1}`,
                title: typeof g.title === 'string' && g.title.trim() ? g.title.trim() : `节点组 #${idx + 1}`,
                accent: validAccents.has(g.accent) ? g.accent : 'sage',
                nodeIds: Array.from(new Set(g.nodeIds.filter((nid) => idSet.has(nid)))),
                collapsed: Boolean(g.collapsed),
              }))
              .filter((g) => g.nodeIds.length > 0)
          : [];

        cancelActiveDemo(true);
        pushHistory();
        state.graph = { nodes: hydratedNodes, edges: safeEdges, groups: safeGroups };
        state.seq = Math.max(state.seq, maxNumericSuffix(state.graph) + 1);
        const firstId = state.graph.nodes[0]?.id || '';
        state.selectedId = firstId;
        state.selectedIds = firstId ? new Set([firstId]) : new Set();
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
      const validIds = new Set(state.graph.nodes.map((n) => n.id));
      state.selectedIds = new Set(Array.from(state.selectedIds).filter((id) => validIds.has(id)));
      if (!validIds.has(state.selectedId)) {
        state.selectedId = Array.from(state.selectedIds)[0] || state.graph.nodes[0]?.id || '';
        if (state.selectedId && state.selectedIds.size === 0) state.selectedIds.add(state.selectedId);
      }
      renderAll();
      scheduleAutoSave(300);
      if (onStatusChange) onStatusChange();
      setStatus('已撤销上一步画布操作。');
    }

    function loadPreset(name) {
      cancelActiveDemo(true);
      pushHistory();
      const tplNames = {
        linear: '标准四步流程',
        cluster: '前后端并行开发',
        multi: '全栈分层协作',
        blank: '空白画布',
      };
      if (name === 'linear') state.graph = makeLinearPreset();
      else if (name === 'multi') state.graph = makeMultiClusterPreset();
      else if (name === 'blank') state.graph = makeBlankPreset();
      else state.graph = makeClusterPreset();
      state.activeWorkflowId = null;
      state.activeWorkflowName = tplNames[name] || '标准四步流程';
      state.restoredViewport = false;
      state.seq = Math.max(state.seq, maxNumericSuffix(state.graph) + 1);
      const firstId = state.graph.nodes[0]?.id || '';
      state.selectedId = firstId;
      state.selectedIds = firstId ? new Set([firstId]) : new Set();
      if (onPresetChange) onPresetChange(name);
      renderAll();
      updateWorkflowHeaderHud();
      scheduleAutoSave(300);
      requestAnimationFrame(() => fitView(true));
      const hintMap = {
        linear: '已切换到「标准四步流程」：在底部输入任务 → 点「运行工作流」，结果会依次流进末尾总结框。',
        multi: '已切换到「全栈分层协作」：前后端并行处理，最终由画布卡片总结框输出结论与复述。',
        blank: '已切换到「空白画布」：点击左上角「+ 添加节点」或右键空白处自由搭建。',
        cluster: '已切换到「前后端并行开发」：前端与后端节点并行执行后汇总审查并总结。',
      };
      setStatus(hintMap[name] || hintMap.linear);
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
        if (onToast) onToast('当前所有节点均已设为跳过，请先恢复至少一个节点');
        setStatus('无法预演：当前画布中所有节点均被设为跳过。');
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
        n.steps = makeStepsForNode(n.kind, prompt ? `任务目标「${prompt.slice(0, 32)}」 · 模型 ${formatNodeModelLabel(n)}` : '');
        n.cotOpen = false;
      });

      const waves = topoWaves(state.graph).filter((w) => w.some((id) => !state.graph.nodes.find((n) => n.id === id)?.muted));
      setStatus(`正在预演 ${waves.length} 个执行阶段（不会修改本地文件）...`);
      renderAll();
      if (onStatusChange) onStatusChange();

      const completedLog = [];

      for (let w = 0; w < waves.length; w += 1) {
        if (token !== state.demoToken) return;
        const activeNodes = waves[w]
          .map((id) => state.graph.nodes.find((n) => n.id === id))
          .filter((n) => n && !n.muted);
        if (activeNodes.length === 0) continue;

        const names = activeNodes.map((n) => n.title).join('、');
        activeNodes.forEach((n) => {
          n.status = 'running';
          n.cotOpen = true;
        });
        if (!isEditingInDrawer()) state.selectedId = activeNodes[0].id;
        setStatus(`预演阶段 ${w + 1}/${waves.length}：${names}`);
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
          n.summarySource = 'preview';
          n.outputMd = buildNodeDeliverable(n, formatNodeModelLabel(n), prompt, upTitles, failed);
          completedLog.push(
            `- **阶段 ${w + 1} · ${n.title}**（\`${formatNodeModelLabel(n)}\`）：${failed ? '预演拦截示意' : `完成 ${n.steps.length} 个预演步骤`}`
          );
        });

        renderAll();
        if (res === 'blocked') {
          state.demoRunning = false;
          state.lastClusterReportMd = `## 流程预演在审查节点触发拦截示意\n\n- **预演目标**：${prompt || '当前画布流程演示'}\n- **拦截位置**：${names}\n\n### 阶段记录\n${completedLog.join('\n')}\n\n> 如需正常通过，请取消顶部「预演拦截」勾选后重新预演。`;
          setStatus('流程预演触发拦截示意，已在右侧面板展示详情。');
          openResultDrawer('summary');
          if (onStatusChange) onStatusChange();
          return;
        }
      }

      state.demoRunning = false;
      const mergeCount = allActive.filter((n) => n.kind === 'cluster-merge').length;
      state.lastClusterReportMd = `## 流程预演完成（未修改本地文件）\n\n- **预演目标**：${prompt || '当前画布流程演示'}\n- **流程结构**：共 **${waves.length} 个阶段** · **${allActive.length} 个启用节点**${mergeCount ? ` · **${mergeCount} 个汇总节点**` : ''}\n\n### 阶段流转记录\n${completedLog.join('\n')}\n\n> 以上为画布流程预演。确认无误后，可点击下方 **「按此流程真实执行」** 调起本机引擎开始实际工作。`;
      setStatus('流程预演完成（未修改本地文件）。点击右上角「按此流程执行」可发起真实任务。');
      openResultDrawer('summary');
      if (onStatusChange) onStatusChange();
    }

    function dispatchFlowReal(customPrompt = '') {
      const activeNodes = state.graph.nodes.filter((n) => !n.muted);
      if (activeNodes.length === 0) {
        if (onToast) onToast('当前所有节点均已跳过，请先恢复至少一个节点');
        return;
      }
      const userGoal = String(customPrompt || commandInputEl?.value || state.lastTaskPrompt || '').trim();
      if (userGoal) state.lastTaskPrompt = userGoal;

      if (activeNodes.length === 1) {
        const only = activeNodes[0];
        if (onDispatchRealCli) {
          onDispatchRealCli(only, userGoal || only.prompt);
        }
        return;
      }

      const planNode = activeNodes.find((n) => n.kind === 'gemini-plan');
      const codexNode = activeNodes.find((n) => n.kind === 'codex-exec');
      const waves = topoWaves(state.graph);
      const stepLines = [];
      waves.forEach((w, idx) => {
        const members = w
          .map((id) => activeNodes.find((n) => n.id === id))
          .filter(Boolean);
        if (!members.length) return;
        const desc = members.map((n) => `${n.title}（${n.prompt}）`).join('；');
        stepLines.push(`${idx + 1}. ${desc}`);
      });

      const finalPrompt = [
        userGoal || (planNode?.prompt || activeNodes[0]?.prompt || '按以下流程协作完成任务'),
        stepLines.length ? `\n\n【画布编排流程】\n${stepLines.join('\n')}` : '',
      ].join('');

      if (onDispatchRealCli) {
        onDispatchRealCli(
          {
            kind: 'cluster-merge',
            model: planNode?.model || '',
            codexModel: codexNode?.model || '',
            effort: codexNode?.effort || '',
          },
          finalPrompt
        );
      }
    }

    function collectUpstreamContext(targetNodeId) {
      const visited = new Set();
      const ordered = [];
      const walk = (nid) => {
        const incoming = state.graph.edges.filter((e) => e.target === nid);
        incoming.forEach((e) => {
          if (visited.has(e.source)) return;
          visited.add(e.source);
          walk(e.source);
          const up = state.graph.nodes.find((x) => x.id === e.source);
          if (up && !up.muted) ordered.push(up);
        });
      };
      walk(targetNodeId);

      const sections = [];
      ordered.forEach((up) => {
        if (up.outputMd && up.outputMd.trim()) {
          sections.push(`### 上游节点：${up.title}（${formatNodeModelLabel(up)}）\n${up.outputMd.trim().slice(0, 2200)}`);
        } else {
          sections.push(`### 上游节点：${up.title}（${formatNodeModelLabel(up)}）\n任务职责：${up.prompt || up.subtitle}`);
        }
      });

      const ctx = getContext ? getContext() : {};
      const run = ctx.currentRun;
      if (run) {
        const runBits = [];
        if (run.prompt) runBits.push(`原始任务：${String(run.prompt).slice(0, 800)}`);
        if (run.gemini?.planText) runBits.push(`规划输出：\n${String(run.gemini.planText).slice(0, 1800)}`);
        if (run.codex?.execText) runBits.push(`代码实现回报：\n${String(run.codex.execText).slice(0, 2200)}`);
        if (run.reviewVerdict?.summary) {
          runBits.push(`审查结论：${run.reviewVerdict.passed ? '通过' : '拦截'} — ${run.reviewVerdict.summary}`);
        }
        if (run.gemini?.summaryText) runBits.push(`已有阶段汇总：\n${String(run.gemini.summaryText).slice(0, 1500)}`);
        if (Array.isArray(run.messages) && run.messages.length > 0) {
          const recentMsgs = run.messages
            .filter((m) => m.content && m.content.trim())
            .slice(-6)
            .map((m) => `${m.role === 'user' ? '用户' : (m.engine || '助手')}：${String(m.content).slice(0, 1200)}`)
            .join('\n\n');
          if (recentMsgs) runBits.push(`对话流最新记录：\n${recentMsgs}`);
        }
        if (runBits.length > 0) {
          sections.push(`### 当前工作台真实执行上下文\n${runBits.join('\n\n')}`);
        }
      }

      return sections.join('\n\n---\n\n');
    }

    function buildLiveNodePrompts(node, taskPrompt) {
      const upstreamContext = collectUpstreamContext(node.id);
      const goal = String(state.activeRunPrompt || taskPrompt || state.lastTaskPrompt || '').trim();
      const tpl = NODE_TEMPLATES[node.kind] || NODE_TEMPLATES['codex-exec'];
      const nodeInstr = String(node.prompt || tpl.defaultPrompt || '').trim();
      const amendmentBanner = state.goalAmendmentNote
        ? `\n\n【运行中目标已更新（请以此最新目标为准）】\n${state.goalAmendmentNote}`
        : '';

      if (node.kind === 'summary-card') {
        const fullPrompt = [
          goal ? `【用户最终目标】\n${goal}${amendmentBanner}\n\n` : '',
          `【总结与复述要求】\n${nodeInstr}`,
          upstreamContext
            ? `\n\n【需要汇总的上游材料】\n${upstreamContext}`
            : '\n\n（当前暂无上游节点输出，请基于用户任务和当前工作目录简要给出结论与下一步建议。）',
          '\n\n请按以下两部分用清晰直白的中文作答（控制在 300 字以内，不要堆砌技术黑话）：',
          '\n### 最终结论\n（1-3 句点明最终结果、改动与状态）',
          '\n### 给你复述一遍\n（用自然口语化的 3-5 条要点直接向我复述核心内容和需要注意的地方）',
        ].join('');
        return {
          prompt: fullPrompt,
          systemPrompt: '你是 TENON 节点画布末尾的「画布卡片总结框」。你的职责是只读汇总上游所有节点输出，提炼清晰准确的最终结论并用口语化中文复述给用户，绝不修改任何文件。',
        };
      }

      const fullPrompt = [
        goal ? `【本次总任务目标】\n${goal}${amendmentBanner}\n\n` : '',
        `【当前节点：${node.title}】\n职责要求：${nodeInstr}`,
        upstreamContext ? `\n\n【上游节点传递下来的结果】\n${upstreamContext}` : '',
        '\n\n请用结构清晰、简洁直接的中文给出本节点的执行结果，方便直接传递给下一个节点继续处理。',
      ].join('');

      const readOnlyKinds = new Set(['gemini-plan', 'gemini-copy', 'codex-review', 'cluster-merge']);
      const sysPrompt = readOnlyKinds.has(node.kind)
        ? `你正在 TENON 多模型节点画布中执行只读步骤「${node.title}」。请专注完成该步骤的职责，直接输出清晰可用的结果，不要修改文件。`
        : `你正在 TENON 多模型节点画布中执行步骤「${node.title}」。请结合上游输入和当前工作目录完成本步骤任务，并清晰汇报修改内容与验证结果。`;

      return { prompt: fullPrompt, systemPrompt: sysPrompt };
    }

    async function executeCanvasNode(node, taskPrompt, signal) {
      if (!onRunCanvasNode) {
        throw new Error('当前环境未连接模型执行接口');
      }
      const { prompt, systemPrompt } = buildLiveNodePrompts(node, taskPrompt);
      return await onRunCanvasNode({
        node,
        model: node.model || '',
        prompt,
        systemPrompt,
        signal,
      });
    }

    function togglePauseWorkflow() {
      if (!state.demoRunning) return;
      state.pauseRequested = !state.pauseRequested;
      syncRunButtonUi();
      setStatus(
        state.pauseRequested
          ? '已预约暂停：当前步骤完成后将停在断点，你可以修改目标、节点指令或模型后再继续。'
          : '已取消暂停预约，工作流将继续自动往下执行。'
      );
      if (onToast) onToast(state.pauseRequested ? '已预约：本步完成后暂停' : '已取消暂停预约');
    }

    function stopWorkflowRun() {
      if (!state.demoRunning) return;
      const stepInfo = state.liveStepInfo;
      cancelActiveDemo(false);
      state.graph.nodes.forEach((n) => {
        if (n.status === 'running') {
          n.status = 'idle';
        }
      });
      if (stepInfo && stepInfo.totalWaves > 0) {
        state.pausedCheckpoint = {
          waveIndex: stepInfo.currentWaveIndex,
          totalWaves: stepInfo.totalWaves,
          targetNodeIds: stepInfo.targetNodeIds || null,
          prompt: state.activeRunPrompt || state.lastTaskPrompt || '',
          reason: 'interrupted',
        };
      }
      syncRunButtonUi();
      setStatus('已中途打断当前运行（上游已完成节点的输出均已保留，改完目标或模型后可点「从断点继续」）。');
      renderAll();
      scheduleAutoSave(250);
      if (onToast) onToast('已中途打断，上游已完成结果已保留');
      if (onStatusChange) onStatusChange();
    }

    function steerCanvasGoal(strategy = 'interrupt', newPromptRaw = '') {
      const nextGoal = String(newPromptRaw || commandInputEl?.value || '').trim();
      if (!nextGoal) {
        if (onToast) onToast('请先在底部输入框写下修改后的新目标');
        commandInputEl?.focus();
        return;
      }

      if (!state.demoRunning) {
        state.lastTaskPrompt = nextGoal;
        state.activeRunPrompt = nextGoal;
        if (commandInputEl && commandInputEl.value !== nextGoal) commandInputEl.value = nextGoal;
        if (state.pausedCheckpoint) {
          resumeFromCheckpoint();
        } else {
          runWorkflowLive(nextGoal);
        }
        return;
      }

      if (strategy === 'next') {
        state.activeRunPrompt = nextGoal;
        state.lastTaskPrompt = nextGoal;
        state.goalAmendmentNote = nextGoal;
        syncRunButtonUi();
        scheduleAutoSave(250);
        setStatus(`运行中目标已更新为「${nextGoal.slice(0, 36)}」：当前步跑完后，所有下游节点将按新目标继续。`);
        if (onToast) onToast('新目标已登记，下一步起自动生效');
        return;
      }

      // Immediate interrupt current wave and re-run from current wave with the new goal (upstream stays intact!)
      const currentWaveIndex = state.liveStepInfo?.currentWaveIndex ?? 0;
      const targetNodeIds = state.liveStepInfo?.targetNodeIds || null;
      cancelActiveDemo(false);
      state.graph.nodes.forEach((n) => {
        if (n.status === 'running') n.status = 'idle';
      });
      state.activeRunPrompt = nextGoal;
      state.lastTaskPrompt = nextGoal;
      state.goalAmendmentNote = nextGoal;
      if (commandInputEl && commandInputEl.value !== nextGoal) commandInputEl.value = nextGoal;
      if (onToast) onToast('已打断当前步，正在按新目标重跑本步及下游');
      void runWorkflowWaves({
        prompt: nextGoal,
        startWaveIndex: currentWaveIndex,
        targetNodeIds,
        preserveExistingOutputs: true,
      });
    }

    function resumeFromCheckpoint() {
      const cp = state.pausedCheckpoint;
      const nextGoal = String(commandInputEl?.value || cp?.prompt || state.lastTaskPrompt || '').trim();
      if (!nextGoal) {
        if (onToast) onToast('请先在底部输入框写下任务目标');
        commandInputEl?.focus();
        return;
      }
      if (cp && cp.prompt && nextGoal !== cp.prompt) {
        state.goalAmendmentNote = nextGoal;
      }
      const startWaveIndex = cp ? cp.waveIndex : 0;
      const targetNodeIds = cp?.targetNodeIds || null;
      state.pausedCheckpoint = null;
      void runWorkflowWaves({
        prompt: nextGoal,
        startWaveIndex,
        targetNodeIds,
        preserveExistingOutputs: true,
      });
    }

    function runFromNodeDownstream(startNodeId) {
      const startNode = state.graph.nodes.find((n) => n.id === startNodeId);
      if (!startNode || startNode.muted) return;
      const prompt = String(commandInputEl?.value || state.lastTaskPrompt || startNode.prompt || '').trim();
      if (!prompt) {
        if (onToast) onToast('请先在底部输入框写下任务目标');
        commandInputEl?.focus();
        return;
      }
      // BFS to collect startNodeId + all reachable downstream nodes
      const reachable = new Set([startNodeId]);
      const queue = [startNodeId];
      while (queue.length > 0) {
        const cur = queue.shift();
        state.graph.edges.forEach((e) => {
          if (e.source === cur && !reachable.has(e.target)) {
            reachable.add(e.target);
            queue.push(e.target);
          }
        });
      }
      state.pausedCheckpoint = null;
      void runWorkflowWaves({
        prompt,
        startWaveIndex: 0,
        targetNodeIds: reachable,
        preserveExistingOutputs: true,
      });
    }

    async function runWorkflowWaves({ prompt, startWaveIndex = 0, targetNodeIds = null, preserveExistingOutputs = false } = {}) {
      const allWaves = topoWaves(state.graph)
        .map((w) =>
          w.filter((id) => {
            const node = state.graph.nodes.find((n) => n.id === id);
            if (!node || node.muted) return false;
            if (targetNodeIds && !targetNodeIds.has(id)) return false;
            return true;
          })
        )
        .filter((w) => w.length > 0);

      if (allWaves.length === 0) {
        if (onToast) onToast('当前没有可运行的节点（请检查节点是否都被跳过）');
        return;
      }

      cancelActiveDemo(false);
      state.pausedCheckpoint = null;
      const token = ++state.demoToken;
      const controller = new AbortController();
      state.liveAbortController = controller;
      state.activeRunPrompt = prompt;
      state.lastTaskPrompt = prompt;
      if (commandInputEl && commandInputEl.value !== prompt) commandInputEl.value = prompt;
      if (!preserveExistingOutputs) {
        state.goalAmendmentNote = '';
        state.lastClusterReportMd = '';
      }
      state.demoRunning = true;
      state.pauseRequested = false;

      const safeStart = clampNum(startWaveIndex, 0, Math.max(0, allWaves.length - 1));

      // Clear only nodes at or after safeStart (preserve all earlier upstream waves when resuming/steering!)
      const resetIds = new Set();
      for (let i = safeStart; i < allWaves.length; i += 1) {
        allWaves[i].forEach((id) => resetIds.add(id));
      }
      state.graph.nodes.forEach((n) => {
        if (resetIds.has(n.id)) {
          n.status = 'idle';
          n.outputMd = '';
          n.summarySource = '';
          n.durationMs = 0;
        }
      });

      syncRunButtonUi();
      setStatus(
        safeStart > 0 || targetNodeIds
          ? `从第 ${safeStart + 1}/${allWaves.length} 步继续执行工作流（已保留上游结果）...`
          : `开始运行工作流（共 ${allWaves.length} 步），运行中可随时中途打断或修改目标...`
      );
      renderAll();
      if (onStatusChange) onStatusChange();

      const completedLog = [];
      let hadError = false;

      for (let w = safeStart; w < allWaves.length; w += 1) {
        if (token !== state.demoToken || controller.signal.aborted) return;

        // Honor mid-run Pause Checkpoint cleanly between waves
        if (state.pauseRequested && w > safeStart) {
          state.demoRunning = false;
          state.pauseRequested = false;
          state.liveAbortController = null;
          state.liveStepInfo = null;
          state.pausedCheckpoint = {
            waveIndex: w,
            totalWaves: allWaves.length,
            targetNodeIds,
            prompt: state.activeRunPrompt || prompt,
            reason: 'paused',
          };
          syncRunButtonUi();
          setStatus(`已暂停在第 ${w + 1}/${allWaves.length} 步前：现在可修改下方目标、节点指令或更换模型，改好点「从断点继续」。`);
          renderAll();
          scheduleAutoSave(200);
          if (onToast) onToast(`已暂停在第 ${w + 1} 步前，上游结果已保留`);
          if (onStatusChange) onStatusChange();
          return;
        }

        const activeNodes = allWaves[w]
          .map((id) => state.graph.nodes.find((n) => n.id === id))
          .filter((n) => n && !n.muted);
        if (activeNodes.length === 0) continue;

        const shortTitles = activeNodes.map((n) => n.title).join('、');
        const names = activeNodes.map((n) => `${n.title}（${formatNodeModelLabel(n)}）`).join('、');
        state.liveStepInfo = {
          currentWaveIndex: w,
          totalWaves: allWaves.length,
          activeTitles: shortTitles,
          targetNodeIds,
        };
        activeNodes.forEach((n) => { n.status = 'running'; });
        if (!isEditingInDrawer()) state.selectedId = activeNodes[0].id;
        syncRunButtonUi();
        setStatus(`正在运行第 ${w + 1}/${allWaves.length} 步：${names}...`);
        renderAll();
        if (onStatusChange) onStatusChange();

        const waveGoal = state.activeRunPrompt || prompt;
        const results = await Promise.all(
          activeNodes.map(async (node) => {
            try {
              const res = await executeCanvasNode(node, waveGoal, controller.signal);
              return { node, ok: true, res };
            } catch (err) {
              return { node, ok: false, err };
            }
          })
        );

        if (token !== state.demoToken || controller.signal.aborted) return;

        for (const r of results) {
          if (r.ok) {
            r.node.status = 'completed';
            r.node.durationMs = r.res?.durationMs || 0;
            r.node.summarySource = 'live';
            r.node.outputMd = (r.res?.text || '').trim() || '（模型已完成调用，未返回正文内容）';
            completedLog.push(`- **第 ${w + 1} 步 · ${r.node.title}**（\`${r.res?.engine || formatNodeModelLabel(r.node)}\` · ${((r.node.durationMs || 0) / 1000).toFixed(1)}s）：已完成`);
          } else {
            hadError = true;
            const errMsg = r.err?.message || '节点调用失败';
            r.node.status = 'error';
            r.node.summarySource = 'live';
            r.node.outputMd = `**运行出错**：${errMsg}\n\n可点击上方「使用模型」自由切换其他模型后，点「从断点继续」或本卡片「重试」。`;
            completedLog.push(`- **第 ${w + 1} 步 · ${r.node.title}**：失败（${errMsg}）`);
          }
        }

        renderAll();
        scheduleAutoSave(200);

        if (hadError) {
          state.demoRunning = false;
          state.pauseRequested = false;
          state.liveAbortController = null;
          state.liveStepInfo = null;
          state.pausedCheckpoint = {
            waveIndex: w,
            totalWaves: allWaves.length,
            targetNodeIds,
            prompt: state.activeRunPrompt || prompt,
            reason: 'interrupted',
          };
          syncRunButtonUi();
          state.lastClusterReportMd = `## 工作流在第 ${w + 1} 步暂停\n\n- **任务目标**：${state.activeRunPrompt || prompt}\n\n### 执行记录\n${completedLog.join('\n')}\n\n> 上游已完成步骤的结果均已自动保存。改完模型或目标后可直接点「从断点继续」。`;
          setStatus(`第 ${w + 1} 步出现错误已停在断点，前面已完成的结果已自动保存。`);
          if (onStatusChange) onStatusChange();
          return;
        }
      }

      state.demoRunning = false;
      state.pauseRequested = false;
      state.liveAbortController = null;
      state.liveStepInfo = null;
      state.pausedCheckpoint = null;
      const finalGoal = state.activeRunPrompt || prompt;
      state.goalAmendmentNote = '';
      syncRunButtonUi();
      state.lastClusterReportMd = `## 工作流运行完成\n\n- **最终目标**：${finalGoal}\n- **完成步骤**：共 ${allWaves.length} 步\n\n### 执行记录\n${completedLog.join('\n')}\n\n> 全部节点的输出和末尾总结已自动保存到本地，刷新或下次打开仍会保留。`;
      const hasSummary = state.graph.nodes.some((n) => !n.muted && n.kind === 'summary-card');
      setStatus(hasSummary
        ? '工作流运行完成，最终结论与复述已写入「画布卡片总结框」并自动保存'
        : '工作流运行完成，各节点结果已显示在卡片中并自动保存');
      renderAll();
      scheduleAutoSave(200);
      if (onToast) onToast('工作流运行完成，结果已自动保存');
      if (onStatusChange) onStatusChange();
    }

    async function runWorkflowLive(customPrompt = '', opts = {}) {
      const allActive = state.graph.nodes.filter((n) => !n.muted);
      if (allActive.length === 0) {
        if (onToast) onToast('当前所有节点均已设为跳过，请先恢复至少一个节点');
        return;
      }
      if (!opts.forceRestart && state.pausedCheckpoint) {
        resumeFromCheckpoint();
        return;
      }
      const prompt = String(customPrompt || commandInputEl?.value || state.lastTaskPrompt || '').trim();
      if (!prompt) {
        if (onToast) onToast('请先在画布底部输入框写下本次要完成的任务');
        commandInputEl?.focus();
        return;
      }
      if (!onRunCanvasNode) {
        runClusterDemo(prompt);
        return;
      }
      await runWorkflowWaves({
        prompt,
        startWaveIndex: 0,
        targetNodeIds: null,
        preserveExistingOutputs: false,
      });
    }

    async function runSingleNodeLive(nid) {
      const node = state.graph.nodes.find((n) => n.id === nid);
      if (!node || node.muted) return;
      if (!onRunCanvasNode) {
        runSinglePreview(nid);
        return;
      }

      cancelActiveDemo(false);
      const token = ++state.demoToken;
      const controller = new AbortController();
      const prompt = String(commandInputEl?.value || state.lastTaskPrompt || '').trim();
      if (prompt) state.lastTaskPrompt = prompt;
      state.activeRunPrompt = prompt;
      state.pausedCheckpoint = null;
      state.pauseRequested = false;
      state.goalAmendmentNote = '';
      state.liveAbortController = controller;
      state.liveStepInfo = {
        currentWaveIndex: 0,
        totalWaves: 1,
        activeTitles: node.title,
        targetNodeIds: new Set([nid]),
      };
      state.demoRunning = true;
      syncRunButtonUi();

      if (!isEditingInDrawer()) state.selectedId = nid;
      node.status = 'running';
      setStatus(`正在画布内运行「${node.title}」（使用模型：${formatNodeModelLabel(node)}）...`);
      renderAll();
      if (onStatusChange) onStatusChange();

      try {
        const res = await executeCanvasNode(node, prompt, controller.signal);
        if (token !== state.demoToken || controller.signal.aborted) return;
        node.durationMs = res.durationMs || 0;
        node.status = 'completed';
        node.summarySource = 'live';
        node.outputMd = (res.text || '').trim() || '（模型未返回正文内容）';
        state.demoRunning = false;
        state.liveAbortController = null;
        state.liveStepInfo = null;
        syncRunButtonUi();
        setStatus(`「${node.title}」运行完成（${((node.durationMs || 0) / 1000).toFixed(1)}s），结果已自动保存。`);
        renderAll();
        scheduleAutoSave(200);
        if (onToast) onToast(node.kind === 'summary-card' ? '画布卡片总结框已更新' : `「${node.title}」运行完成`);
        if (onStatusChange) onStatusChange();
      } catch (err) {
        if (token !== state.demoToken || controller.signal.aborted) return;
        node.status = 'error';
        node.summarySource = 'live';
        node.outputMd = `**运行失败**：${err.message || '未知错误'}\n\n可点击卡片上方「使用模型」自由切换其他模型后再重试。`;
        state.demoRunning = false;
        state.liveAbortController = null;
        state.liveStepInfo = null;
        syncRunButtonUi();
        setStatus(`「${node.title}」运行失败：${err.message}`);
        renderAll();
        scheduleAutoSave(200);
        if (onStatusChange) onStatusChange();
      }
    }

    async function runSummaryCardLive(nid) {
      return runSingleNodeLive(nid);
    }

    function runSingleRealOrInline(nid) {
      return runSingleNodeLive(nid);
    }

    async function runSinglePreview(nid) {
      const node = state.graph.nodes.find((n) => n.id === nid);
      if (!node) return;
      if (node.muted) {
        if (onToast) onToast('该节点已设为跳过，请先右键恢复后再运行');
        return;
      }
      const token = ++state.demoToken;
      const prompt = (node.prompt || commandInputEl?.value || state.lastTaskPrompt || '').trim();
      const ctx = getContext ? getContext() : {};
      let extRef = parseNodeProviderRef(node.model);
      if (!extRef && node.kind === 'custom-agent') {
        const first = (ctx.providers || []).find((p) => p.enabled);
        if (first) extRef = { providerId: first.id, model: first.defaultModel || '' };
      }

      // Real live execution when node is bound to an external local CLI Agent or HTTP API Provider!
      if (extRef && onRunProviderNode) {
        state.demoRunning = true;
        if (!isEditingInDrawer()) state.selectedId = nid;
        node.status = 'running';
        node.cotOpen = true;
        node.steps = [
          { id: 's-1', verb: '连接外部 Agent / API 引擎', detail: `目标：${formatNodeModelLabel(node)}`, status: 'completed', ms: 60 },
          { id: 's-2', verb: '实时流式推理执行中...', detail: prompt.slice(0, 80) || '等待响应', status: 'active', ms: 0 },
          { id: 's-3', verb: '整理交付成果', detail: '等待推理完成后落盘', status: 'pending', ms: 0 },
        ];
        setStatus(`正在实时调用外部引擎「${formatNodeModelLabel(node)}」...`);
        renderAll();
        if (onStatusChange) onStatusChange();

        try {
          const result = await onRunProviderNode(extRef.providerId, extRef.model, prompt || '请给出简短自检回复', node);
          if (token !== state.demoToken) return;
          node.durationMs = result.durationMs || 0;
          node.steps[1].status = 'completed';
          node.steps[1].ms = result.durationMs || 0;
          node.steps[1].detail = result.reasoning ? result.reasoning.slice(0, 260) : `响应完成 (${((result.durationMs || 0) / 1000).toFixed(1)}s)`;
          node.steps[2].status = 'completed';
          node.steps[2].detail = `协议 ${result.protocol || 'custom'} · 模型 ${result.model || 'default'}`;
          node.status = 'completed';
          const reasoningSection = result.reasoning
            ? `\n\n> **思考链摘要**\n> ${result.reasoning.replace(/\n+/g, '\n> ')}\n`
            : '';
          node.outputMd = `## ${node.title} · 真实外部执行交付\n\n- **引擎**：${result.providerName || formatNodeModelLabel(node)}（\`${result.model || result.protocol}\`）\n- **耗时**：\`${((result.durationMs || 0) / 1000).toFixed(2)}s\`${reasoningSection}\n\n---\n\n${result.text || '（无正文输出）'}`;
          state.demoRunning = false;
          setStatus(`外部引擎「${node.title}」执行完成（${((result.durationMs || 0) / 1000).toFixed(1)}s）。`);
          renderAll();
          openResultDrawer('node');
          if (onStatusChange) onStatusChange();
          return;
        } catch (err) {
          if (token !== state.demoToken) return;
          node.steps[1].status = 'error';
          node.steps[1].detail = err.message || '执行失败';
          node.status = 'error';
          node.outputMd = `## ${node.title} · 外部引擎调用失败\n\n- **目标引擎**：\`${formatNodeModelLabel(node)}\`\n- **错误详情**：${err.message || '未知错误'}\n\n> 可前往「设置 → Agent 与 API 接入」测试连接或检查 API Key / 本地 CLI。`;
          state.demoRunning = false;
          setStatus(`「${node.title}」外部调用失败：${err.message}`);
          renderAll();
          openResultDrawer('node');
          if (onStatusChange) onStatusChange();
          return;
        }
      }

      state.demoRunning = true;
      if (!isEditingInDrawer()) state.selectedId = nid;
      node.status = 'running';
      node.cotOpen = true;
      node.steps = makeStepsForNode(node.kind, prompt ? `模型 ${formatNodeModelLabel(node)} · 任务：${prompt.slice(0, 28)}` : '');
      setStatus(`正在预演「${node.title}」（${formatNodeModelLabel(node)}）...`);
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
      node.summarySource = 'preview';
      node.outputMd = buildNodeDeliverable(node, formatNodeModelLabel(node), prompt, upTitles, failed);
      state.demoRunning = false;
      setStatus(`「${node.title}」${failed ? '预演触发拦截示意。' : '预演完成。'}`);
      renderAll();
      if (node.kind !== 'summary-card') openResultDrawer('node');
      if (onStatusChange) onStatusChange();
    }

    function resetDemo() {
      cancelActiveDemo(true);
      state.graph.nodes.forEach((n) => {
        n.status = 'idle';
        n.outputMd = '';
        n.summarySource = '';
        n.durationMs = 0;
        n.cotOpen = false;
        n.steps = makeStepsForNode(n.kind);
      });
      setStatus('已清空全部节点输出结果（节点布局、模型与提示词均保留）。');
      renderAll();
      scheduleAutoSave(300);
      if (onStatusChange) onStatusChange();
    }

    function exportJson() {
      exportWorkflowFile();
    }

    // --- Context Menu, Library/Add Popovers & Drag-and-Drop .json Import ---
    document.addEventListener('pointerdown', (e) => {
      if (state.ctxMenu.open && contextMenuEl && !contextMenuEl.contains(e.target)) {
        closeContextMenu();
      }
      if (state.libraryOpen && libraryPopoverEl && !libraryPopoverEl.contains(e.target) && !libraryBtnEl?.contains(e.target)) {
        closeLibraryPopover();
      }
      if (state.addMenuOpen && addMenuPopoverEl && !addMenuPopoverEl.contains(e.target) && !addMenuBtnEl?.contains(e.target)) {
        closeAddMenuPopover();
      }
    });

    let dragFileDepth = 0;
    const hasFileTransfer = (ev) => Boolean(ev.dataTransfer && Array.from(ev.dataTransfer.types || []).includes('Files'));
    viewportEl.addEventListener('dragenter', (e) => {
      if (!hasFileTransfer(e)) return;
      e.preventDefault();
      dragFileDepth += 1;
      dropOverlayEl?.classList.remove('hidden');
    });
    viewportEl.addEventListener('dragover', (e) => {
      if (!hasFileTransfer(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    viewportEl.addEventListener('dragleave', (e) => {
      if (!hasFileTransfer(e)) return;
      dragFileDepth = Math.max(0, dragFileDepth - 1);
      if (dragFileDepth === 0) dropOverlayEl?.classList.add('hidden');
    });
    viewportEl.addEventListener('drop', async (e) => {
      if (!hasFileTransfer(e)) return;
      e.preventDefault();
      dragFileDepth = 0;
      dropOverlayEl?.classList.add('hidden');
      const file = Array.from(e.dataTransfer.files || []).find((f) => /\.json$/i.test(f.name) || f.type === 'application/json');
      if (!file) {
        if (onToast) onToast('请拖入 TENON 导出的 .json 工作流文件');
        return;
      }
      try {
        const text = await file.text();
        importWorkflowJsonText(text, file.name);
      } catch (err) {
        if (onToast) onToast(`读取拖入文件失败：${err.message || err}`);
      }
    });

    // Suppress native Windows middle-click autoscroll icon & auxclick behavior on canvas
    viewportEl.addEventListener('mousedown', (e) => {
      if (e.button === 1 && !e.target.closest(OVERLAY_SEL)) {
        e.preventDefault();
      }
    });
    viewportEl.addEventListener('auxclick', (e) => {
      if (e.button === 1 && !e.target.closest(OVERLAY_SEL)) {
        e.preventDefault();
      }
    });

    viewportEl.addEventListener('contextmenu', (e) => {
      if (e.target.closest(OVERLAY_SEL)) return;
      e.preventDefault();
      const groupHead = e.target.closest('.ic-group-head, .ic-node-group.is-collapsed');
      const gid = groupHead ? (groupHead.dataset.groupDrag || groupHead.closest('.ic-node-group')?.dataset.groupId || null) : null;
      if (gid) {
        openContextMenu(e.clientX, e.clientY, null, gid);
        return;
      }
      const nodeWrap = e.target.closest('.ic-node-wrap');
      const nid = nodeWrap ? nodeWrap.dataset.nodeId : null;
      if (nid) {
        if (!state.selectedIds.has(nid)) {
          setSelection([nid], nid);
        } else {
          state.selectedId = nid;
        }
      }
      openContextMenu(e.clientX, e.clientY, nid, null);
    });

    viewportEl.addEventListener('scroll', () => {
      if (viewportEl.scrollLeft !== 0) viewportEl.scrollLeft = 0;
      if (viewportEl.scrollTop !== 0) viewportEl.scrollTop = 0;
    });

    viewportEl.addEventListener('dblclick', (e) => {
      if (e.target.closest(OVERLAY_SEL)) return;
      if (e.target.closest('.ic-node-wrap, .ic-group-head, .ic-node-group.is-collapsed, .ic-edge-group')) return;
      e.preventDefault();
      openContextMenu(e.clientX, e.clientY, null, null);
    });

    function updateMarqueeVisual(m) {
      if (!marqueeBoxEl) return;
      const vpRect = viewportEl.getBoundingClientRect();
      const x1 = clampNum(Math.min(m.startClientX, m.currentClientX) - vpRect.left, 0, vpRect.width);
      const y1 = clampNum(Math.min(m.startClientY, m.currentClientY) - vpRect.top, 0, vpRect.height);
      const x2 = clampNum(Math.max(m.startClientX, m.currentClientX) - vpRect.left, 0, vpRect.width);
      const y2 = clampNum(Math.max(m.startClientY, m.currentClientY) - vpRect.top, 0, vpRect.height);
      marqueeBoxEl.style.left = `${x1}px`;
      marqueeBoxEl.style.top = `${y1}px`;
      marqueeBoxEl.style.width = `${Math.max(1, x2 - x1)}px`;
      marqueeBoxEl.style.height = `${Math.max(1, y2 - y1)}px`;
      marqueeBoxEl.classList.remove('hidden');
    }

    function applyMarqueeHitTest(m) {
      const wA = screenToWorld(Math.min(m.startClientX, m.currentClientX), Math.min(m.startClientY, m.currentClientY));
      const wB = screenToWorld(Math.max(m.startClientX, m.currentClientX), Math.max(m.startClientY, m.currentClientY));
      const hits = new Set(m.additive ? m.baseSelection : []);
      state.graph.nodes.forEach((n) => {
        if (getCollapsedGroupForNode(n.id)) return;
        const wrap = nodeEls.get(n.id);
        const nw = nodeWidth(n);
        const nh = wrap ? wrap.offsetHeight : (n.collapsed ? 84 : 260);
        const overlaps = n.x < wB.x && n.x + nw > wA.x && n.y < wB.y && n.y + nh > wA.y;
        if (overlaps) hits.add(n.id);
      });
      state.selectedIds = hits;
      if (!hits.has(state.selectedId)) {
        const arr = Array.from(hits);
        state.selectedId = arr[arr.length - 1] || '';
      }
      syncSelectionClasses();
    }

    // --- Pointer & Wheel Events on Infinite Viewport ---
    // Middle-mouse drag OR Space+Left-drag => Pan canvas
    // Left-mouse drag on empty canvas => Desktop-style Marquee Box Selection
    viewportEl.addEventListener('pointerdown', (e) => {
      const isUi = Boolean(e.target.closest(OVERLAY_SEL));
      if (isUi || state.dragging || state.wiring || state.resizing) return;

      // Middle-click pans from ANYWHERE inside the canvas viewport (even over nodes/groups!)
      if (e.button === 1 || (e.button === 0 && state.spaceDown)) {
        if (document.activeElement instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
          document.activeElement.blur();
        }
        e.preventDefault();
        closeContextMenu();
        state.panning = {
          startX: e.clientX,
          startY: e.clientY,
          originPanX: state.panX,
          originPanY: state.panY,
          pointerId: e.pointerId,
        };
        viewportEl.classList.add('is-panning');
        try { viewportEl.setPointerCapture(e.pointerId); } catch {}
        return;
      }

      if (e.target.closest('input, textarea, select, .ic-resize-handle')) return;
      const isBg = !e.target.closest('.ic-node-wrap, .ic-group-head, .ic-node-group.is-collapsed, .ic-edge-group');
      if (isBg && e.button === 0) {
        if (document.activeElement instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
          document.activeElement.blur();
        }
        closeContextMenu();
        let changed = false;
        if (state.selectedEdgeId) { state.selectedEdgeId = null; changed = true; }
        if (state.pendingWire) { state.pendingWire = null; changed = true; setStatus('已取消连线。'); }
        if (changed) renderAll();

        // Start left-drag marquee box selection
        state.marquee = {
          startClientX: e.clientX,
          startClientY: e.clientY,
          currentClientX: e.clientX,
          currentClientY: e.clientY,
          additive: e.shiftKey || e.ctrlKey || e.metaKey,
          baseSelection: new Set(state.selectedIds),
          moved: false,
          captured: false,
          pointerId: e.pointerId,
        };
      }
    });

    viewportEl.addEventListener('pointermove', (e) => {
      if (state.panning && e.pointerId === state.panning.pointerId) {
        state.panX = state.panning.originPanX + (e.clientX - state.panning.startX);
        state.panY = state.panning.originPanY + (e.clientY - state.panning.startY);
        applyTransform();
        return;
      }

      if (state.marquee && e.pointerId === state.marquee.pointerId) {
        const m = state.marquee;
        m.currentClientX = e.clientX;
        m.currentClientY = e.clientY;
        if (!m.moved) {
          if (Math.hypot(e.clientX - m.startClientX, e.clientY - m.startClientY) < DRAG_THRESHOLD) return;
          m.moved = true;
          viewportEl.classList.add('is-marquee');
          try {
            viewportEl.setPointerCapture(e.pointerId);
            m.captured = true;
          } catch {}
        }
        updateMarqueeVisual(m);
        applyMarqueeHitTest(m);
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
        const drag = state.dragging;
        const node = state.graph.nodes.find((n) => n.id === drag.id);
        if (!node) return;
        if (!drag.moved) {
          const dist = Math.hypot(e.clientX - drag.startClientX, e.clientY - drag.startClientY);
          if (dist < DRAG_THRESHOLD) return;
          drag.moved = true;
          pushHistory();
          drag.origins.forEach((_orig, id) => {
            const w = nodeEls.get(id);
            if (w) w.classList.add('is-dragging');
          });
          try {
            viewportEl.setPointerCapture(e.pointerId);
            drag.captured = true;
          } catch {}
        }
        const pt = screenToWorld(e.clientX, e.clientY);
        let dx = pt.x - drag.startWorldX;
        let dy = pt.y - drag.startWorldY;
        if (e.shiftKey) {
          const anchorOrig = drag.origins.get(drag.id) || { x: node.x, y: node.y };
          const snappedX = Math.round((anchorOrig.x + dx) / GRID_SNAP) * GRID_SNAP;
          const snappedY = Math.round((anchorOrig.y + dy) / GRID_SNAP) * GRID_SNAP;
          dx = snappedX - anchorOrig.x;
          dy = snappedY - anchorOrig.y;
        }
        drag.origins.forEach((orig, id) => {
          const n = state.graph.nodes.find((x) => x.id === id);
          if (!n) return;
          n.x = Math.round(orig.x + dx);
          n.y = Math.round(orig.y + dy);
          const wrap = nodeEls.get(id);
          if (wrap) wrap.style.transform = `translate(${n.x}px,${n.y}px)`;
        });
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
        if (!state.wiring.moved && Math.hypot(e.clientX - state.wiring.startClientX, e.clientY - state.wiring.startClientY) >= 6) {
          state.wiring.moved = true;
          setStatus(state.wiring.side === 'out'
            ? '拖至目标节点卡片或左侧输入端口松手即可连线。'
            : '拖至上游节点卡片或右侧输出端口松手即可连线。');
        }
        const stack = document.elementsFromPoint(e.clientX, e.clientY);
        const blockedByUi = stack.length > 0 && Boolean(stack[0].closest(OVERLAY_SEL));
        const wantSide = state.wiring.side === 'out' ? 'in' : 'out';
        const portHit = blockedByUi ? null : stack.find((el) => el.dataset?.portSide === wantSide);
        const cardHit = blockedByUi || portHit ? null : stack.find((el) => el.classList?.contains('ic-node-wrap'));
        const nextHover = portHit
          ? portHit.dataset.portNode
          : (cardHit && cardHit.dataset.nodeId !== state.wiring.anchorId ? cardHit.dataset.nodeId : null);
        if (state.wiring.hoverTargetId !== nextHover) {
          nodesLayerEl.querySelectorAll('.wf-port.is-drop-target').forEach((p) => p.classList.remove('is-drop-target'));
          if (nextHover) {
            const srcId = state.wiring.side === 'out' ? state.wiring.anchorId : nextHover;
            const dstId = state.wiring.side === 'out' ? nextHover : state.wiring.anchorId;
            if (canConnect(state.graph, srcId, dstId)) {
              const targetPort = portHit || nodesLayerEl.querySelector(`[data-port-node="${CSS.escape(nextHover)}"][data-port-side="${wantSide}"]`);
              targetPort?.classList.add('is-drop-target');
            }
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
        if (!cancel) scheduleAutoSave(600);
      }
      if (state.marquee && (cancel || e.pointerId === state.marquee.pointerId)) {
        const m = state.marquee;
        if (m.captured) {
          try { viewportEl.releasePointerCapture(m.pointerId); } catch {}
        }
        state.marquee = null;
        viewportEl.classList.remove('is-marquee');
        if (marqueeBoxEl) marqueeBoxEl.classList.add('hidden');
        if (!cancel) {
          if (!m.moved) {
            if (!m.additive) clearSelection();
          } else {
            syncSelectionBar();
            const cnt = state.selectedIds.size;
            if (cnt >= 2) {
              setStatus(`已框选 ${cnt} 个节点：可整体拖动、点上方或右键「合并成组 (Ctrl+G)」或批量对齐。`);
            } else if (cnt === 1) {
              if (state.drawerOpen && state.drawerTab === 'node') renderResultDrawer();
            }
          }
        }
      }
      if (state.resizing && (cancel || e.pointerId === state.resizing.pointerId)) {
        const wasMoved = state.resizing.moved;
        const wrap = nodeEls.get(state.resizing.id);
        if (wrap) wrap.classList.remove('is-resizing');
        if (state.resizing.captured) {
          try { viewportEl.releasePointerCapture(state.resizing.pointerId); } catch {}
        }
        state.resizing = null;
        drawMinimap();
        if (wasMoved && !cancel) scheduleAutoSave(350);
      }
      if (state.dragging && (cancel || e.pointerId === state.dragging.pointerId)) {
        const drag = state.dragging;
        const wasMoved = drag.moved;
        drag.origins.forEach((_orig, id) => {
          const w = nodeEls.get(id);
          if (w) w.classList.remove('is-dragging');
        });
        if (drag.captured) {
          try { viewportEl.releasePointerCapture(drag.pointerId); } catch {}
        }
        state.dragging = null;
        if (!wasMoved && !cancel && drag.narrowOnClick) {
          setSelection([drag.id], drag.id);
        }
        drawMinimap();
        if (wasMoved && !cancel) scheduleAutoSave(350);
      }
      if (state.draggingGroup && (cancel || e.pointerId === state.draggingGroup.pointerId)) {
        const wasMoved = state.draggingGroup.moved;
        if (state.draggingGroup.captured) {
          try { viewportEl.releasePointerCapture(state.draggingGroup.pointerId); } catch {}
        }
        state.draggingGroup = null;
        drawMinimap();
        if (wasMoved && !cancel) scheduleAutoSave(350);
      }
      if (state.wiring && (cancel || e.pointerId === state.wiring.pointerId)) {
        const { side, anchorId, moved, hoverTargetId, pointerId } = state.wiring;
        nodesLayerEl.querySelectorAll('.wf-port.is-drop-target').forEach((p) => p.classList.remove('is-drop-target'));
        try { viewportEl.releasePointerCapture(pointerId); } catch {}
        state.wiring = null;

        if (cancel) {
          renderEdges();
          return;
        }

        // Click-to-connect mode (when pointer barely moved on a port)
        if (!moved) {
          if (state.pendingWire) {
            if (state.pendingWire.nodeId === anchorId && state.pendingWire.side === side) {
              state.pendingWire = null;
              setStatus('已取消端口连线。');
              renderAll();
              return;
            }
            if (state.pendingWire.side !== side) {
              const srcId = state.pendingWire.side === 'out' ? state.pendingWire.nodeId : anchorId;
              const dstId = state.pendingWire.side === 'out' ? anchorId : state.pendingWire.nodeId;
              connectNodes(srcId, dstId);
              return;
            }
          }
          state.pendingWire = { side, nodeId: anchorId };
          setStatus(side === 'out'
            ? '已选中输出端口：点击另一个节点的输入端口完成连线（按 Esc 取消）。'
            : '已选中输入端口：点击上游节点的输出端口完成连线（按 Esc 取消）。');
          renderAll();
          return;
        }

        // Drag-to-connect mode
        const stack = document.elementsFromPoint(e.clientX, e.clientY);
        const blockedByUi = stack.length > 0 && Boolean(stack[0].closest(OVERLAY_SEL));
        const wantSide = side === 'out' ? 'in' : 'out';
        const portHit = blockedByUi ? null : stack.find((el) => el.dataset?.portSide === wantSide);
        const cardHit = blockedByUi || portHit ? null : stack.find((el) => el.classList?.contains('ic-node-wrap'));
        const targetId = portHit
          ? portHit.dataset.portNode
          : (cardHit && cardHit.dataset.nodeId !== anchorId ? cardHit.dataset.nodeId : hoverTargetId);

        if (targetId && targetId !== anchorId) {
          const srcId = side === 'out' ? anchorId : targetId;
          const dstId = side === 'out' ? targetId : anchorId;
          if (!connectNodes(srcId, dstId)) {
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
        scheduleAutoSave(700);
      },
      { passive: false }
    );

    // Canvas Keyboard Shortcuts (ComfyUI + Desktop Multi-Select & Group Shortcuts)
    window.addEventListener('keydown', (e) => {
      if (viewportEl.closest('.hidden') || e.isComposing) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        quickSaveWorkflow();
        return;
      }
      if (e.key === 'Escape') {
        closeAllCanvasPopovers();
        if (state.marquee) finishPointer({ pointerId: state.marquee.pointerId }, true);
        if (state.pendingWire || state.selectedEdgeId) {
          state.pendingWire = null;
          state.selectedEdgeId = null;
          setStatus(DEFAULT_GUIDE_TEXT);
          renderAll();
        } else if (state.selectedIds.size > 1) {
          clearSelection();
          setStatus(DEFAULT_GUIDE_TEXT);
        }
        return;
      }
      const tag = (e.target?.tagName || '').toLowerCase();
      if (['input', 'textarea', 'select'].includes(tag)) return;
      if (e.target?.closest?.('.ic-result-drawer, .studio-drawer, .inspector-pane, .tweaks-panel, .floating-popover, .ic-ctx-menu, .c-modal, .mg-lightbox')) return;
      const studioEl = document.getElementById('studioDrawer');
      if (studioEl && !studioEl.classList.contains('hidden')) return;
      if (document.querySelector('.c-modal:not(.hidden), .mg-lightbox:not(.hidden)')) return;

      const hasMod = e.ctrlKey || e.metaKey || e.altKey;
      const keyLower = e.key.toLowerCase();

      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && keyLower === 'z') {
        e.preventDefault();
        undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && keyLower === 'a') {
        e.preventDefault();
        selectAllNodes();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && keyLower === 'g') {
        e.preventDefault();
        createNodeGroup();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.shiftKey && keyLower === 'g') {
        e.preventDefault();
        ungroupSelected();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && keyLower === 'd') {
        e.preventDefault();
        duplicateSelectedNodes();
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
        openContextMenu(r.left + r.width / 2, r.top + r.height / 2, null, null);
      } else if (e.shiftKey && keyLower === 'd' && (state.selectedIds.size > 0 || state.selectedId)) {
        e.preventDefault();
        duplicateSelectedNodes();
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
      } else if (!e.shiftKey && keyLower === 'm' && (state.selectedIds.size > 0 || state.selectedId)) {
        e.preventDefault();
        toggleMuteSelectedNodes();
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
      } else if (!e.shiftKey && (e.key === 'Delete' || e.key === 'Backspace')) {
        if (state.selectedEdgeId) {
          e.preventDefault();
          pushHistory();
          state.graph.edges = state.graph.edges.filter((ed) => ed.id !== state.selectedEdgeId);
          state.selectedEdgeId = null;
          renderAll();
          setStatus('已断开所选连线（按 Ctrl+Z 可撤销）。');
        } else if (state.selectedIds.size > 0 || state.selectedId) {
          e.preventDefault();
          removeSelectedNodes();
        }
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

    // Hydrate saved draft synchronously (zero flash!) then sync named workflows & latest disk state
    syncCanvasModeUi();
    const localUpdatedAt = restoreFromLocalSync();
    renderAll();
    updateWorkflowHeaderHud();
    syncRunButtonUi();
    syncFromServerAsync(localUpdatedAt);

    return {
      render: renderAll,
      setCanvasMode,
      getCanvasMode: () => state.canvasMode,
      fitView,
      autoLayout,
      zoomIn: () => { zoomAt(1.18); scheduleAutoSave(600); },
      zoomOut: () => { zoomAt(1 / 1.18); scheduleAutoSave(600); },
      resetZoom: () => { state.zoom = 1; applyTransform(); scheduleAutoSave(600); },
      addNode,
      createNodeGroup,
      undo,
      loadPreset,
      quickSaveWorkflow,
      saveNamedWorkflow,
      loadSavedWorkflow,
      exportWorkflowFile,
      importWorkflowJsonText,
      saveCustomTemplate: quickSaveWorkflow,
      loadCustomTemplate: () => openLibraryPopover(false),
      runWorkflowLive,
      stopWorkflowRun,
      togglePauseWorkflow,
      steerCanvasGoal,
      resumeFromCheckpoint,
      runFromNodeDownstream,
      hasModifiedGoalWhileRunning,
      runSingleNodeLive,
      runClusterDemo,
      dispatchFlowReal,
      resetDemo,
      exportJson,
      flushDraft,
      hasRestoredViewport: () => Boolean(state.restoredViewport),
      setTaskPrompt: (val) => {
        state.lastTaskPrompt = String(val || '');
        syncLiveSteerBar();
        scheduleAutoSave(500);
      },
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
