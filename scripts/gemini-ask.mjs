#!/usr/bin/env node
/**
 * gemini-ask.mjs — 独立命令行工具：调用本机 Antigravity (`agy`) 进行只读规划、文案顾问或结果汇报。
 *
 * 用法示例：
 *   node scripts/gemini-ask.mjs --dir D:\my-project --mode plan "为订单模块设计幂等重试架构"
 *   node scripts/gemini-ask.mjs --mode copy "选中对话里的一段话，点侧边问就能在这顺便问一句"
 *   node scripts/gemini-ask.mjs --model gemini-4-neon-xhigh --json "评审以下目录结构"
 */
import path from 'node:path';
import { runAgy } from '../lib/runners.mjs';

function parseArgs(argv) {
  const opts = {
    dir: process.cwd(),
    model: 'gemini-4-neon-high',
    mode: 'plan', // plan | copy | synth
    effort: '',
    json: false,
    prompt: '',
    help: false,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg === '--dir' || arg === '-C') opts.dir = argv[++i] || opts.dir;
    else if (arg === '--model' || arg === '-m') opts.model = argv[++i] || opts.model;
    else if (arg === '--mode') opts.mode = argv[++i] || opts.mode;
    else if (arg === '--copy') opts.mode = 'copy';
    else if (arg === '--effort') opts.effort = argv[++i] || '';
    else if (arg === '--json') opts.json = true;
    else rest.push(arg);
  }
  opts.prompt = rest.join(' ').trim();
  return opts;
}

const opts = parseArgs(process.argv.slice(2));

if (opts.help || !opts.prompt) {
  console.log(`CONDUIT gemini-ask — 调用本机 agy (Gemini) 的只读军师脚本

用法:
  node scripts/gemini-ask.mjs [选项] "<任务描述>"

选项:
  --dir, -C <目录>     目标项目目录（默认当前目录）
  --model, -m <模型>   agy 模型 ID（默认 gemini-4-neon-high）
  --mode <模式>        plan (独立规划，默认) | copy (文案与交互顾问) | synth (汇总人话汇报)
  --copy               等价于 --mode copy
  --effort <深度>      推理深度 low|medium|high|xhigh|max
  --json               输出结构化 JSON 结果
  -h, --help           查看帮助`);
  process.exit(opts.help ? 0 : 1);
}

const roleHeader =
  opts.mode === 'copy'
    ? '你是产品文案与交互顾问（无头只读，严禁调用终端命令工具或改动任何文件）。请审阅下面文案，去掉 AI 解释腔，给出“原句 | 改写 | 理由”对照表。'
    : opts.mode === 'synth'
      ? '你是项目总指挥（无头只读，严禁调用终端命令工具或改动任何文件）。请把下面的技术结果翻译成 10 秒能读懂的简明中文汇报，先说做成什么与用户可见变化。'
      : '你是独立架构军师（无头只读，严禁调用终端命令工具或改动任何文件）。请根据下方原始需求直接输出清晰的《实施方案、接口契约与验收标准》，方便下游 Codex 精确执行。';

const fullPrompt = `${roleHeader}\n\n【工作目录】${path.resolve(opts.dir)}\n【任务内容】\n${opts.prompt}`;

const result = await runAgy({
  prompt: fullPrompt,
  model: opts.model,
  cwd: path.resolve(opts.dir),
  mode: 'plan',
  effort: opts.effort,
  onDelta: opts.json ? undefined : (delta) => process.stdout.write(delta),
});

if (opts.json) {
  console.log(JSON.stringify(result, null, 2));
} else if (!result.ok) {
  console.error(`\n[gemini-ask] 执行失败: ${result.error}`);
} else {
  process.stdout.write('\n');
}

process.exit(result.ok ? 0 : 1);
