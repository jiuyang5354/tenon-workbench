import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';

export function killProcessTree(child) {
  if (!child || !child.pid) return;
  try {
    if (process.platform === 'win32') {
      execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    // Process already terminated
  }
}

/**
 * Strips optional chat status footers before forwarding a prompt/spec to another model.
 */
export function sanitizeAgentText(text = '') {
  return String(text)
    .replace(/\n*---\s*\n📊\s*\*\*上下文用量\*\*[\s\S]*$/m, '')
    .trim();
}

/**
 * Runs Antigravity (`agy --print --output-format stream-json`) cleanly and streams NDJSON events.
 * Uses `--input-format stream-json` or safe stdin closing and guards against silent empty-output
 * exits caused by headless tool-permission denials.
 */
export function runAgy({
  prompt,
  model = 'gemini-4-neon-high',
  cwd = process.cwd(),
  mode = 'plan',
  effort = '',
  conversationId = '',
  sandbox = false,
  disableSlashCommands = false,
  addDirs = [],
  timeoutMs = 180_000,
  onDelta,
  onEvent,
  onProcess,
}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    // Guard against leading '-' being misinterpreted as a CLI flag & stay under Windows argv bounds
    const safePrompt = String(prompt || '').trimStart().startsWith('-')
      ? ` ${String(prompt || '')}`
      : String(prompt || '');

    const args = [];
    if (model) args.push('--model', model);
    if (effort) args.push('--effort', effort);
    if (mode) args.push('--mode', mode);
    if (sandbox) args.push('--sandbox');
    if (conversationId) args.push('--conversation', conversationId);
    if (disableSlashCommands && !mode) args.push('--disable-slash-commands');
    for (const dir of addDirs) {
      if (dir) args.push('--add-dir', dir);
    }
    args.push('--output-format', 'stream-json');
    args.push(`--print=${safePrompt}`);

    const child = spawn('agy', args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env },
    });

    if (onProcess) onProcess(child);
    // Guard against EPIPE if child exits immediately or fails to spawn
    child.stdin.on('error', () => {});
    child.stdin.end();

    let stdoutBuf = '';
    let stderrText = '';
    let collectedDelta = '';
    let finalResponse = '';
    let resolvedConversationId = conversationId || null;
    let usage = null;
    let status = 'UNKNOWN';
    let timedOut = false;

    const timer = timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          killProcessTree(child);
        }, timeoutMs)
      : null;

    const processLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        if (onEvent) onEvent({ source: 'gemini', kind: 'raw', text: trimmed });
        return;
      }

      if (parsed.event === 'init') {
        resolvedConversationId = parsed.conversation_id || resolvedConversationId;
        if (onEvent) {
          onEvent({
            source: 'gemini',
            kind: 'init',
            conversationId: resolvedConversationId,
            model: parsed.init?.model || model,
            cwd: parsed.init?.cwd || cwd,
          });
        }
      } else if (parsed.event === 'step_update' && parsed.step_update) {
        const su = parsed.step_update;
        if (su.conversation_id) resolvedConversationId = su.conversation_id;
        if (su.text_delta) {
          collectedDelta += su.text_delta;
          if (onDelta) onDelta(su.text_delta, sanitizeAgentText(collectedDelta));
        }
        if (su.usage) usage = su.usage;
        if (su.step_type && su.step_type !== 'agent_response' && su.step_type !== 'user_input') {
          if (onEvent) {
            onEvent({
              source: 'gemini',
              kind: 'step',
              stepType: su.step_type,
              state: su.state,
            });
          }
        }
      } else if (parsed.event === 'result' && parsed.result) {
        const r = parsed.result;
        if (r.conversation_id) resolvedConversationId = r.conversation_id;
        status = r.status || 'SUCCESS';
        if (r.response) finalResponse = r.response;
        if (r.usage) usage = r.usage;
        if (onEvent) {
          onEvent({
            source: 'gemini',
            kind: 'result',
            status,
            durationSeconds: r.duration_seconds,
            usage,
          });
        }
      }
    };

    child.stdout.on('data', (chunk) => {
      stdoutBuf += chunk.toString('utf8');
      const lines = stdoutBuf.split(/\r?\n/);
      stdoutBuf = lines.pop() ?? '';
      for (const line of lines) processLine(line);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stderrText += text;
      const clean = text.trim();
      if (clean && onEvent) {
        onEvent({ source: 'gemini', kind: 'stderr', text: clean });
      }
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({
        ok: false,
        exitCode: -1,
        text: '',
        rawText: '',
        conversationId: resolvedConversationId,
        usage,
        durationMs: Date.now() - startedAt,
        error: `无法启动 agy CLI：${err.message}`,
      });
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (stdoutBuf.trim()) processLine(stdoutBuf);
      const rawText = finalResponse || collectedDelta;
      const cleanText = sanitizeAgentText(rawText);
      const permissionDenied = /no output produced|permission.*auto-denied/i.test(stderrText);
      // Require actual non-empty output so headless auto-denials never masquerade as SUCCESS
      const ok = !timedOut && !permissionDenied && code === 0 && Boolean(cleanText);

      let error = null;
      if (timedOut) {
        error = `Gemini (agy) 执行超过 ${Math.round(timeoutMs / 1000)}s 已自动超时终止`;
      } else if (permissionDenied || (code === 0 && !cleanText)) {
        error = `Gemini (agy) 未产生正文输出（无头模式下工具权限被拦截或模型无回复）。详情：${stderrText.trim().slice(0, 320) || 'empty response'}`;
      } else if (!ok) {
        error = stderrText.trim().slice(0, 500) || `agy 异常退出 (code=${code})`;
      }

      resolve({
        ok,
        exitCode: code,
        text: cleanText,
        rawText,
        conversationId: resolvedConversationId,
        usage,
        durationMs: Date.now() - startedAt,
        error,
      });
    });
  });
}

/**
 * Runs OpenAI Codex CLI (`codex exec --json` or `codex exec resume`) safely with
 * bounded sandbox (`workspace-write` or `read-only`) and stdin prompt delivery.
 */
export function runCodex({
  prompt,
  cwd = process.cwd(),
  model = '',
  reasoningEffort = 'high',
  sandbox = 'workspace-write',
  isGitRepo = true,
  resumeThreadId = '',
  codexHome = '',
  timeoutMs = 300_000,
  onDelta,
  onEvent,
  onProcess,
}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    // Enforce safe sandbox bounds — never permit danger-full-access from the workbench
    const safeSandbox = sandbox === 'read-only' ? 'read-only' : 'workspace-write';
    const tmpFile = path.join(os.tmpdir(), `conduit-codex-${crypto.randomUUID()}.txt`);

    const args = ['exec'];
    if (resumeThreadId) {
      args.push('resume', resumeThreadId);
      // Enforce sandbox policy explicitly on resume via config override
      args.push('-c', `sandbox_mode="${safeSandbox}"`);
    }
    args.push('--json');
    if (!resumeThreadId) {
      args.push('--sandbox', safeSandbox);
      args.push('-C', cwd);
    }
    if (!isGitRepo) {
      args.push('--skip-git-repo-check');
    }
    if (model && model.trim()) {
      args.push('-m', model.trim());
    }
    if (reasoningEffort) {
      args.push('-c', `model_reasoning_effort="${reasoningEffort}"`);
    }
    args.push('-o', tmpFile);
    // Read full prompt cleanly via stdin to prevent Windows quoting/length issues
    args.push('-');

    const childEnv = { ...process.env };
    if (codexHome && codexHome.trim()) {
      childEnv.CODEX_HOME = codexHome.trim();
    }

    const child = spawn('codex', args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: childEnv,
    });

    if (onProcess) onProcess(child);
    child.stdin.on('error', () => {});
    child.stdin.write(String(prompt || ''), 'utf8');
    child.stdin.end();

    let stdoutBuf = '';
    let stderrText = '';
    let threadId = resumeThreadId || null;
    let lastAgentText = '';
    let usage = null;
    const errorMessages = [];
    let authErrorDetected = false;
    let timedOut = false;

    const timer = timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          killProcessTree(child);
        }, timeoutMs)
      : null;

    const processLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        if (onEvent) onEvent({ source: 'codex', kind: 'raw', text: trimmed });
        return;
      }

      if (parsed.type === 'thread.started') {
        threadId = parsed.thread_id || threadId;
        if (onEvent) {
          onEvent({
            source: 'codex',
            kind: 'init',
            threadId,
            sandbox: safeSandbox,
            model: model || 'config-default',
            effort: reasoningEffort,
          });
        }
      } else if (parsed.type === 'turn.started') {
        if (onEvent) onEvent({ source: 'codex', kind: 'turn_started' });
      } else if (parsed.type === 'item.completed' || parsed.type === 'item.updated' || parsed.type === 'item.started') {
        const item = parsed.item || {};
        const itemType = item.type || 'item';
        if (itemType === 'agent_message' || itemType === 'message') {
          const txt = item.text || item.content || '';
          if (txt) {
            lastAgentText = txt;
            if (onDelta) onDelta(txt, txt);
          }
        } else if (itemType === 'reasoning') {
          const txt = item.text || item.summary || '';
          if (txt && onEvent) {
            onEvent({ source: 'codex', kind: 'reasoning', text: txt });
          }
        } else if (itemType === 'command_execution') {
          if (onEvent) {
            onEvent({
              source: 'codex',
              kind: 'command',
              command: item.command || '',
              status: item.status || parsed.type,
              exitCode: item.exit_code ?? null,
              output: (item.aggregated_output || '').slice(0, 600),
            });
          }
        } else if (itemType === 'file_change') {
          if (onEvent) {
            onEvent({
              source: 'codex',
              kind: 'file_change',
              changes: item.changes || [],
              status: item.status || parsed.type,
            });
          }
        } else if (itemType === 'error') {
          const msg = item.message || 'Codex warning/error';
          if (/401 Unauthorized|invalid_api_key/i.test(msg)) authErrorDetected = true;
          if (!/Under-development features enabled|Model metadata for/i.test(msg)) {
            errorMessages.push(msg);
          }
          if (onEvent) onEvent({ source: 'codex', kind: 'warning', text: msg });
        }
      } else if (parsed.type === 'turn.completed') {
        usage = parsed.usage || usage;
        if (onEvent) onEvent({ source: 'codex', kind: 'turn_completed', usage });
      } else if (parsed.type === 'turn.failed' || parsed.type === 'error') {
        const msg = parsed.error?.message || parsed.message || 'Codex execution error';
        if (/401 Unauthorized|invalid_api_key/i.test(msg)) authErrorDetected = true;
        errorMessages.push(msg);
        if (onEvent) onEvent({ source: 'codex', kind: 'error', text: msg });
      }
    };

    child.stdout.on('data', (chunk) => {
      stdoutBuf += chunk.toString('utf8');
      const lines = stdoutBuf.split(/\r?\n/);
      stdoutBuf = lines.pop() ?? '';
      for (const line of lines) processLine(line);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stderrText += text;
      if (/401 Unauthorized|invalid_api_key/i.test(text)) authErrorDetected = true;
      const clean = text.trim();
      if (clean && onEvent && !/failed to install system skills/i.test(clean)) {
        onEvent({ source: 'codex', kind: 'stderr', text: clean.slice(0, 400) });
      }
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      fs.unlink(tmpFile).catch(() => {});
      resolve({
        ok: false,
        exitCode: -1,
        text: '',
        threadId,
        usage,
        durationMs: Date.now() - startedAt,
        error: `无法启动 codex CLI：${err.message}`,
      });
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (stdoutBuf.trim()) processLine(stdoutBuf);
      fs.readFile(tmpFile, 'utf8')
        .then((raw) => raw.trim())
        .catch(() => '')
        .finally(() => fs.unlink(tmpFile).catch(() => {}))
        .then((fileLastMsg) => {
          const finalText = fileLastMsg || lastAgentText;
          const ok = !timedOut && code === 0 && Boolean(finalText);
          let error = null;
          if (timedOut) {
            error = `Codex 执行超过 ${Math.round(timeoutMs / 1000)}s 已自动超时终止`;
          } else if (authErrorDetected && !ok) {
            error = 'Codex 鉴权失败（401 Unauthorized / Invalid API Key）。请在上方配置中切换 CODEX_HOME 配置档，或检查当前 config.toml 中的 provider 与凭据。';
          } else if (!ok) {
            error = errorMessages[errorMessages.length - 1] || stderrText.trim().slice(0, 500) || `codex 异常退出 (code=${code})`;
          }

          resolve({
            ok,
            exitCode: code,
            text: finalText,
            threadId,
            usage,
            durationMs: Date.now() - startedAt,
            error,
          });
        });
    });
  });
}
