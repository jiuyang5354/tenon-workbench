import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { killProcessTree, sanitizeAgentText } from './runners.mjs';

const execFileAsync = promisify(execFile);

export const VALID_KINDS = new Set(['cli', 'api']);
export const VALID_PROTOCOLS = new Set([
  'claude-cli',
  'custom-cli',
  'openai-compatible',
  'anthropic',
  'gemini-api',
]);

/**
 * Curated one-click provider presets inspired by BloopAI/vibe-kanban (local CLI executors),
 * Zed ACP (normalized agent event streams), and ProviderProtocol/ai (multi-protocol adapters).
 */
export const PROVIDER_PRESETS = [
  {
    presetId: 'claude-cli',
    name: 'Claude Code (本机 CLI)',
    kind: 'cli',
    protocol: 'claude-cli',
    command: 'claude',
    argsTemplate: '',
    baseUrl: '',
    defaultModel: 'claude-sonnet-4-5',
    models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-3-5'],
    badge: 'LOCAL CLI',
    description: '直连本机已安装的 Claude Code CLI（stream-json 流式思维链与工具事件，复用本机订阅）',
    requiresKey: false,
  },
  {
    presetId: 'ollama',
    name: 'Ollama (本机大模型)',
    kind: 'api',
    protocol: 'openai-compatible',
    command: '',
    argsTemplate: '',
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: 'qwen2.5-coder:14b',
    models: ['qwen2.5-coder:14b', 'deepseek-r1:14b', 'llama3.3:latest'],
    badge: 'LOCAL API',
    description: '连接本机 Ollama OpenAI 兼容端点，无需 API Key，自动探测已拉取模型',
    requiresKey: false,
  },
  {
    presetId: 'lmstudio',
    name: 'LM Studio (本机服务)',
    kind: 'api',
    protocol: 'openai-compatible',
    command: '',
    argsTemplate: '',
    baseUrl: 'http://127.0.0.1:1234/v1',
    defaultModel: 'local-model',
    models: ['local-model'],
    badge: 'LOCAL API',
    description: '连接本机 LM Studio 推理服务（默认端口 1234）',
    requiresKey: false,
  },
  {
    presetId: 'deepseek',
    name: 'DeepSeek API',
    kind: 'api',
    protocol: 'openai-compatible',
    command: '',
    argsTemplate: '',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-reasoner',
    models: ['deepseek-reasoner', 'deepseek-chat'],
    badge: 'OPENAI SSE',
    description: '支持 DeepSeek R1/V3，原生捕获 reasoning_content 实时写入思维链',
    requiresKey: true,
  },
  {
    presetId: 'openrouter',
    name: 'OpenRouter 聚合网关',
    kind: 'api',
    protocol: 'openai-compatible',
    command: '',
    argsTemplate: '',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-sonnet-4',
    models: [
      'anthropic/claude-sonnet-4',
      'openai/o3',
      'google/gemini-2.5-pro',
      'deepseek/deepseek-r1',
    ],
    badge: 'GATEWAY',
    description: '单一 Key 路由 300+ 模型（Claude / GPT / Gemini / DeepSeek / Qwen）',
    requiresKey: true,
  },
  {
    presetId: 'anthropic',
    name: 'Anthropic Claude API',
    kind: 'api',
    protocol: 'anthropic',
    command: '',
    argsTemplate: '',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-5-20250929',
    models: ['claude-sonnet-4-5-20250929', 'claude-opus-4-1-20250805', 'claude-3-7-sonnet-latest'],
    badge: 'ANTHROPIC',
    description: '直连 Anthropic /v1/messages SSE 协议，原生支持 thinking_delta 思考流',
    requiresKey: true,
  },
  {
    presetId: 'gemini-api',
    name: 'Google Gemini REST API',
    kind: 'api',
    protocol: 'gemini-api',
    command: '',
    argsTemplate: '',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.5-pro',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    badge: 'GEMINI REST',
    description: '使用 Gemini API Key 直连 streamGenerateContent SSE（支持 thought 思维链）',
    requiresKey: true,
  },
  {
    presetId: 'openai',
    name: 'OpenAI / 兼容 API',
    kind: 'api',
    protocol: 'openai-compatible',
    command: '',
    argsTemplate: '',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4.1',
    models: ['gpt-4.1', 'o3-mini', 'gpt-4o'],
    badge: 'OPENAI SSE',
    description: '通用 OpenAI 协议（兼容 Kimi、智谱 GLM、通义千问、硅基流动、vLLM、OneAPI）',
    requiresKey: true,
  },
  {
    presetId: 'custom-cli',
    name: '自定义本地 CLI Agent',
    kind: 'cli',
    protocol: 'custom-cli',
    command: 'gemini',
    argsTemplate: '-p {prompt}',
    baseUrl: '',
    defaultModel: '',
    models: [],
    badge: 'CUSTOM CLI',
    description: '适配任意本地命令行 Agent（如 Gemini CLI / OpenCode / Aider / Goose / Python 脚本），支持 {prompt} / {model} / {cwd} 占位符或 stdin 传参',
    requiresKey: false,
  },
];

const LOCAL_CLI_CATALOG = [
  { id: 'agy', name: 'Antigravity (Gemini)', cmd: 'agy', versionArgs: ['--version'], builtin: true, presetId: null },
  { id: 'codex', name: 'OpenAI Codex CLI', cmd: 'codex', versionArgs: ['--version'], builtin: true, presetId: null },
  { id: 'claude', name: 'Claude Code CLI', cmd: 'claude', versionArgs: ['--version'], builtin: false, presetId: 'claude-cli' },
  { id: 'gemini', name: 'Google Gemini CLI', cmd: 'gemini', versionArgs: ['--version'], builtin: false, presetId: 'custom-cli' },
  { id: 'ollama', name: 'Ollama CLI', cmd: 'ollama', versionArgs: ['--version'], builtin: false, presetId: 'ollama' },
  { id: 'opencode', name: 'OpenCode CLI', cmd: 'opencode', versionArgs: ['--version'], builtin: false, presetId: 'custom-cli' },
  { id: 'aider', name: 'Aider CLI', cmd: 'aider', versionArgs: ['--version'], builtin: false, presetId: 'custom-cli' },
  { id: 'goose', name: 'Goose Agent CLI', cmd: 'goose', versionArgs: ['--version'], builtin: false, presetId: 'custom-cli' },
];

export function maskSecret(secret = '') {
  const s = String(secret || '').trim();
  if (!s) return '';
  if (s.length <= 8) return `${s.slice(0, 2)}••••`;
  return `${s.slice(0, 4)}••••${s.slice(-4)}`;
}

export function isMaskedSecret(value = '') {
  return String(value || '').includes('••••');
}

/**
 * Splits a CLI arguments template string cleanly respecting single/double quotes.
 */
export function parseArgsTemplate(template = '', vars = {}) {
  const str = String(template || '').trim();
  if (!str) return { args: [], usedPromptPlaceholder: false };
  const tokens = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < str.length; i += 1) {
    const ch = str[i];
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur) {
        tokens.push(cur);
        cur = '';
      }
    } else {
      cur += ch;
    }
  }
  if (cur) tokens.push(cur);

  let usedPromptPlaceholder = false;
  const args = tokens.map((tok) => {
    if (tok.includes('{prompt}')) usedPromptPlaceholder = true;
    return tok
      .replaceAll('{prompt}', String(vars.prompt ?? ''))
      .replaceAll('{model}', String(vars.model ?? ''))
      .replaceAll('{cwd}', String(vars.cwd ?? ''));
  });
  return { args, usedPromptPlaceholder };
}

async function resolveBinaryPath(cmd) {
  const clean = String(cmd || '').trim();
  if (!clean) return null;
  const finder = process.platform === 'win32' ? 'where.exe' : 'which';
  try {
    const { stdout } = await execFileAsync(finder, [clean], {
      timeout: 3500,
      windowsHide: true,
    });
    const lines = String(stdout || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) return null;
    // On Windows prefer .exe over bare extensionless shims when available
    if (process.platform === 'win32') {
      const exe = lines.find((l) => /\.exe$/i.test(l));
      if (exe) return exe;
      const cmdBat = lines.find((l) => /\.(cmd|bat)$/i.test(l));
      if (cmdBat) return cmdBat;
    }
    return lines[0];
  } catch {
    return null;
  }
}

async function probeBinaryVersion(cmd, versionArgs = ['--version']) {
  const resolved = await resolveBinaryPath(cmd);
  if (!resolved) return { installed: false, path: null, version: null };
  try {
    const isWinScript = process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolved);
    const execTarget = isWinScript ? (process.env.ComSpec || 'cmd.exe') : resolved;
    const execArgs = isWinScript ? ['/d', '/s', '/c', resolved, ...versionArgs] : versionArgs;
    const { stdout, stderr } = await execFileAsync(execTarget, execArgs, {
      timeout: 4500,
      maxBuffer: 512 * 1024,
      windowsHide: true,
    });
    const line = String(stdout || stderr || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean);
    return {
      installed: true,
      path: resolved,
      version: line ? line.slice(0, 96) : 'detected',
    };
  } catch {
    return { installed: true, path: resolved, version: 'installed' };
  }
}

async function probeLocalHttpEndpoint(url, timeoutMs = 1200) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return { online: false, latencyMs: Date.now() - startedAt, models: [] };
    const data = await res.json().catch(() => ({}));
    let models = [];
    if (Array.isArray(data.models)) {
      models = data.models.map((m) => m.name || m.model || m.id).filter(Boolean);
    } else if (Array.isArray(data.data)) {
      models = data.data.map((m) => m.id).filter(Boolean);
    }
    return { online: true, latencyMs: Date.now() - startedAt, models };
  } catch {
    return { online: false, latencyMs: Date.now() - startedAt, models: [] };
  } finally {
    clearTimeout(timer);
  }
}

let cachedLocalAgents = null;
let cachedLocalAgentsAt = 0;
const LOCAL_PROBE_TTL_MS = 60_000;

/**
 * Probes installed local CLI agents AND local model servers (Ollama / LM Studio).
 */
export async function detectLocalAgents(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedLocalAgents && now - cachedLocalAgentsAt < LOCAL_PROBE_TTL_MS) {
    return cachedLocalAgents;
  }

  const [cliResults, ollamaHttp, lmStudioHttp] = await Promise.all([
    Promise.all(
      LOCAL_CLI_CATALOG.map(async (item) => {
        const probe = await probeBinaryVersion(item.cmd, item.versionArgs);
        return {
          id: item.id,
          name: item.name,
          kind: 'cli',
          command: item.cmd,
          builtin: item.builtin,
          presetId: item.presetId,
          installed: probe.installed,
          path: probe.path,
          version: probe.version,
        };
      })
    ),
    probeLocalHttpEndpoint('http://127.0.0.1:11434/api/tags', 1200),
    probeLocalHttpEndpoint('http://127.0.0.1:1234/v1/models', 1200),
  ]);

  const localServices = [
    {
      id: 'ollama-service',
      name: 'Ollama 本地服务',
      kind: 'api',
      baseUrl: 'http://127.0.0.1:11434/v1',
      presetId: 'ollama',
      installed: ollamaHttp.online,
      online: ollamaHttp.online,
      latencyMs: ollamaHttp.latencyMs,
      models: ollamaHttp.models,
      version: ollamaHttp.online ? `${ollamaHttp.models.length} 个模型在线` : '未运行 (:11434)',
    },
    {
      id: 'lmstudio-service',
      name: 'LM Studio 本地服务',
      kind: 'api',
      baseUrl: 'http://127.0.0.1:1234/v1',
      presetId: 'lmstudio',
      installed: lmStudioHttp.online,
      online: lmStudioHttp.online,
      latencyMs: lmStudioHttp.latencyMs,
      models: lmStudioHttp.models,
      version: lmStudioHttp.online ? `${lmStudioHttp.models.length} 个模型在线` : '未运行 (:1234)',
    },
  ];

  cachedLocalAgents = {
    scannedAt: new Date().toISOString(),
    clis: cliResults,
    services: localServices,
  };
  cachedLocalAgentsAt = now;
  return cachedLocalAgents;
}

function validateBaseUrl(urlStr) {
  const clean = String(urlStr || '').trim();
  if (!clean) throw new Error('API 类型的 Provider 必须填写 Base URL');
  let parsed;
  try {
    parsed = new URL(clean);
  } catch {
    throw new Error(`Base URL 格式无效：${clean}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Base URL 仅支持 http:// 或 https:// 协议');
  }
  return clean.replace(/\/+$/, '');
}

function normalizeModelsList(input, defaultModel = '') {
  let list = [];
  if (Array.isArray(input)) {
    list = input.map((m) => String(m || '').trim()).filter(Boolean);
  } else if (typeof input === 'string') {
    list = input
      .split(/[\n,]+/)
      .map((m) => m.trim())
      .filter(Boolean);
  }
  if (defaultModel && !list.includes(defaultModel)) {
    list.unshift(defaultModel);
  }
  return Array.from(new Set(list)).slice(0, 64);
}

/**
 * Persistent provider store backed by gitignored `data/providers.json`.
 * Keeps API keys server-side and masks them in all public responses.
 */
export class ProviderStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.filePath = path.join(dataDir, 'providers.json');
    this.providers = [];
  }

  async init() {
    await fs.mkdir(this.dataDir, { recursive: true });
    let loaded = false;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.providers)) {
        this.providers = parsed.providers;
        loaded = true;
      }
    } catch {
      // Fresh store
    }

    if (!loaded) {
      await this.seedDefaults();
    }
  }

  async seedDefaults() {
    const claudeProbe = await probeBinaryVersion('claude', ['--version']);
    const ollamaHttp = await probeLocalHttpEndpoint('http://127.0.0.1:11434/api/tags', 900);
    const now = new Date().toISOString();

    const seeded = [];
    if (claudeProbe.installed) {
      seeded.push({
        id: 'prov_claude_cli',
        presetId: 'claude-cli',
        name: 'Claude Code (本机 CLI)',
        kind: 'cli',
        protocol: 'claude-cli',
        enabled: true,
        command: 'claude',
        argsTemplate: '',
        baseUrl: '',
        apiKey: '',
        defaultModel: 'claude-sonnet-4-5',
        models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-3-5'],
        notes: '已自动检测到本机 Claude Code CLI，直连订阅额度运行',
        lastTest: {
          ok: true,
          testedAt: now,
          latencyMs: 0,
          detail: `本机已安装：${claudeProbe.version || claudeProbe.path}`,
        },
        createdAt: now,
        updatedAt: now,
      });
    }

    if (ollamaHttp.online) {
      const ollamaModels = ollamaHttp.models.length ? ollamaHttp.models : ['qwen2.5-coder:14b'];
      seeded.push({
        id: 'prov_ollama_local',
        presetId: 'ollama',
        name: 'Ollama (本机大模型)',
        kind: 'api',
        protocol: 'openai-compatible',
        enabled: true,
        command: '',
        argsTemplate: '',
        baseUrl: 'http://127.0.0.1:11434/v1',
        apiKey: '',
        defaultModel: ollamaModels[0],
        models: ollamaModels,
        notes: '自动发现本机 Ollama 推理服务',
        lastTest: {
          ok: true,
          testedAt: now,
          latencyMs: ollamaHttp.latencyMs,
          detail: `在线 · 发现 ${ollamaModels.length} 个本地模型`,
        },
        createdAt: now,
        updatedAt: now,
      });
    }

    this.providers = seeded;
    await this.save();
  }

  async save() {
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.writeFile(
      this.filePath,
      JSON.stringify({ version: 1, providers: this.providers }, null, 2),
      'utf8'
    );
  }

  list() {
    return this.providers;
  }

  toPublic(provider) {
    if (!provider) return null;
    const { apiKey, ...rest } = provider;
    return {
      ...rest,
      hasApiKey: Boolean(apiKey && String(apiKey).trim()),
      apiKeyMasked: maskSecret(apiKey),
    };
  }

  listPublic() {
    return this.providers.map((p) => this.toPublic(p));
  }

  get(id) {
    return this.providers.find((p) => p.id === id) || null;
  }

  async upsert(payload = {}) {
    const existing = payload.id ? this.get(payload.id) : null;
    const name = String(payload.name ?? existing?.name ?? '').trim();
    if (!name) throw new Error('请填写 Agent / API 接入名称');

    const kind = String(payload.kind ?? existing?.kind ?? 'api').trim();
    if (!VALID_KINDS.has(kind)) throw new Error(`不支持的接入类型：${kind}`);

    const protocol = String(
      payload.protocol ?? existing?.protocol ?? (kind === 'cli' ? 'custom-cli' : 'openai-compatible')
    ).trim();
    if (!VALID_PROTOCOLS.has(protocol)) throw new Error(`不支持的协议类型：${protocol}`);

    let command = String(payload.command ?? existing?.command ?? '').trim();
    const argsTemplate = String(payload.argsTemplate ?? existing?.argsTemplate ?? '').trim();
    let baseUrl = String(payload.baseUrl ?? existing?.baseUrl ?? '').trim();

    if (kind === 'cli') {
      if (protocol === 'claude-cli' && !command) command = 'claude';
      if (!command) throw new Error('本地 CLI Agent 必须填写可执行命令名称（如 claude / gemini / aider）');
      baseUrl = '';
    } else {
      baseUrl = validateBaseUrl(baseUrl);
      command = '';
    }

    // Preserve stored secret if client omitted key or echoed masked placeholder
    let apiKey = existing?.apiKey || '';
    if (typeof payload.apiKey === 'string') {
      const trimmedKey = payload.apiKey.trim();
      if (trimmedKey === '__CLEAR__') {
        apiKey = '';
      } else if (trimmedKey && !isMaskedSecret(trimmedKey)) {
        apiKey = trimmedKey;
      }
    }

    const defaultModel = String(payload.defaultModel ?? existing?.defaultModel ?? '').trim();
    const models = normalizeModelsList(
      payload.models !== undefined ? payload.models : existing?.models || [],
      defaultModel
    );
    const enabled = payload.enabled !== undefined ? Boolean(payload.enabled) : (existing ? existing.enabled : true);
    const notes = String(payload.notes ?? existing?.notes ?? '').trim().slice(0, 300);
    const now = new Date().toISOString();

    const record = {
      id: existing?.id || `prov_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
      presetId: String(payload.presetId ?? existing?.presetId ?? '').trim() || null,
      name: name.slice(0, 80),
      kind,
      protocol,
      enabled,
      command,
      argsTemplate,
      baseUrl,
      apiKey,
      defaultModel: defaultModel || models[0] || '',
      models,
      notes,
      lastTest: payload.lastTest !== undefined ? payload.lastTest : (existing?.lastTest || null),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    if (existing) {
      const idx = this.providers.findIndex((p) => p.id === existing.id);
      this.providers[idx] = record;
    } else {
      this.providers.unshift(record);
    }

    await this.save();
    return record;
  }

  async updateTestStatus(id, lastTest, discoveredModels = []) {
    const existing = this.get(id);
    if (!existing) return null;
    existing.lastTest = lastTest;
    if (Array.isArray(discoveredModels) && discoveredModels.length > 0) {
      existing.models = normalizeModelsList(
        [...discoveredModels, ...(existing.models || [])],
        existing.defaultModel || discoveredModels[0]
      );
      if (!existing.defaultModel) existing.defaultModel = discoveredModels[0];
    }
    existing.updatedAt = new Date().toISOString();
    await this.save();
    return existing;
  }

  async remove(id) {
    const before = this.providers.length;
    this.providers = this.providers.filter((p) => p.id !== id);
    if (this.providers.length !== before) {
      await this.save();
      return true;
    }
    return false;
  }
}

/* ============================================================================
   SSE & Protocol Stream Parsers (Exported for direct unit testing!)
   ============================================================================ */

export function parseOpenAiSseChunk(dataStr) {
  if (!dataStr || dataStr === '[DONE]') return { done: true };
  try {
    const obj = JSON.parse(dataStr);
    const choice = obj.choices?.[0];
    const delta = choice?.delta || choice?.message || {};
    return {
      done: false,
      text: typeof delta.content === 'string' ? delta.content : '',
      reasoning:
        typeof delta.reasoning_content === 'string'
          ? delta.reasoning_content
          : (typeof delta.reasoning === 'string' ? delta.reasoning : ''),
      usage: obj.usage || null,
      error: obj.error?.message || null,
    };
  } catch {
    return { done: false, text: '', reasoning: '' };
  }
}

export function parseAnthropicSseChunk(dataStr) {
  if (!dataStr) return { done: false };
  try {
    const obj = JSON.parse(dataStr);
    if (obj.type === 'content_block_delta' && obj.delta) {
      if (obj.delta.type === 'text_delta') {
        return { done: false, text: obj.delta.text || '', reasoning: '' };
      }
      if (obj.delta.type === 'thinking_delta') {
        return { done: false, text: '', reasoning: obj.delta.thinking || '' };
      }
    }
    if (obj.type === 'message_delta' && obj.usage) {
      return { done: false, usage: obj.usage };
    }
    if (obj.type === 'message_stop') {
      return { done: true };
    }
    if (obj.type === 'error') {
      return { done: true, error: obj.error?.message || 'Anthropic stream error' };
    }
    return { done: false };
  } catch {
    return { done: false };
  }
}

export function parseGeminiSseChunk(dataStr) {
  if (!dataStr || dataStr === '[DONE]') return { done: true };
  try {
    const obj = JSON.parse(dataStr);
    if (obj.error) {
      return { done: true, error: obj.error.message || 'Gemini API error' };
    }
    const parts = obj.candidates?.[0]?.content?.parts || [];
    let text = '';
    let reasoning = '';
    for (const part of parts) {
      if (!part || typeof part.text !== 'string') continue;
      if (part.thought === true) reasoning += part.text;
      else text += part.text;
    }
    const u = obj.usageMetadata;
    const usage = u
      ? {
          input_tokens: u.promptTokenCount || 0,
          output_tokens: u.candidatesTokenCount || 0,
          total_tokens: u.totalTokenCount || 0,
        }
      : null;
    return { done: false, text, reasoning, usage };
  } catch {
    return { done: false };
  }
}

async function consumeSseStream(response, onDataLine) {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let dataLines = [];

  const flushEvent = () => {
    if (!dataLines.length) return;
    const joined = dataLines.join('\n').trim();
    dataLines = [];
    if (joined) onDataLine(joined);
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line === '') {
        flushEvent();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
  }
  if (buffer.startsWith('data:')) {
    dataLines.push(buffer.slice(5).trimStart());
  }
  flushEvent();
}

/* ============================================================================
   Connectivity & Model Discovery Probe (`POST /api/providers/:id/test`)
   ============================================================================ */

export async function testProvider(provider) {
  const startedAt = Date.now();
  const testedAt = new Date().toISOString();

  if (provider.kind === 'cli') {
    const cmd = provider.command || (provider.protocol === 'claude-cli' ? 'claude' : '');
    const probe = await probeBinaryVersion(cmd, ['--version']);
    const latencyMs = Date.now() - startedAt;
    if (!probe.installed) {
      return {
        ok: false,
        testedAt,
        latencyMs,
        detail: `未在本机 PATH 中找到命令「${cmd}」，请确认已安装并加入环境变量`,
        discoveredModels: [],
      };
    }
    return {
      ok: true,
      testedAt,
      latencyMs,
      detail: `本机可执行 (${probe.version || 'ready'}) · ${probe.path}`,
      discoveredModels: [],
    };
  }

  // HTTP API providers
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const base = String(provider.baseUrl || '').replace(/\/+$/, '');
    if (provider.protocol === 'anthropic') {
      const v1Base = /\/v1$/i.test(base) ? base : `${base}/v1`;
      const headers = { 'anthropic-version': '2023-06-01' };
      if (provider.apiKey) headers['x-api-key'] = provider.apiKey;
      const res = await fetch(`${v1Base}/models`, { headers, signal: ctrl.signal });
      const latencyMs = Date.now() - startedAt;
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return {
          ok: false,
          testedAt,
          latencyMs,
          detail: `Anthropic 鉴权或连接失败 (HTTP ${res.status})：${body.slice(0, 180)}`,
          discoveredModels: [],
        };
      }
      const json = await res.json().catch(() => ({}));
      const discoveredModels = Array.isArray(json.data)
        ? json.data.map((m) => m.id).filter(Boolean).slice(0, 24)
        : [];
      return {
        ok: true,
        testedAt,
        latencyMs,
        detail: `Anthropic API 连通 (${latencyMs}ms)${discoveredModels.length ? ` · 发现 ${discoveredModels.length} 个模型` : ''}`,
        discoveredModels,
      };
    }

    if (provider.protocol === 'gemini-api') {
      const headers = {};
      if (provider.apiKey) headers['x-goog-api-key'] = provider.apiKey;
      const res = await fetch(`${base}/models`, { headers, signal: ctrl.signal });
      const latencyMs = Date.now() - startedAt;
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return {
          ok: false,
          testedAt,
          latencyMs,
          detail: `Gemini API 校验失败 (HTTP ${res.status})：${body.slice(0, 180)}`,
          discoveredModels: [],
        };
      }
      const json = await res.json().catch(() => ({}));
      const discoveredModels = Array.isArray(json.models)
        ? json.models
            .map((m) => String(m.name || '').replace(/^models\//, ''))
            .filter((n) => /^gemini-/i.test(n))
            .slice(0, 24)
        : [];
      return {
        ok: true,
        testedAt,
        latencyMs,
        detail: `Gemini REST API 连通 (${latencyMs}ms) · 发现 ${discoveredModels.length} 个模型`,
        discoveredModels,
      };
    }

    // Default: OpenAI-compatible (`/models` with Ollama `/api/tags` fallback)
    const modelsUrl = /\/chat\/completions$/i.test(base)
      ? base.replace(/\/chat\/completions$/i, '/models')
      : `${base}/models`;
    const headers = {};
    if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
    const res = await fetch(modelsUrl, { headers, signal: ctrl.signal });
    const latencyMs = Date.now() - startedAt;
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        ok: false,
        testedAt,
        latencyMs,
        detail: `API 连接失败 (HTTP ${res.status})：${body.slice(0, 180)}`,
        discoveredModels: [],
      };
    }
    const json = await res.json().catch(() => ({}));
    const discoveredModels = Array.isArray(json.data)
      ? json.data.map((m) => m.id).filter(Boolean).slice(0, 32)
      : (Array.isArray(json.models) ? json.models.map((m) => m.name || m.id).filter(Boolean).slice(0, 32) : []);
    return {
      ok: true,
      testedAt,
      latencyMs,
      detail: `连接成功 (${latencyMs}ms)${discoveredModels.length ? ` · 发现 ${discoveredModels.length} 个模型` : ''}`,
      discoveredModels,
    };
  } catch (err) {
    return {
      ok: false,
      testedAt,
      latencyMs: Date.now() - startedAt,
      detail: err.name === 'AbortError' ? '连接超时（超过 10s 无响应）' : `网络错误：${err.message}`,
      discoveredModels: [],
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ============================================================================
   Unified Execution Runners (CLI Agents + Multi-Protocol HTTP Streaming APIs)
   ============================================================================ */

async function spawnSafeCommand(cmd, args, options) {
  const resolved = await resolveBinaryPath(cmd);
  const target = resolved || cmd;
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(target)) {
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', target, ...args], options);
  }
  return spawn(target, args, options);
}

async function runClaudeCli(provider, opts) {
  const startedAt = Date.now();
  const model = opts.model || provider.defaultModel || '';
  const cmd = provider.command || 'claude';
  const args = ['-p', '--output-format', 'stream-json', '--verbose'];
  if (model) args.push('--model', model);
  if (opts.systemPrompt) args.push('--append-system-prompt', opts.systemPrompt);

  const childEnv = { ...process.env };
  // Prevent nested-session lockouts if user started workbench from a Claude terminal
  delete childEnv.CLAUDECODE;

  const child = await spawnSafeCommand(cmd, args, {
    cwd: opts.cwd || process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: childEnv,
  });

  const handle = { pid: child.pid, abort: () => killProcessTree(child) };
  if (opts.onProcess) opts.onProcess(handle);

  return new Promise((resolve) => {
    child.stdin.on('error', () => {});
    child.stdin.write(String(opts.prompt || ''), 'utf8');
    child.stdin.end();

    let stdoutBuf = '';
    let stderrText = '';
    let fullText = '';
    let fullReasoning = '';
    let finalResultText = '';
    let usage = null;
    let timedOut = false;

    const timeoutMs = opts.timeoutMs ?? 240_000;
    const timer = timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          killProcessTree(child);
        }, timeoutMs)
      : null;

    const emitTextChunk = (chunk) => {
      if (!chunk) return;
      fullText += chunk;
      if (opts.onDelta) opts.onDelta(chunk, sanitizeAgentText(fullText));
    };

    const emitReasoningChunk = (chunk) => {
      if (!chunk) return;
      fullReasoning += chunk;
      if (opts.onReasoning) opts.onReasoning(chunk, fullReasoning);
      if (opts.onEvent) opts.onEvent({ source: 'provider', kind: 'reasoning', text: chunk });
    };

    const processLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        return;
      }

      if (parsed.type === 'system' && parsed.subtype === 'init') {
        if (opts.onEvent) {
          opts.onEvent({
            source: 'provider',
            kind: 'init',
            model: parsed.model || model || 'claude',
            sessionId: parsed.session_id || null,
          });
        }
      } else if (parsed.type === 'stream_event' && parsed.event) {
        const ev = parsed.event;
        if (ev.type === 'content_block_delta' && ev.delta) {
          if (ev.delta.type === 'text_delta') emitTextChunk(ev.delta.text || '');
          else if (ev.delta.type === 'thinking_delta') emitReasoningChunk(ev.delta.thinking || '');
        }
      } else if (parsed.type === 'assistant' && Array.isArray(parsed.message?.content)) {
        for (const block of parsed.message.content) {
          if (!block) continue;
          if (block.type === 'thinking' && block.thinking) {
            if (!fullReasoning.includes(block.thinking)) emitReasoningChunk(block.thinking);
          } else if (block.type === 'text' && block.text) {
            if (block.text.startsWith(fullText) && block.text.length > fullText.length) {
              emitTextChunk(block.text.slice(fullText.length));
            } else if (!fullText.includes(block.text)) {
              emitTextChunk((fullText ? '\n' : '') + block.text);
            }
          } else if (block.type === 'tool_use') {
            if (opts.onEvent) {
              opts.onEvent({
                source: 'provider',
                kind: 'tool',
                itemId: block.id || '',
                toolName: block.name || 'tool',
                summary: JSON.stringify(block.input || {}).slice(0, 160),
                params: block.input || {},
                state: 'running',
              });
            }
          }
        }
      } else if (parsed.type === 'user' && Array.isArray(parsed.message?.content)) {
        for (const block of parsed.message.content) {
          if (block && block.type === 'tool_result') {
            const rawOut = Array.isArray(block.content)
              ? block.content.map((c) => c.text || '').join('\n')
              : String(block.content || '');
            if (opts.onEvent) {
              opts.onEvent({
                source: 'provider',
                kind: 'tool_result',
                itemId: block.tool_use_id || '',
                output: rawOut.slice(0, 1200),
                state: block.is_error ? 'error' : 'done',
              });
            }
          }
        }
      } else if (parsed.type === 'result') {
        if (typeof parsed.result === 'string' && parsed.result) {
          finalResultText = parsed.result;
        }
        if (parsed.usage) {
          usage = {
            input_tokens: parsed.usage.input_tokens || 0,
            output_tokens: parsed.usage.output_tokens || 0,
            total_tokens: (parsed.usage.input_tokens || 0) + (parsed.usage.output_tokens || 0),
          };
        }
        if (opts.onEvent) {
          opts.onEvent({ source: 'provider', kind: 'result', status: parsed.is_error ? 'ERROR' : 'SUCCESS', usage });
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
      stderrText += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({
        ok: false,
        text: '',
        reasoning: fullReasoning,
        usage,
        durationMs: Date.now() - startedAt,
        error: `无法启动 ${cmd} CLI：${err.message}`,
      });
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (stdoutBuf.trim()) processLine(stdoutBuf);
      const cleanText = sanitizeAgentText(finalResultText || fullText);
      const ok = !timedOut && code === 0 && Boolean(cleanText);
      let error = null;
      if (timedOut) error = `${provider.name} 执行超时`;
      else if (!ok) error = stderrText.trim().slice(0, 480) || `${cmd} 退出异常 (code=${code})`;
      resolve({
        ok,
        text: cleanText,
        reasoning: fullReasoning,
        usage,
        durationMs: Date.now() - startedAt,
        error,
      });
    });
  });
}

async function runCustomCli(provider, opts) {
  const startedAt = Date.now();
  const cmd = provider.command;
  const model = opts.model || provider.defaultModel || '';
  const combinedPrompt = opts.systemPrompt ? `${opts.systemPrompt}\n\n${opts.prompt}` : opts.prompt;
  const { args, usedPromptPlaceholder } = parseArgsTemplate(provider.argsTemplate || '', {
    prompt: combinedPrompt,
    model,
    cwd: opts.cwd || process.cwd(),
  });

  const child = await spawnSafeCommand(cmd, args, {
    cwd: opts.cwd || process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env },
  });

  const handle = { pid: child.pid, abort: () => killProcessTree(child) };
  if (opts.onProcess) opts.onProcess(handle);

  return new Promise((resolve) => {
    child.stdin.on('error', () => {});
    if (!usedPromptPlaceholder) {
      child.stdin.write(String(combinedPrompt || ''), 'utf8');
    }
    child.stdin.end();

    let fullText = '';
    let stderrText = '';
    let timedOut = false;

    const timeoutMs = opts.timeoutMs ?? 240_000;
    const timer = timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          killProcessTree(child);
        }, timeoutMs)
      : null;

    child.stdout.on('data', (chunk) => {
      const str = chunk.toString('utf8');
      fullText += str;
      if (opts.onDelta) opts.onDelta(str, sanitizeAgentText(fullText));
    });

    child.stderr.on('data', (chunk) => {
      const str = chunk.toString('utf8');
      stderrText += str;
      const clean = str.trim();
      if (clean && opts.onEvent) {
        opts.onEvent({ source: 'provider', kind: 'stderr', text: clean.slice(0, 300) });
      }
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({
        ok: false,
        text: '',
        reasoning: '',
        usage: null,
        durationMs: Date.now() - startedAt,
        error: `无法启动本地命令「${cmd}」：${err.message}`,
      });
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      const cleanText = sanitizeAgentText(fullText);
      const ok = !timedOut && code === 0 && Boolean(cleanText);
      let error = null;
      if (timedOut) error = `${provider.name} 执行超时`;
      else if (!ok) error = stderrText.trim().slice(0, 480) || `${cmd} 退出异常 (code=${code})`;
      resolve({
        ok,
        text: cleanText,
        reasoning: '',
        usage: null,
        durationMs: Date.now() - startedAt,
        error,
      });
    });
  });
}

async function runHttpProvider(provider, opts) {
  const startedAt = Date.now();
  const model = opts.model || provider.defaultModel || provider.models?.[0] || '';
  if (!model) {
    return {
      ok: false,
      text: '',
      reasoning: '',
      usage: null,
      durationMs: 0,
      error: `${provider.name} 尚未配置默认模型 ID`,
    };
  }

  const ctrl = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 180_000;
  let timedOut = false;
  const timer = timeoutMs > 0
    ? setTimeout(() => {
        timedOut = true;
        ctrl.abort();
      }, timeoutMs)
    : null;

  if (opts.onProcess) {
    opts.onProcess({ abort: () => ctrl.abort() });
  }

  let fullText = '';
  let fullReasoning = '';
  let usage = null;
  let streamError = null;
  let reasoningBuf = '';

  const flushReasoning = () => {
    if (!reasoningBuf) return;
    if (opts.onEvent) {
      opts.onEvent({ source: 'provider', kind: 'reasoning', text: reasoningBuf });
    }
    reasoningBuf = '';
  };

  try {
    const base = String(provider.baseUrl || '').replace(/\/+$/, '');
    let url = '';
    let headers = { 'Content-Type': 'application/json' };
    let body = {};
    let parser = parseOpenAiSseChunk;

    if (provider.protocol === 'anthropic') {
      const v1Base = /\/v1$/i.test(base) ? base : `${base}/v1`;
      url = `${v1Base}/messages`;
      headers['anthropic-version'] = '2023-06-01';
      if (provider.apiKey) headers['x-api-key'] = provider.apiKey;
      body = {
        model,
        max_tokens: 4096,
        stream: true,
        ...(opts.systemPrompt ? { system: opts.systemPrompt } : {}),
        messages: [{ role: 'user', content: String(opts.prompt || '') }],
      };
      parser = parseAnthropicSseChunk;
    } else if (provider.protocol === 'gemini-api') {
      url = `${base}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
      if (provider.apiKey) headers['x-goog-api-key'] = provider.apiKey;
      body = {
        ...(opts.systemPrompt ? { systemInstruction: { parts: [{ text: opts.systemPrompt }] } } : {}),
        contents: [{ role: 'user', parts: [{ text: String(opts.prompt || '') }] }],
      };
      parser = parseGeminiSseChunk;
    } else {
      // openai-compatible
      url = /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`;
      if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
      if (/openrouter\.ai/i.test(base)) {
        headers['HTTP-Referer'] = 'http://127.0.0.1:4177';
        headers['X-Title'] = 'TENON Workbench';
      }
      const messages = [];
      if (opts.systemPrompt) messages.push({ role: 'system', content: opts.systemPrompt });
      messages.push({ role: 'user', content: String(opts.prompt || '') });
      body = {
        model,
        stream: true,
        messages,
      };
      parser = parseOpenAiSseChunk;
    }

    if (opts.onEvent) {
      opts.onEvent({
        source: 'provider',
        kind: 'init',
        model,
        protocol: provider.protocol,
        providerName: provider.name,
      });
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      return {
        ok: false,
        text: '',
        reasoning: '',
        usage: null,
        durationMs: Date.now() - startedAt,
        error: `${provider.name} 返回错误 (HTTP ${res.status})：${errBody.slice(0, 320)}`,
      };
    }

    const ct = String(res.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('text/event-stream')) {
      await consumeSseStream(res, (dataLine) => {
        const chunk = parser(dataLine);
        if (chunk.error) streamError = chunk.error;
        if (chunk.usage) usage = chunk.usage;
        if (chunk.reasoning) {
          fullReasoning += chunk.reasoning;
          reasoningBuf += chunk.reasoning;
          if (opts.onReasoning) opts.onReasoning(chunk.reasoning, fullReasoning);
          // Flush readable reasoning chunks on paragraph breaks or size threshold
          if (reasoningBuf.includes('\n') || reasoningBuf.length >= 160) {
            flushReasoning();
          }
        }
        if (chunk.text) {
          flushReasoning();
          fullText += chunk.text;
          if (opts.onDelta) opts.onDelta(chunk.text, sanitizeAgentText(fullText));
        }
      });
      flushReasoning();
    } else {
      // Non-streaming JSON fallback
      const json = await res.json().catch(() => ({}));
      if (provider.protocol === 'anthropic') {
        for (const b of json.content || []) {
          if (b.type === 'thinking') fullReasoning += b.thinking || '';
          if (b.type === 'text') fullText += b.text || '';
        }
        usage = json.usage || null;
      } else if (provider.protocol === 'gemini-api') {
        const parts = json.candidates?.[0]?.content?.parts || [];
        for (const p of parts) {
          if (p.thought) fullReasoning += p.text || '';
          else fullText += p.text || '';
        }
      } else {
        const msg = json.choices?.[0]?.message || {};
        fullText = msg.content || '';
        fullReasoning = msg.reasoning_content || msg.reasoning || '';
        usage = json.usage || null;
      }
      if (fullReasoning && opts.onEvent) {
        opts.onEvent({ source: 'provider', kind: 'reasoning', text: fullReasoning });
      }
      if (fullText && opts.onDelta) {
        opts.onDelta(fullText, sanitizeAgentText(fullText));
      }
    }

    const cleanText = sanitizeAgentText(fullText);
    const ok = !streamError && Boolean(cleanText);
    return {
      ok,
      text: cleanText,
      reasoning: fullReasoning.trim(),
      usage,
      durationMs: Date.now() - startedAt,
      error: streamError || (ok ? null : `${provider.name} 未返回正文内容`),
    };
  } catch (err) {
    flushReasoning();
    const aborted = err.name === 'AbortError';
    return {
      ok: false,
      text: sanitizeAgentText(fullText),
      reasoning: fullReasoning.trim(),
      usage,
      durationMs: Date.now() - startedAt,
      error: timedOut
        ? `${provider.name} 响应超时`
        : (aborted ? '任务已被中止' : `${provider.name} 请求失败：${err.message}`),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Unified execution entrypoint for ANY configured local CLI Agent or HTTP API Provider.
 */
export async function runProvider(provider, opts = {}) {
  if (!provider) {
    return { ok: false, text: '', reasoning: '', usage: null, durationMs: 0, error: '未找到对应的 Agent / API 接入配置' };
  }
  if (provider.kind === 'cli') {
    if (provider.protocol === 'claude-cli') {
      return runClaudeCli(provider, opts);
    }
    return runCustomCli(provider, opts);
  }
  return runHttpProvider(provider, opts);
}
