import crypto from 'node:crypto';
import { runAgy, runCodex, killProcessTree } from './runners.mjs';
import { runProvider } from './providers.mjs';
import { inspectWorkspace, getWorkspaceDiff, createManagedWorktree } from './workspace.mjs';

export function parseProviderRef(ref = '') {
  const s = String(ref || '').trim();
  if (!s.startsWith('provider:')) return null;
  const rest = s.slice('provider:'.length);
  const sepIdx = rest.indexOf(':');
  if (sepIdx < 0) return { providerId: rest, model: '' };
  return {
    providerId: rest.slice(0, sepIdx),
    model: rest.slice(sepIdx + 1),
  };
}

function abortActiveHandle(proc) {
  if (!proc) return;
  if (typeof proc.abort === 'function') {
    try { proc.abort(); } catch { /* ignore */ }
  } else {
    killProcessTree(proc);
  }
}

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
  }
}

/**
 * Parses Codex's structured Pre-CI review verdict (two-tier severity: BLOCKING vs SUGGESTION).
 * Matches the LAST valid fenced JSON block carrying verdict fields to avoid earlier prose snippets
 * accidentally bypassing the review gate.
 */
export function parseReviewVerdict(text = '') {
  const source = String(text || '');
  const jsonMatches = Array.from(source.matchAll(/```json\s*([\s\S]*?)```/gi));

  for (let i = jsonMatches.length - 1; i >= 0; i -= 1) {
    try {
      const obj = JSON.parse(jsonMatches[i][1]);
      if (
        obj &&
        typeof obj === 'object' &&
        ('passed' in obj || Array.isArray(obj.blocking) || Array.isArray(obj.suggestions))
      ) {
        const blocking = Array.isArray(obj.blocking) ? obj.blocking : [];
        const suggestions = Array.isArray(obj.suggestions) ? obj.suggestions : [];
        const passed = typeof obj.passed === 'boolean' ? obj.passed : blocking.length === 0;
        return {
          passed,
          blocking,
          suggestions,
          summary: obj.summary || (passed ? '审查通过，无阻塞级风险' : `拦截 ${blocking.length} 项阻塞级问题`),
        };
      }
    } catch {
      // Try earlier block if final JSON block is malformed
    }
  }

  // Fallback marker parsing (strictly requires bullet/item prefix so prose like "无 [BLOCKING]" never false-blocks)
  const hasPassMarker = /VERDICT\s*[:：]\s*PASS/i.test(source);
  const hasBlockMarker = /VERDICT\s*[:：]\s*BLOCK/i.test(source);
  const blockingLines = source
    .split(/\r?\n/)
    .filter((l) => /^\s*(?:[-*]|\d+\.)\s*\[BLOCKING\]/i.test(l))
    .map((l) => l.replace(/^\s*(?:[-*]|\d+\.)\s*/, '').trim());
  const suggestionLines = source
    .split(/\r?\n/)
    .filter((l) => /^\s*(?:[-*]|\d+\.)\s*\[SUGGESTION\]/i.test(l))
    .map((l) => l.replace(/^\s*(?:[-*]|\d+\.)\s*/, '').trim());

  const passed = hasPassMarker && !hasBlockMarker && blockingLines.length === 0
    ? true
    : (!hasBlockMarker && blockingLines.length === 0);

  return {
    passed,
    blocking: blockingLines,
    suggestions: suggestionLines,
    summary: passed
      ? '审查通过，未检出阻塞上线级问题'
      : `发现 ${blockingLines.length || 1} 项阻塞级问题，建议修复后复审`,
  };
}

export class Orchestrator {
  constructor(store, options = {}) {
    this.store = store;
    this.providerStore = options.providerStore || null;
    this.activeProcesses = new Map();
    this.pendingGates = new Map();
  }

  setActiveProcess(runId, child) {
    if (child) this.activeProcesses.set(runId, child);
    else this.activeProcesses.delete(runId);
  }

  shutdown() {
    for (const [, proc] of this.activeProcesses) {
      abortActiveHandle(proc);
    }
    this.activeProcesses.clear();
    for (const [, gate] of this.pendingGates) {
      gate.resolve({ action: 'cancel' });
    }
    this.pendingGates.clear();
  }

  cancelRun(runId) {
    const run = this.store.get(runId);
    if (!run) return false;

    const proc = this.activeProcesses.get(runId);
    if (proc) {
      abortActiveHandle(proc);
      this.activeProcesses.delete(runId);
    }

    const gate = this.pendingGates.get(runId);
    if (gate) {
      gate.resolve({ action: 'cancel' });
      this.pendingGates.delete(runId);
    }

    this.store.update(runId, (r) => {
      r.status = 'cancelled';
      r.gate = null;
    });
    this.store.appendEvent(runId, {
      source: 'system',
      kind: 'cancelled',
      text: '任务已被用户手动中止',
    });
    return true;
  }

  waitForHumanGate(runId, gateMeta) {
    return new Promise((resolve) => {
      this.store.update(runId, (r) => {
        r.status = 'awaiting_approval';
        r.gate = gateMeta;
      });
      this.store.appendEvent(runId, {
        source: 'system',
        kind: 'gate',
        text: gateMeta.message,
      });
      this.pendingGates.set(runId, { resolve });
    });
  }

  resolveGate(runId, decision) {
    const gate = this.pendingGates.get(runId);
    if (!gate) return false;
    this.pendingGates.delete(runId);
    this.store.update(runId, (r) => {
      r.status = 'running';
      r.gate = null;
    });
    gate.resolve(decision);
    return true;
  }

  async startRun(payload) {
    const id = `run_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
    const mode = payload.mode || 'full-pipeline';
    const workspaceDir = payload.workspaceDir || process.cwd();
    const prompt = String(payload.prompt || '').trim();
    if (!prompt) {
      throw new ValidationError('请输入任务需求或待处理内容');
    }

    const ws = await inspectWorkspace(workspaceDir);
    if (!ws.ok) {
      throw new ValidationError(`工作目录不可用：${ws.error}`);
    }

    const parsedRef = parseProviderRef(payload.geminiModel);
    const resolvedProviderId = String(payload.providerId || parsedRef?.providerId || '').trim();
    const resolvedProvider = resolvedProviderId && this.providerStore
      ? this.providerStore.get(resolvedProviderId)
      : null;

    if (mode === 'custom-agent') {
      if (!resolvedProvider) {
        throw new ValidationError('未找到指定的外部 Agent / API 接入，请先在「设置 → Agent 与 API 接入」中配置并启用');
      }
      if (!resolvedProvider.enabled) {
        throw new ValidationError(`接入「${resolvedProvider.name}」当前处于停用状态，请先启用后再运行`);
      }
    }

    const config = {
      geminiModel: payload.geminiModel || 'gemini-4-neon-high',
      codexModel: payload.codexModel ?? '',
      codexReviewModel: payload.codexReviewModel ?? '',
      codexEffort: payload.codexEffort || 'high',
      sandbox: payload.sandbox === 'read-only' ? 'read-only' : 'workspace-write',
      useWorktree: Boolean(payload.useWorktree),
      requireApproval: payload.requireApproval !== false,
      maxReviewRounds: Math.min(3, Math.max(1, Number(payload.maxReviewRounds) || 2)),
      codexHome: String(payload.codexHome || '').trim(),
      // Only honor resumeThreadId in direct codex-exec mode
      resumeThreadId: mode === 'codex-exec' ? String(payload.resumeThreadId || '').trim() : '',
      providerId: resolvedProvider ? resolvedProvider.id : '',
      providerName: resolvedProvider ? resolvedProvider.name : '',
      providerProtocol: resolvedProvider ? resolvedProvider.protocol : '',
      providerKind: resolvedProvider ? resolvedProvider.kind : '',
      providerModel: resolvedProvider
        ? String(payload.providerModel || parsedRef?.model || resolvedProvider.defaultModel || '').trim()
        : '',
    };

    let effectiveWorkDir = ws.path;
    let worktreePath = null;

    if (config.useWorktree && ws.isGitRepo && (mode === 'full-pipeline' || mode === 'codex-exec')) {
      const wt = await createManagedWorktree(ws.path, id);
      if (!wt.ok) {
        throw new ValidationError(wt.error);
      }
      effectiveWorkDir = wt.path;
      worktreePath = wt.path;
    }

    const run = this.store.create({
      id,
      mode,
      title: prompt.slice(0, 64),
      prompt,
      workspaceDir: ws.path,
      effectiveWorkDir,
      worktreePath,
      isGitRepo: ws.isGitRepo,
      branch: ws.branch,
      status: 'running',
      activeStage: 'init',
      config,
      gate: null,
      reviewRound: 0,
      reviewVerdict: null,
      gemini: {
        status: 'idle',
        conversationId: null,
        planText: '',
        summaryText: '',
        copyText: '',
        durationMs: 0,
        usage: null,
        error: null,
      },
      codex: {
        status: 'idle',
        threadId: config.resumeThreadId || null,
        execText: '',
        reviewText: '',
        durationMs: 0,
        usage: null,
        error: null,
        diff: '',
        diffStat: '',
      },
      metrics: {
        totalDurationMs: 0,
        geminiTokens: 0,
        codexTokens: 0,
      },
      events: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    if (worktreePath) {
      this.store.appendEvent(id, {
        source: 'system',
        kind: 'worktree',
        text: `已创建隔离 Git Worktree：${worktreePath}（施工、Diff 与审查均在此隔离目录执行）`,
      });
    }

    this.executePipeline(run).catch((err) => {
      this.store.update(id, (r) => {
        if (r.status !== 'cancelled') {
          r.status = 'failed';
          r.activeStage = 'failed';
        }
      });
      this.store.appendEvent(id, {
        source: 'system',
        kind: 'error',
        text: `管线异常：${err.message}`,
      });
    });

    return run;
  }

  async executePipeline(run) {
    const startedAt = Date.now();
    const id = run.id;

    try {
      if (run.mode === 'custom-agent') {
        await this.stageCustomAgent(run);
      } else if (run.mode === 'plan-only') {
        await this.stageGeminiPlan(run);
      } else if (run.mode === 'copy-polish') {
        await this.stageGeminiCopy(run);
      } else if (run.mode === 'codex-exec') {
        await this.stageCodexExec(run, run.prompt);
      } else if (run.mode === 'codex-review') {
        await this.stageCodexReviewLoop(run, false);
      } else {
        let currentPrompt = run.prompt;
        let codexSpec = '';

        while (true) {
          const planRes = await this.stageGeminiPlan(run, currentPrompt);
          if (!planRes.ok || this.store.get(id)?.status === 'cancelled') return;
          codexSpec = planRes.text;

          if (!run.config.requireApproval) break;

          const decision = await this.waitForHumanGate(id, {
            type: 'plan_approval',
            title: '02 人工拍板闸门 — 确认派发给 Codex 施工',
            message: 'Gemini 已输出实施方案与接口契约。你可以直接修改下方派单指令后放行给 Codex，或提出意见让 Gemini 重出方案。',
            editableSpec: codexSpec,
          });

          if (decision.action === 'cancel' || decision.action === 'abort' || this.store.get(id)?.status === 'cancelled') {
            return;
          }
          if (decision.action === 'replan') {
            currentPrompt = `${run.prompt}\n\n【人工拍板打回意见】\n${decision.feedback || '请重新梳理方案细节与边界。'}`;
            this.store.appendEvent(id, {
              source: 'system',
              kind: 'replan',
              text: '已收到打回意见，交回 Gemini 重新规划',
            });
            continue;
          }
          if (decision.spec && decision.spec.trim()) {
            codexSpec = decision.spec.trim();
          }
          break;
        }

        const execRes = await this.stageCodexExec(run, codexSpec);
        if (!execRes.ok || this.store.get(id)?.status === 'cancelled') return;

        const reviewOk = await this.stageCodexReviewLoop(run, true);
        if (!reviewOk || this.store.get(id)?.status === 'cancelled') return;

        const summaryRes = await this.stageGeminiSummary(run);
        if (!summaryRes.ok || this.store.get(id)?.status === 'cancelled') return;
      }

      const latest = this.store.get(id);
      if (latest && latest.status === 'running') {
        this.store.update(id, (r) => {
          r.status = 'completed';
          r.activeStage = 'done';
          r.metrics.totalDurationMs = Date.now() - startedAt;
        });
        this.store.appendEvent(id, {
          source: 'system',
          kind: 'completed',
          text: `协同管线完成，总耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
        });
      }
    } finally {
      this.setActiveProcess(id, null);
    }
  }

  async invokePrimaryEngine(run, { prompt, systemPrompt = '', onDelta }) {
    const id = run.id;
    const providerId = run.config.providerId;
    if (providerId && this.providerStore) {
      const provider = this.providerStore.get(providerId);
      if (provider && provider.enabled) {
        return runProvider(provider, {
          prompt,
          systemPrompt,
          model: run.config.providerModel || provider.defaultModel,
          cwd: run.effectiveWorkDir,
          onProcess: (p) => this.setActiveProcess(id, p),
          onDelta,
          onEvent: (ev) => this.store.appendEvent(id, {
            ...ev,
            source: ev.source === 'provider' ? 'gemini' : (ev.source || 'gemini'),
          }),
        });
      }
    }

    return runAgy({
      prompt: systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt,
      model: run.config.geminiModel,
      cwd: run.effectiveWorkDir,
      mode: 'plan',
      onProcess: (p) => this.setActiveProcess(id, p),
      onDelta,
      onEvent: (ev) => this.store.appendEvent(id, ev),
    });
  }

  async stageCustomAgent(run) {
    const id = run.id;
    const provider = this.providerStore?.get(run.config.providerId);
    const engineLabel = provider
      ? `${provider.name}${run.config.providerModel ? ` (${run.config.providerModel})` : ''}`
      : '外部 Agent';

    this.store.update(id, (r) => {
      r.activeStage = 'plan';
      r.gemini.status = 'running';
      r.gemini.error = null;
      r.gemini.planText = '';
    });
    this.store.appendEvent(id, {
      source: 'gemini',
      kind: 'stage',
      text: `启动外部接入引擎 · ${engineLabel} [${provider?.protocol || 'custom'}]`,
    });

    const wsContext = await inspectWorkspace(run.effectiveWorkDir).catch(() => null);
    const dirSummary = wsContext?.topFiles?.length
      ? wsContext.topFiles.slice(0, 20).map((f) => `${f.type === 'dir' ? '[DIR]' : '[FILE]'} ${f.name}`).join(', ')
      : '';
    const systemPrompt = dirSummary
      ? `你正在 CONDUIT 多模型协同工作台中运行。当前工作目录：${run.effectiveWorkDir}；顶层结构：${dirSummary}。请用清晰、准确、无废话的中文作答。`
      : `你正在 CONDUIT 多模型协同工作台中运行。当前工作目录：${run.effectiveWorkDir}。请用清晰、准确、无废话的中文作答。`;

    const res = await this.invokePrimaryEngine(run, {
      prompt: run.prompt,
      systemPrompt,
      onDelta: (_delta, full) => {
        this.store.update(id, (r) => {
          r.gemini.planText = full;
        });
      },
    });

    this.setActiveProcess(id, null);
    this.store.update(id, (r) => {
      r.gemini.status = res.ok ? 'done' : 'failed';
      r.gemini.planText = res.text || r.gemini.planText;
      r.gemini.durationMs += res.durationMs || 0;
      r.gemini.usage = res.usage || null;
      r.gemini.error = res.error || null;
      if (res.usage) {
        const tok = res.usage.total_tokens || ((res.usage.input_tokens || 0) + (res.usage.output_tokens || 0));
        if (tok) r.metrics.geminiTokens += tok;
      }
      if (!res.ok && r.status !== 'cancelled') {
        r.status = 'failed';
        r.activeStage = 'failed';
      }
    });
    return res;
  }

  async stageGeminiPlan(run, promptOverride = null) {
    const id = run.id;
    const task = promptOverride || run.prompt;
    const plannerLabel = run.config.providerName
      ? `${run.config.providerName} (${run.config.providerModel || 'default'})`
      : `Gemini (${run.config.geminiModel})`;
    this.store.update(id, (r) => {
      r.activeStage = 'plan';
      r.gemini.status = 'running';
      r.gemini.error = null;
      r.gemini.planText = '';
    });
    this.store.appendEvent(id, {
      source: 'gemini',
      kind: 'stage',
      text: `01 启动 ${plannerLabel} 进行需求拆解与独立规划（只读）`,
    });

    const wsContext = await inspectWorkspace(run.effectiveWorkDir).catch(() => null);
    const dirSummary = wsContext?.topFiles?.length
      ? wsContext.topFiles.slice(0, 24).map((f) => `${f.type === 'dir' ? '[DIR]' : '[FILE]'} ${f.name}`).join(', ')
      : '（无顶层文件概览）';

    const structuredPrompt = [
      '你是 CONDUIT 多模型协同工作台的【总指挥与架构规划师】。',
      '【严格约束】当前处于无头只读规划模式：绝对不要调用任何终端命令工具（run_command），不要修改任何文件；如需了解项目可直接基于下方已提供的目录结构直接推理回答，或仅做纯文本分析。',
      '请针对下方用户需求，用清晰、克制、无黑话的中文输出一份可直接交付给下游 Codex 工程师施工的《实施方案与派单契约》，包含：',
      '1. 核心目标与业务边界（3 条以内）',
      '2. 涉及文件与模块拆解（明确接口输入输出）',
      '3. 验收标准与机械检查项（类型/测试/边界条件）',
      '4. 潜在风险与需要特别留意的同类联动处',
      '',
      `【工作目录】${run.effectiveWorkDir}`,
      `【目录顶层结构】${dirSummary}`,
      '【用户原始需求】',
      task,
    ].join('\n');

    const res = await this.invokePrimaryEngine(run, {
      prompt: structuredPrompt,
      onDelta: (_delta, full) => {
        this.store.update(id, (r) => {
          r.gemini.planText = full;
        });
      },
    });

    this.setActiveProcess(id, null);
    this.store.update(id, (r) => {
      r.gemini.status = res.ok ? 'done' : 'failed';
      r.gemini.conversationId = res.conversationId || r.gemini.conversationId;
      r.gemini.planText = res.text || r.gemini.planText;
      r.gemini.durationMs += res.durationMs || 0;
      r.gemini.usage = res.usage;
      r.gemini.error = res.error;
      const tok = res.usage?.total_tokens || ((res.usage?.input_tokens || 0) + (res.usage?.output_tokens || 0));
      if (tok) r.metrics.geminiTokens += tok;
      if (!res.ok && r.status !== 'cancelled') {
        r.status = 'failed';
        r.activeStage = 'failed';
      }
    });
    return res;
  }

  async stageGeminiCopy(run) {
    const id = run.id;
    const advisorLabel = run.config.providerName
      ? `${run.config.providerName} (${run.config.providerModel || 'default'})`
      : `Gemini (${run.config.geminiModel})`;
    this.store.update(id, (r) => {
      r.activeStage = 'copy';
      r.gemini.status = 'running';
      r.gemini.error = null;
      r.gemini.copyText = '';
    });
    this.store.appendEvent(id, {
      source: 'gemini',
      kind: 'stage',
      text: `启动 ${advisorLabel} 担任界面文案与交互顾问`,
    });

    const copyPrompt = [
      '你是顶级产品文案与交互设计师（无头只读顾问：绝对不要调用终端命令工具或修改任何本地文件，直接基于文本作答）。',
      '请审阅用户提供的界面文案/交互说明，彻底去除“AI 解释腔”和冗余字句，遵循“说人话、短句、动词明确、零废话”的原则。',
      '输出格式：',
      '1. 问题诊断（直指哪里别扭、多余）',
      '2. 改写前后对照表（原句 | 推荐改写 | 改动理由）',
      '3. 交互状态补充建议（空状态 / 加载 / 错误提示）',
      '',
      '【待审阅的文案与页面上下文】',
      run.prompt,
    ].join('\n');

    const res = await this.invokePrimaryEngine(run, {
      prompt: copyPrompt,
      onDelta: (_delta, full) => {
        this.store.update(id, (r) => {
          r.gemini.copyText = full;
        });
      },
    });

    this.setActiveProcess(id, null);
    this.store.update(id, (r) => {
      r.gemini.status = res.ok ? 'done' : 'failed';
      r.gemini.conversationId = res.conversationId || r.gemini.conversationId;
      r.gemini.copyText = res.text || r.gemini.copyText;
      r.gemini.durationMs += res.durationMs || 0;
      r.gemini.usage = res.usage;
      r.gemini.error = res.error;
      const tok = res.usage?.total_tokens || ((res.usage?.input_tokens || 0) + (res.usage?.output_tokens || 0));
      if (tok) r.metrics.geminiTokens += tok;
      if (!res.ok && r.status !== 'cancelled') {
        r.status = 'failed';
        r.activeStage = 'failed';
      }
    });
    return res;
  }

  async stageCodexExec(run, taskSpec, resumeThreadId = '') {
    const id = run.id;
    const latestRun = this.store.get(id);
    const threadToResume = resumeThreadId || latestRun?.config?.resumeThreadId || '';

    this.store.update(id, (r) => {
      r.activeStage = 'exec';
      r.codex.status = 'running';
      r.codex.error = null;
    });
    this.store.appendEvent(id, {
      source: 'codex',
      kind: 'stage',
      text: `03 派发给 Codex (${run.config.codexModel || '本机默认'} · ${run.config.codexEffort} · sandbox=${run.config.sandbox})`,
    });

    const codexPrompt = [
      '你是 CONDUIT 多模型协同工作台的【后端与代码实现工程师（Codex）】。',
      '请严格按以下任务契约和验收标准在当前工作目录内严谨实现，不要顺手改无关模块，不要跳过验证。',
      '完成后请简明汇报：改动文件清单、核心实现点、已跑过的测试命令与结果。',
      '',
      '【派单任务与验收标准】',
      taskSpec,
    ].join('\n');

    const res = await runCodex({
      prompt: codexPrompt,
      cwd: run.effectiveWorkDir,
      model: run.config.codexModel,
      reasoningEffort: run.config.codexEffort,
      sandbox: run.config.sandbox,
      isGitRepo: run.isGitRepo,
      resumeThreadId: threadToResume,
      codexHome: run.config.codexHome,
      onProcess: (p) => this.setActiveProcess(id, p),
      onDelta: (_d, full) => {
        this.store.update(id, (r) => {
          r.codex.execText = full;
        });
      },
      onEvent: (ev) => this.store.appendEvent(id, ev),
    });

    this.setActiveProcess(id, null);
    const diffInfo = await getWorkspaceDiff(run.effectiveWorkDir).catch(() => ({ diff: '', stat: '' }));

    this.store.update(id, (r) => {
      r.codex.status = res.ok ? 'done' : 'failed';
      r.codex.threadId = res.threadId || r.codex.threadId;
      r.codex.execText = res.text || r.codex.execText;
      r.codex.durationMs += res.durationMs;
      r.codex.usage = res.usage;
      r.codex.error = res.error;
      r.codex.diff = diffInfo.diff || '';
      r.codex.diffStat = diffInfo.stat || '';
      if (res.usage) {
        r.metrics.codexTokens += (res.usage.input_tokens || 0) + (res.usage.output_tokens || 0);
      }
      if (!res.ok && r.status !== 'cancelled') {
        r.status = 'failed';
        r.activeStage = 'failed';
      }
    });
    return res;
  }

  async stageCodexReviewLoop(run, allowAutoFix = true) {
    const id = run.id;
    const effectiveMaxRounds = allowAutoFix ? (run.config.maxReviewRounds || 2) : 1;

    for (let round = 1; round <= effectiveMaxRounds; round += 1) {
      if (this.store.get(id)?.status === 'cancelled') return false;

      // Re-inspect workspace on EVERY round so high-risk files touched during Round-1 fix escalate Round-2 to xhigh
      const ws = await inspectWorkspace(run.effectiveWorkDir);
      const reviewEffort = ws.recommendedReviewEffort || 'high';
      const highRiskNote = ws.highRiskFiles && ws.highRiskFiles.length > 0
        ? `检测到高危敏感文件变更（${ws.highRiskFiles.join(', ')}），自动将审查深度提升至 xhigh。`
        : '未触发高危路径规则，审查深度保持 high。';

      this.store.update(id, (r) => {
        r.activeStage = 'review';
        r.reviewRound = round;
        r.codex.status = 'running';
        r.codex.error = null;
      });
      this.store.appendEvent(id, {
        source: 'codex',
        kind: 'stage',
        text: `04 启动前置代码审查门禁 · 第 ${round}/${effectiveMaxRounds} 轮（model=${run.config.codexReviewModel || run.config.codexModel || '默认'} · effort=${reviewEffort}）。${highRiskNote}`,
      });

      const diffInfo = await getWorkspaceDiff(run.effectiveWorkDir);
      const reviewPrompt = [
        '你是 CONDUIT 工作台的【Pre-CI 代码审查门神（只读模式）】。不要修改任何文件。',
        '请检查当前工作目录的代码变更（你可直接读取文件或参考下方 diff），严格按两级标准分类：',
        '- BLOCKING（阻塞上线）：仅限会导致算错钱、丢数据、越权/登录漏洞、发错对外消息、发布崩溃事故且能清晰说出触发路径的真实缺陷。',
        '- SUGGESTION（非阻塞建议）：代码风格、极端巧合场景、可后续优化项。',
        '',
        '请务必在回复末尾附带如下严格 JSON 代码块：',
        '```json',
        '{',
        '  "passed": true,',
        '  "summary": "一句话结论",',
        '  "blocking": ["[文件:行号] 问题描述 + 触发路径"],',
        '  "suggestions": ["[文件:行号] 优化建议"]',
        '}',
        '```',
        '',
        diffInfo.diff
          ? `【当前 Git Diff】\n${diffInfo.diff.slice(0, 60_000)}`
          : `【审查目标说明】\n${run.prompt}`,
      ].join('\n');

      const res = await runCodex({
        prompt: reviewPrompt,
        cwd: run.effectiveWorkDir,
        model: run.config.codexReviewModel || run.config.codexModel,
        reasoningEffort: reviewEffort,
        sandbox: 'read-only',
        isGitRepo: run.isGitRepo,
        codexHome: run.config.codexHome,
        onProcess: (p) => this.setActiveProcess(id, p),
        onDelta: (_d, full) => {
          this.store.update(id, (r) => {
            r.codex.reviewText = full;
          });
        },
        onEvent: (ev) => this.store.appendEvent(id, ev),
      });

      this.setActiveProcess(id, null);
      if (!res.ok) {
        this.store.update(id, (r) => {
          r.codex.status = 'failed';
          r.codex.error = res.error;
          if (r.status !== 'cancelled') {
            r.status = 'failed';
            r.activeStage = 'failed';
          }
        });
        return false;
      }

      const verdict = parseReviewVerdict(res.text);
      this.store.update(id, (r) => {
        r.codex.status = 'done';
        r.codex.reviewText = res.text;
        r.codex.diff = diffInfo.diff || r.codex.diff;
        r.codex.diffStat = diffInfo.stat || r.codex.diffStat;
        r.reviewVerdict = verdict;
        if (res.usage) {
          r.metrics.codexTokens += (res.usage.input_tokens || 0) + (res.usage.output_tokens || 0);
        }
      });

      if (verdict.passed) {
        this.store.appendEvent(id, {
          source: 'codex',
          kind: 'review_pass',
          text: `审查门禁第 ${round} 轮通过：${verdict.summary}`,
        });
        return true;
      }

      this.store.appendEvent(id, {
        source: 'codex',
        kind: 'review_block',
        text: `第 ${round} 轮拦截 ${verdict.blocking.length} 项阻塞级问题：${verdict.summary}`,
      });

      if (round < effectiveMaxRounds && allowAutoFix) {
        const fixSpec = [
          `以下是 Pre-CI 第 ${round} 轮审查拦截的 BLOCKING 缺陷，请在同一处根治，并在可能时补上对应守卫测试或类型检查：`,
          ...verdict.blocking.map((item, idx) => `${idx + 1}. ${item}`),
        ].join('\n');
        const current = this.store.get(id);
        const fixRes = await this.stageCodexExec(run, fixSpec, current?.codex?.threadId || '');
        if (!fixRes.ok) return false;
      } else if (!allowAutoFix) {
        // Standalone codex-review mode ends directly in blocked state without promising a summary stage
        this.store.update(id, (r) => {
          if (r.status !== 'cancelled') r.status = 'blocked';
        });
        return false;
      } else {
        const decision = await this.waitForHumanGate(id, {
          type: 'review_escalation',
          title: `审查门禁已达上限（${effectiveMaxRounds} 轮）— 等待人工决策`,
          message: `Codex 审查仍标记了 ${verdict.blocking.length} 项阻塞问题。请核实后决定：强制放行进入 Gemini 汇总，或停止并保持拦截。`,
          blocking: verdict.blocking,
          suggestions: verdict.suggestions,
        });
        if (decision.action === 'cancel' || this.store.get(id)?.status === 'cancelled') {
          return false;
        }
        if (decision.action === 'override') {
          this.store.appendEvent(id, {
            source: 'system',
            kind: 'override',
            text: '用户已人工确认强制放行审查门禁',
          });
          return true;
        }
        this.store.update(id, (r) => {
          if (r.status !== 'cancelled') r.status = 'blocked';
        });
        return false;
      }
    }
    return true;
  }

  async stageGeminiSummary(run) {
    const id = run.id;
    const latest = this.store.get(id);
    this.store.update(id, (r) => {
      r.activeStage = 'summary';
      r.gemini.status = 'running';
      r.gemini.error = null;
    });
    this.store.appendEvent(id, {
      source: 'gemini',
      kind: 'stage',
      text: '05 Gemini 正在核实改动与审查结论，生成面向人类的简明交付汇报',
    });

    const summaryPrompt = [
      '你是 CONDUIT 多模型协同工作台的【总指挥（Gemini）】。当前处于无头只读汇总模式：绝对不要调用任何终端命令工具或修改文件，直接基于下方材料用简明中文作答。',
      '请把下游 Codex 的施工结果、Diff 摘要与审查结论，翻译成一段让项目负责人 10 秒看懂的简短中文汇报：',
      '- 先说做成了什么、使用者会看到什么变化',
      '- 不堆技术黑话与长篇日志',
      '- 明确标注是否通过审查门禁，以及还剩哪些可选项/注意事项',
      '',
      `【原始需求】${run.prompt}`,
      `【工作路径】${run.effectiveWorkDir}${run.worktreePath ? '（隔离 Worktree）' : ''}`,
      `【Codex 施工回报】\n${(latest?.codex?.execText || '').slice(0, 6000)}`,
      `【Git Diff 摘要】\n${(latest?.codex?.diffStat || '无变更统计')}`,
      `【审查结论】${latest?.reviewVerdict ? JSON.stringify(latest.reviewVerdict) : '未执行'}`,
    ].join('\n');

    const res = await this.invokePrimaryEngine(run, {
      prompt: summaryPrompt,
      onDelta: (_d, full) => {
        this.store.update(id, (r) => {
          r.gemini.summaryText = full;
        });
      },
    });

    this.setActiveProcess(id, null);
    this.store.update(id, (r) => {
      r.gemini.status = res.ok ? 'done' : 'failed';
      r.gemini.summaryText = res.text || r.gemini.summaryText;
      r.gemini.durationMs += res.durationMs;
      r.gemini.error = res.error;
      if (res.usage?.total_tokens) r.metrics.geminiTokens += res.usage.total_tokens;
      if (!res.ok && r.status !== 'cancelled') {
        r.status = 'failed';
        r.activeStage = 'failed';
      }
    });
    return res;
  }
}
