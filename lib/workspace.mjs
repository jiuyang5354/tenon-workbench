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

async function runGit(cwd, args, timeoutMs = 8000) {
  try {
    const { stdout, stderr } = await execFileAsync('git', ['-c', 'core.quotepath=false', ...args], {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
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
  const resolved = path.resolve(String(repoDir));
  const safeId = String(runId).replace(/[^a-zA-Z0-9_-]/g, '');
  const wtDir = path.join(os.tmpdir(), `conduit-wt-${safeId}`);
  const res = await runGit(resolved, ['worktree', 'add', '--detach', wtDir, 'HEAD'], 15_000);
  if (!res.ok) {
    return { ok: false, path: null, error: res.stderr || '创建 Git worktree 失败（请确认仓库至少有一次提交）' };
  }
  return { ok: true, path: wtDir, error: null };
}

export async function inspectWorkspace(targetDir) {
  const resolved = path.resolve(String(targetDir || process.cwd()));
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
    runGit(resolved, ['status', '--porcelain']),
  ]);

  const changedFiles = (statusRes.stdout || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const code = line.slice(0, 2).trim() || '??';
      const file = line.slice(3).trim();
      return { code, file };
    });

  const risk = classifyRiskFiles(changedFiles.map((c) => c.file));

  return {
    ok: true,
    path: resolved,
    exists: true,
    isGitRepo: true,
    branch: branchRes.ok ? branchRes.stdout.trim() : 'HEAD',
    changedFiles,
    highRiskFiles: risk.highRiskFiles,
    recommendedReviewEffort: risk.recommendedEffort,
    topFiles,
  };
}

async function buildUntrackedDiffs(repoDir, maxFiles = 15, maxFileBytes = 24_000) {
  const listRes = await runGit(repoDir, ['ls-files', '--others', '--exclude-standard']);
  if (!listRes.ok || !listRes.stdout.trim()) return '';
  const relPaths = listRes.stdout.split(/\r?\n/).filter(Boolean).slice(0, maxFiles);
  const blocks = [];

  for (const rel of relPaths) {
    const abs = path.resolve(repoDir, rel);
    if (!abs.startsWith(repoDir)) continue;
    try {
      const buf = await fs.readFile(abs);
      // Skip binary files containing NUL bytes
      if (buf.includes(0)) continue;
      const truncatedBuf = buf.length > maxFileBytes ? buf.subarray(0, maxFileBytes) : buf;
      const text = truncatedBuf.toString('utf8');
      const lines = text.split(/\r?\n/);
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
    } catch {
      // Skip unreadable file
    }
  }
  return blocks.join('\n');
}

export async function getWorkspaceDiff(targetDir, maxBytes = 140_000) {
  const resolved = path.resolve(String(targetDir || process.cwd()));
  const check = await runGit(resolved, ['rev-parse', '--is-inside-work-tree']);
  if (!check.ok || check.stdout.trim() !== 'true') {
    return { ok: true, isGitRepo: false, diff: '', stat: '', truncated: false };
  }

  const [unstaged, staged, statUnstaged, statStaged, untrackedDiff] = await Promise.all([
    runGit(resolved, ['diff', '--no-color']),
    runGit(resolved, ['diff', '--cached', '--no-color']),
    runGit(resolved, ['diff', '--stat', '--no-color']),
    runGit(resolved, ['diff', '--cached', '--stat', '--no-color']),
    buildUntrackedDiffs(resolved),
  ]);

  const parts = [];
  if (staged.stdout.trim()) parts.push(staged.stdout.trim());
  if (unstaged.stdout.trim()) parts.push(unstaged.stdout.trim());
  if (untrackedDiff.trim()) parts.push(untrackedDiff.trim());
  let combined = parts.join('\n');

  const statCombined = [statStaged.stdout.trim(), statUnstaged.stdout.trim()].filter(Boolean).join('\n');

  let truncated = false;
  if (combined.length > maxBytes) {
    combined = combined.slice(0, maxBytes) + '\n\n... [Diff 输出超过 140KB，已截断] ...';
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
