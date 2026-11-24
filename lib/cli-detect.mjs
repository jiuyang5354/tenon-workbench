import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

let cachedAgyModels = null;
let cachedAgyModelsAt = 0;
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;

export const CODEX_MODEL_PRESETS = [
  { id: '', label: '默认（读取本机 config.toml）', group: 'default' },
  { id: 'gpt-6.2-astra', label: 'GPT-6.2 Astra（重后端 / 算法推荐）', group: 'codex' },
  { id: 'gpt-6.2-sol', label: 'GPT-6.2 Sol（高性价比代码审查推荐）', group: 'codex' },
  { id: 'gpt-5.5', label: 'GPT-5.5', group: 'codex' },
  { id: 'gpt-5.4', label: 'GPT-5.4', group: 'codex' },
  { id: 'o3', label: 'o3', group: 'codex' },
];

export const AGY_FALLBACK_MODELS = [
  { id: 'gemini-4-neon-xhigh', label: 'Gemini 4 Neon (XHigh)' },
  { id: 'gemini-4-neon-high', label: 'Gemini 4 Neon (High)' },
  { id: 'gemini-4-neon-medium', label: 'Gemini 4 Neon (Medium)' },
  { id: 'gemini-4-carbon-high', label: 'Gemini 4 Carbon (High)' },
  { id: 'gemini-4-argon-high', label: 'Gemini 4 Argon (High)' },
  { id: 'gemini-4-hydrogen-xhigh', label: 'Gemini 4 Hydrogen (XHigh)' },
  { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
];

async function probeCommand(cmd, args, timeoutMs = 8000) {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    });
    return { ok: true, stdout: (stdout || '').trim(), stderr: (stderr || '').trim() };
  } catch (err) {
    return {
      ok: false,
      stdout: (err.stdout || '').trim(),
      stderr: (err.stderr || err.message || '').trim(),
      code: err.code ?? null,
    };
  }
}

/**
 * Safely parses non-secret configuration fields from Codex's config.toml.
 * Never reads auth.json, API keys, or tokens.
 */
export async function inspectCodexConfig(codexHomeOverride = '') {
  const activeHome = codexHomeOverride || process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const candidateHomes = Array.from(
    new Set([
      process.env.CODEX_HOME,
      path.join(os.homedir(), '.codex'),
    ].filter(Boolean))
  );

  const detectedProfiles = [];
  for (const homeDir of candidateHomes) {
    const cfgPath = path.join(homeDir, 'config.toml');
    try {
      const content = await fs.readFile(cfgPath, 'utf8');
      const modelMatch = content.match(/^\s*model\s*=\s*"([^"]+)"/m);
      const providerMatch = content.match(/^\s*model_provider\s*=\s*"([^"]+)"/m);
      const effortMatch = content.match(/^\s*model_reasoning_effort\s*=\s*"([^"]+)"/m);
      detectedProfiles.push({
        codexHome: homeDir,
        hasConfig: true,
        model: modelMatch ? modelMatch[1] : null,
        provider: providerMatch ? providerMatch[1] : 'openai',
        reasoningEffort: effortMatch ? effortMatch[1] : 'high',
      });
    } catch {
      // Directory does not have config.toml
    }
  }

  const active = detectedProfiles.find((p) => path.resolve(p.codexHome) === path.resolve(activeHome))
    || detectedProfiles[0]
    || { codexHome: activeHome, hasConfig: false, model: null, provider: 'unknown', reasoningEffort: 'high' };

  return {
    activeHome: active.codexHome,
    defaultModel: active.model,
    defaultProvider: active.provider,
    defaultEffort: active.reasoningEffort,
    profiles: detectedProfiles,
  };
}

export async function listAgyModels(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedAgyModels && now - cachedAgyModelsAt < MODEL_CACHE_TTL_MS) {
    return { ok: true, cached: true, models: cachedAgyModels };
  }

  const res = await probeCommand('agy', ['models'], 15000);
  if (!res.ok && !res.stdout) {
    return {
      ok: false,
      cached: false,
      models: AGY_FALLBACK_MODELS,
      error: res.stderr || 'agy models 执行失败',
    };
  }

  const parsed = [];
  for (const line of res.stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('Fetching')) continue;
    const parts = trimmed.split(/\t+/);
    if (parts.length >= 2) {
      parsed.push({ id: parts[0].trim(), label: parts[1].trim() });
    } else if (/^[a-z0-9._-]+$/i.test(trimmed)) {
      parsed.push({ id: trimmed, label: trimmed });
    }
  }

  const geminiOnly = parsed.filter((m) => /^gemini-/i.test(m.id));
  const finalModels = geminiOnly.length > 0 ? geminiOnly : parsed;

  if (finalModels.length > 0) {
    cachedAgyModels = finalModels;
    cachedAgyModelsAt = now;
    return { ok: true, cached: false, models: finalModels };
  }

  return { ok: false, cached: false, models: AGY_FALLBACK_MODELS, error: '未解析到可用模型列表' };
}

export async function checkEnvironmentHealth() {
  const [codexVer, gitVer, agyProbe, codexConfig] = await Promise.all([
    probeCommand('codex', ['--version'], 6000),
    probeCommand('git', ['--version'], 6000),
    probeCommand(process.platform === 'win32' ? 'where.exe' : 'which', ['agy'], 6000),
    inspectCodexConfig(),
  ]);

  const codexPathProbe = await probeCommand(
    process.platform === 'win32' ? 'where.exe' : 'which',
    ['codex'],
    5000
  );

  return {
    timestamp: new Date().toISOString(),
    platform: process.platform,
    nodeVersion: process.version,
    agy: {
      installed: agyProbe.ok && Boolean(agyProbe.stdout),
      path: agyProbe.ok ? agyProbe.stdout.split(/\r?\n/)[0].trim() : null,
      status: agyProbe.ok ? 'READY' : 'MISSING',
    },
    codex: {
      installed: codexVer.ok,
      version: codexVer.ok ? codexVer.stdout : null,
      path: codexPathProbe.ok ? codexPathProbe.stdout.split(/\r?\n/)[0].trim() : null,
      status: codexVer.ok ? 'READY' : 'MISSING',
      config: codexConfig,
    },
    git: {
      installed: gitVer.ok,
      version: gitVer.ok ? gitVer.stdout : null,
    },
  };
}
