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
      instructions: '先给核心结论与接口契约，再用简洁中文列出验证步骤。',
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

    function renderSettingsModal() {
      ensureSettingsModal();
      const body = settingsModal.querySelector('#cSettingsBody');
      const cntEl = settingsModal.querySelector('#cMemTabCount');
      if (cntEl) cntEl.textContent = String(memories.length);

      settingsModal.querySelectorAll('[data-stab]').forEach((b) => {
        const active = b.dataset.stab === settingsTab;
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', String(active));
      });

      if (settingsTab === 'instructions') {
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
                <p id="ciSampleText">${escapeHtml(activeP.sample)}</p>
              </div>
            </section>

            <section class="ci-section" data-slot="instructions-field">
              <div class="ci-label-row">
                <label class="ci-title" for="ciTextarea">模型应如何配合你？</label>
                <span class="mono-xs ci-counter" id="ciCharCounter">${draft.instructions.length} / ${MAX_INSTR_LEN}</span>
              </div>
              <textarea id="ciTextarea" class="gate-editor ci-textarea" rows="4" maxlength="${MAX_INSTR_LEN}" placeholder="输入跨会话生效的协作约定、代码风格或交付偏好...">${escapeHtml(draft.instructions)}</textarea>
              <div class="ci-chips" role="group" aria-label="一键追加偏好">
                ${INSTR_SUGGESTIONS.map(
                  (s) => `<button type="button" class="ci-chip" data-ci-chip="${escapeHtml(s)}">+ ${escapeHtml(s)}</button>`
                ).join('')}
              </div>
            </section>

            <footer class="ci-footer" data-slot="custom-instructions-footer">
              <span class="mono-xs ci-saved-hint" id="ciSavedHint">更改将自动应用于后续对话派发</span>
              <div class="ci-footer-btns">
                <button type="button" class="btn-secondary-sm" id="ciBtnReset">恢复默认</button>
                <button type="button" class="btn-primary-sm" id="ciBtnSave">保存偏好</button>
              </div>
            </footer>
          </div>`;

        let currentStyle = draft.personality;
        const ta = body.querySelector('#ciTextarea');
        const counter = body.querySelector('#ciCharCounter');
        const sampleEl = body.querySelector('#ciSampleText');
        const savedHint = body.querySelector('#ciSavedHint');

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

        body.querySelector('#ciBtnReset').addEventListener('click', () => {
          currentStyle = 'default';
          ta.value = '';
          instrState = { personality: 'default', instructions: '' };
          saveInstructions(instrState);
          renderSettingsModal();
          if (hooks.onToast) hooks.onToast('已重置偏好指令');
        });

        body.querySelector('#ciBtnSave').addEventListener('click', () => {
          instrState = { personality: currentStyle, instructions: ta.value.trim() };
          saveInstructions(instrState);
          savedHint.textContent = '✓ 已保存并生效';
          if (hooks.onToast) hooks.onToast('个性化偏好指令已保存');
        });
        return;
      }

      // Tab 2: Memory Manager (#46393)
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
                              <textarea class="gate-editor mm-edit-input" id="mmEditInput" rows="2">${escapeHtml(m.text)}</textarea>
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
            <input type="text" class="text-input mm-search" id="mmSearchInput" value="${escapeHtml(memSearch)}" placeholder="搜索跨会话记忆..." autocomplete="off" />
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
                  <button type="button" class="link-btn" id="mmBtnUndo">撤销删除</button>
                </div>`
              : ''
          }

          <div class="mm-list">${groupsHtml}</div>

          <form class="mm-add-form" id="mmAddForm">
            <input type="text" class="text-input mm-add-topic mono" id="mmAddTopic" placeholder="分类（如 工程偏好）" value="工程偏好" />
            <input type="text" class="text-input mm-add-text" id="mmAddText" placeholder="新增一条助手应记住的跨会话偏好..." autocomplete="off" />
            <button type="submit" class="btn-primary-sm">记住</button>
          </form>
        </div>`;

      const searchInp = body.querySelector('#mmSearchInput');
      searchInp.addEventListener('input', (e) => {
        memSearch = e.target.value;
        const pos = e.target.selectionStart || memSearch.length;
        renderSettingsModal();
        const nextInp = settingsModal.querySelector('#mmSearchInput');
        if (nextInp) { nextInp.focus(); nextInp.setSelectionRange(pos, pos); }
      });

      body.querySelectorAll('[data-mm-edit]').forEach((btn) => {
        btn.addEventListener('click', () => {
          editingMemId = btn.dataset.mmEdit;
          renderSettingsModal();
          settingsModal.querySelector('#mmEditInput')?.focus();
        });
      });

      body.querySelector('[data-mm-cancel]')?.addEventListener('click', () => {
        editingMemId = null;
        renderSettingsModal();
      });

      body.querySelector('[data-mm-save]')?.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.mmSave;
        const val = (body.querySelector('#mmEditInput')?.value || '').trim();
        if (val) {
          memories = memories.map((m) => (m.id === id ? { ...m, text: val, updatedAt: '刚刚' } : m));
          saveMemories(memories);
        }
        editingMemId = null;
        renderSettingsModal();
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
          undoTimer = setTimeout(() => { lastDeleted = null; if (!settingsModal.classList.contains('hidden') && settingsTab === 'memory') renderSettingsModal(); }, 6000);
          renderSettingsModal();
        });
      });

      body.querySelector('#mmBtnUndo')?.addEventListener('click', () => {
        if (!lastDeleted) return;
        const { _idx, ...item } = lastDeleted;
        memories.splice(Math.min(_idx, memories.length), 0, item);
        lastDeleted = null;
        saveMemories(memories);
        renderSettingsModal();
        if (hooks.onToast) hooks.onToast('已恢复删除的记忆');
      });

      body.querySelector('#mmAddForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const topic = (body.querySelector('#mmAddTopic').value || '').trim() || '工程偏好';
        const text = (body.querySelector('#mmAddText').value || '').trim();
        if (!text) return;
        memories.unshift({
          id: `mem-${Date.now()}`,
          topic,
          text,
          source: '手动录入',
          updatedAt: '刚刚',
        });
        saveMemories(memories);
        renderSettingsModal();
        if (hooks.onToast) hooks.onToast('已写入持久记忆库');
      });
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
            <span>CONDUIT COMMANDS</span>
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

      return [
        { label: '快捷操作', items: actionItems },
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
      settingsTab = tab;
      ensureSettingsModal();
      renderSettingsModal();
      settingsModal.classList.remove('hidden');
    }

    function openShortcuts() {
      closeAllModals();
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
      getInstructionContext,
      getMemories: () => memories,
    };
  }

  window.ConduitPanels = {
    create: createWorkspacePanels,
    MOD_KEY,
  };
})();
