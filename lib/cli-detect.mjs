import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  hydrateRuntimePath,
  resolveExecutable,
  execCliFile,
} from './runners.mjs';

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
    const { stdout, stderr } = await execCliFile(cmd, args, {
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

function normalizePathKey(p) {
  const resolved = path.resolve(String(p || ''));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function extractTopLevelTomlSection(content = '') {
  const topLines = [];
  for (const rawLine of String(content || '').split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (/^\[[^[\]]+\]/.test(trimmed)) break;
    topLines.push(rawLine);
  }
  return topLines.join('\n');
}

/**
 * Safely parses non-secret configuration fields from Codex's config.toml.
 * Never reads auth.json, API keys, or tokens.
 */
export async function inspectCodexConfig(codexHomeOverride = '') {
  const activeHome = String(codexHomeOverride || '').trim()
    || process.env.CODEX_HOME
    || path.join(os.homedir(), '.codex');

  const rawCandidates = [
    String(codexHomeOverride || '').trim(),
    process.env.CODEX_HOME,
    path.join(os.homedir(), '.codex'),
  ].filter(Boolean);

  const seenHomes = new Set();
  const candidateHomes = [];
  for (const dir of rawCandidates) {
    const key = normalizePathKey(dir);
    if (seenHomes.has(key)) continue;
    seenHomes.add(key);
    candidateHomes.push(path.resolve(dir));
  }

  const detectedProfiles = [];
  for (const homeDir of candidateHomes) {
    const cfgPath = path.join(homeDir, 'config.toml');
    try {
      const content = await fs.readFile(cfgPath, 'utf8');
      const topSection = extractTopLevelTomlSection(content);
      const modelMatch = topSection.match(/^\s*model\s*=\s*["']([^"']+)["']/m);
      const providerMatch = topSection.match(/^\s*model_provider\s*=\s*["']([^"']+)["']/m);
      const effortMatch = topSection.match(/^\s*model_reasoning_effort\s*=\s*["']([^"']+)["']/m);
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

  const activeKey = normalizePathKey(activeHome);
  const active = detectedProfiles.find((p) => normalizePathKey(p.codexHome) === activeKey)
    || detectedProfiles[0]
    || { codexHome: path.resolve(activeHome), hasConfig: false, model: null, provider: 'unknown', reasoningEffort: 'high' };

  return {
    activeHome: active.codexHome,
    defaultModel: active.model,
    defaultProvider: active.provider,
    defaultEffort: active.reasoningEffort,
    profiles: detectedProfiles,
  };
}

export async function listAgyModels(forceRefresh = false) {
  hydrateRuntimePath();
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
  for (const rawLine of res.stdout.split(/\r?\n/)) {
    const trimmed = rawLine.replace(/\x1b\[[0-9;]*m/g, '').trim();
    if (!trimmed || trimmed.startsWith('Fetching')) continue;
    const parts = trimmed.split(/\t+|\s{2,}/);
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
  hydrateRuntimePath();

  const [
    agyPath,
    codexPath,
    codexVer,
    gitPath,
    gitVer,
    ghPath,
    ghVer,
    codexConfig,
  ] = await Promise.all([
    resolveExecutable('agy'),
    resolveExecutable('codex'),
    probeCommand('codex', ['--version'], 6000),
    resolveExecutable('git'),
    probeCommand('git', ['--version'], 6000),
    resolveExecutable('gh'),
    probeCommand('gh', ['--version'], 5000),
    inspectCodexConfig(),
  ]);

  const gitInstalled = gitVer.ok;
  const ghInstalled = ghVer.ok;

  return {
    timestamp: new Date().toISOString(),
    platform: process.platform,
    nodeVersion: process.version,
    agy: {
      installed: Boolean(agyPath),
      path: agyPath || null,
      status: agyPath ? 'READY' : 'MISSING',
    },
    codex: {
      installed: codexVer.ok,
      version: codexVer.ok ? codexVer.stdout.split(/\r?\n/)[0].trim() : null,
      path: codexPath || null,
      status: codexVer.ok ? 'READY' : 'MISSING',
      config: codexConfig,
    },
    git: {
      installed: gitInstalled,
      version: gitInstalled ? gitVer.stdout.split(/\r?\n/)[0].trim() : null,
      path: gitPath || null,
    },
    gh: {
      installed: ghInstalled,
      version: ghInstalled ? ghVer.stdout.split(/\r?\n/)[0].trim() : null,
      path: ghPath || null,
    },
  };
}
