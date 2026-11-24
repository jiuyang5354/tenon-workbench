#!/usr/bin/env node
/**
 * codex-worker.mjs — 独立命令行工具：安全封装 `codex exec` / `codex exec resume`。
 *
 * 强制使用 `--sandbox workspace-write`（绝不使用默认全权限），支持 `--worktree` 隔离、
 * `--resume <threadId>` 续跑以及 `--codex-home` 配置切换。
 */
import path from 'node:path';
import { runCodex } from '../lib/runners.mjs';
import { inspectWorkspace, createManagedWorktree } from '../lib/workspace.mjs';

function parseArgs(argv) {
  const opts = {
    dir: process.cwd(),
    model: '',
    effort: 'high',
    sandbox: 'workspace-write',
    worktree: false,
    resume: '',
    codexHome: '',
    json: false,
    prompt: '',
    help: false,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg === '--dir' || arg === '-C') opts.dir = argv[++i] || opts.dir;
    else if (arg === '--model' || arg === '-m') opts.model = argv[++i] || '';
    else if (arg === '--effort') opts.effort = argv[++i] || opts.effort;
    else if (arg === '--read-only') opts.sandbox = 'read-only';
    else if (arg === '--worktree') opts.worktree = true;
    else if (arg === '--resume') opts.resume = argv[++i] || '';
    else if (arg === '--codex-home') opts.codexHome = argv[++i] || '';
    else if (arg === '--json') opts.json = true;
    else rest.push(arg);
  }
  opts.prompt = rest.join(' ').trim();
  return opts;
}

const opts = parseArgs(process.argv.slice(2));

if (opts.help || !opts.prompt) {
  console.log(`CONDUIT codex-worker — 安全封装 codex exec 的独立后端施工脚本

用法:
  node scripts/codex-worker.mjs [选项] "<接口契约与施工任务>"

选项:
  --dir, -C <目录>        目标代码库目录（默认当前目录）
  --model, -m <模型>      Codex 模型名（留空则读取 config.toml 默认模型）
  --effort <深度>         推理深度 low|medium|high|xhigh（默认 high）
  --read-only             切换为只读沙箱（默认 workspace-write，永不开放完全权限）
  --worktree              在独立 Git worktree 中隔离施工
  --resume <thread_id>    续跑上一次 Codex 会话
  --codex-home <目录>     临时指定 CODEX_HOME 配置目录
  --json                  输出结构化 JSON 结果
  -h, --help              查看帮助`);
  process.exit(opts.help ? 0 : 1);
}

const resolvedDir = path.resolve(opts.dir);
const ws = await inspectWorkspace(resolvedDir);
if (!ws.ok) {
  console.error(`[codex-worker] 目录不可用: ${ws.error}`);
  process.exit(1);
}

let effectiveDir = resolvedDir;
if (opts.worktree && ws.isGitRepo && !opts.resume) {
  const wt = await createManagedWorktree(resolvedDir, `cli_${Date.now().toString(36)}`);
  if (!wt.ok) {
    console.error(`[codex-worker] 创建 Worktree 失败: ${wt.error}`);
    process.exit(1);
  }
  effectiveDir = wt.path;
  if (!opts.json) console.error(`[codex-worker] 已切换至隔离 Worktree: ${effectiveDir}`);
}

const result = await runCodex({
  prompt: opts.prompt,
  cwd: effectiveDir,
  model: opts.model,
  reasoningEffort: opts.effort,
  sandbox: opts.sandbox,
  isGitRepo: ws.isGitRepo,
  resumeThreadId: opts.resume,
  codexHome: opts.codexHome,
  onEvent: opts.json
    ? undefined
    : (ev) => {
        if (ev.kind === 'init') {
          console.error(`[codex-worker] thread=${ev.threadId} sandbox=${ev.sandbox} effort=${ev.effort}`);
        } else if (ev.kind === 'command') {
          console.error(`[codex-worker] cmd (${ev.status}): ${ev.command}`);
        }
      },
});

if (opts.json) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.ok) {
  console.log(result.text);
  if (result.threadId) {
    console.error(`\n[codex-worker] 完成 · 可使用 --resume ${result.threadId} 继续追问`);
  }
} else {
  console.error(`[codex-worker] 失败: ${result.error}`);
}

process.exit(result.ok ? 0 : 1);
