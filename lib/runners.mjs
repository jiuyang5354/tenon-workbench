import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { spawn, execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const activeChildren = new Map(); // ChildProcess -> { pid, tmpFiles: Set<string> }
const resolvedExecCache = new Map(); // `${cmd}\0${pathVal}` -> { resolved, expiresAt }
const EXEC_CACHE_TTL_MS = 60_000;
let runtimePathHydrated = false;
let registryPathMerged = false;

function getPathEnvKey(env = process.env) {
  if (!env || typeof env !== 'object') return 'PATH';
  if (process.platform !== 'win32') return 'PATH';
  return Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH';
}

function getPathEnvValue(env = process.env) {
  const key = getPathEnvKey(env);
  return String(env?.[key] || '');
}

function expandWindowsEnvVars(raw, env = process.env) {
  return String(raw || '').replace(/%([^%]+)%/g, (match, name) => {
    const foundKey = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
    return foundKey && env[foundKey] !== undefined ? String(env[foundKey]) : match;
  });
}

function readWindowsRegistryPath(hiveKey) {
  const regExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
  const targetExe = fsSync.existsSync(regExe) ? regExe : 'reg.exe';
  try {
    const out = execFileSync(targetExe, ['query', hiveKey, '/v', 'Path'], {
      encoding: 'utf8',
      timeout: 1200,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const line = String(out || '')
      .split(/\r?\n/)
      .find((l) => /^\s*path\s+REG_(?:EXPAND_)?SZ\s+/i.test(l));
    if (!line) return '';
    const match = line.match(/^\s*path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/i);
    return match ? expandWindowsEnvVars(match[1].trim(), process.env) : '';
  } catch {
    return '';
  }
}

function collectCandidateToolDirs() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

    return [
      path.join(localAppData, 'agy', 'bin'),
      path.join(localAppData, 'Programs', 'OpenAI', 'Codex', 'bin'),
      path.join(localAppData, 'Microsoft', 'WinGet', 'Links'),
      path.join(appData, 'npm'),
      path.join(home, '.local', 'bin'),
      path.join(home, '.cargo', 'bin'),
      path.join(home, '.bun', 'bin'),
      path.join(home, '.volta', 'bin'),
      process.env.PNPM_HOME || '',
      process.env.NVM_SYMLINK || '',
      path.join(localAppData, 'Programs', 'claude-code'),
      path.join(localAppData, 'Programs', 'Ollama'),
      path.join(localAppData, 'Programs', 'Git', 'cmd'),
      path.join(localAppData, 'Programs', 'Git', 'bin'),
      path.join(programFiles, 'Git', 'cmd'),
      path.join(programFiles, 'Git', 'bin'),
      path.join(programFilesX86, 'Git', 'cmd'),
      path.join(programFiles, 'GitHub CLI'),
      path.join(programFiles, 'nodejs'),
    ].filter(Boolean);
  }

  return [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    path.join(home, '.local', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.volta', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.cargo', 'bin'),
  ].filter(Boolean);
}

/**
 * Hydrates `process.env.PATH` with standard CLI install directories (and optionally fresh
 * Windows Registry User/System PATH entries) so packaged Electron builds launched from
 * Windows Explorer / Start Menu can reliably discover `agy`, `codex`, `claude`, `git`, `gh`, etc.
 * Appends missing existing directories only — never overrides explicit leading PATH entries.
 */
export function hydrateRuntimePath({ mergeRegistry = false } = {}) {
  if (runtimePathHydrated && (!mergeRegistry || registryPathMerged || process.platform !== 'win32')) {
    return getPathEnvValue(process.env);
  }

  const sep = path.delimiter;
  const pathKey = getPathEnvKey(process.env);
  const existingParts = getPathEnvValue(process.env)
    .split(sep)
    .map((p) => p.trim())
    .filter(Boolean);

  const normalizeKey = (dir) => {
    const cleaned = dir.replace(/[\\/]+$/, '');
    return process.platform === 'win32' ? cleaned.toLowerCase() : cleaned;
  };

  const seen = new Set(existingParts.map(normalizeKey));
  const additions = [];

  const maybeAdd = (rawDir) => {
    const clean = String(rawDir || '').trim().replace(/^"|"$/g, '');
    if (!clean) return;
    const key = normalizeKey(clean);
    if (!key || seen.has(key)) return;
    try {
      if (fsSync.existsSync(clean) && fsSync.statSync(clean).isDirectory()) {
        seen.add(key);
        additions.push(clean);
      }
    } catch {
      // Skip inaccessible directories
    }
  };

  if (mergeRegistry && process.platform === 'win32' && !registryPathMerged) {
    registryPathMerged = true;
    const userReg = readWindowsRegistryPath('HKCU\\Environment');
    const sysReg = readWindowsRegistryPath('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment');
    for (const part of `${userReg}${sep}${sysReg}`.split(sep)) {
      maybeAdd(part);
    }
  }

  for (const dir of collectCandidateToolDirs()) {
    maybeAdd(dir);
  }

  if (additions.length > 0) {
    const merged = [...existingParts, ...additions].join(sep);
    process.env[pathKey] = merged;
    resolvedExecCache.clear();
  }

  runtimePathHydrated = true;
  return getPathEnvValue(process.env);
}

function getTaskkillPath() {
  const sysPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
  return fsSync.existsSync(sysPath) ? sysPath : 'taskkill';
}

export function registerActiveChild(child, meta = {}) {
  if (!child) return;
  const tmpFiles = new Set(Array.isArray(meta.tmpFiles) ? meta.tmpFiles.filter(Boolean) : []);
  activeChildren.set(child, { pid: child.pid || null, tmpFiles });
}

export function unregisterActiveChild(child) {
  if (!child) return;
  activeChildren.delete(child);
}

export function killProcessTree(child) {
  if (!child || !child.pid) return;
  try {
    if (process.platform === 'win32') {
      execFile(getTaskkillPath(), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, (err) => {
        if (err) {
          try { child.kill('SIGKILL'); } catch { /* ignore */ }
        }
      });
    } else {
      child.kill('SIGTERM');
      const fallback = setTimeout(() => {
        try {
          if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
        } catch {
          // Process already exited
        }
      }, 1500);
      fallback.unref();
    }
  } catch {
    // Process already terminated
  }
}

export function killProcessTreeSync(child) {
  if (!child || !child.pid) return;
  try {
    if (process.platform === 'win32') {
      try {
        execFileSync(getTaskkillPath(), ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          timeout: 2500,
          stdio: 'ignore',
        });
      } catch {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
      }
    } else {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
    }
  } catch {
    // Process already terminated
  }
}

/**
 * Synchronously terminates every active child process tree spawned by TENON
 * and cleans up any tracked temporary files (used on Electron `before-quit`).
 */
export function killAllActiveChildrenSync() {
  for (const [child, meta] of Array.from(activeChildren.entries())) {
    killProcessTreeSync(child);
    if (meta?.tmpFiles) {
      for (const tmp of meta.tmpFiles) {
        try { fsSync.unlinkSync(tmp); } catch { /* ignore */ }
      }
    }
    activeChildren.delete(child);
  }
}

const WIN_CMD_META_RE = /([()\][%!^"`<>&|])/g;

function escapeWinCmdMeta(str) {
  return str.replace(WIN_CMD_META_RE, '^$1');
}

function quoteWinCmdTarget(target) {
  // Windows file paths cannot contain double quotes or control chars
  const clean = String(target ?? '').replace(/[\r\n"]/g, '');
  return `"${clean}"`;
}

function quoteWinCmdArg(arg) {
  let s = String(arg ?? '').replace(/[\r\n]+/g, ' ');
  // Stage 1: C-runtime / CommandLineToArgvW quoting for downstream executable behind .cmd/%*
  s = s.replace(/(\\*)"/g, '$1$1\\"');
  s = `"${s.replace(/(\\*)$/, '$1$1')}"`;
  // Stage 2: Double caret-escape cmd.exe metacharacters (including `"`, `&`, `|`, `<`, `>`, `%`)
  // matching cross-spawn, because cmd.exe parses once for `/c` and again when `.cmd`/`.bat` expands `%*`.
  s = escapeWinCmdMeta(s);
  s = escapeWinCmdMeta(s);
  return s;
}

/**
 * Builds a single verbatim command string for `cmd.exe /d /s /c` with `windowsVerbatimArguments: true`.
 * Preserves spaces/special chars in `.cmd`/`.bat` paths and prevents cmd.exe metacharacter injection
 * (even when arguments contain embedded quotes like `hello "x & echo INJECTED"`).
 */
export function buildWindowsCmdLine(target, args = []) {
  const parts = [quoteWinCmdTarget(target), ...args.map(quoteWinCmdArg)];
  return `"${parts.join(' ')}"`;
}

function isWindowsBatchScript(filePath) {
  return process.platform === 'win32' && /\.(cmd|bat)$/i.test(String(filePath || ''));
}

async function isExecutableFile(filePath) {
  try {
    const st = await fs.stat(filePath);
    return st.isFile();
  } catch {
    return false;
  }
}

async function scanPathManually(cmd, env = process.env) {
  const pathVal = getPathEnvValue(env);
  const dirs = pathVal.split(path.delimiter).map((d) => d.trim().replace(/^"|"$/g, '')).filter(Boolean);
  const exts = process.platform === 'win32'
    ? ['.exe', '.com', '.cmd', '.bat', '']
    : [''];

  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = ext && !cmd.toLowerCase().endsWith(ext)
        ? path.join(dir, `${cmd}${ext}`)
        : path.join(dir, cmd);
      if (await isExecutableFile(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Resolves a CLI command name or explicit path to its concrete executable path.
 * On Windows: supports absolute/relative paths directly, prefers `.exe`/`.com` over `.cmd`/`.bat`
 * and skips extensionless Unix shims when a native Windows executable exists.
 */
export async function resolveExecutable(cmd, env = process.env) {
  hydrateRuntimePath();
  const clean = String(cmd || '').trim().replace(/^"|"$/g, '');
  if (!clean) return null;

  // Handle explicit paths (absolute or relative containing path separator) directly
  if (path.isAbsolute(clean) || /[\\/]/.test(clean)) {
    const resolved = path.resolve(clean);
    if (await isExecutableFile(resolved)) return resolved;
    if (process.platform === 'win32' && !path.extname(resolved)) {
      for (const ext of ['.exe', '.com', '.cmd', '.bat']) {
        const withExt = `${resolved}${ext}`;
        if (await isExecutableFile(withExt)) return withExt;
      }
    }
    return null;
  }

  const cacheKey = `${clean}\0${getPathEnvValue(env)}`;
  const cached = resolvedExecCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.resolved;
  }

  let resolved = null;
  const finder = process.platform === 'win32'
    ? (fsSync.existsSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'where.exe'))
        ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'where.exe')
        : 'where.exe')
    : 'which';

  try {
    const { stdout } = await execFileAsync(finder, [clean], {
      timeout: 3500,
      windowsHide: true,
      env,
    });
    const lines = String(stdout || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length > 0) {
      if (process.platform === 'win32') {
        const exe = lines.find((l) => /\.exe$/i.test(l));
        const com = lines.find((l) => /\.com$/i.test(l));
        const cmdBat = lines.find((l) => /\.(cmd|bat)$/i.test(l));
        resolved = exe || com || cmdBat || lines[0];
      } else {
        resolved = lines[0];
      }
    }
  } catch {
    // Fallback to direct PATH scan if where.exe/which fails
  }

  if (!resolved) {
    resolved = await scanPathManually(clean, env);
  }

  if (resolved) {
    resolvedExecCache.set(cacheKey, { resolved, expiresAt: Date.now() + EXEC_CACHE_TTL_MS });
  }
  return resolved;
}

/**
 * Executes a short-lived CLI command (e.g. `--version`, `models`) safely across Windows
 * `.exe` and `.cmd`/`.bat` shims.
 */
export async function execCliFile(cmd, args = [], options = {}) {
  const env = options.env || process.env;
  const resolved = await resolveExecutable(cmd, env);
  if (!resolved) {
    const err = new Error(`spawn ${cmd} ENOENT`);
    err.code = 'ENOENT';
    throw err;
  }

  if (isWindowsBatchScript(resolved)) {
    const comspec = process.env.ComSpec || 'cmd.exe';
    const cmdLine = buildWindowsCmdLine(resolved, args);
    return execFileAsync(comspec, ['/d', '/s', '/c', cmdLine], {
      windowsHide: true,
      windowsVerbatimArguments: true,
      ...options,
      env,
    });
  }

  return execFileAsync(resolved, args, {
    windowsHide: true,
    ...options,
    env,
  });
}

/**
 * Spawns a long-running CLI executable safely on Windows (`.exe` direct, `.cmd`/`.bat` via
 * quoted `cmd.exe /d /s /c`) and POSIX.
 */
export async function spawnCliExecutable(cmd, args = [], options = {}) {
  const env = options.env || process.env;
  const resolved = await resolveExecutable(cmd, env);
  const target = resolved || cmd;

  if (isWindowsBatchScript(target)) {
    const comspec = process.env.ComSpec || 'cmd.exe';
    const cmdLine = buildWindowsCmdLine(target, args);
    return spawn(comspec, ['/d', '/s', '/c', cmdLine], {
      windowsHide: true,
      windowsVerbatimArguments: true,
      ...options,
      env,
    });
  }

  return spawn(target, args, {
    windowsHide: true,
    ...options,
    env,
  });
}

function summarizeToolParams(toolName, params = {}) {
  if (!params || typeof params !== 'object') return '';
  const direct =
    params.CommandLine ||
    params.command ||
    params.cmd ||
    params.Path ||
    params.path ||
    params.AbsolutePath ||
    params.TargetFile ||
    params.query ||
    params.Query ||
    params.url ||
    params.Url ||
    params.SearchPath;
  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim().slice(0, 180);
  }
  const compact = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .slice(0, 3)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v.slice(0, 60) : JSON.stringify(v).slice(0, 60)}`)
    .join(' ');
  return compact.slice(0, 180) || toolName;
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
 * Pure argument builder for `agy --print --output-format stream-json`.
 */
export function buildAgyArgs({
  prompt = '',
  model = 'gemini-4-neon-high',
  mode = 'plan',
  effort = '',
  conversationId = '',
  sandbox = false,
  disableSlashCommands = false,
  addDirs = [],
} = {}) {
  // Guard against leading '-' being misinterpreted as a CLI flag
  const rawPrompt = String(prompt || '');
  const safePrompt = rawPrompt.trimStart().startsWith('-') ? ` ${rawPrompt}` : rawPrompt;

  const args = [];
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  if (mode) args.push('--mode', mode);
  if (sandbox) args.push('--sandbox');
  if (conversationId) args.push('--conversation', conversationId);
  if (disableSlashCommands && !mode) args.push('--disable-slash-commands');
  for (const dir of addDirs || []) {
    if (dir) args.push('--add-dir', dir);
  }
  args.push('--output-format', 'stream-json');
  args.push(`--print=${safePrompt}`);
  return args;
}

/**
 * Pure argument builder for `codex exec --json` and `codex exec resume`.
 * Strictly enforces safe sandbox bounds (`read-only` or `workspace-write`) and only enables
 * `sandbox_workspace_write.network_access=true` when `allowCodexNetwork === true` AND
 * `safeSandbox === 'workspace-write'`.
 */
export function buildCodexArgs({
  cwd = process.cwd(),
  model = '',
  reasoningEffort = 'high',
  sandbox = 'workspace-write',
  allowCodexNetwork = false,
  isGitRepo = true,
  resumeThreadId = '',
  outputFile = '',
} = {}) {
  // Enforce safe sandbox bounds — never permit danger-full-access from the workbench
  const safeSandbox = sandbox === 'read-only' ? 'read-only' : 'workspace-write';
  const enableNetwork = allowCodexNetwork === true && safeSandbox === 'workspace-write';
  const cleanResumeId = String(resumeThreadId || '').trim();

  const args = ['exec'];
  if (cleanResumeId) {
    args.push('resume', cleanResumeId);
    // Enforce sandbox policy explicitly on resume via config override
    args.push('-c', `sandbox_mode="${safeSandbox}"`);
  }
  args.push('--json');
  if (!cleanResumeId) {
    args.push('--sandbox', safeSandbox);
    args.push('-C', cwd);
  }
  if (enableNetwork) {
    args.push('-c', 'sandbox_workspace_write.network_access=true');
  }
  if (!isGitRepo) {
    args.push('--skip-git-repo-check');
  }
  if (model && String(model).trim()) {
    args.push('-m', String(model).trim());
  }
  if (reasoningEffort) {
    args.push('-c', `model_reasoning_effort="${reasoningEffort}"`);
  }
  if (outputFile) {
    args.push('-o', outputFile);
  }
  // Read full prompt cleanly via stdin to prevent Windows quoting/length issues
  args.push('-');

  return { args, safeSandbox, enableNetwork };
}

function extractCodexText(field) {
  if (typeof field === 'string') return field;
  if (Array.isArray(field)) {
    return field
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          if (typeof part.text === 'string') return part.text;
          if (typeof part.content === 'string') return part.content;
        }
        return '';
      })
      .filter(Boolean)
      .join('');
  }
  return '';
}

function hasCodexApiKeyEnv(env = process.env) {
  return Object.keys(env || {}).some((k) => k.toUpperCase() === 'CODEX_API_KEY' && Boolean(env[k]));
}

/**
 * Runs Antigravity (`agy --print --output-format stream-json`) cleanly and streams NDJSON events.
 * Uses safe executable resolution on Windows, UTF-8 StringDecoder, clean cancel/timeout handling,
 * and guards against silent empty-output exits caused by headless tool-permission denials.
 */
export async function runAgy({
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
  hydrateRuntimePath();
  const startedAt = Date.now();
  const args = buildAgyArgs({
    prompt,
    model,
    mode,
    effort,
    conversationId,
    sandbox,
    disableSlashCommands,
    addDirs,
  });

  let cancelled = false;
  let child = null;

  const handle = {
    pid: null,
    abort: () => {
      cancelled = true;
      if (child) killProcessTree(child);
    },
  };
  if (onProcess) onProcess(handle);

  try {
    child = await spawnCliExecutable('agy', args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env },
    });
  } catch (err) {
    return {
      ok: false,
      exitCode: -1,
      text: '',
      rawText: '',
      conversationId: conversationId || null,
      usage: null,
      durationMs: Date.now() - startedAt,
      error: `无法启动 agy CLI：${err.message}`,
    };
  }

  handle.pid = child.pid || null;
  registerActiveChild(child);

  if (cancelled) {
    killProcessTree(child);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      unregisterActiveChild(child);
      resolve(result);
    };

    // Guard against EPIPE if child exits immediately or fails to spawn
    if (child.stdin) {
      child.stdin.on('error', () => {});
      try {
        if (!child.stdin.destroyed) child.stdin.end();
      } catch {
        // Ignore
      }
    }

    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');
    let stdoutBuf = '';
    let stderrText = '';
    let collectedDelta = '';
    let finalResponse = '';
    let resolvedConversationId = conversationId || null;
    let usage = null;
    let status = 'UNKNOWN';
    let resultError = '';
    let timedOut = false;
    const emittedThinkingSteps = new Set();

    const timer = timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          killProcessTree(child);
        }, timeoutMs)
      : null;

    const processLine = (line) => {
      if (cancelled || timedOut) return;
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
        if (parsed.conversation_id || su.conversation_id) {
          resolvedConversationId = parsed.conversation_id || su.conversation_id;
        }
        if (su.usage) usage = su.usage;

        const thoughtChunk = su.thinking_delta || su.thought_delta || su.thinking || su.thought || '';
        if (typeof thoughtChunk === 'string' && thoughtChunk) {
          if (onEvent) {
            onEvent({
              source: 'gemini',
              kind: 'reasoning',
              stepIndex: su.step_index,
              text: thoughtChunk,
              state: su.state || 'ACTIVE',
            });
          }
        }

        if (su.text_delta) {
          collectedDelta += su.text_delta;
          if (onDelta) onDelta(su.text_delta, sanitizeAgentText(collectedDelta));
        }

        if (su.step_type === 'tool') {
          const info = su.tool_info && typeof su.tool_info === 'object' ? su.tool_info : {};
          const toolName = su.tool_name || info.name || 'tool';
          const params = info.parameters && typeof info.parameters === 'object' ? info.parameters : {};
          const rawOut = info.output ?? info.error ?? su.error ?? '';
          const output = typeof rawOut === 'string'
            ? rawOut.slice(0, 1400)
            : (rawOut ? JSON.stringify(rawOut).slice(0, 1400) : '');
          const durationMs = Math.round((Number(su.duration_seconds) || 0) * 1000);
          const rawState = String(su.state || '').toUpperCase();
          const state = (rawState === 'ERROR' || rawState === 'FAILED' || rawState === 'CANCELLED' || rawState === 'CANCELED')
            ? 'error'
            : (rawState === 'DONE' || rawState === 'COMPLETED' || rawState === 'SUCCESS')
              ? 'done'
              : 'running';
          if (onEvent) {
            onEvent({
              source: 'gemini',
              kind: 'tool',
              stepIndex: su.step_index,
              toolName,
              summary: summarizeToolParams(toolName, params),
              params,
              output,
              durationMs,
              state,
            });
          }
        } else if (su.step_type === 'agent_response' && su.state === 'DONE') {
          const stepKey = su.step_index ?? 'final';
          const thinkingTokens = Number(su.usage?.thinking_tokens || 0);
          const durationMs = Math.round((Number(su.duration_seconds) || 0) * 1000);
          if (!emittedThinkingSteps.has(stepKey) && (thinkingTokens > 0 || durationMs > 0)) {
            emittedThinkingSteps.add(stepKey);
            if (onEvent) {
              onEvent({
                source: 'gemini',
                kind: 'thinking_step',
                stepIndex: su.step_index,
                thinkingTokens,
                durationMs,
                state: 'done',
              });
            }
          }
        } else if (su.step_type && su.step_type !== 'agent_response' && su.step_type !== 'user_input' && su.step_type !== 'system_message') {
          if (onEvent) {
            onEvent({
              source: 'gemini',
              kind: 'step',
              stepIndex: su.step_index,
              stepType: su.step_type,
              state: su.state,
            });
          }
        }
      } else if (parsed.event === 'result' && parsed.result) {
        const r = parsed.result;
        if (parsed.conversation_id || r.conversation_id) {
          resolvedConversationId = parsed.conversation_id || r.conversation_id;
        }
        status = r.status || 'SUCCESS';
        if (r.response) finalResponse = r.response;
        if (r.usage) usage = r.usage;
        if (status === 'ERROR' || status === 'FAILED') {
          resultError = String(r.error || r.message || '').trim();
        }
        if (onEvent) {
          onEvent({
            source: 'gemini',
            kind: 'result',
            status,
            durationSeconds: r.duration_seconds,
            usage,
          });
        }
      } else if (parsed.event === 'error') {
        const msg = String(parsed.error?.message || parsed.error || parsed.message || 'agy execution error').trim();
        if (msg) resultError = msg;
        if (onEvent) onEvent({ source: 'gemini', kind: 'error', text: msg });
      }
    };

    child.stdout.on('data', (chunk) => {
      stdoutBuf += stdoutDecoder.write(chunk);
      const lines = stdoutBuf.split(/\r?\n/);
      stdoutBuf = lines.pop() ?? '';
      for (const line of lines) processLine(line);
    });

    child.stderr.on('data', (chunk) => {
      const text = stderrDecoder.write(chunk);
      stderrText += text;
      const clean = text.trim();
      if (clean && !cancelled && !timedOut && onEvent) {
        onEvent({ source: 'gemini', kind: 'stderr', text: clean });
      }
    });

    child.on('error', (err) => {
      if (err.code === 'ENOENT') resolvedExecCache.clear();
      finish({
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
      stdoutBuf += stdoutDecoder.end();
      stderrText += stderrDecoder.end();
      if (stdoutBuf.trim()) processLine(stdoutBuf);
      const rawText = finalResponse || collectedDelta;
      const cleanText = sanitizeAgentText(rawText);
      const permissionDenied = /no output produced|permission.*auto-denied/i.test(stderrText);
      const statusFailed = status === 'ERROR' || status === 'FAILED';
      // Require actual non-empty output so headless auto-denials never masquerade as SUCCESS
      const ok = !cancelled && !timedOut && !permissionDenied && !statusFailed && code === 0 && Boolean(cleanText);

      let error = null;
      if (cancelled) {
        error = 'Gemini (agy) 任务已被用户中止';
      } else if (timedOut) {
        error = `Gemini (agy) 执行超过 ${Math.round(timeoutMs / 1000)}s 已自动超时终止`;
      } else if (statusFailed) {
        error = resultError || stderrText.trim().slice(0, 500) || `agy 返回失败状态 (${status})`;
      } else if (permissionDenied || (code === 0 && !cleanText)) {
        error = `Gemini (agy) 未产生正文输出（无头模式下工具权限被拦截或模型无回复）。详情：${stderrText.trim().slice(0, 320) || 'empty response'}`;
      } else if (!ok) {
        error = resultError || stderrText.trim().slice(0, 500) || `agy 异常退出 (code=${code})`;
      }

      finish({
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
 * bounded sandbox (`workspace-write` or `read-only`), optional opt-in network access
 * (`allowCodexNetwork === true` in `workspace-write`), and stdin prompt delivery.
 */
async function runCodexOnce({
  prompt,
  cwd = process.cwd(),
  model = '',
  reasoningEffort = 'high',
  sandbox = 'workspace-write',
  allowCodexNetwork = false,
  isGitRepo = true,
  resumeThreadId = '',
  codexHome = '',
  timeoutMs = 300_000,
  onDelta,
  onEvent,
  onProcess,
}, { stripCodexApiKey = false } = {}) {
  hydrateRuntimePath();
  const startedAt = Date.now();
  const tmpFile = path.join(os.tmpdir(), `conduit-codex-${crypto.randomUUID()}.txt`);
  const { args, safeSandbox, enableNetwork } = buildCodexArgs({
    cwd,
    model,
    reasoningEffort,
    sandbox,
    allowCodexNetwork,
    isGitRepo,
    resumeThreadId,
    outputFile: tmpFile,
  });

  const childEnv = { ...process.env };
  if (stripCodexApiKey) {
    for (const k of Object.keys(childEnv)) {
      if (k.toUpperCase() === 'CODEX_API_KEY') delete childEnv[k];
    }
  }
  if (codexHome && codexHome.trim()) {
    childEnv.CODEX_HOME = codexHome.trim();
  }

  let cancelled = false;
  let child = null;

  const handle = {
    pid: null,
    abort: () => {
      cancelled = true;
      if (child) killProcessTree(child);
    },
  };
  if (onProcess) onProcess(handle);

  try {
    child = await spawnCliExecutable('codex', args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: childEnv,
    });
  } catch (err) {
    fs.unlink(tmpFile).catch(() => {});
    return {
      ok: false,
      exitCode: -1,
      text: '',
      threadId: resumeThreadId || null,
      usage: null,
      durationMs: Date.now() - startedAt,
      error: `无法启动 codex CLI：${err.message}`,
      _authError: false,
      _cancelled: cancelled,
      _timedOut: false,
    };
  }

  handle.pid = child.pid || null;
  registerActiveChild(child, { tmpFiles: [tmpFile] });

  if (cancelled) {
    killProcessTree(child);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      unregisterActiveChild(child);
      resolve(result);
    };

    if (child.stdin) {
      child.stdin.on('error', () => {});
      try {
        if (!child.stdin.destroyed) {
          child.stdin.write(String(prompt || ''), 'utf8');
          child.stdin.end();
        }
      } catch {
        // Ignore EPIPE / premature close
      }
    }

    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');
    let stdoutBuf = '';
    let stderrText = '';
    let threadId = resumeThreadId || null;
    let lastAgentText = '';
    let usage = null;
    const errorMessages = [];
    let authErrorDetected = false;
    let timedOut = false;

    const AUTH_ERR_RX = /401\s*Unauthorized|status\s*401|invalid_api_key|incorrect api key/i;

    const timer = timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          killProcessTree(child);
        }, timeoutMs)
      : null;

    const processLine = (line) => {
      if (cancelled || timedOut) return;
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
        threadId = parsed.thread_id || parsed.thread?.id || threadId;
        if (onEvent) {
          onEvent({
            source: 'codex',
            kind: 'init',
            threadId,
            sandbox: safeSandbox,
            allowCodexNetwork: enableNetwork,
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
          const txt = extractCodexText(item.text) || extractCodexText(item.content);
          if (txt) {
            lastAgentText = txt;
            if (onDelta) onDelta(txt, txt);
          }
        } else if (itemType === 'reasoning') {
          const txt = extractCodexText(item.text) || extractCodexText(item.summary);
          if (txt && onEvent) {
            onEvent({ source: 'codex', kind: 'reasoning', itemId: item.id || '', text: txt });
          }
        } else if (itemType === 'command_execution') {
          if (onEvent) {
            onEvent({
              source: 'codex',
              kind: 'command',
              itemId: item.id || '',
              command: item.command || '',
              status: item.status || parsed.type,
              exitCode: item.exit_code ?? null,
              output: (item.aggregated_output || '').slice(0, 1200),
            });
          }
        } else if (itemType === 'file_change') {
          if (onEvent) {
            onEvent({
              source: 'codex',
              kind: 'file_change',
              itemId: item.id || '',
              changes: item.changes || [],
              status: item.status || parsed.type,
            });
          }
        } else if (itemType === 'error') {
          const msg = item.message || 'Codex warning/error';
          if (AUTH_ERR_RX.test(msg)) authErrorDetected = true;
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
        if (AUTH_ERR_RX.test(msg)) authErrorDetected = true;
        errorMessages.push(msg);
        if (onEvent) onEvent({ source: 'codex', kind: 'error', text: msg });
      }
    };

    child.stdout.on('data', (chunk) => {
      stdoutBuf += stdoutDecoder.write(chunk);
      const lines = stdoutBuf.split(/\r?\n/);
      stdoutBuf = lines.pop() ?? '';
      for (const line of lines) processLine(line);
    });

    child.stderr.on('data', (chunk) => {
      const text = stderrDecoder.write(chunk);
      stderrText += text;
      if (AUTH_ERR_RX.test(text)) authErrorDetected = true;
      const clean = text.trim();
      if (clean && !cancelled && !timedOut && onEvent && !/failed to install system skills/i.test(clean)) {
        onEvent({ source: 'codex', kind: 'stderr', text: clean.slice(0, 400) });
      }
    });

    child.on('error', (err) => {
      if (err.code === 'ENOENT') resolvedExecCache.clear();
      fs.unlink(tmpFile).catch(() => {});
      finish({
        ok: false,
        exitCode: -1,
        text: '',
        threadId,
        usage,
        durationMs: Date.now() - startedAt,
        error: `无法启动 codex CLI：${err.message}`,
        _authError: false,
        _cancelled: cancelled,
        _timedOut: timedOut,
      });
    });

    child.on('close', (code) => {
      stdoutBuf += stdoutDecoder.end();
      stderrText += stderrDecoder.end();
      if (stdoutBuf.trim()) processLine(stdoutBuf);
      fs.readFile(tmpFile, 'utf8')
        .then((raw) => raw.trim())
        .catch(() => '')
        .finally(() => fs.unlink(tmpFile).catch(() => {}))
        .then((fileLastMsg) => {
          const finalText = fileLastMsg || lastAgentText;
          const ok = !cancelled && !timedOut && code === 0 && Boolean(finalText);
          let error = null;
          if (cancelled) {
            error = 'Codex 任务已被用户中止';
          } else if (timedOut) {
            error = `Codex 执行超过 ${Math.round(timeoutMs / 1000)}s 已自动超时终止`;
          } else if (authErrorDetected && !ok) {
            error = 'Codex 鉴权失败（401 Unauthorized / Invalid API Key）。请在上方配置中切换 CODEX_HOME 配置档，或检查当前 config.toml 中的 provider 与凭据。';
          } else if (!ok) {
            error = errorMessages[errorMessages.length - 1] || stderrText.trim().slice(0, 500) || `codex 异常退出 (code=${code})`;
          }

          finish({
            ok,
            exitCode: code,
            text: finalText,
            threadId,
            usage,
            durationMs: Date.now() - startedAt,
            error,
            _authError: authErrorDetected,
            _cancelled: cancelled,
            _timedOut: timedOut,
          });
        });
    });
  });
}

/**
 * Runs OpenAI Codex CLI (`codex exec --json` or `codex exec resume`) safely.
 * If an inherited stale `CODEX_API_KEY` env var triggers 401 Unauthorized,
 * automatically retries once without `CODEX_API_KEY` so local ChatGPT login works seamlessly.
 */
export async function runCodex(opts = {}) {
  const first = await runCodexOnce(opts, { stripCodexApiKey: false });
  if (!first.ok && !first._cancelled && !first._timedOut && first._authError && hasCodexApiKeyEnv(process.env)) {
    if (opts.onEvent) {
      opts.onEvent({
        source: 'codex',
        kind: 'warning',
        text: '检测到进程继承了失效的 CODEX_API_KEY 导致 401，已自动清除并回退至本机登录态重试',
      });
    }
    const retry = await runCodexOnce(opts, { stripCodexApiKey: true });
    delete retry._authError;
    delete retry._cancelled;
    delete retry._timedOut;
    return retry;
  }
  delete first._authError;
  delete first._cancelled;
  delete first._timedOut;
  return first;
}
