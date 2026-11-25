import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * High-risk file patterns that trigger automatic escalation of Codex review
 * reasoning effort from `high` to `xhigh`.
 */
export const HIGH_RISK_PATTERNS = [
  /auth|login|oauth|jwt|session|token|credential|secret/i,
  /perm|rbac|acl|role|policy|guard/i,
  /pay|billing|invoice|price|money|ledger|order|refund|wallet|balance/i,
  /feishu|lark|slack|webhook|notify|email|sms|mail|broadcast/i,
  /deploy|nginx|waf|cdn|docker|k8s|github[\\/]+workflows|migration/i,
];

export function classifyRiskFiles(filePaths = []) {
  const highRiskFiles = [];
  for (const raw of filePaths) {
    const file = String(raw || '').trim();
    if (!file) continue;
    const matched = HIGH_RISK_PATTERNS.some((rx) => rx.test(file));
    if (matched) highRiskFiles.push(file);
  }
  return {
    highRiskFiles,
    recommendedEffort: highRiskFiles.length > 0 ? 'xhigh' : 'high',
  };
}

function stripWinVerbatimPrefix(p) {
  if (process.platform !== 'win32' || typeof p !== 'string') return p;
  if (/^\\\\\?\\UNC\\/i.test(p)) return `\\\\${p.slice(8)}`;
  if (/^\\\\\?\\[A-Za-z]:[\\/]/.test(p)) return p.slice(4);
  return p;
}

function normalizePathKey(p) {
  const resolved = path.resolve(stripWinVerbatimPrefix(String(p || '')));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isPathInside(baseDir, candidate) {
  const baseKey = normalizePathKey(baseDir);
  const candKey = normalizePathKey(candidate);
  if (candKey === baseKey) return true;
  const prefix = baseKey.endsWith(path.sep) ? baseKey : `${baseKey}${path.sep}`;
  return candKey.startsWith(prefix);
}

function parsePorcelainZ(stdout = '') {
  const tokens = String(stdout || '').split('\0');
  const out = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const entry = tokens[i];
    if (!entry || entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    const code = xy.trim() || '??';
    const file = entry.slice(3);
    out.push({ code, file });
    // Rename/copy records carry an extra NUL-terminated original path right after the new path
    if (xy[0] === 'R' || xy[0] === 'C' || xy[1] === 'R' || xy[1] === 'C') {
      i += 1;
    }
  }
  return out;
}

async function mapWithConcurrency(items, limit, worker) {
  const concurrency = Math.max(1, Number(limit) || 1);
  const results = new Array(items.length);
  let cursor = 0;

  async function next() {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      results[idx] = await worker(items[idx], idx);
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => next());
  await Promise.all(runners);
  return results;
}

async function runGit(cwd, args, timeoutMs = 8000) {
  try {
    const { stdout, stderr } = await execFileAsync('git', ['-c', 'core.quotepath=false', ...args], {
      cwd,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return { ok: true, stdout: stdout || '', stderr: stderr || '' };
  } catch (err) {
    return {
      ok: false,
      stdout: err.stdout || '',
      stderr: err.stderr || err.message || 'git execution failed',
    };
  }
}

/**
 * Creates an explicit managed detached Git worktree so diff, risk inspection,
 * and Pre-CI review all operate on the exact same isolated directory.
 */
export async function createManagedWorktree(repoDir, runId) {
  const resolved = path.resolve(stripWinVerbatimPrefix(String(repoDir)));
  const headCheck = await runGit(resolved, ['rev-parse', '--verify', 'HEAD'], 5000);
  if (!headCheck.ok) {
    return {
      ok: false,
      path: null,
      error: '当前 Git 仓库尚未产生首次提交，无法创建隔离 Worktree（请先提交一次或关闭隔离 Worktree）',
    };
  }

  // Prune stale temp worktree metadata left behind by prior OS reboots/cleanups
  await runGit(resolved, ['worktree', 'prune'], 5000);

  const safeId = String(runId || '').replace(/[^a-zA-Z0-9_-]/g, '') || Date.now().toString(36);
  const wtDir = path.join(os.tmpdir(), `conduit-wt-${safeId}`);
  const res = await runGit(resolved, ['worktree', 'add', '--detach', wtDir, 'HEAD'], 15_000);
  if (!res.ok) {
    return { ok: false, path: null, error: res.stderr || '创建 Git worktree 失败（请确认仓库至少有一次提交）' };
  }
  return { ok: true, path: wtDir, error: null };
}

/**
 * Safely removes a previously created managed temporary worktree under os.tmpdir().
 */
export async function removeManagedWorktree(repoDir, wtDir) {
  if (!wtDir) return { ok: false, reason: 'missing path' };
  const resolvedWt = path.resolve(stripWinVerbatimPrefix(String(wtDir)));
  const tmpRoot = path.resolve(os.tmpdir());
  const baseName = path.basename(resolvedWt);
  if (
    !isPathInside(tmpRoot, resolvedWt) ||
    normalizePathKey(resolvedWt) === normalizePathKey(tmpRoot) ||
    !baseName.startsWith('conduit-wt-')
  ) {
    return { ok: false, reason: 'refused unmanaged worktree path' };
  }

  const resolvedRepo = repoDir ? path.resolve(stripWinVerbatimPrefix(String(repoDir))) : '';
  if (resolvedRepo) {
    await runGit(resolvedRepo, ['worktree', 'remove', '--force', resolvedWt], 10_000);
  }
  await fs.rm(resolvedWt, { recursive: true, force: true }).catch(() => {});
  if (resolvedRepo) {
    await runGit(resolvedRepo, ['worktree', 'prune'], 5000);
  }
  return { ok: true };
}

export async function inspectWorkspace(targetDir) {
  const resolved = path.resolve(stripWinVerbatimPrefix(String(targetDir || process.cwd())));
  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    return {
      ok: false,
      path: resolved,
      exists: false,
      isGitRepo: false,
      error: '目录不存在或无法访问',
    };
  }

  if (!stat.isDirectory()) {
    return {
      ok: false,
      path: resolved,
      exists: true,
      isGitRepo: false,
      error: '指定路径不是文件夹',
    };
  }

  const entries = await fs.readdir(resolved, { withFileTypes: true }).catch(() => []);
  const topFiles = entries
    .filter((e) => !e.name.startsWith('.git') && e.name !== 'node_modules')
    .slice(0, 40)
    .map((e) => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }));

  const revParse = await runGit(resolved, ['rev-parse', '--is-inside-work-tree']);
  const isGitRepo = revParse.ok && revParse.stdout.trim() === 'true';

  if (!isGitRepo) {
    return {
      ok: true,
      path: resolved,
      exists: true,
      isGitRepo: false,
      branch: null,
      changedFiles: [],
      highRiskFiles: [],
      recommendedReviewEffort: 'high',
      topFiles,
    };
  }

  const [branchRes, statusRes] = await Promise.all([
    runGit(resolved, ['rev-parse', '--abbrev-ref', 'HEAD']),
    runGit(resolved, ['status', '--porcelain', '-z', '--ignore-submodules=all']),
  ]);

  let branchName = branchRes.ok ? branchRes.stdout.trim() : '';
  const hasCommits = branchRes.ok;
  if (!branchName) {
    const sym = await runGit(resolved, ['symbolic-ref', '--short', 'HEAD']);
    branchName = sym.ok ? sym.stdout.trim() : 'HEAD';
  }

  const changedFiles = parsePorcelainZ(statusRes.stdout);

  const risk = classifyRiskFiles(changedFiles.map((c) => c.file));

  return {
    ok: true,
    path: resolved,
    exists: true,
    isGitRepo: true,
    hasCommits,
    branch: branchName,
    changedFiles,
    highRiskFiles: risk.highRiskFiles,
    recommendedReviewEffort: risk.recommendedEffort,
    topFiles,
  };
}

async function readBoundedTextFile(absPath, maxFileBytes = 24_000) {
  let fh;
  try {
    const st = await fs.stat(absPath);
    if (!st.isFile()) return null;
    if (st.size === 0) return { text: '', truncated: false };
    const readLen = Math.min(st.size, maxFileBytes + 1);
    fh = await fs.open(absPath, 'r');
    const buf = Buffer.allocUnsafe(readLen);
    const { bytesRead } = await fh.read(buf, 0, readLen, 0);
    const slice = buf.subarray(0, bytesRead);
    // Skip binary files containing NUL bytes in header/read slice
    if (slice.subarray(0, Math.min(slice.length, 8192)).includes(0)) return null;
    const truncated = st.size > maxFileBytes || bytesRead > maxFileBytes;
    const textBuf = slice.length > maxFileBytes ? slice.subarray(0, maxFileBytes) : slice;
    return { text: textBuf.toString('utf8'), truncated };
  } catch {
    return null;
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

async function buildUntrackedDiffs(repoDir, maxFiles = 15, maxFileBytes = 24_000) {
  const listRes = await runGit(repoDir, ['ls-files', '--others', '--exclude-standard', '-z']);
  if (!listRes.ok || !listRes.stdout) return '';
  const relPaths = listRes.stdout.split('\0').filter(Boolean).slice(0, maxFiles);
  const blocks = [];

  for (const rel of relPaths) {
    const abs = path.resolve(repoDir, rel);
    if (!isPathInside(repoDir, abs)) continue;
    const loaded = await readBoundedTextFile(abs, maxFileBytes);
    if (!loaded) continue;
    const lines = loaded.text.split(/\r?\n/);
    if (loaded.truncated) {
      lines.push(`... [未跟踪文件超过 ${Math.round(maxFileBytes / 1000)}KB，已截断] ...`);
    }
    const posixRel = rel.replace(/\\/g, '/');
    const body = lines.map((l) => `+${l}`).join('\n');
    blocks.push(
      [
        `diff --git a/${posixRel} b/${posixRel}`,
        'new file mode 100644',
        '--- /dev/null',
        `+++ b/${posixRel}`,
        `@@ -0,0 +1,${lines.length} @@`,
        body,
      ].join('\n')
    );
  }
  return blocks.join('\n');
}

const GIT_EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export async function getWorkspaceDiff(targetDir, maxBytes = 140_000) {
  const resolved = path.resolve(stripWinVerbatimPrefix(String(targetDir || process.cwd())));
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    return { ok: true, isGitRepo: false, diff: '', stat: '', truncated: false };
  }

  const check = await runGit(resolved, ['rev-parse', '--is-inside-work-tree']);
  if (!check.ok || check.stdout.trim() !== 'true') {
    return { ok: true, isGitRepo: false, diff: '', stat: '', truncated: false };
  }

  const [unstaged, stagedInitial, statUnstaged, statStagedInitial, untrackedDiff] = await Promise.all([
    runGit(resolved, ['diff', '--no-color']),
    runGit(resolved, ['diff', '--cached', '--no-color']),
    runGit(resolved, ['diff', '--stat', '--no-color']),
    runGit(resolved, ['diff', '--cached', '--stat', '--no-color']),
    buildUntrackedDiffs(resolved),
  ]);

  // Fallback for unborn HEAD on older Git builds where `git diff --cached` requires explicit empty tree
  const staged = stagedInitial.ok
    ? stagedInitial
    : await runGit(resolved, ['diff', '--cached', GIT_EMPTY_TREE, '--no-color']);
  const statStaged = statStagedInitial.ok
    ? statStagedInitial
    : await runGit(resolved, ['diff', '--cached', GIT_EMPTY_TREE, '--stat', '--no-color']);

  const parts = [];
  if (staged.stdout.trim()) parts.push(staged.stdout.trim());
  if (unstaged.stdout.trim()) parts.push(unstaged.stdout.trim());
  if (untrackedDiff.trim()) parts.push(untrackedDiff.trim());
  let combined = parts.join('\n');

  const statCombined = [statStaged.stdout.trim(), statUnstaged.stdout.trim()].filter(Boolean).join('\n');

  let truncated = false;
  if (combined.length > maxBytes) {
    combined = combined.slice(0, maxBytes) + `\n\n... [Diff 输出超过 ${Math.round(maxBytes / 1000)}KB，已截断] ...`;
    truncated = true;
  }

  return {
    ok: true,
    isGitRepo: true,
    diff: combined.trim(),
    stat: statCombined,
    truncated,
  };
}

/* =========================================================================
   Automatic Agent & Local Git Workspace Discovery
   Reads ONLY non-secret path metadata (session cwd, workspace roots, project
   paths) — NEVER accesses auth.json, tokens, credentials, or .env files.
   ========================================================================= */

const DISCOVERY_NOISE_PATTERNS = [
  /[\\/]appdata[\\/](roaming|local|locallow)(?:[\\/]|$)/i,
  /[\\/](program files|program files \(x86\)|windows|programdata)(?:[\\/]|$)/i,
  /[\\/]node_modules(?:[\\/]|$)/i,
  /[\\/]\.(codex|claude|gemini|git|cache|npm|pnpm-store)(?:[\\/]|$)/i,
  /\.asar(?:\.unpacked)?(?:[\\/]|$)/i,
];

function isFilesystemRoot(resolved) {
  const parsed = path.parse(resolved);
  return normalizePathKey(parsed.root) === normalizePathKey(resolved);
}

function isIgnoredWorkspacePath(resolved, homeDir, tmpDir, noisePatterns = DISCOVERY_NOISE_PATTERNS) {
  if (!resolved) return true;
  if (isFilesystemRoot(resolved)) return true;
  const norm = normalizePathKey(resolved);
  if (homeDir && norm === normalizePathKey(homeDir)) return true;
  if (tmpDir && isPathInside(tmpDir, resolved)) return true;
  return noisePatterns.some((rx) => rx.test(resolved));
}

function isSafeScanRoot(resolved, homeDir, tmpDir, noisePatterns = DISCOVERY_NOISE_PATTERNS) {
  if (isIgnoredWorkspacePath(resolved, homeDir, tmpDir, noisePatterns)) return false;
  return true;
}

async function readHeadText(filePath, maxBytes = 8192) {
  let fh;
  try {
    fh = await fs.open(filePath, 'r');
    const buf = Buffer.allocUnsafe(maxBytes);
    const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } catch {
    return '';
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

async function readTailText(filePath, maxBytes = 131_072) {
  let fh;
  try {
    fh = await fs.open(filePath, 'r');
    const st = await fh.stat();
    const size = Math.min(st.size, maxBytes);
    if (size <= 0) return '';
    const buf = Buffer.allocUnsafe(size);
    const { bytesRead } = await fh.read(buf, 0, size, Math.max(0, st.size - size));
    return buf.subarray(0, bytesRead).toString('utf8');
  } catch {
    return '';
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

async function collectRecentJsonlFiles(dir, maxDepth = 4, depth = 0, out = [], maxFiles = 500) {
  if (depth > maxDepth || out.length >= maxFiles) return out;
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const ent of entries) {
    if (out.length >= maxFiles) break;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      await collectRecentJsonlFiles(full, maxDepth, depth + 1, out, maxFiles);
    } else if (ent.isFile() && ent.name.endsWith('.jsonl')) {
      const st = await fs.stat(full).catch(() => null);
      if (st) out.push({ path: full, mtimeMs: st.mtimeMs });
    }
  }
  return out;
}

function addCandidate(map, rawPath, { source, timestamp = 0, active = false, homeDir, tmpDir, noisePatterns }) {
  if (typeof rawPath !== 'string') return;
  const trimmed = stripWinVerbatimPrefix(rawPath.trim());
  if (!trimmed || !path.isAbsolute(trimmed)) return;
  const resolved = path.resolve(trimmed);
  if (isIgnoredWorkspacePath(resolved, homeDir, tmpDir, noisePatterns)) return;

  const key = normalizePathKey(resolved);
  let entry = map.get(key);
  if (!entry) {
    entry = {
      path: resolved,
      name: path.basename(resolved) || resolved,
      sources: new Set(),
      lastActiveAt: 0,
      activeAgent: false,
    };
    map.set(key, entry);
  }
  if (source) entry.sources.add(source);
  const ts = Number(timestamp) || 0;
  if (ts > entry.lastActiveAt) entry.lastActiveAt = ts;
  if (active) entry.activeAgent = true;
}

async function collectCodexWorkspaces(map, codexHome, homeDir, tmpDir, noisePatterns) {
  if (!codexHome) return;

  // 1. Codex global state (active & saved workspace roots — non-secret UI state)
  const statePath = path.join(codexHome, '.codex-global-state.json');
  try {
    const raw = await fs.readFile(statePath, 'utf8');
    const st = await fs.stat(statePath).catch(() => null);
    const mtime = st ? st.mtimeMs : Date.now();
    const state = JSON.parse(raw);
    const activeRoots = Array.isArray(state['active-workspace-roots']) ? state['active-workspace-roots'] : [];
    const savedRoots = [
      ...(Array.isArray(state['electron-saved-workspace-roots']) ? state['electron-saved-workspace-roots'] : []),
      ...(Array.isArray(state['project-order']) ? state['project-order'] : []),
    ];
    for (const root of activeRoots) {
      addCandidate(map, root, { source: 'codex', timestamp: mtime, active: true, homeDir, tmpDir, noisePatterns });
    }
    for (const root of savedRoots) {
      addCandidate(map, root, { source: 'codex', timestamp: Math.max(0, mtime - 1000), active: false, homeDir, tmpDir, noisePatterns });
    }
  } catch {
    // No codex global state file
  }

  // 2. Codex CLI recent rollout sessions (line 1 session_meta.cwd only)
  const sessionsDir = path.join(codexHome, 'sessions');
  const files = await collectRecentJsonlFiles(sessionsDir, 4);
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const file of files.slice(0, 20)) {
    const head = await readHeadText(file.path, 8192);
    const firstLine = head.split(/\r?\n/)[0];
    if (!firstLine) continue;
    try {
      const obj = JSON.parse(firstLine);
      const payload = obj?.payload && typeof obj.payload === 'object' ? obj.payload : obj;
      const ts = Date.parse(payload?.timestamp || obj?.timestamp || '') || file.mtimeMs;
      if (typeof payload?.cwd === 'string') {
        addCandidate(map, payload.cwd, { source: 'codex', timestamp: ts, homeDir, tmpDir, noisePatterns });
      }
      if (Array.isArray(payload?.runtime_workspace_roots)) {
        for (const r of payload.runtime_workspace_roots) {
          addCandidate(map, r, { source: 'codex', timestamp: ts, homeDir, tmpDir, noisePatterns });
        }
      }
    } catch {
      // Skip malformed line
    }
  }
}

async function collectClaudeWorkspaces(map, claudeDir, claudeJsonPath, homeDir, tmpDir, noisePatterns) {
  // 1. ~/.claude/history.jsonl (tail 128KB — extract only `project` and `timestamp`)
  if (claudeDir) {
    const histPath = path.join(claudeDir, 'history.jsonl');
    const tail = await readTailText(histPath, 131_072);
    if (tail) {
      const lines = tail.split(/\r?\n/);
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const line = lines[i].trim();
        if (!line || !line.startsWith('{')) continue;
        try {
          const obj = JSON.parse(line);
          if (typeof obj?.project === 'string') {
            addCandidate(map, obj.project, {
              source: 'claude',
              timestamp: Number(obj.timestamp) || 0,
              homeDir,
              tmpDir,
              noisePatterns,
            });
          }
        } catch {
          // Partial first line when tail-reading is expected; ignore
        }
      }
    }
  }

  // 2. ~/.claude.json (extract ONLY top-level `projects` keys — never read other fields)
  if (claudeJsonPath) {
    try {
      const raw = await fs.readFile(claudeJsonPath, 'utf8');
      const st = await fs.stat(claudeJsonPath).catch(() => null);
      const data = JSON.parse(raw);
      if (data?.projects && typeof data.projects === 'object') {
        for (const projPath of Object.keys(data.projects)) {
          addCandidate(map, projPath, {
            source: 'claude',
            timestamp: st ? st.mtimeMs - 60_000 : 0,
            homeDir,
            tmpDir,
            noisePatterns,
          });
        }
      }
    } catch {
      // No .claude.json
    }
  }
}

async function collectGeminiWorkspaces(map, geminiDir, homeDir, tmpDir, noisePatterns) {
  if (!geminiDir) return;
  const projectsFile = path.join(geminiDir, 'projects.json');
  try {
    const raw = await fs.readFile(projectsFile, 'utf8');
    const st = await fs.stat(projectsFile).catch(() => null);
    const data = JSON.parse(raw);
    const paths = [];
    if (Array.isArray(data)) {
      for (const item of data) {
        if (typeof item === 'string') paths.push(item);
        else if (item && typeof item.path === 'string') paths.push(item.path);
      }
    } else if (data?.projects && typeof data.projects === 'object') {
      paths.push(...Object.keys(data.projects));
    }
    for (const p of paths) {
      addCandidate(map, p, { source: 'gemini', timestamp: st ? st.mtimeMs : 0, homeDir, tmpDir, noisePatterns });
    }
  } catch {
    // Optional file
  }
}

async function scanGitChildren(map, rootDir, homeDir, tmpDir, noisePatterns) {
  if (!rootDir) return;
  const resolvedRoot = path.resolve(rootDir);
  if (!isSafeScanRoot(resolvedRoot, homeDir, tmpDir, noisePatterns)) return;

  // Check if root itself is a Git repo
  const rootGit = await fs.stat(path.join(resolvedRoot, '.git')).catch(() => null);
  if (rootGit) {
    const rootStat = await fs.stat(resolvedRoot).catch(() => null);
    addCandidate(map, resolvedRoot, {
      source: 'git',
      timestamp: Math.max(rootGit.mtimeMs || 0, rootStat?.mtimeMs || 0),
      homeDir,
      tmpDir,
      noisePatterns,
    });
  }

  // Scan direct child directories for `.git`
  const entries = await fs.readdir(resolvedRoot, { withFileTypes: true }).catch(() => []);
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (ent.name.startsWith('.') || ent.name === 'node_modules' || ent.name === 'dist') continue;
    const childDir = path.join(resolvedRoot, ent.name);
    const gitStat = await fs.stat(path.join(childDir, '.git')).catch(() => null);
    if (!gitStat) continue;
    const dirStat = await fs.stat(childDir).catch(() => null);
    addCandidate(map, childDir, {
      source: 'git',
      timestamp: Math.max(gitStat.mtimeMs || 0, dirStat?.mtimeMs || 0),
      homeDir,
      tmpDir,
      noisePatterns,
    });
  }
}

async function probeWorkspaceQuick(entry) {
  let stat;
  try {
    stat = await fs.stat(entry.path);
    if (!stat.isDirectory()) return null;
  } catch {
    return null;
  }

  const revParse = await runGit(entry.path, ['rev-parse', '--is-inside-work-tree'], 2500);
  const isGitRepo = revParse.ok && revParse.stdout.trim() === 'true';

  if (!isGitRepo) {
    return {
      path: entry.path,
      name: entry.name,
      isGitRepo: false,
      branch: null,
      changedCount: 0,
      highRiskCount: 0,
      sources: Array.from(entry.sources),
      activeAgent: entry.activeAgent,
      lastActiveAt: entry.lastActiveAt || stat.mtimeMs,
    };
  }

  const [branchRes, statusRes] = await Promise.all([
    runGit(entry.path, ['rev-parse', '--abbrev-ref', 'HEAD'], 2500),
    runGit(entry.path, ['status', '--porcelain', '-z', '--ignore-submodules=all'], 2500),
  ]);

  let branchName = branchRes.ok ? branchRes.stdout.trim() : '';
  const hasCommits = branchRes.ok;
  if (!branchName) {
    const sym = await runGit(entry.path, ['symbolic-ref', '--short', 'HEAD'], 2000);
    branchName = sym.ok ? sym.stdout.trim() : 'HEAD';
  }

  const changedFiles = parsePorcelainZ(statusRes.stdout).map((item) => item.file);
  const risk = classifyRiskFiles(changedFiles);

  return {
    path: entry.path,
    name: entry.name,
    isGitRepo: true,
    hasCommits,
    branch: branchName,
    changedCount: changedFiles.length,
    highRiskCount: risk.highRiskFiles.length,
    sources: Array.from(entry.sources),
    activeAgent: entry.activeAgent,
    lastActiveAt: entry.lastActiveAt || stat.mtimeMs,
  };
}

function hasAgentSource(ws) {
  return ws.sources.some((s) => s === 'codex' || s === 'claude' || s === 'gemini' || s === 'tenon');
}

function rankDiscoveredWorkspace(ws) {
  const isAgent = hasAgentSource(ws);
  let score = 0;
  if (ws.activeAgent) score += 1600;
  if (isAgent) score += 1200;
  if (ws.isGitRepo) score += 700;
  if (ws.hasCommits) score += 450;
  if (ws.sources.includes('tenon')) score += 300;
  if (ws.changedCount > 0) score += 220;
  if (ws.highRiskCount > 0) score += 40;
  return score;
}

function uniqueDirs(list) {
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const resolved = path.resolve(raw.trim());
    const key = normalizePathKey(resolved);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(resolved);
  }
  return out;
}

/**
 * Automatically discovers active local Agent working directories (Codex, Claude Code,
 * Gemini CLI, previous TENON runs) and nearby local Git repositories.
 */
export async function discoverWorkspaces(options = {}) {
  const homeDir = options.homeDir ?? os.homedir();
  const tmpDir = options.tmpDir ?? os.tmpdir();
  const noisePatterns = Array.isArray(options.noisePatterns) ? options.noisePatterns : DISCOVERY_NOISE_PATTERNS;

  // Support both custom env homes (e.g. CODEX_HOME) and default ~/.codex / ~/.claude
  const codexHomes = options.codexHome !== undefined
    ? uniqueDirs(Array.isArray(options.codexHome) ? options.codexHome : [options.codexHome])
    : uniqueDirs([process.env.CODEX_HOME, homeDir ? path.join(homeDir, '.codex') : '']);

  const claudeDirs = options.claudeDir !== undefined
    ? uniqueDirs(Array.isArray(options.claudeDir) ? options.claudeDir : [options.claudeDir])
    : uniqueDirs([process.env.CLAUDE_CONFIG_DIR, homeDir ? path.join(homeDir, '.claude') : '']);

  const claudeJsonPath = options.claudeJsonPath !== undefined
    ? options.claudeJsonPath
    : (homeDir ? path.join(homeDir, '.claude.json') : '');

  const geminiDir = options.geminiDir !== undefined
    ? options.geminiDir
    : (homeDir ? path.join(homeDir, '.gemini') : '');

  const maxResults = Math.max(1, Math.min(40, Number(options.maxResults) || 24));

  const map = new Map();

  // 1. Collect from all local Agent metadata directories (non-secret path fields only)
  await Promise.all([
    ...codexHomes.map((dir) => collectCodexWorkspaces(map, dir, homeDir, tmpDir, noisePatterns)),
    ...claudeDirs.map((dir, idx) =>
      collectClaudeWorkspaces(map, dir, idx === 0 ? claudeJsonPath : '', homeDir, tmpDir, noisePatterns)
    ),
    ...(claudeDirs.length === 0 && claudeJsonPath
      ? [collectClaudeWorkspaces(map, '', claudeJsonPath, homeDir, tmpDir, noisePatterns)]
      : []),
    collectGeminiWorkspaces(map, geminiDir, homeDir, tmpDir, noisePatterns),
  ]);

  // 2. Collect from previous TENON runs
  for (const rec of options.recentRunDirs || []) {
    const dir = typeof rec === 'string' ? rec : rec?.path;
    const ts = typeof rec === 'object' ? (Date.parse(rec?.timestamp || '') || Number(rec?.timestamp) || 0) : 0;
    addCandidate(map, dir, { source: 'tenon', timestamp: ts, homeDir, tmpDir, noisePatterns });
  }

  // 3. Scan explicit scanRoots + discovered Agent folders for child Git repos (case-insensitive dedup on Windows)
  const scanRootsMap = new Map();
  const addScanRoot = (raw) => {
    if (typeof raw !== 'string' || !raw.trim()) return;
    const cleaned = stripWinVerbatimPrefix(raw.trim());
    if (!path.isAbsolute(cleaned)) return;
    const resolved = path.resolve(cleaned);
    if (!isSafeScanRoot(resolved, homeDir, tmpDir, noisePatterns)) return;
    const key = normalizePathKey(resolved);
    if (!scanRootsMap.has(key)) scanRootsMap.set(key, resolved);
  };
  for (const r of options.scanRoots || []) addScanRoot(r);
  for (const cand of map.values()) addScanRoot(cand.path);

  await mapWithConcurrency(
    Array.from(scanRootsMap.values()).slice(0, 14),
    4,
    (root) => scanGitChildren(map, root, homeDir, tmpDir, noisePatterns)
  );

  // 4. Pre-sort candidates so Agent paths are always probed before plain Git scans
  const preSorted = Array.from(map.values()).sort((a, b) => {
    const aActive = a.activeAgent ? 1 : 0;
    const bActive = b.activeAgent ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    const aAgent = Array.from(a.sources).some((s) => s !== 'git') ? 1 : 0;
    const bAgent = Array.from(b.sources).some((s) => s !== 'git') ? 1 : 0;
    if (aAgent !== bAgent) return bAgent - aAgent;
    return (b.lastActiveAt || 0) - (a.lastActiveAt || 0);
  });

  const probed = (await mapWithConcurrency(preSorted.slice(0, maxResults + 8), 6, probeWorkspaceQuick))
    .filter(Boolean);

  // 5. Final smart ranking (Agent + Git first, then Agent non-Git & dirty Git repos)
  probed.sort((a, b) => {
    const scoreDiff = rankDiscoveredWorkspace(b) - rankDiscoveredWorkspace(a);
    if (scoreDiff !== 0) return scoreDiff;
    return (b.lastActiveAt || 0) - (a.lastActiveAt || 0);
  });

  const workspaces = probed.slice(0, maxResults);
  const recommended =
    workspaces.find((w) => w.isGitRepo && w.hasCommits && hasAgentSource(w)) ||
    workspaces.find((w) => w.isGitRepo && w.hasCommits) ||
    workspaces.find((w) => w.isGitRepo && hasAgentSource(w)) ||
    workspaces.find((w) => w.isGitRepo) ||
    workspaces[0] ||
    null;

  const summary = {
    total: workspaces.length,
    git: workspaces.filter((w) => w.isGitRepo).length,
    codex: workspaces.filter((w) => w.sources.includes('codex')).length,
    claude: workspaces.filter((w) => w.sources.includes('claude')).length,
    gemini: workspaces.filter((w) => w.sources.includes('gemini')).length,
    tenon: workspaces.filter((w) => w.sources.includes('tenon')).length,
  };

  return {
    ok: true,
    recommended: recommended ? recommended.path : null,
    recommendedInfo: recommended,
    workspaces,
    summary,
    scannedAt: new Date().toISOString(),
  };
}

const INVALID_FOLDER_CHARS = /[<>:"/\\|?*\x00-\x1f]/;
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

function formatLocalDateStamp(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Safely creates a new local project directory with optional date suffix,
 * starter README/.gitignore, and Git repository initialization + initial commit.
 */
export async function createWorkspaceProject({
  parentDir,
  name,
  appendDate = true,
  initGit = true,
  createReadme = true,
} = {}) {
  const rawName = String(name || '').trim();
  if (!rawName) {
    const err = new Error('请输入工程名称');
    err.statusCode = 400;
    throw err;
  }
  if (rawName.length > 120) {
    const err = new Error('工程名称过长（最多 120 个字符）');
    err.statusCode = 400;
    throw err;
  }
  if (
    rawName === '.' ||
    rawName === '..' ||
    rawName.includes('..') ||
    INVALID_FOLDER_CHARS.test(rawName) ||
    WINDOWS_RESERVED_NAMES.test(rawName) ||
    /[.\s]$/.test(rawName)
  ) {
    const err = new Error('工程名称包含非法路径字符或保留文件名');
    err.statusCode = 400;
    throw err;
  }

  const rawParent = stripWinVerbatimPrefix(String(parentDir || '').trim());
  if (!rawParent || !path.isAbsolute(rawParent)) {
    const err = new Error('请指定有效的本地绝对路径作为存放父目录');
    err.statusCode = 400;
    throw err;
  }
  const resolvedParent = path.resolve(rawParent);
  let parentStat;
  try {
    parentStat = await fs.stat(resolvedParent);
  } catch {
    const err = new Error(`父目录不存在：${resolvedParent}`);
    err.statusCode = 400;
    throw err;
  }
  if (!parentStat.isDirectory()) {
    const err = new Error('指定的存放路径不是文件夹');
    err.statusCode = 400;
    throw err;
  }

  const hasDateSuffix = /_\d{4}-\d{2}-\d{2}$/.test(rawName);
  const folderName = appendDate && !hasDateSuffix ? `${rawName}_${formatLocalDateStamp()}` : rawName;
  const targetDir = path.resolve(resolvedParent, folderName);

  // Strict containment check
  const parentKey = normalizePathKey(resolvedParent);
  const targetKey = normalizePathKey(targetDir);
  const parentPrefix = parentKey.endsWith(path.sep) ? parentKey : `${parentKey}${path.sep}`;
  if (!targetKey.startsWith(parentPrefix)) {
    const err = new Error('目标路径越界，已拒绝创建');
    err.statusCode = 400;
    throw err;
  }

  // Never overwrite an existing directory or file
  const existing = await fs.stat(targetDir).catch(() => null);
  if (existing) {
    const err = new Error(`目标目录已存在：${folderName}`);
    err.statusCode = 409;
    throw err;
  }

  try {
    await fs.mkdir(targetDir, { recursive: false });
  } catch (mkdirErr) {
    if (mkdirErr?.code === 'EEXIST') {
      const err = new Error(`目标目录已存在：${folderName}`);
      err.statusCode = 409;
      throw err;
    }
    if (mkdirErr?.code === 'ENAMETOOLONG') {
      const err = new Error('目标路径超过操作系统长度限制，请缩短工程名称或选择更浅的父目录');
      err.statusCode = 400;
      throw err;
    }
    if (mkdirErr?.code === 'EACCES' || mkdirErr?.code === 'EPERM' || mkdirErr?.code === 'EROFS') {
      const err = new Error(`父目录不可写或无权限：${resolvedParent}`);
      err.statusCode = 403;
      throw err;
    }
    throw mkdirErr;
  }

  const createdFiles = [];
  if (createReadme) {
    const readmeBody = `# ${rawName}\n\n> Created by TENON（榫）多模型协同工作台 · ${formatLocalDateStamp()}\n`;
    const gitignoreBody = [
      'node_modules/',
      'dist/',
      '.env',
      '.env.local',
      '.DS_Store',
      'Thumbs.db',
      '',
    ].join('\n');
    await Promise.all([
      fs.writeFile(path.join(targetDir, 'README.md'), readmeBody, 'utf8'),
      fs.writeFile(path.join(targetDir, '.gitignore'), gitignoreBody, 'utf8'),
    ]);
    createdFiles.push('README.md', '.gitignore');
  }

  let gitInitialized = false;
  let gitWarning = null;
  if (initGit) {
    let initRes = await runGit(targetDir, ['init', '-b', 'main'], 8000);
    if (!initRes.ok) {
      initRes = await runGit(targetDir, ['init'], 8000);
    }
    if (initRes.ok) {
      gitInitialized = true;
      if (createdFiles.length > 0) {
        const addRes = await runGit(targetDir, ['add', '.'], 8000);
        let commitRes = addRes.ok
          ? await runGit(targetDir, ['commit', '-m', 'chore: initial project scaffold'], 8000)
          : addRes;
        if (!commitRes.ok && addRes.ok) {
          commitRes = await runGit(
            targetDir,
            [
              '-c',
              'user.name=TENON',
              '-c',
              'user.email=tenon@local',
              '-c',
              'commit.gpgsign=false',
              'commit',
              '-m',
              'chore: initial project scaffold',
            ],
            8000
          );
        }
        if (!commitRes.ok) {
          gitWarning = '已初始化 Git，但首个提交未完成';
        }
      }
    } else {
      gitWarning = initRes.stderr || 'Git 初始化失败';
    }
  }

  const info = await inspectWorkspace(targetDir);
  return {
    ok: true,
    path: targetDir,
    name: folderName,
    createdFiles,
    gitInitialized,
    gitWarning,
    workspace: info,
  };
}
