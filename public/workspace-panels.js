(() => {
  'use strict';

  /**
   * CONDUIT Workspace Panels — Native Zero-Dep Ports of 21st.dev `chatcn` Components:
   *   - Custom Instructions (#46412): Response styles with live sample + instructions + one-tap chips
   *   - Memory Manager (#46393): Topic-grouped memories, live search, inline edit, delete + undo, capacity bar
   *   - Keyboard Shortcuts (#46395): Searchable grouped hotkey sheet with platform-aware <kbd> keycaps
   *   - Command Palette (#45520): Ranked Mod+K search across actions, threads, and local CLI models
   */

  const STORAGE_INSTR = 'conduit_custom_instructions_v1';
  const STORAGE_MEM = 'conduit_memories_v1';
  const MAX_MEMORIES = 24;
  const MAX_INSTR_LEN = 1500;
  const IS_APPLE = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');
  const MOD_KEY = IS_APPLE ? '⌘' : 'Ctrl';

  const PERSONALITIES = [
    {
      id: 'default',
      name: '默认均衡',
      desc: '先给明确结论，再展开关键接口与改动步骤。',
      sample: '`server.mjs` 需要新增只读媒体路由，建议限定在当前工作区目录并启用 `Range` 分片响应，确保视频拖拽零卡顿。',
    },
    {
      id: 'concise',
      name: '精炼直给',
      desc: '剔除寒暄与铺垫，直接给命令、补丁与结论。',
      sample: '根因：缺少 `/api/workspace/media` 的路径前缀校验。修复：使用 `path.resolve` 锁定工作区白名单并返回 403。',
    },
    {
      id: 'explanatory',
      name: '架构详解',
      desc: '阐明边界权衡、数据流与回归风险，适合方案评审。',
      sample: '采用固定定位 Portal 渲染下拉菜单可以脱离父容器 `overflow-x: auto` 裁剪，同时维持原生 `<select>` 作为唯一状态源以避免表单状态分叉。',
    },
    {
      id: 'candid',
      name: '犀利直白',
      desc: '像严苛架构师一样直接挑刺，不绕弯子。',
      sample: '这个接口把工作区路径和文件名直接拼接存在目录穿越隐患，必须先做规范化前缀校验，否则 Pre-CI 门禁绝不应放行。',
    },
  ];

  const INSTR_SUGGESTIONS = [
    '先给代码或结论，再简短解释原因',
    '所有路径与命令遵循 Windows PowerShell 语法',
    '高危改动前先列清影响文件与回滚方案',
    '输出文案禁止使用 AI 营销腔',
  ];

  const DEFAULT_MEMORIES = [
    {
      id: 'mem-1',
      topic: '工程偏好',
      text: '始终优先使用本地官方 Gemini (agy) 与 Codex CLI 订阅额度，不配置任何外部反代或明文 API Key。',
      source: '工作台默认规范',
      updatedAt: '今天',
    },
    {
      id: 'mem-2',
      topic: '架构约定',
      text: '界面视觉严格锁定 Figma Weave 建筑白昼图纸风格，保留单处柠黄主按钮与全站中文字体回退链。',
      source: 'DESIGN.md 锁定规则',
      updatedAt: '今天',
    },
    {
      id: 'mem-3',
      topic: '工作流',
      text: '涉及鉴权、部署或数据落盘改动时，Pre-CI 审查自动升档至 xhigh 并启用人工拍板闸门。',
      source: '协同护栏偏好',
      updatedAt: '今天',
    },
  ];

  const SHORTCUT_GROUPS = [
    {
      group: '全局与导航',
      items: [
        { label: '打开全局命令面板', keys: [MOD_KEY, 'K'] },
        { label: '显示快捷键一览', keys: ['?'] },
        { label: '展开 / 收起 Tweaks 调参台', keys: ['T'] },
        { label: '关闭当前弹窗 / 抽屉', keys: ['Esc'] },
      ],
    },
    {
      group: '对话流与媒体输出',
      items: [
        { label: '派发当前协同任务', keys: [MOD_KEY, 'Enter'] },
        { label: '呼出 / 快捷模式菜单（含 /image /video）', keys: ['/'] },
        { label: '呼出 @ 工作区文件引用', keys: ['@'] },
        { label: '视频播放器：播放 / 暂停 · 静音 · 全屏', keys: ['K', 'M', 'F'] },
      ],
    },
    {
      group: 'Blender 风格无限画布',
      items: [
        { label: '快速添加节点菜单', keys: ['Shift', 'A'] },
        { label: '复制选中节点', keys: ['Shift', 'D'] },
        { label: '按拓扑层级自动整理', keys: ['L'] },
        { label: '全览适配所有节点', keys: ['F'] },
        { label: '撤销画布操作', keys: [MOD_KEY, 'Z'] },
        { label: '按住空格拖拽平移画布', keys: ['Space'] },
      ],
    },
  ];

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function loadInstructions() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_INSTR) || 'null');
      if (saved && typeof saved === 'object') {
        return {
          personality: saved.personality || 'default',
          instructions: String(saved.instructions || ''),
        };
      }
    } catch {}
    return {
      personality: 'default',
      instructions: '',
    };
  }

  function saveInstructions(data) {
    try { localStorage.setItem(STORAGE_INSTR, JSON.stringify(data)); } catch {}
  }

  function loadMemories() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_MEM) || 'null');
      if (Array.isArray(saved)) return saved;
    } catch {}
    return DEFAULT_MEMORIES.map((m) => ({ ...m }));
  }

  function saveMemories(list) {
    try { localStorage.setItem(STORAGE_MEM, JSON.stringify(list)); } catch {}
  }

  function highlightMatch(text, query) {
    const safe = escapeHtml(text);
    const q = (query || '').trim();
    if (!q) return safe;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) return safe;
    return (
      escapeHtml(text.slice(0, idx)) +
      `<mark class="cp-match">${escapeHtml(text.slice(idx, idx + q.length))}</mark>` +
      escapeHtml(text.slice(idx + q.length))
    );
  }

  function createWorkspacePanels(hooks = {}) {
    let instrState = loadInstructions();
    let memories = loadMemories();
    let lastDeleted = null;
    let undoTimer = null;

    let settingsModal = null;
    let settingsTab = 'instructions';
    let memSearch = '';
    let editingMemId = null;

    let shortcutsModal = null;
    let shortcutQuery = '';

    let paletteModal = null;
    let paletteQuery = '';
    let paletteIdx = 0;

    // Provider Hub UI transient state
    let providerDraft = null; // null = closed, object = editing/creating
    let providerTestingId = null;
    let providerSaving = false;

    function closeAllModals() {
      settingsModal?.classList.add('hidden');
      shortcutsModal?.classList.add('hidden');
      paletteModal?.classList.add('hidden');
    }

    /* =======================================================================
       1. Settings Modal: Custom Instructions (#46412) + Memory Manager (#46393)
       ======================================================================= */
    function ensureSettingsModal() {
      if (settingsModal) return settingsModal;
      settingsModal = document.createElement('div');
      settingsModal.id = 'conduitSettingsModal';
      settingsModal.className = 'c-modal hidden';
      settingsModal.setAttribute('role', 'dialog');
      settingsModal.setAttribute('aria-modal', 'true');
      settingsModal.setAttribute('aria-label', '个性化指令与持久记忆');
      settingsModal.innerHTML = `
        <div class="c-modal-scrim" data-close-settings></div>
        <div class="c-modal-card is-lg">
          <header class="c-modal-head">
            <div class="c-modal-tabs" role="tablist">
              <button type="button" class="c-modal-tab active" role="tab" data-stab="instructions">偏好指令</button>
              <button type="button" class="c-modal-tab" role="tab" data-stab="memory">持久记忆 <span class="c-tab-count mono-xs" id="cMemTabCount"></span></button>
            </div>
            <button type="button" class="rail-icon-btn" data-close-settings aria-label="关闭 [Esc]">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.35"/></svg>
            </button>
          </header>
          <div class="c-modal-body" id="cSettingsBody"></div>
        </div>`;
      document.body.appendChild(settingsModal);

      settingsModal.querySelectorAll('[data-close-settings]').forEach((el) => {
        el.addEventListener('click', () => settingsModal.classList.add('hidden'));
      });
      settingsModal.querySelectorAll('[data-stab]').forEach((btn) => {
        btn.addEventListener('click', () => {
          settingsTab = btn.dataset.stab;
          renderSettingsModal();
        });
      });
      return settingsModal;
    }

    function syncMemCountBadge() {
      const sideBadge = document.getElementById('settingsMemCount');
      if (sideBadge) sideBadge.textContent = String(memories.length);
      const modalBadge = settingsModal?.querySelector('#cMemTabCount');
      if (modalBadge) modalBadge.textContent = String(memories.length);
    }

    function renderInstructionsInto(body) {
      if (!body) return;
      const draft = { ...instrState };
      const activeP = PERSONALITIES.find((p) => p.id === draft.personality) || PERSONALITIES[0];

      body.innerHTML = `
        <div class="ci-wrap" data-slot="custom-instructions">
          <section class="ci-section">
            <div class="ci-label-row">
              <strong class="ci-title">回复风格（Response Style）</strong>
              <span class="mono-xs ci-sub">自动附加到本机 Gemini / Codex 协同上下文</span>
            </div>
            <div class="ci-personality-grid" data-slot="personality-picker" role="radiogroup" aria-label="回复风格">
              ${PERSONALITIES.map(
                (p) => `
                <button type="button" class="ci-style-card ${p.id === draft.personality ? 'is-selected' : ''}" role="radio" aria-checked="${p.id === draft.personality}" data-ci-style="${p.id}">
                  <span class="ci-radio-dot" aria-hidden="true"></span>
                  <div class="ci-style-text">
                    <span class="ci-style-name">${escapeHtml(p.name)}</span>
                    <span class="ci-style-desc">${escapeHtml(p.desc)}</span>
                  </div>
                </button>`
              ).join('')}
            </div>
            <div class="ci-sample-box" data-slot="personality-sample">
              <span class="mono-xs ci-sample-kicker">示例输出效果</span>
              <p class="ci-sample-text">${escapeHtml(activeP.sample)}</p>
            </div>
          </section>

          <section class="ci-section" data-slot="instructions-field">
            <div class="ci-label-row">
              <label class="ci-title">模型应如何配合你？</label>
              <span class="mono-xs ci-counter">${draft.instructions.length} / ${MAX_INSTR_LEN}</span>
            </div>
            <textarea class="gate-editor ci-textarea" rows="4" maxlength="${MAX_INSTR_LEN}" placeholder="输入跨会话生效的协作约定、代码风格或交付偏好...">${escapeHtml(draft.instructions)}</textarea>
            <div class="ci-chips" role="group" aria-label="一键追加偏好">
              ${INSTR_SUGGESTIONS.map(
                (s) => `<button type="button" class="ci-chip" data-ci-chip="${escapeHtml(s)}">+ ${escapeHtml(s)}</button>`
              ).join('')}
            </div>
          </section>

          <footer class="ci-footer" data-slot="custom-instructions-footer">
            <span class="mono-xs ci-saved-hint">更改将自动应用于后续对话派发</span>
            <div class="ci-footer-btns">
              <button type="button" class="btn-secondary-sm" data-ci-reset>恢复默认</button>
              <button type="button" class="btn-primary-sm" data-ci-save>保存偏好</button>
            </div>
          </footer>
        </div>`;

      let currentStyle = draft.personality;
      const ta = body.querySelector('.ci-textarea');
      const counter = body.querySelector('.ci-counter');
      const sampleEl = body.querySelector('.ci-sample-text');
      const savedHint = body.querySelector('.ci-saved-hint');

      body.querySelectorAll('[data-ci-style]').forEach((btn) => {
        btn.addEventListener('click', () => {
          currentStyle = btn.dataset.ciStyle;
          body.querySelectorAll('[data-ci-style]').forEach((b) => {
            const sel = b.dataset.ciStyle === currentStyle;
            b.classList.toggle('is-selected', sel);
            b.setAttribute('aria-checked', String(sel));
          });
          const found = PERSONALITIES.find((p) => p.id === currentStyle);
          if (found && sampleEl) sampleEl.textContent = found.sample;
        });
      });

      ta.addEventListener('input', () => {
        counter.textContent = `${ta.value.length} / ${MAX_INSTR_LEN}`;
      });

      body.querySelectorAll('[data-ci-chip]').forEach((chip) => {
        chip.addEventListener('click', () => {
          const line = chip.dataset.ciChip;
          if (!ta.value.includes(line)) {
            ta.value = ta.value.trim() ? `${ta.value.trim()}\n${line}` : line;
            ta.dispatchEvent(new Event('input'));
          }
          ta.focus();
        });
      });

      body.querySelector('[data-ci-reset]').addEventListener('click', () => {
        instrState = { personality: 'default', instructions: '' };
        saveInstructions(instrState);
        renderInstructionsInto(body);
        if (hooks.onToast) hooks.onToast('已重置偏好指令');
      });

      body.querySelector('[data-ci-save]').addEventListener('click', () => {
        instrState = { personality: currentStyle, instructions: ta.value.trim() };
        saveInstructions(instrState);
        savedHint.textContent = '✓ 已保存并生效';
        if (hooks.onToast) hooks.onToast('个性化偏好指令已保存');
      });
    }

    function renderMemoryInto(body) {
      if (!body) return;
      syncMemCountBadge();
      const q = memSearch.trim().toLowerCase();
      const filtered = memories.filter(
        (m) => !q || m.text.toLowerCase().includes(q) || (m.topic || '').toLowerCase().includes(q)
      );
      const pct = Math.min(100, Math.round((memories.length / MAX_MEMORIES) * 100));
      const groupsMap = new Map();
      filtered.forEach((m) => {
        const t = m.topic || '通用';
        if (!groupsMap.has(t)) groupsMap.set(t, []);
        groupsMap.get(t).push(m);
      });

      const groupsHtml =
        groupsMap.size === 0
          ? `<div class="mm-empty mono-xs">${q ? '未找到匹配的记忆条目' : '暂无持久记忆，可在下方新增一条工作偏好'}</div>`
          : Array.from(groupsMap.entries())
              .map(
                ([topic, items]) => `
                <section class="mm-group" aria-label="${escapeHtml(topic)}">
                  <div class="mm-group-head mono-xs">
                    <span>${escapeHtml(topic)}</span>
                    <span>${items.length}</span>
                  </div>
                  <div class="mm-rows">
                    ${items
                      .map((m) => {
                        if (editingMemId === m.id) {
                          return `
                            <div class="mm-editor" data-slot="memory-editor">
                              <textarea class="gate-editor mm-edit-input" rows="2">${escapeHtml(m.text)}</textarea>
                              <div class="mm-edit-actions">
                                <button type="button" class="btn-secondary-sm" data-mm-cancel>取消</button>
                                <button type="button" class="btn-primary-sm" data-mm-save="${escapeHtml(m.id)}">保存修改</button>
                              </div>
                            </div>`;
                        }
                        return `
                          <div class="mm-row" data-slot="memory-row">
                            <div class="mm-row-main">
                              <p class="mm-row-text">${highlightMatch(m.text, memSearch)}</p>
                              <span class="mm-row-meta mono-xs">${escapeHtml(m.source || '手动记录')} · ${escapeHtml(m.updatedAt || '今天')}</span>
                            </div>
                            <div class="mm-row-actions">
                              <button type="button" class="link-btn" data-mm-edit="${escapeHtml(m.id)}">编辑</button>
                              <button type="button" class="link-btn mm-del-btn" data-mm-del="${escapeHtml(m.id)}">删除</button>
                            </div>
                          </div>`;
                      })
                      .join('')}
                  </div>
                </section>`
              )
              .join('');

      body.innerHTML = `
        <div class="mm-wrap" data-slot="memory-manager">
          <div class="mm-top-bar">
            <input type="text" class="text-input mm-search" value="${escapeHtml(memSearch)}" placeholder="搜索跨会话记忆..." autocomplete="off" />
            <div class="mm-capacity" aria-label="记忆容量">
              <span class="mono-xs">${memories.length} 条记忆</span>
              <span class="mm-cap-bar"><span class="mm-cap-fill" style="width:${pct}%"></span></span>
              <span class="mono-xs">${pct}%</span>
            </div>
          </div>

          ${
            lastDeleted
              ? `<div class="mm-undo-bar" data-slot="memory-undo">
                  <span>已删除「${escapeHtml(lastDeleted.text.slice(0, 26))}${lastDeleted.text.length > 26 ? '…' : ''}」</span>
                  <button type="button" class="link-btn" data-mm-undo>撤销删除</button>
                </div>`
              : ''
          }

          <div class="mm-list is-fullpage">${groupsHtml}</div>

          <form class="mm-add-form">
            <input type="text" class="text-input mm-add-topic mono" placeholder="分类（如 工程偏好）" value="工程偏好" />
            <input type="text" class="text-input mm-add-text" placeholder="新增一条助手应记住的跨会话偏好..." autocomplete="off" />
            <button type="submit" class="btn-primary-sm">记住</button>
          </form>
        </div>`;

      const searchInp = body.querySelector('.mm-search');
      searchInp.addEventListener('input', (e) => {
        memSearch = e.target.value;
        const pos = e.target.selectionStart || memSearch.length;
        renderMemoryInto(body);
        const nextInp = body.querySelector('.mm-search');
        if (nextInp) { nextInp.focus(); nextInp.setSelectionRange(pos, pos); }
      });

      body.querySelectorAll('[data-mm-edit]').forEach((btn) => {
        btn.addEventListener('click', () => {
          editingMemId = btn.dataset.mmEdit;
          renderMemoryInto(body);
          body.querySelector('.mm-edit-input')?.focus();
        });
      });

      body.querySelector('[data-mm-cancel]')?.addEventListener('click', () => {
        editingMemId = null;
        renderMemoryInto(body);
      });

      body.querySelector('[data-mm-save]')?.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.mmSave;
        const val = (body.querySelector('.mm-edit-input')?.value || '').trim();
        if (val) {
          memories = memories.map((m) => (m.id === id ? { ...m, text: val, updatedAt: '刚刚' } : m));
          saveMemories(memories);
        }
        editingMemId = null;
        renderMemoryInto(body);
        if (hooks.onToast) hooks.onToast('记忆条目已更新');
      });

      body.querySelectorAll('[data-mm-del]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.mmDel;
          const idx = memories.findIndex((m) => m.id === id);
          if (idx < 0) return;
          lastDeleted = { ...memories[idx], _idx: idx };
          memories.splice(idx, 1);
          saveMemories(memories);
          clearTimeout(undoTimer);
          undoTimer = setTimeout(() => { lastDeleted = null; renderMemoryInto(body); }, 6000);
          renderMemoryInto(body);
        });
      });

      body.querySelector('[data-mm-undo]')?.addEventListener('click', () => {
        if (!lastDeleted) return;
        const { _idx, ...item } = lastDeleted;
        memories.splice(Math.min(_idx, memories.length), 0, item);
        lastDeleted = null;
        saveMemories(memories);
        renderMemoryInto(body);
        if (hooks.onToast) hooks.onToast('已恢复删除的记忆');
      });

      body.querySelector('.mm-add-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const topic = (body.querySelector('.mm-add-topic').value || '').trim() || '工程偏好';
        const text = (body.querySelector('.mm-add-text').value || '').trim();
        if (!text) return;
        memories.unshift({
          id: `mem-${Date.now()}`,
          topic,
          text,
          source: '手动录入',
          updatedAt: '刚刚',
        });
        saveMemories(memories);
        renderMemoryInto(body);
        if (hooks.onToast) hooks.onToast('已写入持久记忆库');
      });
    }

    function renderShortcutsInto(mount) {
      if (!mount) return;
      mount.innerHTML = `
        <div class="ks-inline-wrap" data-slot="keyboard-shortcuts">
          <input type="text" class="text-input ks-inline-search" value="${escapeHtml(shortcutQuery)}" placeholder="搜索快捷键或操作..." autocomplete="off" />
          <div class="ks-grid" data-ks-grid></div>
        </div>`;
      const gridEl = mount.querySelector('[data-ks-grid]');
      const paint = () => {
        const q = shortcutQuery.trim().toLowerCase();
        const blocks = SHORTCUT_GROUPS.map((g) => {
          const items = g.items.filter(
            (it) => !q || it.label.toLowerCase().includes(q) || it.keys.join(' ').toLowerCase().includes(q)
          );
          if (!items.length) return '';
          return `
            <section class="ks-section" aria-label="${escapeHtml(g.group)}">
              <h4 class="ks-group-title mono-xs">${escapeHtml(g.group)}</h4>
              <div class="ks-list">
                ${items
                  .map(
                    (it) => `
                    <div class="ks-row" data-slot="keyboard-shortcut">
                      <span class="ks-label">${highlightMatch(it.label, shortcutQuery)}</span>
                      <span class="ks-keys">${it.keys.map((k) => `<kbd class="c-kbd">${escapeHtml(k)}</kbd>`).join('')}</span>
                    </div>`
                  )
                  .join('')}
              </div>
            </section>`;
        }).filter(Boolean);
        gridEl.innerHTML = blocks.length ? blocks.join('') : '<div class="mm-empty mono-xs">没有匹配的快捷键</div>';
      };
      mount.querySelector('.ks-inline-search').addEventListener('input', (e) => {
        shortcutQuery = e.target.value;
        paint();
      });
      paint();
    }

    const PROTOCOL_LABELS = {
      'claude-cli': 'CLAUDE CLI',
      'custom-cli': 'CUSTOM CLI',
      'openai-compatible': 'OPENAI SSE',
      anthropic: 'ANTHROPIC SSE',
      'gemini-api': 'GEMINI REST',
    };

    function openProviderEditor(initial = null) {
      providerDraft = initial
        ? {
            id: initial.id || '',
            presetId: initial.presetId || '',
            name: initial.name || '',
            kind: initial.kind || 'api',
            protocol: initial.protocol || (initial.kind === 'cli' ? 'custom-cli' : 'openai-compatible'),
            enabled: initial.enabled !== false,
            command: initial.command || '',
            argsTemplate: initial.argsTemplate || '',
            baseUrl: initial.baseUrl || '',
            apiKey: '',
            hasApiKey: Boolean(initial.hasApiKey),
            apiKeyMasked: initial.apiKeyMasked || '',
            defaultModel: initial.defaultModel || '',
            modelsText: Array.isArray(initial.models) ? initial.models.join(', ') : '',
            notes: initial.notes || '',
          }
        : {
            id: '',
            presetId: 'openai',
            name: '',
            kind: 'api',
            protocol: 'openai-compatible',
            enabled: true,
            command: '',
            argsTemplate: '',
            baseUrl: 'https://api.openai.com/v1',
            apiKey: '',
            hasApiKey: false,
            apiKeyMasked: '',
            defaultModel: 'gpt-4.1',
            modelsText: 'gpt-4.1, o3-mini',
            notes: '',
          };
    }

    function renderProvidersInto(mount, ctx = {}) {
      if (!mount) return;
      const providers = Array.isArray(ctx.providers) ? ctx.providers : [];
      const localAgents = ctx.localAgents || { clis: [], services: [] };
      const presets = Array.isArray(ctx.presets) ? ctx.presets : [];

      const countBadge = document.getElementById('settingsProviderCount');
      if (countBadge) {
        countBadge.textContent = String(providers.filter((p) => p.enabled).length);
      }

      const detectedClis = localAgents.clis || [];
      const detectedServices = localAgents.services || [];
      const probeItems = [...detectedClis, ...detectedServices];

      const probeHtml = probeItems
        .map((item) => {
          const isOnline = Boolean(item.installed || item.online);
          const alreadyConfigured = item.builtin || providers.some(
            (p) =>
              (item.kind === 'cli' && p.kind === 'cli' && p.command === item.command) ||
              (item.kind === 'api' && p.baseUrl && item.baseUrl && p.baseUrl.replace(/\/+$/, '') === item.baseUrl.replace(/\/+$/, ''))
          );
          const badge = item.builtin
            ? '<span class="ph-probe-tag is-core mono-xs">内置核心</span>'
            : isOnline && !alreadyConfigured
              ? `<button type="button" class="ph-probe-add mono-xs" data-ph-quick-probe="${escapeHtml(item.id)}">+ 一键接入</button>`
              : isOnline
                ? '<span class="ph-probe-tag is-ok mono-xs">已接入</span>'
                : '<span class="ph-probe-tag mono-xs">未检出</span>';
          const titleTip = item.path || item.baseUrl || item.version || '';
          return `
            <div class="ph-probe-chip ${isOnline ? 'is-ready' : 'is-missing'}" title="${escapeHtml(titleTip)}">
              <span class="ph-dot ${isOnline ? 'is-ok' : ''}" aria-hidden="true"></span>
              <div class="ph-probe-meta">
                <span class="ph-probe-name">${escapeHtml(item.name)}</span>
                <span class="ph-probe-ver mono-xs">${escapeHtml(isOnline ? (item.version || 'ready') : '未安装 / 未启动')}</span>
              </div>
              ${badge}
            </div>`;
        })
        .join('');

      const presetsHtml = presets
        .map(
          (pr) => `
          <button type="button" class="ph-preset-pill ${providerDraft?.presetId === pr.presetId && !providerDraft?.id ? 'is-active' : ''}" data-ph-preset="${escapeHtml(pr.presetId)}" title="${escapeHtml(pr.description || '')}">
            <span class="ph-preset-name">${escapeHtml(pr.name)}</span>
            <span class="ph-preset-badge mono-xs">${escapeHtml(pr.badge || pr.protocol)}</span>
          </button>`
        )
        .join('');

      const renderEditorHtml = () => {
        if (!providerDraft) return '';
        const d = providerDraft;
        const isCli = d.kind === 'cli';
        return `
          <form class="settings-card ph-editor-card" id="phEditorForm" data-slot="provider-editor">
            <div class="ph-editor-head">
              <div>
                <span class="mono-xs settings-kicker">${d.id ? 'EDIT PROVIDER' : 'NEW CONNECTION'}</span>
                <h3>${d.id ? `编辑「${escapeHtml(d.name)}」` : '配置外部 Agent / API 接入'}</h3>
              </div>
              <button type="button" class="rail-icon-btn" id="btnPhCloseEditor" title="收起表单">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.35"/></svg>
              </button>
            </div>

            <div class="ph-form-grid">
              <label class="field-block">
                <span class="field-label">接入显示名称</span>
                <input type="text" class="text-input" id="phName" value="${escapeHtml(d.name)}" placeholder="例如：Claude Code CLI / DeepSeek R1 / 本机 Ollama" required />
              </label>

              <div class="field-block">
                <span class="field-label">接入模式</span>
                <div class="tweak-pills ph-kind-pills" role="radiogroup" aria-label="接入模式">
                  <button type="button" data-ph-kind="cli" class="${isCli ? 'active' : ''}">本地 CLI Agent</button>
                  <button type="button" data-ph-kind="api" class="${!isCli ? 'active' : ''}">HTTP 流式 API</button>
                </div>
              </div>

              <label class="field-block">
                <span class="field-label">适配器协议</span>
                <select class="text-input mono" id="phProtocol">
                  ${
                    isCli
                      ? `<option value="claude-cli" ${d.protocol === 'claude-cli' ? 'selected' : ''}>claude-cli（Claude Code stream-json 流式思维链）</option>
                         <option value="custom-cli" ${d.protocol === 'custom-cli' ? 'selected' : ''}>custom-cli（通用本地 CLI / Gemini CLI / Aider / 脚本）</option>`
                      : `<option value="openai-compatible" ${d.protocol === 'openai-compatible' ? 'selected' : ''}>openai-compatible（OpenAI / DeepSeek / OpenRouter / Ollama / Qwen / Kimi）</option>
                         <option value="anthropic" ${d.protocol === 'anthropic' ? 'selected' : ''}>anthropic（Claude /v1/messages + thinking_delta）</option>
                         <option value="gemini-api" ${d.protocol === 'gemini-api' ? 'selected' : ''}>gemini-api（Google Gemini REST streamGenerateContent）</option>`
                  }
                </select>
              </label>

              ${
                isCli
                  ? `<label class="field-block">
                      <span class="field-label">可执行命令（PATH 或绝对路径）</span>
                      <input type="text" class="text-input mono" id="phCommand" value="${escapeHtml(d.command)}" placeholder="如 claude / gemini / aider / opencode" required />
                    </label>
                    <label class="field-block ph-span-2">
                      <span class="field-label">自定义参数模板（可选 · 支持 {prompt} / {model} / {cwd}，留空自动 stdin 传参）</span>
                      <input type="text" class="text-input mono" id="phArgs" value="${escapeHtml(d.argsTemplate)}" placeholder="${d.protocol === 'claude-cli' ? 'Claude CLI 已内置 stream-json 参数，留空即可' : '例如：-p {prompt} --model {model}'}" />
                    </label>`
                  : `<label class="field-block">
                      <span class="field-label">Base URL（端点基址）</span>
                      <input type="url" class="text-input mono" id="phBaseUrl" value="${escapeHtml(d.baseUrl)}" placeholder="https://api.deepseek.com/v1 或 http://127.0.0.1:11434/v1" required />
                    </label>
                    <label class="field-block ph-span-2">
                      <span class="field-label">API Key（仅保存在本机 gitignored data/providers.json，绝不回传明文）</span>
                      <input type="password" class="text-input mono" id="phApiKey" value="${escapeHtml(d.apiKey)}" placeholder="${d.hasApiKey ? `已保存密钥 (${d.apiKeyMasked}) · 留空则保持不变` : '本地 Ollama / LM Studio 可留空；云端 API 粘贴 sk-...'}" autocomplete="new-password" />
                    </label>`
              }

              <label class="field-block">
                <span class="field-label">默认模型 ID</span>
                <input type="text" class="text-input mono" id="phDefaultModel" value="${escapeHtml(d.defaultModel)}" placeholder="${isCli ? '如 claude-sonnet-4-5（留空跟 CLI 默认）' : '如 deepseek-reasoner / gpt-4.1 / qwen2.5-coder:14b'}" />
              </label>

              <label class="field-block">
                <span class="field-label">可选模型清单（逗号分隔，测试连接时会自动拉取补全）</span>
                <input type="text" class="text-input mono" id="phModels" value="${escapeHtml(d.modelsText)}" placeholder="deepseek-reasoner, deepseek-chat" />
              </label>

              <label class="field-block ph-span-2">
                <span class="field-label">备注说明（可选）</span>
                <input type="text" class="text-input" id="phNotes" value="${escapeHtml(d.notes)}" placeholder="例如：适合前端长上下文评审、本地隐私代码分析等" />
              </label>
            </div>

            <div class="ph-editor-foot">
              <span class="mono-xs ph-sec-hint">遵循 Vibe Kanban / Zed ACP 统一流协议，自动注入对话流与无限画布节点选择器</span>
              <div class="ph-editor-btns">
                <button type="button" class="btn-secondary-sm" id="btnPhCancel">取消</button>
                <button type="submit" class="btn-primary-sm" id="btnPhSave" ${providerSaving ? 'disabled' : ''}>${providerSaving ? '保存中...' : '保存接入配置'}</button>
              </div>
            </div>
          </form>`;
      };

      const listHtml =
        providers.length === 0
          ? `<div class="ph-empty mono-xs">尚未接入外部 Agent 或 API。点击上方「一键接入模板」或检测到的本机 CLI 即可秒级启用。</div>`
          : providers
              .map((p) => {
                const isTesting = providerTestingId === p.id;
                const endpoint = p.kind === 'cli'
                  ? `$ ${p.command}${p.argsTemplate ? ` ${p.argsTemplate}` : ' (stdin/stream-json)'}`
                  : p.baseUrl;
                const keyBadge = p.kind === 'cli'
                  ? '本机订阅 / 无需 Key'
                  : p.hasApiKey
                    ? `KEY ${p.apiKeyMasked}`
                    : '免 Key / 本地服务';
                const testOk = p.lastTest?.ok;
                const testDetail = p.lastTest?.detail || '尚未测试连通性';
                const modelCount = (p.models || []).length;
                return `
                  <article class="ph-provider-card ${p.enabled ? '' : 'is-disabled'}" data-provider-id="${escapeHtml(p.id)}">
                    <div class="ph-card-top">
                      <div class="ph-card-title-group">
                        <span class="ph-kind-badge mono-xs ${p.kind === 'cli' ? 'is-cli' : 'is-api'}">${escapeHtml(PROTOCOL_LABELS[p.protocol] || p.protocol)}</span>
                        <strong class="ph-card-name">${escapeHtml(p.name)}</strong>
                        ${p.defaultModel ? `<span class="ph-model-pill mono-xs">${escapeHtml(p.defaultModel)}</span>` : ''}
                        ${modelCount > 1 ? `<span class="ph-model-more mono-xs">+${modelCount - 1} 模型</span>` : ''}
                      </div>
                      <button type="button" class="wf-switch" role="switch" aria-checked="${Boolean(p.enabled)}" data-ph-toggle="${escapeHtml(p.id)}" title="${p.enabled ? '点击停用此接入' : '点击启用此接入'}">
                        <span class="wf-switch-thumb"></span>
                      </button>
                    </div>

                    <div class="ph-card-meta mono-xs">
                      <span class="ph-endpoint" title="${escapeHtml(endpoint)}">${escapeHtml(endpoint)}</span>
                      <span class="ph-sep">·</span>
                      <span class="ph-key-tag">${escapeHtml(keyBadge)}</span>
                    </div>

                    ${p.notes ? `<p class="ph-card-notes">${escapeHtml(p.notes)}</p>` : ''}

                    <div class="ph-card-foot">
                      <div class="ph-test-status ${testOk === true ? 'is-ok' : testOk === false ? 'is-err' : ''}">
                        <span class="ph-dot ${testOk === true ? 'is-ok' : testOk === false ? 'is-err' : ''}" aria-hidden="true"></span>
                        <span class="mono-xs">${escapeHtml(testDetail)}</span>
                      </div>
                      <div class="ph-card-actions">
                        <button type="button" class="btn-secondary-sm" data-ph-test="${escapeHtml(p.id)}" ${isTesting ? 'disabled' : ''}>${isTesting ? '探测中...' : '测试连接'}</button>
                        ${p.enabled ? `<button type="button" class="btn-secondary-sm" data-ph-use="${escapeHtml(p.id)}">立即对话</button>` : ''}
                        <button type="button" class="link-btn" data-ph-edit="${escapeHtml(p.id)}">编辑</button>
                        <button type="button" class="link-btn mm-del-btn" data-ph-del="${escapeHtml(p.id)}">删除</button>
                      </div>
                    </div>
                  </article>`;
              })
              .join('');

      mount.innerHTML = `
        <div class="ph-wrap" data-slot="provider-hub">
          <div class="settings-card">
            <div class="ph-section-head">
              <div>
                <div class="section-cap mono-label">LOCAL AGENT &amp; RUNTIME DISCOVERY · 本机自动探测</div>
                <p class="ph-section-sub">自动发现本机 PATH 中的编程 Agent CLI 与本地大模型推理服务（Ollama / LM Studio）</p>
              </div>
              <span class="mono-xs ph-scan-count">${probeItems.filter((x) => x.installed || x.online).length} / ${probeItems.length} 就绪</span>
            </div>
            <div class="ph-probe-grid">${probeHtml || '<div class="mono-xs">正在扫描本机环境...</div>'}</div>
          </div>

          <div class="settings-card">
            <div class="ph-section-head">
              <div>
                <div class="section-cap mono-label">ONE-CLICK PRESETS · 一键接入模板</div>
                <p class="ph-section-sub">覆盖本地 CLI、本地推理服务与三大云端流式协议（OpenAI 兼容 / Anthropic / Gemini REST）</p>
              </div>
            </div>
            <div class="ph-presets-row">${presetsHtml}</div>
          </div>

          ${renderEditorHtml()}

          <div class="settings-card">
            <div class="ph-section-head">
              <div>
                <div class="section-cap mono-label">CONNECTED PROVIDERS · 已接入列表（${providers.length}）</div>
                <p class="ph-section-sub">启用的接入会自动出现在「对话流模型选择器」与「无限画布节点 Model 菜单」中</p>
              </div>
            </div>
            <div class="ph-provider-list">${listHtml}</div>
          </div>
        </div>`;

      // Bind quick-add from local probe
      mount.querySelectorAll('[data-ph-quick-probe]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const item = probeItems.find((x) => x.id === btn.dataset.phQuickProbe);
          if (!item) return;
          const preset = presets.find((pr) => pr.presetId === item.presetId);
          if (item.kind === 'cli') {
            openProviderEditor({
              presetId: item.presetId || 'custom-cli',
              name: item.name,
              kind: 'cli',
              protocol: item.id === 'claude' ? 'claude-cli' : 'custom-cli',
              command: item.command,
              argsTemplate: item.id === 'claude' ? '' : '-p {prompt}',
              defaultModel: preset?.defaultModel || '',
              models: preset?.models || [],
              notes: `本机自动检测：${item.path || item.version || ''}`,
            });
          } else {
            openProviderEditor({
              presetId: item.presetId || 'ollama',
              name: item.name,
              kind: 'api',
              protocol: 'openai-compatible',
              baseUrl: item.baseUrl,
              defaultModel: item.models?.[0] || preset?.defaultModel || '',
              models: item.models?.length ? item.models : (preset?.models || []),
              notes: `自动发现本地服务 (${item.baseUrl})`,
            });
          }
          renderProvidersInto(mount, ctx);
          mount.querySelector('#phName')?.focus();
        });
      });

      // Bind one-click preset pills
      mount.querySelectorAll('[data-ph-preset]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const pr = presets.find((x) => x.presetId === btn.dataset.phPreset);
          if (!pr) return;
          openProviderEditor(pr);
          renderProvidersInto(mount, ctx);
          mount.querySelector('#phName')?.focus();
        });
      });

      // Bind editor controls
      const form = mount.querySelector('#phEditorForm');
      if (form && providerDraft) {
        const readDraftFromForm = () => {
          providerDraft.name = form.querySelector('#phName')?.value ?? providerDraft.name;
          providerDraft.protocol = form.querySelector('#phProtocol')?.value ?? providerDraft.protocol;
          providerDraft.command = form.querySelector('#phCommand')?.value ?? providerDraft.command;
          providerDraft.argsTemplate = form.querySelector('#phArgs')?.value ?? providerDraft.argsTemplate;
          providerDraft.baseUrl = form.querySelector('#phBaseUrl')?.value ?? providerDraft.baseUrl;
          providerDraft.apiKey = form.querySelector('#phApiKey')?.value ?? providerDraft.apiKey;
          providerDraft.defaultModel = form.querySelector('#phDefaultModel')?.value ?? providerDraft.defaultModel;
          providerDraft.modelsText = form.querySelector('#phModels')?.value ?? providerDraft.modelsText;
          providerDraft.notes = form.querySelector('#phNotes')?.value ?? providerDraft.notes;
        };

        form.querySelectorAll('[data-ph-kind]').forEach((kbtn) => {
          kbtn.addEventListener('click', () => {
            readDraftFromForm();
            const nextKind = kbtn.dataset.phKind;
            if (providerDraft.kind === nextKind) return;
            providerDraft.kind = nextKind;
            providerDraft.protocol = nextKind === 'cli' ? 'custom-cli' : 'openai-compatible';
            if (nextKind === 'api' && !providerDraft.baseUrl) providerDraft.baseUrl = 'https://api.openai.com/v1';
            if (nextKind === 'cli' && !providerDraft.command) providerDraft.command = 'claude';
            renderProvidersInto(mount, ctx);
          });
        });

        form.querySelector('#phProtocol')?.addEventListener('change', () => {
          readDraftFromForm();
          renderProvidersInto(mount, ctx);
        });

        const closeEditor = () => {
          providerDraft = null;
          renderProvidersInto(mount, ctx);
        };
        form.querySelector('#btnPhCloseEditor')?.addEventListener('click', closeEditor);
        form.querySelector('#btnPhCancel')?.addEventListener('click', closeEditor);

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          readDraftFromForm();
          const payload = {
            id: providerDraft.id || undefined,
            presetId: providerDraft.presetId || undefined,
            name: providerDraft.name.trim(),
            kind: providerDraft.kind,
            protocol: providerDraft.protocol,
            enabled: providerDraft.enabled !== false,
            command: providerDraft.command.trim(),
            argsTemplate: providerDraft.argsTemplate.trim(),
            baseUrl: providerDraft.baseUrl.trim(),
            apiKey: providerDraft.apiKey.trim(),
            defaultModel: providerDraft.defaultModel.trim(),
            models: providerDraft.modelsText,
            notes: providerDraft.notes.trim(),
          };
          providerSaving = true;
          renderProvidersInto(mount, ctx);
          try {
            const ok = await hooks.onSaveProvider?.(payload);
            providerSaving = false;
            if (ok) providerDraft = null;
          } catch {
            providerSaving = false;
          }
          hooks.onRefreshProvidersView?.();
        });
      }

      // Bind provider list actions
      mount.querySelectorAll('[data-ph-toggle]').forEach((sw) => {
        sw.addEventListener('click', async () => {
          const p = providers.find((x) => x.id === sw.dataset.phToggle);
          if (!p) return;
          await hooks.onSaveProvider?.({ id: p.id, enabled: !p.enabled });
        });
      });

      mount.querySelectorAll('[data-ph-test]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.phTest;
          providerTestingId = id;
          renderProvidersInto(mount, ctx);
          try {
            await hooks.onTestProvider?.(id);
          } finally {
            providerTestingId = null;
            hooks.onRefreshProvidersView?.();
          }
        });
      });

      mount.querySelectorAll('[data-ph-use]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const p = providers.find((x) => x.id === btn.dataset.phUse);
          if (p) hooks.onUseProvider?.(p);
        });
      });

      mount.querySelectorAll('[data-ph-edit]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const p = providers.find((x) => x.id === btn.dataset.phEdit);
          if (!p) return;
          openProviderEditor(p);
          renderProvidersInto(mount, ctx);
          mount.querySelector('#phName')?.focus();
        });
      });

      mount.querySelectorAll('[data-ph-del]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.phDel;
          if (providerDraft?.id === id) providerDraft = null;
          await hooks.onDeleteProvider?.(id);
        });
      });
    }

    function formatBytesMb(bytes) {
      const n = Number(bytes) || 0;
      if (!n) return '';
      if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
      return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    }

    function renderUpdatesInto(mount, ctx = {}) {
      if (!mount) return;
      const info = ctx.info || {};
      const checking = Boolean(ctx.checking);
      const autoCheck = ctx.autoCheck !== false;
      const curVer = info.currentVersion || '1.0.0';
      const last = info.lastCheck || null;
      const dl = info.download || { state: 'idle', progress: 0 };
      const runtimeLabel = info.isDesktopApp
        ? `Windows 桌面客户端 · Electron ${info.electronVersion || ''}`
        : `本地 Web 工作台 · Node ${info.nodeVersion || ''}`;
      const relUrl = last?.releaseUrl || info.releasesUrl || 'https://github.com/jiuyang5354/tenon-workbench/releases';

      const checkedStr = last?.checkedAt
        ? new Date(last.checkedAt).toLocaleString('zh-CN', { hour12: false })
        : '尚未检测';

      let statusBodyHtml = '';
      if (checking) {
        statusBodyHtml = `
          <div class="upd-status-banner is-checking">
            <span class="upd-dot is-pulse" aria-hidden="true"></span>
            <div class="upd-status-copy">
              <strong>正在连接 GitHub Releases 检测最新版本...</strong>
              <span class="mono-xs">仓库：${escapeHtml(info.repo || 'jiuyang5354/tenon-workbench')}</span>
            </div>
          </div>`;
      } else if (!last) {
        statusBodyHtml = `
          <div class="upd-status-banner">
            <span class="upd-dot" aria-hidden="true"></span>
            <div class="upd-status-copy">
              <strong>点击右上角「立即检测更新」核对 GitHub 最新版本</strong>
              <span class="mono-xs">支持自动比对 SemVer 版本号与一键下载 Windows .exe 安装包</span>
            </div>
          </div>`;
      } else if (!last.ok) {
        statusBodyHtml = `
          <div class="upd-status-banner is-err">
            <span class="upd-dot is-err" aria-hidden="true"></span>
            <div class="upd-status-copy">
              <strong>更新检测未完成</strong>
              <span class="mono-xs">${escapeHtml(last.error || '网络连接异常')}</span>
            </div>
            <button type="button" class="btn-secondary-sm" data-upd-check>重试</button>
          </div>`;
      } else if (last.hasUpdate) {
        const sizeLabel = last.assetSize ? ` · ${formatBytesMb(last.assetSize)}` : '';
        let actionHtml = '';
        if (dl.state === 'downloading') {
          const pct = Math.max(0, Math.min(100, Number(dl.progress) || 0));
          actionHtml = `
            <div class="upd-progress-box">
              <div class="upd-progress-meta mono-xs">
                <span>正在下载 ${escapeHtml(dl.assetName || 'TENON-Setup.exe')}...</span>
                <span>${pct}%${dl.totalBytes ? ` (${formatBytesMb(dl.downloadedBytes)} / ${formatBytesMb(dl.totalBytes)})` : ''}</span>
              </div>
              <div class="upd-progress-track"><span class="upd-progress-fill" style="width:${pct}%"></span></div>
            </div>`;
        } else if (dl.state === 'downloaded') {
          actionHtml = `
            <div class="upd-actions-row">
              <button type="button" class="btn-weave-cta" data-upd-install>立即启动安装程序 (${escapeHtml(dl.assetName)})</button>
              <span class="mono-xs upd-ready-hint">安装包已就绪，点击后将拉起向导并自动覆盖升级</span>
            </div>`;
        } else {
          actionHtml = `
            <div class="upd-actions-row">
              ${
                last.downloadUrl
                  ? `<button type="button" class="btn-weave-cta" data-upd-download>一键下载安装包 (.exe${sizeLabel})</button>`
                  : ''
              }
              <a class="btn-secondary-sm" href="${escapeHtml(relUrl)}" target="_blank" rel="noopener noreferrer">查看 Release 详情 →</a>
              ${dl.state === 'error' ? `<span class="mono-xs upd-err-inline">${escapeHtml(dl.error)}</span>` : ''}
            </div>`;
        }

        statusBodyHtml = `
          <div class="upd-status-banner is-available">
            <span class="upd-dot is-new" aria-hidden="true"></span>
            <div class="upd-status-copy">
              <strong>发现新版本 v${escapeHtml(last.latestVersion)}</strong>
              <span class="mono-xs">${escapeHtml(last.releaseName || '')}${last.publishedAt ? ` · 发布于 ${new Date(last.publishedAt).toLocaleDateString('zh-CN')}` : ''}</span>
            </div>
          </div>
          ${last.releaseNotes ? `<pre class="upd-notes mono-xs">${escapeHtml(last.releaseNotes)}</pre>` : ''}
          ${actionHtml}`;
      } else {
        statusBodyHtml = `
          <div class="upd-status-banner is-ok">
            <span class="upd-dot is-ok" aria-hidden="true"></span>
            <div class="upd-status-copy">
              <strong>当前已是最新版本（v${escapeHtml(curVer)}）</strong>
              <span class="mono-xs">远端最新：v${escapeHtml(last.latestVersion || curVer)} · 上次检测：${escapeHtml(checkedStr)}</span>
            </div>
          </div>
          ${last.releaseNotes ? `<pre class="upd-notes mono-xs">${escapeHtml(last.releaseNotes)}</pre>` : ''}`;
      }

      mount.innerHTML = `
        <div class="upd-wrap" data-slot="software-updates">
          <div class="settings-card upd-hero-card">
            <div class="upd-hero-left">
              <span class="upd-app-tile" aria-hidden="true">
                <svg class="tenon-mark-svg" width="32" height="32" viewBox="0 0 256 256" fill="none">
                  <path fill="#F3F4F6" d="M 46 22 H 210 A 24 24 0 0 1 234 46 V 74 H 154 V 154 H 102 V 74 H 22 V 46 A 24 24 0 0 1 46 22 Z" />
                  <path fill="#F3F4F6" d="M 22 102 H 74 V 182 H 234 V 210 A 24 24 0 0 1 210 234 H 46 A 24 24 0 0 1 22 210 Z" />
                  <rect fill="#EEFF82" x="182" y="102" width="52" height="52" rx="6" />
                </svg>
              </span>
              <div class="upd-hero-meta">
                <div class="upd-title-line">
                  <strong>TENON（榫）多模型协同工作台</strong>
                  <span class="upd-ver-pill mono-xs">v${escapeHtml(curVer)}</span>
                </div>
                <div class="upd-sub-line mono-xs">${escapeHtml(runtimeLabel)} · ${escapeHtml(info.platform || 'win32')} (${escapeHtml(info.arch || 'x64')})</div>
                <div class="upd-sub-line mono-xs">官方更新源：<a href="${escapeHtml(info.repoUrl || 'https://github.com/jiuyang5354/tenon-workbench')}" target="_blank" rel="noopener noreferrer">${escapeHtml(info.repo || 'jiuyang5354/tenon-workbench')}</a></div>
              </div>
            </div>
          </div>

          <div class="settings-card">
            <div class="section-cap mono-label">UPDATE STATUS · 版本状态</div>
            ${statusBodyHtml}
          </div>

          <div class="settings-card">
            <div class="settings-row">
              <div class="settings-row-info">
                <strong>启动时自动检测更新</strong>
                <span class="upd-row-desc">每次打开 TENON 时在后台静默检查 GitHub Releases，有新版本时在设置页提示</span>
              </div>
              <button type="button" class="wf-switch" role="switch" aria-checked="${autoCheck}" id="btnToggleAutoUpdate" aria-label="启动时自动检测更新">
                <span class="wf-switch-thumb"></span>
              </button>
            </div>
          </div>
        </div>`;

      mount.querySelector('[data-upd-check]')?.addEventListener('click', () => hooks.onCheckUpdates?.());
      mount.querySelector('[data-upd-download]')?.addEventListener('click', () => hooks.onDownloadUpdate?.());
      mount.querySelector('[data-upd-install]')?.addEventListener('click', () => hooks.onInstallUpdate?.());
      mount.querySelector('#btnToggleAutoUpdate')?.addEventListener('click', () => hooks.onToggleAutoUpdate?.());
    }

    function renderTelemetryInto(mount, ctx = {}) {
      if (!mount) return;
      const runs = Array.isArray(ctx.runs) ? ctx.runs : [];
      const health = ctx.health || {};
      const agyCount = (ctx.geminiModels || []).length;
      const codexCount = (ctx.codexModels || []).length;
      const canvasScale = Number(document.documentElement.dataset.canvasScale || 2);

      const totalRuns = runs.length;
      const doneRuns = runs.filter((r) => r.status === 'completed').length;
      const activeRuns = runs.filter((r) => r.status === 'running' || r.status === 'awaiting_approval').length;
      const blockedRuns = runs.filter((r) => r.status === 'failed' || r.status === 'blocked' || r.status === 'cancelled').length;

      const planRuns = runs.filter((r) => r.mode === 'plan-only' || r.mode === 'copy-polish').length;
      const pipeRuns = runs.filter((r) => r.mode === 'full-pipeline' || r.mode === 'codex-exec' || r.mode === 'codex-review').length;
      const mediaRuns = runs.filter((r) => r.mode === 'image-gen' || r.mode === 'video-gen').length;

      const completionPct = totalRuns > 0 ? Math.round((doneRuns / totalRuns) * 100) : 100;
      const healthScore =
        (health.agy?.installed ? 40 : 0) +
        (health.codex?.installed ? 40 : 0) +
        (health.git?.installed ? 20 : 0);
      const planPct = totalRuns > 0 ? completionPct : (healthScore || 88);

      const rawSlices =
        totalRuns > 0
          ? [
              { id: 'pipeline', label: '全链路与施工', value: pipeRuns, opacity: 1 },
              { id: 'planning', label: '架构规划与文案', value: planRuns, opacity: 0.58 },
              { id: 'media', label: '图像与视频输出', value: mediaRuns, opacity: 0.24 },
            ].filter((s) => s.value > 0)
          : [
              { id: 'pipeline', label: '全链路与施工', value: 52, opacity: 1 },
              { id: 'planning', label: '架构规划与文案', value: 30, opacity: 0.58 },
              { id: 'media', label: '图像与视频输出', value: 18, opacity: 0.24 },
            ];
      const sliceSum = rawSlices.reduce((acc, s) => acc + s.value, 0) || 1;

      // Build crisp SVG Donut Arcs (r=64, strokeWidth=16, circumference=402.12, gap=3)
      const r = 64;
      const C = 2 * Math.PI * r;
      let offset = 0;
      const gap = rawSlices.length > 1 ? 3 : 0;
      const arcsHtml = rawSlices
        .map((s) => {
          const frac = s.value / sliceSum;
          const dash = Math.max(2, frac * C - gap);
          const seg = `<circle class="tm-donut-seg" cx="84" cy="84" r="${r}" fill="none" stroke="currentColor" stroke-opacity="${s.opacity}" stroke-width="16" stroke-dasharray="${dash.toFixed(2)} ${(C - dash).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" data-slice-label="${escapeHtml(s.label)}" data-slice-val="${s.value}" data-slice-pct="${Math.round(frac * 100)}" />`;
          offset += frac * C;
          return seg;
        })
        .join('');

      const TOTAL_BARS = 24;
      const filledBars = Math.round((planPct * TOTAL_BARS) / 100);
      const barsHtml = Array.from({ length: TOTAL_BARS }, (_, i) => {
        const filled = i < filledBars;
        return `<span class="tm-bar-pill ${filled ? 'is-filled' : ''}" title="${planPct}% (${i + 1}/${TOTAL_BARS})"></span>`;
      }).join('');

      const metrics = [
        {
          title: '累计协同会话',
          value: String(totalRuns),
          icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>',
        },
        {
          title: '活跃 / 待拍板',
          value: `${activeRuns} 项`,
          icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
        },
        {
          title: '本机已检出模型',
          value: `${agyCount + codexCount} 个`,
          icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/></svg>',
        },
        {
          title: '持久记忆条目',
          value: `${memories.length} / ${MAX_MEMORIES}`,
          icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
        },
      ];

      mount.innerHTML = `
        <div class="tm-card" data-slot="telemetry-metrics-card">
          <div class="tm-top-grid">
            <div class="tm-left-col">
              <div class="tm-identity">
                <span class="tm-logo-tile" aria-hidden="true">
                  <svg class="tenon-mark-svg" width="22" height="22" viewBox="0 0 256 256" fill="none">
                    <path fill="currentColor" d="M 46 22 H 210 A 24 24 0 0 1 234 46 V 74 H 154 V 154 H 102 V 74 H 22 V 46 A 24 24 0 0 1 46 22 Z" />
                    <path fill="currentColor" d="M 22 102 H 74 V 182 H 234 V 210 A 24 24 0 0 1 210 234 H 46 A 24 24 0 0 1 22 210 Z" />
                    <rect class="tenon-keystone" x="182" y="102" width="52" height="52" rx="6" />
                  </svg>
                </span>
                <div class="tm-identity-text">
                  <strong>TENON 本地多模型协同引擎</strong>
                  <span class="mono-xs">${escapeHtml(ctx.workspaceDir || '本机直连工作区')} · CLI &amp; Multi-API Hub</span>
                </div>
              </div>

              <ul class="tm-metrics-grid">
                ${metrics
                  .map(
                    (m) => `
                    <li class="tm-metric-tile">
                      <span class="tm-metric-ico" aria-hidden="true">${m.icon}</span>
                      <div class="tm-metric-meta">
                        <span class="tm-metric-label">${escapeHtml(m.title)}</span>
                        <strong class="tm-metric-val mono">${escapeHtml(m.value)}</strong>
                      </div>
                    </li>`
                  )
                  .join('')}
              </ul>
            </div>

            <div class="tm-donut-card">
              <div class="tm-subhead">
                <h3>任务模式分布</h3>
                <span class="mono-xs">${totalRuns > 0 ? '实时统计' : '基准视图'}</span>
              </div>
              <div class="tm-donut-wrap">
                <svg class="tm-donut-svg" viewBox="0 0 168 168" role="img" aria-label="任务模式分布环形图">
                  <g transform="rotate(-90 84 84)">${arcsHtml}</g>
                  <text x="84" y="79" text-anchor="middle" class="tm-donut-big">${totalRuns > 0 ? totalRuns : 'READY'}</text>
                  <text x="84" y="100" text-anchor="middle" class="tm-donut-sub">${totalRuns > 0 ? '总协同任务' : 'CLI 已就绪'}</text>
                </svg>
                <div class="tm-donut-tip hidden mono-xs" id="tmDonutTip"></div>
              </div>
              <div class="tm-legend-row">
                ${rawSlices
                  .map(
                    (s) => `
                    <span class="tm-legend-item">
                      <span class="tm-legend-swatch" style="opacity:${s.opacity}"></span>
                      <span>${escapeHtml(s.label)}</span>
                    </span>`
                  )
                  .join('')}
              </div>
              <div class="tm-donut-foot">
                <span>交付完成度</span>
                <strong class="mono">${completionPct}%</strong>
              </div>
            </div>
          </div>

          <div class="tm-bottom-card">
            <div class="tm-plan-left">
              <h3>协同就绪度</h3>
              <span class="tm-plan-big mono">${planPct}%</span>
              <span class="tm-plan-cap">100% 本地 CLI 直连 · ${blockedRuns} 项拦截或中止</span>
            </div>
            <div class="tm-plan-right">
              <h3>集群与渲染健康指标</h3>
              <p>实时跟踪本机 Gemini (agy) 与 Codex 沙箱执行效率、画布 HiDPI 精度与工作区风险状态。</p>
              <ul class="tm-indicators">
                <li>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>
                  <span>本地官方 CLI 直连率 · 100%</span>
                </li>
                <li>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M9 15l6-6"/><circle cx="9.5" cy="9.5" r="1" fill="currentColor"/><circle cx="14.5" cy="14.5" r="1" fill="currentColor"/></svg>
                  <span>画布清晰度 · ${canvasScale}× ${canvasScale >= 3 ? 'Ultra HD' : canvasScale === 2 ? 'Retina' : '标准'}</span>
                </li>
              </ul>
              <div class="tm-bars-track" role="img" aria-label="协同就绪度 ${planPct}%">
                ${barsHtml}
              </div>
            </div>
          </div>
        </div>`;

      const tip = mount.querySelector('#tmDonutTip');
      mount.querySelectorAll('.tm-donut-seg').forEach((seg) => {
        seg.addEventListener('pointerenter', () => {
          if (!tip) return;
          tip.textContent = `${seg.dataset.sliceLabel} · ${seg.dataset.sliceVal} (${seg.dataset.slicePct}%)`;
          tip.classList.remove('hidden');
        });
        seg.addEventListener('pointerleave', () => tip?.classList.add('hidden'));
      });
    }

    function renderSettingsModal() {
      ensureSettingsModal();
      const body = settingsModal.querySelector('#cSettingsBody');
      syncMemCountBadge();
      settingsModal.querySelectorAll('[data-stab]').forEach((b) => {
        const active = b.dataset.stab === settingsTab;
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', String(active));
      });
      if (settingsTab === 'instructions') renderInstructionsInto(body);
      else renderMemoryInto(body);
    }

    /* =======================================================================
       2. Keyboard Shortcuts Dialog (#46395)
       ======================================================================= */
    function ensureShortcutsModal() {
      if (shortcutsModal) return shortcutsModal;
      shortcutsModal = document.createElement('div');
      shortcutsModal.id = 'conduitShortcutsModal';
      shortcutsModal.className = 'c-modal hidden';
      shortcutsModal.setAttribute('role', 'dialog');
      shortcutsModal.setAttribute('aria-modal', 'true');
      shortcutsModal.setAttribute('aria-label', '键盘快捷键一览');
      shortcutsModal.innerHTML = `
        <div class="c-modal-scrim" data-close-shortcuts></div>
        <div class="c-modal-card is-lg" data-slot="keyboard-shortcuts">
          <header class="c-modal-head">
            <div class="c-modal-title-group">
              <h3>键盘快捷键</h3>
              <span class="mono-xs">随时按 ? 打开 · Esc 关闭</span>
            </div>
            <button type="button" class="rail-icon-btn" data-close-shortcuts aria-label="关闭 [Esc]">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.35"/></svg>
            </button>
          </header>
          <div class="ks-search-wrap">
            <input type="text" class="text-input" id="ksSearchInput" placeholder="搜索快捷键或操作..." autocomplete="off" />
          </div>
          <div class="c-modal-body ks-grid" id="ksBody"></div>
        </div>`;
      document.body.appendChild(shortcutsModal);

      shortcutsModal.querySelectorAll('[data-close-shortcuts]').forEach((n) => {
        n.addEventListener('click', () => shortcutsModal.classList.add('hidden'));
      });
      shortcutsModal.querySelector('#ksSearchInput').addEventListener('input', (e) => {
        shortcutQuery = e.target.value;
        renderShortcutsBody();
      });
      return shortcutsModal;
    }

    function renderShortcutsBody() {
      if (!shortcutsModal) return;
      const body = shortcutsModal.querySelector('#ksBody');
      const q = shortcutQuery.trim().toLowerCase();
      const blocks = SHORTCUT_GROUPS.map((g) => {
        const items = g.items.filter(
          (it) => !q || it.label.toLowerCase().includes(q) || it.keys.join(' ').toLowerCase().includes(q)
        );
        if (!items.length) return '';
        return `
          <section class="ks-section" aria-label="${escapeHtml(g.group)}">
            <h4 class="ks-group-title mono-xs">${escapeHtml(g.group)}</h4>
            <div class="ks-list">
              ${items
                .map(
                  (it) => `
                  <div class="ks-row" data-slot="keyboard-shortcut">
                    <span class="ks-label">${highlightMatch(it.label, shortcutQuery)}</span>
                    <span class="ks-keys">${it.keys.map((k) => `<kbd class="c-kbd">${escapeHtml(k)}</kbd>`).join('')}</span>
                  </div>`
                )
                .join('')}
            </div>
          </section>`;
      }).filter(Boolean);

      body.innerHTML = blocks.length ? blocks.join('') : '<div class="mm-empty mono-xs">没有匹配的快捷键</div>';
    }

    /* =======================================================================
       3. Command Palette (#45520 — Ctrl+K / ⌘K)
       ======================================================================= */
    function ensurePaletteModal() {
      if (paletteModal) return paletteModal;
      paletteModal = document.createElement('div');
      paletteModal.id = 'conduitCommandPalette';
      paletteModal.className = 'c-modal hidden';
      paletteModal.setAttribute('role', 'dialog');
      paletteModal.setAttribute('aria-modal', 'true');
      paletteModal.setAttribute('aria-label', '全局命令面板');
      paletteModal.innerHTML = `
        <div class="c-modal-scrim" data-close-palette></div>
        <div class="c-modal-card is-palette" data-slot="command-palette">
          <div class="cp-input-row">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
            <input type="text" class="cp-input" id="cpInput" placeholder="搜索会话、快捷操作、模型或媒体指令..." autocomplete="off" />
            <kbd class="c-kbd">Esc</kbd>
          </div>
          <div class="cp-list" id="cpList" role="listbox" aria-label="命令结果"></div>
          <footer class="cp-foot mono-xs">
            <span>↑↓ 移动 · Enter 执行</span>
            <span>TENON COMMANDS</span>
          </footer>
        </div>`;
      document.body.appendChild(paletteModal);

      paletteModal.querySelectorAll('[data-close-palette]').forEach((n) => {
        n.addEventListener('click', () => paletteModal.classList.add('hidden'));
      });
      const inp = paletteModal.querySelector('#cpInput');
      inp.addEventListener('input', (e) => {
        paletteQuery = e.target.value;
        paletteIdx = 0;
        renderPaletteList();
      });
      inp.addEventListener('keydown', (e) => {
        const items = getPaletteFlatItems();
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          paletteIdx = items.length ? (paletteIdx + 1) % items.length : 0;
          renderPaletteList();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          paletteIdx = items.length ? (paletteIdx - 1 + items.length) % items.length : 0;
          renderPaletteList();
        } else if (e.key === 'Enter' && items[paletteIdx]) {
          e.preventDefault();
          paletteModal.classList.add('hidden');
          items[paletteIdx].run();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          paletteModal.classList.add('hidden');
        }
      });
      return paletteModal;
    }

    function getPaletteGroups() {
      const ctx = hooks.getContext ? hooks.getContext() : {};
      const q = paletteQuery.trim().toLowerCase();
      const match = (s) => !q || String(s || '').toLowerCase().includes(q);

      const actionItems = [
        { title: '新建协同会话', sub: '清空当前对话，开始新任务', keys: [], run: () => hooks.onNewChat?.() },
        { title: '切换至 Blender 风格无限画布', sub: '多 Agent 节点拖拽、连线与集群合并', keys: [], run: () => hooks.onSwitchView?.('workflow') },
        { title: '切换至对话流视图', sub: 'Gemini × Codex 流式协作主界面', keys: [], run: () => hooks.onSwitchView?.('chat') },
        { title: '生成图像变体预览 (/image)', sub: '打开图像多变体渐进渲染与 Lightbox 预览', keys: ['/image'], run: () => hooks.onQuickMedia?.('image') },
        { title: '生成视频渲染预览 (/video)', sub: '打开视频渐进揭示与自定义视频播放器', keys: ['/video'], run: () => hooks.onQuickMedia?.('video') },
        { title: 'Agent 与 API 接入中心', sub: '接入 Claude Code / Ollama / DeepSeek / OpenRouter / Anthropic / 自定义 CLI', keys: [], run: () => openSettings('providers') },
        { title: '检测软件更新与版本', sub: '核对 GitHub Releases 新版本并一键下载 Windows 安装包', keys: [], run: () => openSettings('updates') },
        { title: '打开协同遥测与指标总览', sub: '查看实时会话统计、环形分布图与 24 段进度条', keys: [], run: () => openSettings('telemetry') },
        { title: '偏好指令（Custom Instructions）', sub: '配置回复风格与跨会话规则', keys: [], run: () => openSettings('instructions') },
        { title: '持久记忆库（Memory Manager）', sub: `查看、编辑或检索 ${memories.length} 条工作记忆`, keys: [], run: () => openSettings('memory') },
        { title: '打开 Agent 运行队列监控', sub: '查看运行中、待拍板与历史任务耗时', keys: [], run: () => hooks.onOpenInspector?.('runs') },
        { title: '查看全部键盘快捷键', sub: '搜索全局、对话流与画布热键', keys: ['?'], run: () => openShortcuts() },
        { title: '展开 Tweaks 实时调参台', sub: '切换建筑纸面、强调色与字号', keys: ['T'], run: () => hooks.onToggleTweaks?.() },
      ].filter((a) => match(a.title) || match(a.sub));

      const threadItems = (ctx.runs || [])
        .slice(0, 8)
        .filter((r) => match(r.title) || match(r.mode))
        .map((r) => ({
          title: r.title || '未命名会话',
          sub: `${r.mode || ''} · ${r.status || ''}`,
          keys: [],
          run: () => hooks.onSelectRun?.(r.id),
        }));

      const modelItems = (ctx.geminiModels || [])
        .slice(0, 6)
        .filter((m) => match(m.id) || match(m.label))
        .map((m) => ({
          title: `切换 Gemini: ${m.label || m.id}`,
          sub: m.id,
          keys: [],
          run: () => hooks.onPickGemini?.(m.id),
        }));

      const providerItems = (ctx.providers || [])
        .filter((p) => p.enabled && (match(p.name) || match(p.defaultModel) || match(p.protocol)))
        .slice(0, 6)
        .map((p) => ({
          title: `切换外部 Agent: ${p.name}`,
          sub: `${p.defaultModel || p.command || p.protocol} · ${p.kind === 'cli' ? 'LOCAL CLI' : 'API'}`,
          keys: [],
          run: () => hooks.onUseProvider?.(p),
        }));

      return [
        { label: '快捷操作', items: actionItems },
        { label: '外部 Agent 与 API', items: providerItems },
        { label: '最近会话', items: threadItems },
        { label: '本机模型', items: modelItems },
      ].filter((g) => g.items.length > 0);
    }

    function getPaletteFlatItems() {
      return getPaletteGroups().flatMap((g) => g.items);
    }

    function renderPaletteList() {
      if (!paletteModal) return;
      const listEl = paletteModal.querySelector('#cpList');
      const groups = getPaletteGroups();
      if (!groups.length) {
        listEl.innerHTML = '<div class="mm-empty mono-xs" data-slot="command-palette-empty">未找到匹配的命令或会话</div>';
        return;
      }
      let flatCursor = 0;
      listEl.innerHTML = groups
        .map(
          (g) => `
          <div class="cp-group">
            <div class="cp-group-label mono-xs">${escapeHtml(g.label)}</div>
            ${g.items
              .map((it) => {
                const idx = flatCursor++;
                const active = idx === paletteIdx;
                return `
                  <button type="button" class="cp-item ${active ? 'is-active' : ''}" role="option" aria-selected="${active}" data-cp-idx="${idx}">
                    <div class="cp-item-main">
                      <span class="cp-item-title">${highlightMatch(it.title, paletteQuery)}</span>
                      ${it.sub ? `<span class="cp-item-sub">${highlightMatch(it.sub, paletteQuery)}</span>` : ''}
                    </div>
                    ${it.keys?.length ? `<span class="ks-keys">${it.keys.map((k) => `<kbd class="c-kbd">${escapeHtml(k)}</kbd>`).join('')}</span>` : ''}
                  </button>`;
              })
              .join('')}
          </div>`
        )
        .join('');

      const flat = getPaletteFlatItems();
      listEl.querySelectorAll('[data-cp-idx]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const item = flat[Number(btn.dataset.cpIdx)];
          paletteModal.classList.add('hidden');
          item?.run();
        });
      });
    }

    function openSettings(tab = 'instructions') {
      closeAllModals();
      if (hooks.onNavigateSettings) {
        hooks.onNavigateSettings(tab);
        return;
      }
      settingsTab = tab;
      ensureSettingsModal();
      renderSettingsModal();
      settingsModal.classList.remove('hidden');
    }

    function openShortcuts() {
      closeAllModals();
      if (hooks.onNavigateSettings) {
        hooks.onNavigateSettings('shortcuts');
        return;
      }
      shortcutQuery = '';
      ensureShortcutsModal();
      const inp = shortcutsModal.querySelector('#ksSearchInput');
      if (inp) inp.value = '';
      renderShortcutsBody();
      shortcutsModal.classList.remove('hidden');
      requestAnimationFrame(() => inp?.focus());
    }

    function openPalette() {
      closeAllModals();
      paletteQuery = '';
      paletteIdx = 0;
      ensurePaletteModal();
      const inp = paletteModal.querySelector('#cpInput');
      if (inp) inp.value = '';
      renderPaletteList();
      paletteModal.classList.remove('hidden');
      requestAnimationFrame(() => inp?.focus());
    }

    function getInstructionContext() {
      const style = PERSONALITIES.find((p) => p.id === instrState.personality);
      return {
        personality: instrState.personality,
        personalityName: style?.name || '默认均衡',
        instructions: instrState.instructions,
        memoriesCount: memories.length,
      };
    }

    // Global hotkeys: Mod+K (Command Palette) & ? (Shortcuts)
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (paletteModal && !paletteModal.classList.contains('hidden')) paletteModal.classList.add('hidden');
        else openPalette();
        return;
      }
      if (e.key === 'Escape') {
        if (
          (settingsModal && !settingsModal.classList.contains('hidden')) ||
          (shortcutsModal && !shortcutsModal.classList.contains('hidden')) ||
          (paletteModal && !paletteModal.classList.contains('hidden'))
        ) {
          closeAllModals();
          return;
        }
      }
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable) return;
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        openShortcuts();
      }
    });

    return {
      openSettings,
      openShortcuts,
      openPalette,
      closeAllModals,
      renderInstructionsInto,
      renderMemoryInto,
      renderShortcutsInto,
      renderTelemetryInto,
      renderProvidersInto,
      renderUpdatesInto,
      openNewProviderEditor: (mount, ctx) => {
        openProviderEditor(null);
        renderProvidersInto(mount, ctx);
        mount?.querySelector('#phName')?.focus();
      },
      getInstructionContext,
      getMemories: () => memories,
    };
  }

  window.ConduitPanels = {
    create: createWorkspacePanels,
    MOD_KEY,
  };
})();
