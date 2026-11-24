#!/usr/bin/env node
/**
 * codex-review.mjs — 独立 Pre-CI 代码审查门禁脚本。
 *
 * 特性：
 * - 两级分级：BLOCKING（仅算错钱/丢数据/越权/发错消息/发布事故且能说明触发路径）vs SUGGESTION
 * - 动态深度：默认 high，若变更涉及 auth/payment/permission/deploy/webhook 等高危路径自动升至 xhigh
 * - 退出码：0 = 通过，2 = 存在 BLOCKING 阻塞项，1 = 执行失败
 */
import path from 'node:path';
import { runCodex } from '../lib/runners.mjs';
import { inspectWorkspace, getWorkspaceDiff } from '../lib/workspace.mjs';
import { parseReviewVerdict } from '../lib/orchestrator.mjs';

function parseArgs(argv) {
  const opts = {
    dir: process.cwd(),
    model: '',
    effort: '',
    codexHome: '',
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg === '--dir' || arg === '-C') opts.dir = argv[++i] || opts.dir;
    else if (arg === '--model' || arg === '-m') opts.model = argv[++i] || '';
    else if (arg === '--effort') opts.effort = argv[++i] || '';
    else if (arg === '--codex-home') opts.codexHome = argv[++i] || '';
    else if (arg === '--json') opts.json = true;
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));

if (opts.help) {
  console.log(`CONDUIT codex-review — Pre-CI 分级代码审查门禁脚本

用法:
  node scripts/codex-review.mjs [--dir <仓库目录>] [--model <模型>] [--effort high|xhigh] [--json]

退出码:
  0  审查通过（无 BLOCKING 问题）
  2  审查拦截（检出 BLOCKING 严重缺陷）
  1  工具执行失败`);
  process.exit(0);
}

const resolvedDir = path.resolve(opts.dir);
const ws = await inspectWorkspace(resolvedDir);
if (!ws.ok) {
  console.error(`[codex-review] 目录不可用: ${ws.error}`);
  process.exit(1);
}

const diffInfo = await getWorkspaceDiff(resolvedDir);
const effectiveEffort = opts.effort || ws.recommendedReviewEffort || 'high';

if (!opts.json) {
  console.error(
    `[codex-review] 目录=${resolvedDir} | 变更文件=${ws.changedFiles.length} | 高危命中=${ws.highRiskFiles.length} | 推理深度=${effectiveEffort}`
  );
}

const prompt = [
  '你是 Pre-CI 代码审查门神（只读模式，禁止修改文件）。',
  '请审查当前 Git 变更，严格区分：',
  '1. BLOCKING：只把会导致算错钱、丢数据、越权/鉴权绕过、误发外部消息、线上崩溃发布事故且能说清触发路径的问题归入 blocking；',
  '2. SUGGESTION：风格、次要优化或极小概率边界归入 suggestions。',
  '必须在末尾输出如下 JSON 代码块：',
  '```json',
  '{"passed": true, "summary": "...", "blocking": [], "suggestions": []}',
  '```',
  '',
  diffInfo.diff ? `【Git Diff】\n${diffInfo.diff.slice(0, 60_000)}` : '当前工作区无未提交 diff，请对目录内核心入口代码做只读健壮性体检。',
].join('\n');

const result = await runCodex({
  prompt,
  cwd: resolvedDir,
  model: opts.model,
  reasoningEffort: effectiveEffort,
  sandbox: 'read-only',
  isGitRepo: ws.isGitRepo,
  codexHome: opts.codexHome,
});

if (!result.ok) {
  if (opts.json) console.log(JSON.stringify({ ok: false, error: result.error }, null, 2));
  else console.error(`[codex-review] 执行失败: ${result.error}`);
  process.exit(1);
}

const verdict = parseReviewVerdict(result.text);

if (opts.json) {
  console.log(JSON.stringify({ ok: true, effort: effectiveEffort, highRiskFiles: ws.highRiskFiles, verdict, raw: result.text }, null, 2));
} else {
  console.log(`\n=== 审查结论: ${verdict.passed ? 'PASS 通过' : 'BLOCK 拦截'} ===`);
  console.log(verdict.summary);
  if (verdict.blocking.length > 0) {
    console.log('\n[BLOCKING 阻塞项]');
    verdict.blocking.forEach((b, i) => console.log(`  ${i + 1}. ${b}`));
  }
  if (verdict.suggestions.length > 0) {
    console.log('\n[SUGGESTION 优化建议]');
    verdict.suggestions.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  }
}

process.exit(verdict.passed ? 0 : 2);
