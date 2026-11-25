import crypto from 'node:crypto';
import { runAgy, runCodex, killProcessTree } from './runners.mjs';
import { runProvider } from './providers.mjs';
import {
  inspectWorkspace,
  getWorkspaceDiff,
  createManagedWorktree,
  removeManagedWorktree,
} from './workspace.mjs';

const VALID_MODES = new Set([
  'agent-chat',
  'full-pipeline',
  'plan-only',
  'codex-exec',
  'codex-review',
  'copy-polish',
  'custom-agent',
]);

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
    this.activeProcesses = new Map(); // runId -> { handle, gen }
    this.pendingGates = new Map();
    this.runGenerations = new Map(); // runId -> integer generation token
  }

  nextGeneration(runId) {
    const next = (this.runGenerations.get(runId) || 0) + 1;
    this.runGenerations.set(runId, next);
    return next;
  }

  isExecutionActive(runId, gen) {
    if (gen !== undefined && gen !== null && this.runGenerations.get(runId) !== gen) {
      return false;
    }
    const run = this.store.get(runId);
    return Boolean(run && run.status !== 'cancelled' && run.status !== 'interrupted');
  }

  setActiveProcess(runId, child, gen = null) {
    if (child) {
      if (gen !== null && !this.isExecutionActive(runId, gen)) {
        abortActiveHandle(child);
        return false;
      }
      this.activeProcesses.set(runId, { handle: child, gen });
      return true;
    }
    const cur = this.activeProcesses.get(runId);
    if (!cur) return true;
    if (gen === null || cur.gen === gen) {
      this.activeProcesses.delete(runId);
    }
    return true;
  }

  shutdown() {
    for (const runId of this.runGenerations.keys()) {
      this.nextGeneration(runId);
    }
    for (const [, entry] of this.activeProcesses) {
      abortActiveHandle(entry?.handle || entry);
    }
    this.activeProcesses.clear();
    for (const [, gate] of this.pendingGates) {
      gate.resolve({ action: 'cancel' });
    }
    this.pendingGates.clear();
    if (typeof this.store.closeAllStreams === 'function') {
      this.store.closeAllStreams();
    }
    if (typeof this.store.flush === 'function') {
      void this.store.flush();
    }
  }

  cleanupRun(runId) {
    const run = this.store.get(runId);
    const worktreePath = run?.worktreePath || null;
    const workspaceDir = run?.workspaceDir || '';
    this.cancelRun(runId);
    this.runGenerations.delete(runId);
    if (worktreePath) {
      void removeManagedWorktree(workspaceDir, worktreePath).catch(() => {});
    }
  }

  cancelRun(runId) {
    const run = this.store.get(runId);
    if (!run) return false;

    const procEntry = this.activeProcesses.get(runId);
    const gate = this.pendingGates.get(runId);
    const isActiveStatus = run.status === 'running' || run.status === 'awaiting_approval';

    if (!isActiveStatus && !procEntry && !gate) {
      return false;
    }

    // Invalidate all in-flight callbacks & pending retries immediately
    this.nextGeneration(runId);

    if (procEntry) {
      abortActiveHandle(procEntry.handle || procEntry);
      this.activeProcesses.delete(runId);
    }

    if (gate) {
      this.pendingGates.delete(runId);
      gate.resolve({ action: 'cancel' });
    }

    this.store.update(runId, (r) => {
      r.status = 'cancelled';
      r.gate = null;
      r.pendingSteer = null;
      if (r.gemini && r.gemini.status === 'running') {
        r.gemini.status = 'cancelled';
      }
      if (r.codex && r.codex.status === 'running') {
        r.codex.status = 'cancelled';
      }
      if (Array.isArray(r.messages)) {
        for (const msg of r.messages) {
          if (!msg || typeof msg !== 'object') continue;
          if (msg.status === 'running') {
            msg.status = 'cancelled';
            msg.liveStep = null;
          }
          if (Array.isArray(msg.trace)) {
            for (const step of msg.trace) {
              if (step && step.status === 'running') {
                step.status = 'cancelled';
              }
            }
          }
        }
      }
    });
    this.store.appendEvent(runId, {
      source: 'system',
      kind: 'cancelled',
      text: '任务已被用户手动中止',
    });
    return true;
  }

  waitForHumanGate(runId, gateMeta, gen = null) {
    if (!this.isExecutionActive(runId, gen)) {
      return Promise.resolve({ action: 'cancel' });
    }
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
      this.pendingGates.set(runId, { resolve, gen });
    });
  }

  resolveGate(runId, decision) {
    const gate = this.pendingGates.get(runId);
    if (!gate) return false;
    this.pendingGates.delete(runId);
    const action = decision?.action || 'approve';
    const currentRun = this.store.get(runId);
    const gateType = currentRun?.gate?.type;
    const isCancel = action === 'cancel' || (action === 'abort' && gateType !== 'review_escalation');
    const isBlockedAbort = action === 'abort' && gateType === 'review_escalation';

    if (isCancel) {
      this.nextGeneration(runId);
    }

    this.store.update(runId, (r) => {
      r.gate = null;
      if (isCancel) {
        r.status = 'cancelled';
      } else if (isBlockedAbort) {
        r.status = 'blocked';
      } else {
        r.status = 'running';
      }
    });
    if (isCancel) {
      this.store.appendEvent(runId, {
        source: 'system',
        kind: 'cancelled',
        text: '用户在审批闸门中止了任务',
      });
    }
    gate.resolve(decision);
    return true;
  }

  async startRun(payload = {}) {
    const id = `run_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
    const mode = String(payload.mode || 'agent-chat').trim();
    if (!VALID_MODES.has(mode)) {
      throw new ValidationError(`不支持的运行模式：${mode}`);
    }
    const workspaceDir = payload.workspaceDir || process.cwd();
    const prompt = String(payload.prompt || '').trim();
    if (!prompt) {
      throw new ValidationError('请输入任务需求或对话内容');
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

    const usesPrimaryEngine =
      mode !== 'codex-exec' &&
      mode !== 'codex-review' &&
      !(mode === 'agent-chat' && payload.geminiModel === 'codex:chat');

    if (mode === 'custom-agent' || (usesPrimaryEngine && (parsedRef || resolvedProviderId))) {
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
      allowCodexNetwork: Boolean(payload.allowCodexNetwork),
      timeoutMode: String(payload.timeoutMode || 'none').trim() || 'none',
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

    let run;
    try {
      run = this.store.create({
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
        pendingSteer: null,
        goalHistory: [],
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
        messages: [],
        events: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      if (worktreePath) {
        await removeManagedWorktree(ws.path, worktreePath).catch(() => {});
      }
      throw err;
    }

    const gen = this.nextGeneration(id);

    if (worktreePath) {
      this.store.appendEvent(id, {
        source: 'system',
        kind: 'worktree',
        text: `已创建隔离 Git Worktree：${worktreePath}（施工、Diff 与审查均在此隔离目录执行）`,
      });
    }

    if (mode === 'agent-chat') {
      this.executeChatTurn(id, prompt, gen).catch((err) => {
        if (!this.isExecutionActive(id, gen)) return;
        this.store.update(id, (r) => {
          if (r.status !== 'cancelled') {
            r.status = 'failed';
            r.activeStage = 'failed';
          }
          const last = Array.isArray(r.messages) ? r.messages[r.messages.length - 1] : null;
          if (last && last.role === 'assistant' && last.status === 'running') {
            last.status = 'failed';
            last.liveStep = null;
            last.error = err.message;
            if (Array.isArray(last.trace)) {
              last.trace.forEach((t) => {
                if (t && t.status === 'running') t.status = 'error';
              });
            }
          }
        });
      });
      return run;
    }

    this.executePipeline(run, gen).catch((err) => {
      if (!this.isExecutionActive(id, gen)) return;
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

  async executePipeline(run, gen) {
    const startedAt = Date.now();
    const id = run.id;

    try {
      if (run.mode === 'custom-agent') {
        await this.stageCustomAgent(run, gen);
      } else if (run.mode === 'plan-only') {
        await this.stageGeminiPlan(run, null, gen);
      } else if (run.mode === 'copy-polish') {
        await this.stageGeminiCopy(run, gen);
      } else if (run.mode === 'codex-exec') {
        await this.stageCodexExec(run, run.prompt, '', gen);
      } else if (run.mode === 'codex-review') {
        await this.stageCodexReviewLoop(run, false, gen);
      } else {
        let currentPrompt = run.prompt;
        let codexSpec = '';

        while (true) {
          const planRes = await this.stageGeminiPlan(run, currentPrompt, gen);
          if (!planRes.ok || !this.isExecutionActive(id, gen)) return;
          codexSpec = planRes.text;

          if (!run.config.requireApproval) break;

          const decision = await this.waitForHumanGate(id, {
            type: 'plan_approval',
            title: '02 人工拍板闸门 — 确认派发给 Codex 施工',
            message: 'Gemini 已输出实施方案与接口契约。你可以直接修改下方派单指令后放行给 Codex，或提出意见让 Gemini 重出方案。',
            editableSpec: codexSpec,
          }, gen);

          if (decision.action === 'cancel' || decision.action === 'abort' || decision.action === 'steer' || !this.isExecutionActive(id, gen)) {
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

        const steerBeforeExec = this.consumePendingSteer(id);
        if (steerBeforeExec) {
          codexSpec = `${codexSpec}\n\n【运行中用户更新的最新目标（最高优先级）】\n${steerBeforeExec.prompt}`;
        }

        const execRes = await this.stageCodexExec(this.store.get(id) || run, codexSpec, '', gen);
        if (!execRes.ok || !this.isExecutionActive(id, gen)) return;

        const steerBeforeReview = this.consumePendingSteer(id);
        if (steerBeforeReview) {
          const followSpec = `用户在刚才施工期间补充/修改了目标，请在当前代码改动基础上继续落实以下最新要求：\n${steerBeforeReview.prompt}`;
          const extraExec = await this.stageCodexExec(this.store.get(id) || run, followSpec, '', gen);
          if (!extraExec.ok || !this.isExecutionActive(id, gen)) return;
        }

        const reviewOk = await this.stageCodexReviewLoop(this.store.get(id) || run, true, gen);
        if (!reviewOk || !this.isExecutionActive(id, gen)) return;

        this.consumePendingSteer(id);
        const summaryRes = await this.stageGeminiSummary(this.store.get(id) || run, gen);
        if (!summaryRes.ok || !this.isExecutionActive(id, gen)) return;
      }

      const latest = this.store.get(id);
      if (latest && latest.status === 'running' && this.isExecutionActive(id, gen)) {
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
      this.setActiveProcess(id, null, gen);
    }
  }

  resolveTimeoutPolicy(mode = 'none') {
    const clean = String(mode || 'none').trim();
    if (clean === 'idle-10m') return { timeoutMs: 0, idleTimeoutMs: 600_000 };
    if (clean === 'max-15m') return { timeoutMs: 900_000, idleTimeoutMs: 0 };
    if (clean === 'max-30m') return { timeoutMs: 1_800_000, idleTimeoutMs: 0 };
    return { timeoutMs: 0, idleTimeoutMs: 0 };
  }

  resolveSteerProvider(payload = {}) {
    const requestedModel = String(payload.geminiModel || '').trim();
    const parsedRef = parseProviderRef(requestedModel);
    const resolvedProviderId = String(payload.providerId || parsedRef?.providerId || '').trim();
    const resolvedProvider = resolvedProviderId && this.providerStore
      ? this.providerStore.get(resolvedProviderId)
      : null;
    const isCodexChat = requestedModel === 'codex:chat';
    if (!isCodexChat && (parsedRef || resolvedProviderId)) {
      if (!resolvedProvider) {
        throw new ValidationError('未找到指定的外部 Agent / API 接入，请先在「设置 → Agent 与 API 接入」中配置并启用');
      }
      if (!resolvedProvider.enabled) {
        throw new ValidationError(`接入「${resolvedProvider.name}」当前处于停用状态，请先启用后再运行`);
      }
    }
    return { requestedModel, parsedRef, resolvedProvider };
  }

  applyConfigOverrides(r, payload = {}, providerCtx = null) {
    if (!r.config) r.config = {};
    const { requestedModel, parsedRef, resolvedProvider } = providerCtx || this.resolveSteerProvider(payload);
    if (requestedModel) r.config.geminiModel = requestedModel;
    if (payload.codexModel !== undefined) r.config.codexModel = payload.codexModel;
    if (payload.codexEffort) r.config.codexEffort = payload.codexEffort;
    if (payload.codexHome !== undefined) r.config.codexHome = payload.codexHome;
    if (payload.sandbox) r.config.sandbox = payload.sandbox === 'read-only' ? 'read-only' : 'workspace-write';
    if (payload.allowCodexNetwork !== undefined) {
      r.config.allowCodexNetwork = Boolean(payload.allowCodexNetwork);
    }
    if (payload.timeoutMode !== undefined) {
      r.config.timeoutMode = String(payload.timeoutMode || 'none').trim() || 'none';
    }
    if (requestedModel || payload.providerId !== undefined) {
      r.config.providerId = resolvedProvider ? resolvedProvider.id : '';
      r.config.providerName = resolvedProvider ? resolvedProvider.name : '';
      r.config.providerProtocol = resolvedProvider ? resolvedProvider.protocol : '';
      r.config.providerKind = resolvedProvider ? resolvedProvider.kind : '';
      r.config.providerModel = resolvedProvider
        ? String(payload.providerModel || parsedRef?.model || resolvedProvider.defaultModel || '').trim()
        : '';
    }
  }

  consumePendingSteer(runId) {
    const run = this.store.get(runId);
    if (!run || !run.pendingSteer || !run.pendingSteer.prompt) return null;
    const queued = run.pendingSteer;
    this.store.update(runId, (r) => {
      if (!Array.isArray(r.goalHistory)) r.goalHistory = [];
      r.goalHistory.push({
        at: new Date().toISOString(),
        prevGoal: r.prompt || '',
        nextGoal: queued.prompt,
        strategy: 'next-step',
      });
      r.prompt = queued.prompt;
      r.pendingSteer = null;
      if (queued.overrides) {
        try {
          this.applyConfigOverrides(r, queued.overrides);
        } catch {
          // Keep current config if queued provider was removed
        }
      }
    });
    this.store.appendEvent(runId, {
      source: 'system',
      kind: 'steer_applied',
      text: `已切换至排队的新目标：${queued.prompt.slice(0, 120)}`,
    });
    return queued;
  }

  clearPendingSteer(runId) {
    const run = this.store.get(runId);
    if (!run) return false;
    if (!run.pendingSteer) return false;
    this.store.update(runId, (r) => {
      r.pendingSteer = null;
    });
    this.store.appendEvent(runId, {
      source: 'system',
      kind: 'steer_cleared',
      text: '已取消排队中的目标修改',
    });
    return true;
  }

  /**
   * Mid-run Interrupt & Goal Modification mechanism:
   * - strategy === 'interrupt' (default): immediately aborts the active CLI/API step (preserving partial output),
   *   records goalHistory, and pivots the same session/run directly onto the new goal.
   * - strategy === 'next-step': keeps the active step running without losing progress, queues the new goal,
   *   and automatically applies it as soon as the current step/turn completes.
   */
  async steerRun(runId, payload = {}) {
    const run = this.store.get(runId);
    if (!run) {
      const err = new ValidationError('找不到该运行记录');
      err.statusCode = 404;
      throw err;
    }
    const prompt = String(payload.prompt || '').trim();
    if (!prompt) {
      throw new ValidationError('请输入修改后的新目标或中途指令');
    }
    const strategy = payload.strategy === 'next-step' ? 'next-step' : 'interrupt';
    const providerCtx = this.resolveSteerProvider(payload);

    const isActive = run.status === 'running' || run.status === 'awaiting_approval';
    if (!isActive) {
      const updated = await this.continueChat(runId, payload);
      return { run: updated, action: 'continued' };
    }

    if (strategy === 'next-step') {
      const queued = {
        id: `steer_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`,
        prompt,
        strategy: 'next-step',
        createdAt: new Date().toISOString(),
        overrides: {
          geminiModel: payload.geminiModel,
          providerId: payload.providerId,
          providerModel: payload.providerModel,
          codexModel: payload.codexModel,
          codexEffort: payload.codexEffort,
          codexHome: payload.codexHome,
          sandbox: payload.sandbox,
          allowCodexNetwork: payload.allowCodexNetwork,
          timeoutMode: payload.timeoutMode,
        },
      };
      this.store.update(runId, (r) => {
        r.pendingSteer = queued;
      });
      this.store.appendEvent(runId, {
        source: 'system',
        kind: 'steer_queued',
        text: `已登记运行中目标修改（当前步完成后自动生效）：${prompt.slice(0, 120)}`,
      });
      return { run: this.store.get(runId), action: 'queued' };
    }

    // Immediate mid-run interrupt + pivot onto new goal
    const gen = this.nextGeneration(runId);

    const procEntry = this.activeProcesses.get(runId);
    if (procEntry) {
      abortActiveHandle(procEntry.handle || procEntry);
      this.activeProcesses.delete(runId);
    }

    const gate = this.pendingGates.get(runId);
    if (gate) {
      this.pendingGates.delete(runId);
      gate.resolve({ action: 'steer' });
    }

    const useChatPivot = run.mode === 'agent-chat' || (Array.isArray(run.messages) && run.messages.length > 0);

    this.store.update(runId, (r) => {
      if (!Array.isArray(r.goalHistory)) r.goalHistory = [];
      r.goalHistory.push({
        at: new Date().toISOString(),
        prevGoal: r.prompt || '',
        nextGoal: prompt,
        strategy: 'interrupt',
      });
      r.prompt = prompt;
      r.pendingSteer = null;
      r.gate = null;
      r.status = 'running';
      r.activeStage = useChatPivot ? 'chat' : 'steer';
      this.applyConfigOverrides(r, payload, providerCtx);

      if (r.gemini && r.gemini.status === 'running') r.gemini.status = 'interrupted';
      if (r.codex && r.codex.status === 'running') r.codex.status = 'interrupted';

      if (Array.isArray(r.messages)) {
        for (const msg of r.messages) {
          if (!msg || typeof msg !== 'object') continue;
          if (msg.status === 'running') {
            msg.status = 'interrupted';
            msg.interruptedBySteer = true;
            msg.liveStep = null;
            if (!msg.error) msg.error = '已被中途打断并切换至新目标';
          }
          if (Array.isArray(msg.trace)) {
            for (const step of msg.trace) {
              if (step && step.status === 'running') step.status = 'cancelled';
            }
          }
        }
      }
    });

    this.store.appendEvent(runId, {
      source: 'system',
      kind: 'steer',
      text: `已中途打断当前执行，并立即切换至新目标：${prompt.slice(0, 120)}`,
    });

    if (useChatPivot) {
      this.executeChatTurn(runId, prompt, gen, {
        steered: true,
        steerReason: 'interrupt',
      }).catch((err) => {
        if (!this.isExecutionActive(runId, gen)) return;
        this.store.update(runId, (r) => {
          if (r.status !== 'cancelled') {
            r.status = 'failed';
            r.activeStage = 'failed';
          }
          const last = Array.isArray(r.messages) ? r.messages[r.messages.length - 1] : null;
          if (last && last.role === 'assistant' && last.status === 'running') {
            last.status = 'failed';
            last.liveStep = null;
            last.error = err.message;
          }
        });
      });
    } else {
      const latestRun = this.store.get(runId);
      this.executePipeline(latestRun, gen).catch((err) => {
        if (!this.isExecutionActive(runId, gen)) return;
        this.store.update(runId, (r) => {
          if (r.status !== 'cancelled') {
            r.status = 'failed';
            r.activeStage = 'failed';
          }
        });
        this.store.appendEvent(runId, {
          source: 'system',
          kind: 'error',
          text: `管线改目标重跑异常：${err.message}`,
        });
      });
    }

    return { run: this.store.get(runId), action: 'interrupted' };
  }

  async continueChat(runId, payload = {}) {
    const run = this.store.get(runId);
    if (!run) {
      const err = new ValidationError('找不到该对话会话');
      err.statusCode = 404;
      throw err;
    }
    if (run.status === 'running' || run.status === 'awaiting_approval') {
      const err = new ValidationError('当前回复仍在生成中，请等待完成或先点击停止');
      err.statusCode = 409;
      throw err;
    }

    const prompt = String(payload.prompt || '').trim();
    if (!prompt) {
      throw new ValidationError('请输入要发送的消息内容');
    }

    const explicitResumeThreadId = String(payload.resumeThreadId || '').trim();
    const forceCodexResume = Boolean(explicitResumeThreadId || payload.forceCodexResume);
    const requestedModel = forceCodexResume
      ? 'codex:chat'
      : String(payload.geminiModel || (run.mode === 'codex-exec' ? 'codex:chat' : '')).trim();

    // Allow switching active engine/model mid-conversation cleanly
    const parsedRef = parseProviderRef(requestedModel);
    const resolvedProviderId = forceCodexResume
      ? ''
      : String(payload.providerId || parsedRef?.providerId || '').trim();
    const resolvedProvider = resolvedProviderId && this.providerStore
      ? this.providerStore.get(resolvedProviderId)
      : null;

    const isSwitchingToCodex = requestedModel === 'codex:chat';
    if (!isSwitchingToCodex && (parsedRef || resolvedProviderId)) {
      if (!resolvedProvider) {
        throw new ValidationError('未找到指定的外部 Agent / API 接入，请先在「设置 → Agent 与 API 接入」中配置并启用');
      }
      if (!resolvedProvider.enabled) {
        throw new ValidationError(`接入「${resolvedProvider.name}」当前处于停用状态，请先启用后再运行`);
      }
    }

    const gen = this.nextGeneration(runId);

    this.store.update(runId, (r) => {
      if (!r.config) r.config = {};
      if (!r.codex) r.codex = { status: 'idle', execText: '', reviewText: '', diff: '', diffStat: '', threadId: '', durationMs: 0, error: null };
      if (!r.gemini) r.gemini = { status: 'idle', planText: '', summaryText: '', copyText: '', conversationId: '', durationMs: 0, error: null };
      if (!r.metrics) r.metrics = { geminiTokens: 0, codexTokens: 0, totalDurationMs: 0 };

      if (requestedModel) r.config.geminiModel = requestedModel;
      if (payload.codexModel !== undefined) r.config.codexModel = payload.codexModel;
      if (payload.codexEffort) r.config.codexEffort = payload.codexEffort;
      if (payload.codexHome !== undefined) r.config.codexHome = payload.codexHome;
      if (payload.sandbox) r.config.sandbox = payload.sandbox === 'read-only' ? 'read-only' : 'workspace-write';
      if (payload.allowCodexNetwork !== undefined) {
        r.config.allowCodexNetwork = Boolean(payload.allowCodexNetwork);
      }
      if (payload.timeoutMode !== undefined) {
        r.config.timeoutMode = String(payload.timeoutMode || 'none').trim() || 'none';
      }
      if (explicitResumeThreadId) {
        r.codex.threadId = explicitResumeThreadId;
      }
      if (requestedModel || payload.providerId !== undefined) {
        r.config.providerId = resolvedProvider ? resolvedProvider.id : '';
        r.config.providerName = resolvedProvider ? resolvedProvider.name : '';
        r.config.providerProtocol = resolvedProvider ? resolvedProvider.protocol : '';
        r.config.providerKind = resolvedProvider ? resolvedProvider.kind : '';
        r.config.providerModel = resolvedProvider
          ? String(payload.providerModel || parsedRef?.model || resolvedProvider.defaultModel || '').trim()
          : '';
      }
      r.status = 'running';
      r.activeStage = 'chat';
    });

    this.executeChatTurn(runId, prompt, gen, {
      explicitResumeThreadId,
      forceCodexResume,
    }).catch((err) => {
      if (!this.isExecutionActive(runId, gen)) return;
      this.store.update(runId, (r) => {
        if (r.status !== 'cancelled') {
          r.status = 'failed';
          r.activeStage = 'failed';
        }
        const last = Array.isArray(r.messages) ? r.messages[r.messages.length - 1] : null;
        if (last && last.role === 'assistant' && last.status === 'running') {
          last.status = 'failed';
          last.liveStep = null;
          last.error = err.message;
          if (Array.isArray(last.trace)) {
            last.trace.forEach((t) => {
              if (t && t.status === 'running') t.status = 'error';
            });
          }
        }
      });
    });

    return this.store.get(runId);
  }

  buildChatContextPrompt(priorMessages, latestPrompt, run = null) {
    const contextChunks = [];
    if (run && run.mode !== 'agent-chat') {
      if (run.prompt) {
        contextChunks.push(`用户（初始任务）：${String(run.prompt).slice(0, 1200)}`);
      }
      if (run.gemini?.planText) {
        contextChunks.push(`规划输出摘要：${String(run.gemini.planText).slice(0, 1600)}`);
      }
      if (run.codex?.execText) {
        contextChunks.push(`Codex 执行回报摘要：${String(run.codex.execText).slice(0, 1600)}`);
      }
      if (run.gemini?.summaryText) {
        contextChunks.push(`阶段总结：${String(run.gemini.summaryText).slice(0, 1200)}`);
      }
    }
    const recent = (priorMessages || [])
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content && m.status !== 'failed')
      .slice(-10);
    recent.forEach((m) => {
      contextChunks.push(`${m.role === 'user' ? '用户' : '助手'}：${m.content}`);
    });
    if (contextChunks.length === 0) return latestPrompt;
    return `【本会话之前的对话与上下文】\n${contextChunks.join('\n\n')}\n\n【用户最新消息】\n${latestPrompt}`;
  }

  async executeChatTurn(runId, userPrompt, gen = null, turnOpts = {}) {
    const run = this.store.get(runId);
    if (!run || !this.isExecutionActive(runId, gen)) return;
    const startedAt = Date.now();

    const explicitResumeThreadId = String(turnOpts.explicitResumeThreadId || '').trim();
    const isCodexChat = Boolean(turnOpts.forceCodexResume || explicitResumeThreadId) || run.config.geminiModel === 'codex:chat';
    const provider = !isCodexChat && run.config.providerId && this.providerStore
      ? this.providerStore.get(run.config.providerId)
      : null;

    const engineName = isCodexChat
      ? 'Codex'
      : provider
        ? provider.name
        : 'Gemini';
    const engineModel = isCodexChat
      ? (run.config.codexModel || 'codex-default')
      : provider
        ? (run.config.providerModel || provider.defaultModel || provider.protocol)
        : (run.config.geminiModel || 'gemini-4-neon-high');

    const priorMessages = Array.isArray(run.messages) ? run.messages.slice() : [];
    const userMsgId = `msg_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
    const asstMsgId = `msg_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;

    this.store.update(runId, (r) => {
      if (!Array.isArray(r.messages)) r.messages = [];
      r.status = 'running';
      r.activeStage = 'chat';
      r.messages.push({
        id: userMsgId,
        role: 'user',
        content: userPrompt,
        status: 'done',
        steered: Boolean(turnOpts.steered),
        steerReason: turnOpts.steerReason || '',
        createdAt: new Date().toISOString(),
      });
      r.messages.push({
        id: asstMsgId,
        role: 'assistant',
        content: '',
        thinkingText: '',
        trace: [],
        thinkingTokens: 0,
        status: 'running',
        engine: engineName,
        model: engineModel,
        durationMs: 0,
        tokens: 0,
        error: null,
        createdAt: new Date().toISOString(),
      });
      r.gemini.status = isCodexChat ? r.gemini.status : 'running';
      if (isCodexChat) r.codex.status = 'running';
    });

    const isReadOnly = run.config.sandbox === 'read-only';
    const systemPrompt = [
      '你是 TENON（榫）工作台中的本地开发 Agent，正在与用户进行自然、高效的多轮对话。',
      `当前工作目录：${run.effectiveWorkDir}${run.isGitRepo && run.branch ? `（Git 分支：${run.branch}）` : ''}。`,
      '对话原则：',
      '- 像真实的编程 Agent 一样直接、简洁、自然地回答；寒暄或简单问题一两句直答，绝不主动展开冗长的“实施方案 / 巡检报告 / 验收清单”。',
      isReadOnly
        ? '- 当前处于只读对话护栏：仅做只读问答与分析，不修改文件、不执行写操作命令。'
        : '- 当用户明确让你检查 git / gh 状态、查看文件或执行工作区操作时，可以直接调用沙箱内可用工具完成并简明回报真实结果。',
    ].join('\n');

    const updateAssistant = (mutator) => {
      if (!this.isExecutionActive(runId, gen)) return;
      this.store.update(runId, (r) => {
        if (!this.isExecutionActive(runId, gen)) return;
        const msg = (r.messages || []).find((m) => m.id === asstMsgId);
        if (msg && msg.status !== 'cancelled') mutator(msg, r);
      });
    };

    const upsertTraceItem = (msg, item) => {
      if (!Array.isArray(msg.trace)) msg.trace = [];
      const idx = msg.trace.findIndex((t) => t.id === item.id);
      if (idx >= 0) {
        msg.trace[idx] = { ...msg.trace[idx], ...item };
      } else {
        msg.trace.push(item);
        if (msg.trace.length > 36) msg.trace = msg.trace.slice(-36);
      }
    };

    const handleChatTraceEvent = (ev) => {
      if (!ev || !ev.kind || !this.isExecutionActive(runId, gen)) return;
      if (ev.kind === 'init') {
        if (ev.source === 'codex' && ev.threadId) {
          this.store.update(runId, (r) => {
            if (this.isExecutionActive(runId, gen)) {
              r.codex.threadId = ev.threadId;
            }
          });
        } else if (ev.source === 'gemini' && ev.conversationId) {
          this.store.update(runId, (r) => {
            if (this.isExecutionActive(runId, gen)) {
              r.gemini.conversationId = ev.conversationId;
            }
          });
        }
        return;
      }
      if (ev.kind === 'reasoning' && ev.text) {
        updateAssistant((m) => {
          const id = ev.itemId ? `reason_${ev.itemId}` : (ev.stepIndex != null ? `reason_${ev.stepIndex}` : 'reason_stream');
          if (ev.source === 'codex') {
            upsertTraceItem(m, {
              id,
              kind: 'thinking',
              title: '推理思考',
              detail: ev.text.split(/\r?\n/)[0].slice(0, 120),
              body: ev.text.slice(0, 4000),
              status: 'done',
            });
            m.thinkingText = (m.thinkingText ? `${m.thinkingText}\n` : '') + ev.text;
          } else {
            m.thinkingText = `${m.thinkingText || ''}${ev.text}`.slice(-8000);
            upsertTraceItem(m, {
              id,
              kind: 'thinking',
              title: '推理思考',
              detail: m.thinkingText.trim().split(/\r?\n/)[0].slice(0, 120),
              body: m.thinkingText.slice(-4000),
              status: ev.state === 'DONE' ? 'done' : 'running',
            });
          }
        });
      } else if (ev.kind === 'thinking_step') {
        updateAssistant((m) => {
          const tok = Number(ev.thinkingTokens) || 0;
          const durMs = Number(ev.durationMs) || 0;
          if (tok) m.thinkingTokens = (Number(m.thinkingTokens) || 0) + tok;
          const bits = [];
          if (tok > 0) bits.push(`${tok} thinking tokens`);
          if (durMs > 0) bits.push(`${(durMs / 1000).toFixed(1)}s`);
          upsertTraceItem(m, {
            id: `think_step_${ev.stepIndex ?? Date.now()}`,
            kind: 'thinking',
            title: '深度思考',
            detail: bits.join(' · ') || '已完成推理',
            thinkingTokens: tok,
            durationMs: durMs,
            status: 'done',
          });
        });
      } else if (ev.kind === 'tool') {
        updateAssistant((m) => {
          const id = ev.itemId ? `tool_${ev.itemId}` : `tool_${ev.stepIndex ?? Date.now()}`;
          const paramPreview = ev.params && Object.keys(ev.params).length
            ? JSON.stringify(ev.params, null, 2).slice(0, 800)
            : '';
          const bodyParts = [];
          if (paramPreview) bodyParts.push(`参数:\n${paramPreview}`);
          if (ev.output) bodyParts.push(`输出:\n${ev.output}`);
          upsertTraceItem(m, {
            id,
            kind: 'tool',
            title: ev.toolName || 'tool',
            detail: ev.summary || ev.toolName || '',
            body: bodyParts.join('\n\n'),
            durationMs: Number(ev.durationMs) || 0,
            status: ev.state === 'error' ? 'error' : ev.state === 'done' ? 'done' : 'running',
          });
          m.liveStep = ev.state === 'running' ? (ev.toolName || 'tool') : null;
        });
      } else if (ev.kind === 'tool_result' && ev.itemId) {
        updateAssistant((m) => {
          const id = `tool_${ev.itemId}`;
          const existing = (m.trace || []).find((t) => t.id === id);
          const prevBody = existing?.body ? `${existing.body}\n\n` : '';
          upsertTraceItem(m, {
            id,
            kind: 'tool',
            title: existing?.title || 'tool',
            detail: existing?.detail || '',
            body: ev.output ? `${prevBody}输出:\n${ev.output}` : (existing?.body || ''),
            status: ev.state === 'error' ? 'error' : 'done',
          });
          m.liveStep = null;
        });
      } else if (ev.kind === 'command') {
        updateAssistant((m) => {
          const id = ev.itemId ? `cmd_${ev.itemId}` : `cmd_${String(ev.command || '').slice(0, 40)}`;
          const failed = ev.status === 'failed' || ev.status === 'declined' || (ev.exitCode != null && ev.exitCode > 0);
          const done = failed || ev.status === 'completed' || ev.status === 'item.completed' || ev.exitCode != null;
          upsertTraceItem(m, {
            id,
            kind: 'tool',
            title: 'run_command',
            detail: ev.command || 'command',
            body: ev.output || '',
            exitCode: ev.exitCode ?? null,
            status: failed ? 'error' : done ? 'done' : 'running',
          });
          m.liveStep = done ? null : 'run_command';
        });
      } else if (ev.kind === 'file_change') {
        updateAssistant((m) => {
          const id = ev.itemId ? `fc_${ev.itemId}` : `fc_${Date.now()}`;
          const files = (ev.changes || []).map((c) => `${c.kind || 'edit'} ${c.path || ''}`.trim());
          upsertTraceItem(m, {
            id,
            kind: 'file_change',
            title: 'file_change',
            detail: files.slice(0, 3).join(', ') || '工作区文件变更',
            body: files.join('\n'),
            status: 'done',
          });
        });
      } else if (ev.kind === 'step' && ev.stepType) {
        updateAssistant((m) => {
          m.liveStep = ev.state === 'DONE' ? null : ev.stepType;
        });
      }
    };

    try {
      let res;
      const engineKey = isCodexChat ? 'codex' : provider ? `provider:${provider.id}` : 'gemini';
      const sameEngineAsLast = !run.lastChatEngine || run.lastChatEngine === engineKey;
      const priorLastAsst = [...priorMessages].reverse().find((m) => m.role === 'assistant');
      const lastTurnIncomplete = Boolean(priorLastAsst && priorLastAsst.status !== 'done');
      const agyFlagMode = isReadOnly ? 'plan' : 'sandbox';
      const codexSandbox = run.config.sandbox || 'workspace-write';
      const { timeoutMs, idleTimeoutMs } = this.resolveTimeoutPolicy(run.config?.timeoutMode);

      const effectiveTurnPrompt = turnOpts.steered && turnOpts.steerReason === 'interrupt'
        ? `【中途打断 · 目标已调整】用户刚才中途打断了上一条未完成的输出，并改为以下新目标，请直接按新目标响应：\n${userPrompt}`
        : userPrompt;

      if (isCodexChat) {
        const targetCodexThreadId = explicitResumeThreadId || run.codex?.threadId || '';
        const canResume = Boolean(targetCodexThreadId) && (
          Boolean(explicitResumeThreadId || turnOpts.forceCodexResume) ||
          (
            sameEngineAsLast &&
            !lastTurnIncomplete &&
            (!run.codex?.lastSandbox || run.codex.lastSandbox === codexSandbox)
          )
        );
        const promptForCodex = canResume
          ? effectiveTurnPrompt
          : `${systemPrompt}\n\n${this.buildChatContextPrompt(priorMessages, effectiveTurnPrompt, run)}`;
        res = await runCodex({
          prompt: promptForCodex,
          cwd: run.effectiveWorkDir || run.workspaceDir,
          model: run.config.codexModel,
          reasoningEffort: run.config.codexEffort || 'medium',
          sandbox: codexSandbox,
          allowCodexNetwork: Boolean(run.config.allowCodexNetwork),
          isGitRepo: run.isGitRepo,
          resumeThreadId: canResume ? targetCodexThreadId : '',
          codexHome: run.config.codexHome,
          timeoutMs,
          idleTimeoutMs,
          onProcess: (p) => this.setActiveProcess(runId, p, gen),
          onDelta: (_delta, full) => {
            updateAssistant((m) => {
              m.content = full;
              m.liveStep = null;
            });
          },
          onEvent: (ev) => {
            if (!this.isExecutionActive(runId, gen)) return;
            this.store.appendEvent(runId, ev);
            handleChatTraceEvent(ev);
          },
        });
      } else if (provider && provider.enabled) {
        const contextualPrompt = this.buildChatContextPrompt(priorMessages, effectiveTurnPrompt, run);
        res = await runProvider(provider, {
          prompt: contextualPrompt,
          systemPrompt,
          model: run.config.providerModel || provider.defaultModel,
          cwd: run.effectiveWorkDir || run.workspaceDir,
          timeoutMs,
          onProcess: (p) => this.setActiveProcess(runId, p, gen),
          onReasoning: (_chunk, fullReasoning) => {
            updateAssistant((m) => {
              m.thinkingText = String(fullReasoning || '').slice(-8000);
              upsertTraceItem(m, {
                id: 'reason_stream',
                kind: 'thinking',
                title: '推理思考',
                detail: m.thinkingText.trim().split(/\r?\n/)[0].slice(0, 120) || '正在推演...',
                body: m.thinkingText.slice(-4000),
                status: 'running',
              });
            });
          },
          onDelta: (_delta, full) => {
            updateAssistant((m) => {
              m.content = full;
              m.liveStep = null;
              const rs = (m.trace || []).find((t) => t.id === 'reason_stream');
              if (rs && rs.status === 'running') rs.status = 'done';
            });
          },
          onEvent: (ev) => {
            if (!this.isExecutionActive(runId, gen)) return;
            this.store.appendEvent(runId, {
              ...ev,
              source: ev.source === 'provider' ? 'gemini' : (ev.source || 'gemini'),
            });
            if (ev.kind !== 'reasoning') handleChatTraceEvent(ev);
          },
        });
      } else {
        const canResumeAgy =
          sameEngineAsLast &&
          !lastTurnIncomplete &&
          Boolean(run.gemini?.conversationId) &&
          run.gemini?.lastFlagMode === agyFlagMode;
        const promptForAgy = canResumeAgy
          ? effectiveTurnPrompt
          : `${systemPrompt}\n\n${this.buildChatContextPrompt(priorMessages, effectiveTurnPrompt, run)}`;
        res = await runAgy({
          prompt: promptForAgy,
          model: run.config.geminiModel,
          cwd: run.effectiveWorkDir || run.workspaceDir,
          mode: isReadOnly ? 'plan' : '',
          sandbox: !isReadOnly,
          conversationId: canResumeAgy ? run.gemini.conversationId : '',
          timeoutMs,
          idleTimeoutMs,
          onProcess: (p) => this.setActiveProcess(runId, p, gen),
          onDelta: (_delta, full) => {
            updateAssistant((m) => {
              m.content = full;
              m.liveStep = null;
            });
          },
          onEvent: (ev) => {
            if (!this.isExecutionActive(runId, gen)) return;
            this.store.appendEvent(runId, ev);
            handleChatTraceEvent(ev);
          },
        });
      }

      this.setActiveProcess(runId, null, gen);
      if (!this.isExecutionActive(runId, gen)) return;

      const tok = res.usage?.total_tokens
        || ((res.usage?.input_tokens || 0) + (res.usage?.output_tokens || 0))
        || 0;
      const finalThinkingTok = Number(res.usage?.thinking_tokens || 0);

      this.store.update(runId, (r) => {
        if (!this.isExecutionActive(runId, gen)) return;
        if (res.ok) r.lastChatEngine = engineKey;
        const msg = (r.messages || []).find((m) => m.id === asstMsgId);
        if (msg && msg.status !== 'cancelled') {
          msg.status = res.ok ? 'done' : 'failed';
          msg.content = res.text || msg.content;
          msg.liveStep = null;
          msg.durationMs = res.durationMs || (Date.now() - startedAt);
          msg.tokens = tok;
          if (finalThinkingTok > (Number(msg.thinkingTokens) || 0)) {
            msg.thinkingTokens = finalThinkingTok;
          }
          if (Array.isArray(msg.trace)) {
            msg.trace.forEach((t) => {
              if (t && t.status === 'running') t.status = res.ok ? 'done' : 'error';
            });
          }
          msg.error = res.error || null;
        }

        if (isCodexChat) {
          r.codex.status = res.ok ? 'done' : 'failed';
          r.codex.threadId = res.threadId || r.codex.threadId;
          if (res.ok) r.codex.lastSandbox = codexSandbox;
          r.codex.durationMs += res.durationMs || 0;
          if (tok) r.metrics.codexTokens += tok;
        } else {
          r.gemini.status = res.ok ? 'done' : 'failed';
          if (res.ok) {
            r.gemini.conversationId = res.conversationId || r.gemini.conversationId;
            r.gemini.lastFlagMode = agyFlagMode;
          }
          r.gemini.durationMs += res.durationMs || 0;
          if (tok) r.metrics.geminiTokens += tok;
        }

        r.metrics.totalDurationMs += res.durationMs || (Date.now() - startedAt);
        const hasQueuedSteer = Boolean(r.pendingSteer && r.pendingSteer.prompt);
        if (r.status !== 'cancelled') {
          if (hasQueuedSteer) {
            r.status = 'running';
            r.activeStage = 'chat';
          } else {
            r.status = res.ok ? 'completed' : 'failed';
            r.activeStage = res.ok ? 'done' : 'failed';
          }
        }
      });

      // If Codex ran with workspace-write in chat mode, refresh live diff passively
      if (isCodexChat && res.ok && run.isGitRepo && this.isExecutionActive(runId, gen)) {
        const diffInfo = await getWorkspaceDiff(run.effectiveWorkDir).catch(() => null);
        if (diffInfo?.ok && this.isExecutionActive(runId, gen)) {
          this.store.update(runId, (r) => {
            r.codex.diff = diffInfo.diff || '';
            r.codex.diffStat = diffInfo.stat || '';
          });
        }
      }

      // Auto-trigger queued mid-run goal modification seamlessly once this turn finishes
      if (this.isExecutionActive(runId, gen)) {
        const queuedSteer = this.consumePendingSteer(runId);
        if (queuedSteer) {
          await this.executeChatTurn(runId, queuedSteer.prompt, gen, {
            steered: true,
            steerReason: 'next-step',
          });
        }
      }
    } finally {
      this.setActiveProcess(runId, null, gen);
    }
  }

  async invokePrimaryEngine(run, { prompt, systemPrompt = '', onDelta, gen = null }) {
    const id = run.id;
    const safeDelta = (delta, full) => {
      if (!this.isExecutionActive(id, gen)) return;
      if (onDelta) onDelta(delta, full);
    };

    const { timeoutMs, idleTimeoutMs } = this.resolveTimeoutPolicy(run.config?.timeoutMode);
    const providerId = run.config.providerId;
    if (providerId && this.providerStore) {
      const provider = this.providerStore.get(providerId);
      if (provider && provider.enabled) {
        return runProvider(provider, {
          prompt,
          systemPrompt,
          model: run.config.providerModel || provider.defaultModel,
          cwd: run.effectiveWorkDir,
          timeoutMs,
          onProcess: (p) => this.setActiveProcess(id, p, gen),
          onDelta: safeDelta,
          onEvent: (ev) => {
            if (!this.isExecutionActive(id, gen)) return;
            this.store.appendEvent(id, {
              ...ev,
              source: ev.source === 'provider' ? 'gemini' : (ev.source || 'gemini'),
            });
          },
        });
      }
    }

    return runAgy({
      prompt: systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt,
      model: run.config.geminiModel,
      cwd: run.effectiveWorkDir,
      mode: 'plan',
      timeoutMs,
      idleTimeoutMs,
      onProcess: (p) => this.setActiveProcess(id, p, gen),
      onDelta: safeDelta,
      onEvent: (ev) => {
        if (!this.isExecutionActive(id, gen)) return;
        this.store.appendEvent(id, ev);
        if (ev?.source === 'gemini' && ev.kind === 'init' && ev.conversationId) {
          this.store.update(id, (r) => {
            if (this.isExecutionActive(id, gen)) {
              r.gemini.conversationId = ev.conversationId;
            }
          });
        }
      },
    });
  }

  async stageCustomAgent(run, gen = null) {
    const id = run.id;
    if (!this.isExecutionActive(id, gen)) return { ok: false, cancelled: true, text: '', error: null, durationMs: 0 };

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
    if (!this.isExecutionActive(id, gen)) return { ok: false, cancelled: true, text: '', error: null, durationMs: 0 };

    const dirSummary = wsContext?.topFiles?.length
      ? wsContext.topFiles.slice(0, 20).map((f) => `${f.type === 'dir' ? '[DIR]' : '[FILE]'} ${f.name}`).join(', ')
      : '';
    const systemPrompt = dirSummary
      ? `你正在 TENON（榫）多模型协同工作台中运行。当前工作目录：${run.effectiveWorkDir}；顶层结构：${dirSummary}。请用清晰、准确、无废话的中文作答。`
      : `你正在 TENON（榫）多模型协同工作台中运行。当前工作目录：${run.effectiveWorkDir}。请用清晰、准确、无废话的中文作答。`;

    const res = await this.invokePrimaryEngine(run, {
      prompt: run.prompt,
      systemPrompt,
      gen,
      onDelta: (_delta, full) => {
        if (!this.isExecutionActive(id, gen)) return;
        this.store.update(id, (r) => {
          r.gemini.planText = full;
        });
      },
    });

    this.setActiveProcess(id, null, gen);
    if (!this.isExecutionActive(id, gen)) return { ok: false, cancelled: true, text: '', error: null, durationMs: 0 };

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

  async stageGeminiPlan(run, promptOverride = null, gen = null) {
    const id = run.id;
    if (!this.isExecutionActive(id, gen)) return { ok: false, cancelled: true, text: '', error: null, durationMs: 0 };

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
    if (!this.isExecutionActive(id, gen)) return { ok: false, cancelled: true, text: '', error: null, durationMs: 0 };

    const dirSummary = wsContext?.topFiles?.length
      ? wsContext.topFiles.slice(0, 24).map((f) => `${f.type === 'dir' ? '[DIR]' : '[FILE]'} ${f.name}`).join(', ')
      : '（无顶层文件概览）';

    const structuredPrompt = [
      '你是 TENON（榫）多模型协同工作台的【总指挥与架构规划师】。',
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
      gen,
      onDelta: (_delta, full) => {
        if (!this.isExecutionActive(id, gen)) return;
        this.store.update(id, (r) => {
          r.gemini.planText = full;
        });
      },
    });

    this.setActiveProcess(id, null, gen);
    if (!this.isExecutionActive(id, gen)) return { ok: false, cancelled: true, text: '', error: null, durationMs: 0 };

    this.store.update(id, (r) => {
      r.gemini.status = res.ok ? 'done' : 'failed';
      r.gemini.conversationId = res.conversationId || r.gemini.conversationId;
      r.gemini.planText = res.text || r.gemini.planText;
      r.gemini.durationMs += res.durationMs || 0;
      r.gemini.usage = res.usage || null;
      r.gemini.error = res.error || null;
      const tok = res.usage?.total_tokens || ((res.usage?.input_tokens || 0) + (res.usage?.output_tokens || 0));
      if (tok) r.metrics.geminiTokens += tok;
      if (!res.ok && r.status !== 'cancelled') {
        r.status = 'failed';
        r.activeStage = 'failed';
      }
    });
    return res;
  }

  async stageGeminiCopy(run, gen = null) {
    const id = run.id;
    if (!this.isExecutionActive(id, gen)) return { ok: false, cancelled: true, text: '', error: null, durationMs: 0 };

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
      gen,
      onDelta: (_delta, full) => {
        if (!this.isExecutionActive(id, gen)) return;
        this.store.update(id, (r) => {
          r.gemini.copyText = full;
        });
      },
    });

    this.setActiveProcess(id, null, gen);
    if (!this.isExecutionActive(id, gen)) return { ok: false, cancelled: true, text: '', error: null, durationMs: 0 };

    this.store.update(id, (r) => {
      r.gemini.status = res.ok ? 'done' : 'failed';
      r.gemini.conversationId = res.conversationId || r.gemini.conversationId;
      r.gemini.copyText = res.text || r.gemini.copyText;
      r.gemini.durationMs += res.durationMs || 0;
      r.gemini.usage = res.usage || null;
      r.gemini.error = res.error || null;
      const tok = res.usage?.total_tokens || ((res.usage?.input_tokens || 0) + (res.usage?.output_tokens || 0));
      if (tok) r.metrics.geminiTokens += tok;
      if (!res.ok && r.status !== 'cancelled') {
        r.status = 'failed';
        r.activeStage = 'failed';
      }
    });
    return res;
  }

  async stageCodexExec(run, taskSpec, resumeThreadId = '', gen = null) {
    const id = run.id;
    if (!this.isExecutionActive(id, gen)) return { ok: false, cancelled: true, text: '', error: null, durationMs: 0 };

    const latestRun = this.store.get(id);
    const threadToResume = resumeThreadId || latestRun?.config?.resumeThreadId || '';
    const allowCodexNetwork = Boolean(latestRun?.config?.allowCodexNetwork ?? run.config.allowCodexNetwork);

    this.store.update(id, (r) => {
      r.activeStage = 'exec';
      r.codex.status = 'running';
      r.codex.error = null;
    });
    this.store.appendEvent(id, {
      source: 'codex',
      kind: 'stage',
      text: `03 派发给 Codex (${run.config.codexModel || '本机默认'} · ${run.config.codexEffort} · sandbox=${run.config.sandbox}${allowCodexNetwork && run.config.sandbox !== 'read-only' ? ' · network=on' : ''})`,
    });

    const codexPrompt = [
      '你是 TENON（榫）多模型协同工作台的【后端与代码实现工程师（Codex）】。',
      '请严格按以下任务契约和验收标准在当前工作目录内严谨实现，不要顺手改无关模块，不要跳过验证。',
      '完成后请简明汇报：改动文件清单、核心实现点、已跑过的测试命令与结果。',
      '',
      '【派单任务与验收标准】',
      taskSpec,
    ].join('\n');

    const { timeoutMs, idleTimeoutMs } = this.resolveTimeoutPolicy(latestRun?.config?.timeoutMode ?? run.config?.timeoutMode);
    const res = await runCodex({
      prompt: codexPrompt,
      cwd: run.effectiveWorkDir,
      model: run.config.codexModel,
      reasoningEffort: run.config.codexEffort,
      sandbox: run.config.sandbox,
      allowCodexNetwork,
      isGitRepo: run.isGitRepo,
      resumeThreadId: threadToResume,
      codexHome: run.config.codexHome,
      timeoutMs,
      idleTimeoutMs,
      onProcess: (p) => this.setActiveProcess(id, p, gen),
      onDelta: (_d, full) => {
        if (!this.isExecutionActive(id, gen)) return;
        this.store.update(id, (r) => {
          r.codex.execText = full;
        });
      },
      onEvent: (ev) => {
        if (!this.isExecutionActive(id, gen)) return;
        this.store.appendEvent(id, ev);
        if (ev?.source === 'codex' && ev.kind === 'init' && ev.threadId) {
          this.store.update(id, (r) => {
            if (this.isExecutionActive(id, gen)) {
              r.codex.threadId = ev.threadId;
            }
          });
        }
      },
    });

    this.setActiveProcess(id, null, gen);
    if (!this.isExecutionActive(id, gen)) return { ok: false, cancelled: true, text: '', error: null, durationMs: 0 };

    const diffInfo = await getWorkspaceDiff(run.effectiveWorkDir).catch(() => ({ diff: '', stat: '' }));
    if (!this.isExecutionActive(id, gen)) return { ok: false, cancelled: true, text: '', error: null, durationMs: 0 };

    this.store.update(id, (r) => {
      r.codex.status = res.ok ? 'done' : 'failed';
      r.codex.threadId = res.threadId || r.codex.threadId;
      r.codex.execText = res.text || r.codex.execText;
      r.codex.durationMs += res.durationMs || 0;
      r.codex.usage = res.usage || null;
      r.codex.error = res.error || null;
      r.codex.diff = diffInfo.diff || '';
      r.codex.diffStat = diffInfo.stat || '';
      if (res.usage) {
        const tok = res.usage.total_tokens || ((res.usage.input_tokens || 0) + (res.usage.output_tokens || 0));
        if (tok) r.metrics.codexTokens += tok;
      }
      if (!res.ok && r.status !== 'cancelled') {
        r.status = 'failed';
        r.activeStage = 'failed';
      }
    });
    return res;
  }

  async stageCodexReviewLoop(run, allowAutoFix = true, gen = null) {
    const id = run.id;
    const effectiveMaxRounds = allowAutoFix ? (run.config.maxReviewRounds || 2) : 1;

    for (let round = 1; round <= effectiveMaxRounds; round += 1) {
      if (!this.isExecutionActive(id, gen)) return false;

      // Re-inspect workspace on EVERY round so high-risk files touched during Round-1 fix escalate Round-2 to xhigh
      const ws = await inspectWorkspace(run.effectiveWorkDir);
      if (!this.isExecutionActive(id, gen)) return false;

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
      if (!this.isExecutionActive(id, gen)) return false;

      const reviewPrompt = [
        '你是 TENON 工作台的【Pre-CI 代码审查门神（只读模式）】。不要修改任何文件。',
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

      const latestConfig = this.store.get(id)?.config || run.config;
      const { timeoutMs, idleTimeoutMs } = this.resolveTimeoutPolicy(latestConfig.timeoutMode);
      const res = await runCodex({
        prompt: reviewPrompt,
        cwd: run.effectiveWorkDir,
        model: run.config.codexReviewModel || run.config.codexModel,
        reasoningEffort: reviewEffort,
        sandbox: 'read-only',
        allowCodexNetwork: Boolean(latestConfig.allowCodexNetwork),
        isGitRepo: run.isGitRepo,
        codexHome: run.config.codexHome,
        timeoutMs,
        idleTimeoutMs,
        onProcess: (p) => this.setActiveProcess(id, p, gen),
        onDelta: (_d, full) => {
          if (!this.isExecutionActive(id, gen)) return;
          this.store.update(id, (r) => {
            r.codex.reviewText = full;
          });
        },
        onEvent: (ev) => {
          if (!this.isExecutionActive(id, gen)) return;
          this.store.appendEvent(id, ev);
          if (ev?.source === 'codex' && ev.kind === 'init' && ev.threadId) {
            this.store.update(id, (r) => {
              // Preserve stageCodexExec's threadId in full-pipeline so Round-1 auto-fix resumes the right exec thread
              if (this.isExecutionActive(id, gen) && !r.codex.threadId) {
                r.codex.threadId = ev.threadId;
              }
            });
          }
        },
      });

      this.setActiveProcess(id, null, gen);
      if (!this.isExecutionActive(id, gen)) return false;

      if (!res.ok) {
        this.store.update(id, (r) => {
          r.codex.status = 'failed';
          r.codex.durationMs += res.durationMs || 0;
          r.codex.error = res.error || null;
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
        if (!r.codex.threadId && res.threadId) r.codex.threadId = res.threadId;
        r.codex.reviewText = res.text;
        r.codex.durationMs += res.durationMs || 0;
        r.codex.usage = res.usage || r.codex.usage;
        r.codex.diff = diffInfo.diff || r.codex.diff;
        r.codex.diffStat = diffInfo.stat || r.codex.diffStat;
        r.reviewVerdict = verdict;
        if (res.usage) {
          const tok = res.usage.total_tokens || ((res.usage.input_tokens || 0) + (res.usage.output_tokens || 0));
          if (tok) r.metrics.codexTokens += tok;
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
        const fixRes = await this.stageCodexExec(run, fixSpec, current?.codex?.threadId || '', gen);
        if (!fixRes.ok || !this.isExecutionActive(id, gen)) return false;
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
        }, gen);
        if (decision.action === 'cancel' || !this.isExecutionActive(id, gen)) {
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

  async stageGeminiSummary(run, gen = null) {
    const id = run.id;
    if (!this.isExecutionActive(id, gen)) return { ok: false, cancelled: true, text: '', error: null, durationMs: 0 };

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
      '你是 TENON（榫）多模型协同工作台的【总指挥（Gemini）】。当前处于无头只读汇总模式：绝对不要调用任何终端命令工具或修改文件，直接基于下方材料用简明中文作答。',
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
      gen,
      onDelta: (_d, full) => {
        if (!this.isExecutionActive(id, gen)) return;
        this.store.update(id, (r) => {
          r.gemini.summaryText = full;
        });
      },
    });

    this.setActiveProcess(id, null, gen);
    if (!this.isExecutionActive(id, gen)) return { ok: false, cancelled: true, text: '', error: null, durationMs: 0 };

    this.store.update(id, (r) => {
      r.gemini.status = res.ok ? 'done' : 'failed';
      r.gemini.conversationId = res.conversationId || r.gemini.conversationId;
      r.gemini.summaryText = res.text || r.gemini.summaryText;
      r.gemini.durationMs += res.durationMs || 0;
      r.gemini.usage = res.usage || r.gemini.usage;
      r.gemini.error = res.error || null;
      const tok = res.usage?.total_tokens || ((res.usage?.input_tokens || 0) + (res.usage?.output_tokens || 0));
      if (tok) r.metrics.geminiTokens += tok;
      if (!res.ok && r.status !== 'cancelled') {
        r.status = 'failed';
        r.activeStage = 'failed';
      }
    });
    return res;
  }
}
