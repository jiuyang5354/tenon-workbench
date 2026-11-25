import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkEnvironmentHealth,
  listAgyModels,
  CODEX_MODEL_PRESETS,
} from './lib/cli-detect.mjs';
import {
  ProviderStore,
  PROVIDER_PRESETS,
  detectLocalAgents,
  testProvider,
  runProvider,
} from './lib/providers.mjs';
import { UpdateManager, readCurrentAppVersion } from './lib/updater.mjs';
import {
  inspectWorkspace,
  getWorkspaceDiff,
  discoverWorkspaces,
  createWorkspaceProject,
} from './lib/workspace.mjs';
import { RunStore } from './lib/store.mjs';
import { WorkflowStore } from './lib/workflows.mjs';
import { Orchestrator, ValidationError, parseProviderRef } from './lib/orchestrator.mjs';
import { runAgy, runCodex } from './lib/runners.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IS_PACKAGED_ASAR = /(?:^|[\\/])app\.asar(?:$|[\\/])/i.test(__dirname);
const UNPACKED_ROOT = IS_PACKAGED_ASAR
  ? __dirname.replace(/([\\/])app\.asar($|[\\/])/i, '$1app.asar.unpacked$2')
  : __dirname;

const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = IS_PACKAGED_ASAR
  ? path.join(os.tmpdir(), 'tenon-workbench-data')
  : path.join(__dirname, 'data');
const TEMPLATES_DIR = path.join(__dirname, 'templates');
const UNPACKED_TEMPLATES_DIR = path.join(UNPACKED_ROOT, 'templates');
const SCRIPTS_DIR = path.join(__dirname, 'scripts');
const UNPACKED_SCRIPTS_DIR = path.join(UNPACKED_ROOT, 'scripts');

const VALID_GATE_ACTIONS = new Set(['approve', 'replan', 'override', 'abort', 'cancel']);

function normalizeFsPath(p) {
  const resolved = path.resolve(String(p || ''));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isPathWithin(baseDir, candidate, { allowEqual = false } = {}) {
  const baseNorm = normalizeFsPath(baseDir);
  const candNorm = normalizeFsPath(candidate);
  if (candNorm === baseNorm) return allowEqual;
  const prefix = baseNorm.endsWith(path.sep) ? baseNorm : `${baseNorm}${path.sep}`;
  return candNorm.startsWith(prefix);
}

function withSoftTimeout(promise, ms, fallbackValue) {
  let timer = null;
  return Promise.race([
    promise.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallbackValue), ms);
      if (typeof timer.unref === 'function') timer.unref();
    }),
  ]);
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const SAFE_MEDIA_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.svg',
  '.mp4',
  '.webm',
  '.mov',
]);

function pipeFileStreamSafely(res, filePath, streamOpts = undefined) {
  const stream = createReadStream(filePath, streamOpts);
  const cleanup = () => {
    if (!stream.destroyed) stream.destroy();
  };
  stream.on('error', () => {
    if (!res.headersSent) {
      sendJson(res, 500, { error: '读取媒体文件失败' });
    } else if (!res.writableEnded) {
      res.destroy();
    }
  });
  res.on('close', cleanup);
  res.on('error', cleanup);
  stream.pipe(res);
}

async function serveWorkspaceMedia(req, res, workspaceDir, relFile) {
  if (!workspaceDir || !relFile) {
    return sendJson(res, 400, { error: '缺少 dir 或 file 参数' });
  }
  if (String(workspaceDir).includes('\0') || String(relFile).includes('\0')) {
    return sendJson(res, 400, { error: '文件路径包含非法空字节' });
  }

  const base = path.resolve(workspaceDir);
  const candidate = path.isAbsolute(relFile) ? path.resolve(relFile) : path.resolve(base, relFile);
  if (!isPathWithin(base, candidate, { allowEqual: false })) {
    return sendJson(res, 403, { error: '拒绝访问工作区目录之外的媒体文件' });
  }
  const ext = path.extname(candidate).toLowerCase();
  if (!SAFE_MEDIA_EXTS.has(ext)) {
    return sendJson(res, 403, { error: '仅允许预览图片或视频媒体文件' });
  }

  let realBase;
  let realCandidate;
  let stat;
  try {
    [realBase, realCandidate] = await Promise.all([fs.realpath(base), fs.realpath(candidate)]);
    stat = await fs.stat(realCandidate);
    if (!stat.isFile()) return sendJson(res, 404, { error: '媒体文件不存在' });
  } catch {
    return sendJson(res, 404, { error: '媒体文件不存在' });
  }

  // Enforce symlink/junction realpath containment inside workspace
  if (!isPathWithin(realBase, realCandidate, { allowEqual: false })) {
    return sendJson(res, 403, { error: '拒绝通过符号链接访问工作区之外的媒体文件' });
  }

  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const baseHeaders = {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (ext === '.svg') {
    baseHeaders['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
  }

  const total = stat.size;
  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
    if (!match || (!match[1] && !match[2]) || total === 0) {
      res.writeHead(416, { 'Content-Range': `bytes */${total}` });
      res.end();
      return;
    }

    let start;
    let end;
    if (!match[1]) {
      // RFC 9110 suffix-byte-range: bytes=-N
      const suffix = Number(match[2]);
      if (!Number.isFinite(suffix) || suffix <= 0) {
        res.writeHead(416, { 'Content-Range': `bytes */${total}` });
        res.end();
        return;
      }
      start = Math.max(0, total - suffix);
      end = total - 1;
    } else {
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
    }

    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= total) {
      res.writeHead(416, { 'Content-Range': `bytes */${total}` });
      res.end();
      return;
    }
    res.writeHead(206, {
      ...baseHeaders,
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Content-Length': end - start + 1,
    });
    pipeFileStreamSafely(res, realCandidate, { start, end });
    return;
  }

  res.writeHead(200, {
    ...baseHeaders,
    'Content-Length': total,
  });
  pipeFileStreamSafely(res, realCandidate);
}

function sendJson(res, status, data) {
  if (res.headersSent) {
    if (!res.writableEnded) res.end();
    return;
  }
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

/**
 * Guards state-mutating POST/PATCH/DELETE endpoints against cross-site browser CSRF requests.
 */
function verifyLocalPostSecurity(req) {
  const origin = req.headers.origin;
  if (origin) {
    try {
      const parsed = new URL(origin);
      const isHttpScheme = parsed.protocol === 'http:' || parsed.protocol === 'https:';
      const isLocal =
        parsed.hostname === '127.0.0.1' ||
        parsed.hostname === 'localhost' ||
        parsed.hostname === '[::1]' ||
        parsed.hostname === '::1';
      if (!isHttpScheme || !isLocal) {
        const err = new ValidationError('拒绝跨站来源请求 (Origin mismatch)');
        err.statusCode = 403;
        throw err;
      }
    } catch (e) {
      if (e.statusCode === 403) throw e;
      const err = new ValidationError('非法 Origin 请求头');
      err.statusCode = 403;
      throw err;
    }
  }

  const fetchSite = req.headers['sec-fetch-site'];
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    const err = new ValidationError('拒绝跨站 Fetch 请求');
    err.statusCode = 403;
    throw err;
  }

  const ct = String(req.headers['content-type'] || '').toLowerCase();
  const hasBody =
    (req.headers['content-length'] && req.headers['content-length'] !== '0') ||
    Boolean(req.headers['transfer-encoding']);
  if (hasBody && !ct.includes('application/json')) {
    const err = new ValidationError('POST 请求必须使用 Content-Type: application/json');
    err.statusCode = 415;
    throw err;
  }
}

async function readJsonBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let rejected = false;
    req.on('data', (chunk) => {
      if (rejected) return;
      size += chunk.length;
      if (size > maxBytes) {
        rejected = true;
        const err = new ValidationError('请求体超过 1MB 限制');
        err.statusCode = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (rejected) return;
      if (chunks.length === 0) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return reject(new ValidationError('请求体必须是 JSON 对象'));
        }
        resolve(parsed);
      } catch {
        reject(new ValidationError('请求体 JSON 格式错误'));
      }
    });
    req.on('error', (err) => {
      if (!rejected) reject(err);
    });
  });
}

async function serveStatic(res, reqPath) {
  if (String(reqPath || '').includes('\0')) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad Request');
    return;
  }
  const cleanPath = reqPath === '/' ? '/index.html' : reqPath;
  const resolved = path.resolve(PUBLIC_DIR, `.${cleanPath}`);
  if (!isPathWithin(PUBLIC_DIR, resolved, { allowEqual: true })) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }
  try {
    const content = await fs.readFile(resolved);
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
}

async function readFirstExistingText(candidates = []) {
  for (const filePath of candidates) {
    if (!filePath) continue;
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch {
      // Try next fallback location
    }
  }
  return '';
}

export async function createWorkbenchServer(options = {}) {
  const dataDir = options.dataDir || DATA_DIR;
  const writableTemplatesDir =
    options.templatesDir || (IS_PACKAGED_ASAR ? path.join(dataDir, 'templates') : TEMPLATES_DIR);
  const defaultWorkspaceDir =
    options.defaultWorkspace || (IS_PACKAGED_ASAR ? os.homedir() : path.resolve(__dirname, '..'));
  const store = new RunStore(dataDir);
  await store.init();
  const providerStore = new ProviderStore(dataDir);
  await providerStore.init();
  const workflowStore = new WorkflowStore(dataDir);
  await workflowStore.init();
  const appVersion = options.appVersion || (await readCurrentAppVersion(__dirname));
  const updater = new UpdateManager({
    currentVersion: appVersion,
    rootDir: __dirname,
    runtime: options.runtime || (process.versions?.electron ? 'electron' : 'node-web'),
    repo: options.updateRepo,
    apiBase: options.updateApiBase,
    downloadDir: options.updateDownloadDir || options.downloadDir,
    fetchImpl: options.updateFetchImpl,
    onRequestQuit: options.onRequestQuit,
  });
  await updater.init();
  const orchestrator = new Orchestrator(store, { providerStore });
  const onPickDirectory = typeof options.onPickDirectory === 'function' ? options.onPickDirectory : null;

  let discoveryCache = { at: 0, data: null };
  let discoveryInFlight = null;
  const getDiscoveredWorkspaces = async (force = false) => {
    const now = Date.now();
    if (!force && discoveryCache.data && now - discoveryCache.at < 20_000) {
      return discoveryCache.data;
    }
    if (!force && discoveryInFlight) {
      return discoveryInFlight;
    }
    const recentRunDirs = store
      .list()
      .slice(0, 12)
      .map((r) => ({ path: r.workspaceDir, timestamp: r.updatedAt || r.createdAt }))
      .filter((r) => r.path);
    const defaultScanRoots = IS_PACKAGED_ASAR
      ? [defaultWorkspaceDir]
      : [__dirname, path.resolve(__dirname, '..'), defaultWorkspaceDir];

    const task = discoverWorkspaces({
      scanRoots: defaultScanRoots,
      recentRunDirs,
      ...(options.workspaceDiscoveryOptions || {}),
    }).then((data) => {
      discoveryCache = { at: Date.now(), data };
      return data;
    });

    discoveryInFlight = task;
    try {
      return await task;
    } finally {
      if (discoveryInFlight === task) discoveryInFlight = null;
    }
  };

  let healthCache = { at: 0, data: null };
  let healthInFlight = null;
  const getEnvironmentHealth = async (force = false) => {
    const now = Date.now();
    if (!force && healthCache.data && now - healthCache.at < 15_000) {
      return healthCache.data;
    }
    if (!force && healthInFlight) {
      return healthInFlight;
    }
    const task = checkEnvironmentHealth()
      .then((data) => {
        healthCache = { at: Date.now(), data };
        return data;
      })
      .catch((err) => ({
        timestamp: new Date().toISOString(),
        platform: process.platform,
        nodeVersion: process.version,
        agy: { installed: false, path: null, status: 'ERROR' },
        codex: { installed: false, version: null, path: null, status: 'ERROR', config: null },
        git: { installed: false, version: null, path: null },
        gh: { installed: false, version: null, path: null },
        probeError: err?.message || 'environment health check failed',
      }));

    healthInFlight = task;
    try {
      return await task;
    } finally {
      if (healthInFlight === task) healthInFlight = null;
    }
  };

  const server = http.createServer(async (req, res) => {
    const method = req.method || 'GET';

    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
      let pathname;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        return sendJson(res, 400, { error: 'URL 路径编码格式错误' });
      }

      if (method === 'POST' || method === 'PATCH' || method === 'DELETE') {
        verifyLocalPostSecurity(req);
      }

      // --- API Routes ---
      if (pathname === '/api/health' && method === 'GET') {
        const forceRefresh = url.searchParams.get('refresh') === '1';
        const fallbackDiscovery = { recommended: null, summary: null };
        const [health, discovery] = await Promise.all([
          getEnvironmentHealth(forceRefresh),
          withSoftTimeout(
            getDiscoveredWorkspaces(forceRefresh).catch(() => fallbackDiscovery),
            6000,
            discoveryCache.data || fallbackDiscovery
          ),
        ]);
        return sendJson(res, 200, {
          ...health,
          appVersion,
          runtime: updater.runtime,
          defaultWorkspace: defaultWorkspaceDir,
          recommendedWorkspace: discovery?.recommended || defaultWorkspaceDir,
          discoveredSummary: discovery?.summary || null,
          capabilities: {
            nativeFolderPicker: Boolean(onPickDirectory),
          },
          workbenchDir: UNPACKED_ROOT,
        });
      }

      if (pathname === '/api/update/info' && method === 'GET') {
        return sendJson(res, 200, updater.getInfo());
      }

      if (pathname === '/api/update/status' && method === 'GET') {
        return sendJson(res, 200, {
          download: updater.downloadState,
          lastCheck: updater.lastCheck,
        });
      }

      if (pathname === '/api/update/check' && (method === 'GET' || method === 'POST')) {
        const result = await updater.checkForUpdates();
        return sendJson(res, 200, {
          ...result,
          info: updater.getInfo(),
        });
      }

      if (pathname === '/api/update/download' && method === 'POST') {
        const body = await readJsonBody(req);
        try {
          const out = await updater.startDownload(body.downloadUrl, body.assetName);
          return sendJson(res, 200, out);
        } catch (err) {
          throw new ValidationError(err.message);
        }
      }

      if (pathname === '/api/update/install' && method === 'POST') {
        try {
          const out = await updater.launchInstaller();
          return sendJson(res, 200, out);
        } catch (err) {
          throw new ValidationError(err.message);
        }
      }

      if (pathname === '/api/models' && method === 'GET') {
        const force = url.searchParams.get('refresh') === '1';
        const agy = await listAgyModels(force);
        return sendJson(res, 200, {
          agy,
          codex: CODEX_MODEL_PRESETS,
          providers: providerStore.listPublic().filter((p) => p.enabled),
        });
      }

      if (pathname === '/api/providers' && method === 'GET') {
        const force = url.searchParams.get('refresh') === '1';
        const localAgents = await detectLocalAgents(force);
        return sendJson(res, 200, {
          providers: providerStore.listPublic(),
          localAgents,
          presets: PROVIDER_PRESETS,
        });
      }

      if (pathname === '/api/providers' && method === 'POST') {
        const body = await readJsonBody(req);
        try {
          const rec = await providerStore.upsert(body);
          return sendJson(res, 200, {
            provider: providerStore.toPublic(rec),
            providers: providerStore.listPublic(),
          });
        } catch (err) {
          throw new ValidationError(err.message);
        }
      }

      if (pathname === '/api/providers/run' && method === 'POST') {
        const body = await readJsonBody(req);
        const provider = providerStore.get(String(body.providerId || '').trim());
        if (!provider) return sendJson(res, 404, { error: '找不到指定的 Agent / API 接入配置' });
        if (!provider.enabled) return sendJson(res, 400, { error: `接入「${provider.name}」当前未启用` });
        const prompt = String(body.prompt || '').trim();
        if (!prompt) throw new ValidationError('请输入要执行的任务需求');
        const cwd = body.cwd ? path.resolve(String(body.cwd)) : defaultWorkspaceDir;
        const model = String(body.model || provider.defaultModel || '').trim();
        const result = await runProvider(provider, {
          prompt,
          systemPrompt: String(body.systemPrompt || '').trim(),
          model,
          cwd,
          timeoutMs: Math.min(240_000, Math.max(10_000, Number(body.timeoutMs) || 120_000)),
        });
        return sendJson(res, result.ok ? 200 : 502, {
          ...result,
          providerId: provider.id,
          providerName: provider.name,
          protocol: provider.protocol,
          model,
        });
      }

      if (pathname === '/api/workflows' && method === 'GET') {
        return sendJson(res, 200, workflowStore.getState());
      }

      if (pathname === '/api/workflows/draft' && method === 'POST') {
        const body = await readJsonBody(req, 3 * 1024 * 1024);
        try {
          const out = await workflowStore.saveDraft(body);
          return sendJson(res, 200, out);
        } catch (err) {
          throw new ValidationError(err.message);
        }
      }

      if (pathname === '/api/workflows' && method === 'POST') {
        const body = await readJsonBody(req, 3 * 1024 * 1024);
        try {
          const workflow = await workflowStore.upsertWorkflow(body);
          return sendJson(res, 200, {
            workflow,
            ...workflowStore.getState(),
          });
        } catch (err) {
          throw new ValidationError(err.message);
        }
      }

      const wfMatch = pathname.match(/^\/api\/workflows\/([^/]+)$/);
      if (wfMatch && wfMatch[1] !== 'draft') {
        const wfId = wfMatch[1];
        if (method === 'PATCH') {
          const body = await readJsonBody(req);
          try {
            const updated = await workflowStore.renameWorkflow(wfId, body.name);
            if (!updated) return sendJson(res, 404, { error: '找不到该已保存的工作流' });
            return sendJson(res, 200, { workflow: updated, ...workflowStore.getState() });
          } catch (err) {
            throw new ValidationError(err.message);
          }
        }
        if (method === 'DELETE') {
          const ok = await workflowStore.deleteWorkflow(wfId);
          if (!ok) return sendJson(res, 404, { error: '找不到该已保存的工作流' });
          return sendJson(res, 200, { ok: true, id: wfId, ...workflowStore.getState() });
        }
      }

      if (pathname === '/api/canvas/node-run' && method === 'POST') {
        const body = await readJsonBody(req);
        const prompt = String(body.prompt || '').trim();
        if (!prompt) throw new ValidationError('请输入该节点要执行的内容或总结指令');
        const cwd = body.cwd ? path.resolve(String(body.cwd)) : defaultWorkspaceDir;
        const nodeKind = String(body.nodeKind || 'summary-card').trim();
        const rawModel = String(body.model || '').trim();
        const systemPrompt = String(body.systemPrompt || '').trim();
        const { timeoutMs, idleTimeoutMs } = orchestrator.resolveTimeoutPolicy(body.timeoutMode || 'none');

        let activeHandle = null;
        let clientAborted = false;
        const onClientClose = () => {
          if (!res.writableEnded) {
            clientAborted = true;
            try { activeHandle?.abort?.(); } catch {}
          }
        };
        req.on('close', onClientClose);
        const onProcess = (handle) => {
          activeHandle = handle;
          if (clientAborted) {
            try { handle?.abort?.(); } catch {}
          }
        };

        const parsedExt = parseProviderRef(rawModel);
        const isReadOnlyKind = ['summary-card', 'gemini-plan', 'gemini-copy', 'codex-review', 'cluster-merge'].includes(nodeKind);
        const requestedSandbox = isReadOnlyKind
          ? 'read-only'
          : (body.sandbox === 'read-only' ? 'read-only' : 'workspace-write');

        try {
          if (parsedExt) {
            const provider = providerStore.get(parsedExt.providerId);
            if (!provider) return sendJson(res, 404, { error: '找不到指定的外部 Agent / API 接入配置' });
            if (!provider.enabled) return sendJson(res, 400, { error: `接入「${provider.name}」当前未启用` });
            const model = parsedExt.model || provider.defaultModel || '';
            const result = await runProvider(provider, {
              prompt,
              systemPrompt,
              model,
              cwd,
              timeoutMs,
              onProcess,
            });
            return sendJson(res, result.ok ? 200 : 502, {
              ...result,
              engine: provider.name,
              protocol: provider.protocol,
              model: model || provider.protocol,
            });
          }

          const isCodexTarget =
            rawModel === 'codex:default' ||
            rawModel.startsWith('codex:') ||
            /^(gpt-|o1|o3|o4|codex)/i.test(rawModel) ||
            (!rawModel && (nodeKind === 'codex-exec' || nodeKind === 'codex-review'));

          if (isCodexTarget) {
            const codexModel = rawModel === 'codex:default'
              ? ''
              : rawModel.startsWith('codex:')
                ? rawModel.slice('codex:'.length).trim()
                : rawModel;
            const wsInfo = await inspectWorkspace(cwd).catch(() => ({ isGitRepo: false }));
            const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
            const result = await runCodex({
              prompt: fullPrompt,
              cwd,
              model: codexModel,
              reasoningEffort: String(body.codexEffort || 'medium').trim() || 'medium',
              sandbox: requestedSandbox,
              allowCodexNetwork: Boolean(body.allowCodexNetwork) && requestedSandbox === 'workspace-write',
              isGitRepo: Boolean(wsInfo?.isGitRepo),
              codexHome: String(body.codexHome || '').trim(),
              timeoutMs,
              idleTimeoutMs,
              onProcess,
            });
            return sendJson(res, result.ok ? 200 : 502, {
              ...result,
              engine: 'Codex',
              protocol: 'codex-cli',
              model: codexModel || 'codex-default',
            });
          }

          const geminiModel = rawModel || String(body.fallbackGeminiModel || 'gemini-4-neon-high').trim();
          const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
          const result = await runAgy({
            prompt: fullPrompt,
            model: geminiModel,
            cwd,
            mode: isReadOnlyKind ? 'plan' : '',
            sandbox: !isReadOnlyKind,
            timeoutMs,
            idleTimeoutMs,
            onProcess,
          });
          return sendJson(res, result.ok ? 200 : 502, {
            ...result,
            engine: 'Gemini',
            protocol: 'agy-cli',
            model: geminiModel,
          });
        } finally {
          req.off('close', onClientClose);
        }
      }

      const provMatch = pathname.match(/^\/api\/providers\/([^/]+)(?:\/(test))?$/);
      if (provMatch) {
        const provId = provMatch[1];
        const sub = provMatch[2] || '';
        const provider = providerStore.get(provId);
        if (!provider) return sendJson(res, 404, { error: '找不到该 Agent / API 接入配置' });

        if (!sub && method === 'DELETE') {
          await providerStore.remove(provId);
          return sendJson(res, 200, {
            ok: true,
            id: provId,
            providers: providerStore.listPublic(),
          });
        }

        if (sub === 'test' && method === 'POST') {
          const result = await testProvider(provider);
          const updated = await providerStore.updateTestStatus(
            provId,
            {
              ok: result.ok,
              testedAt: result.testedAt,
              latencyMs: result.latencyMs,
              detail: result.detail,
            },
            result.discoveredModels || []
          );
          return sendJson(res, 200, {
            result,
            provider: updated ? providerStore.toPublic(updated) : null,
            providers: providerStore.listPublic(),
          });
        }
      }

      if (pathname === '/api/workspace/discover' && method === 'GET') {
        const force = url.searchParams.get('refresh') === '1';
        const data = await getDiscoveredWorkspaces(force);
        return sendJson(res, 200, data);
      }

      if (pathname === '/api/workspace/pick' && method === 'POST') {
        const body = await readJsonBody(req);
        if (!onPickDirectory) {
          return sendJson(res, 200, { supported: false, canceled: true, path: null });
        }
        const picked = await onPickDirectory(String(body.defaultPath || '').trim() || defaultWorkspaceDir);
        return sendJson(res, 200, {
          supported: true,
          canceled: !picked,
          path: picked || null,
        });
      }

      if (pathname === '/api/workspace/create' && method === 'POST') {
        const body = await readJsonBody(req);
        const result = await createWorkspaceProject({
          parentDir: String(body.parentDir || '').trim() || defaultWorkspaceDir,
          name: body.name,
          appendDate: body.appendDate !== false,
          initGit: body.initGit !== false,
          createReadme: body.createReadme !== false,
        });
        discoveryCache = { at: 0, data: null };
        return sendJson(res, 201, result);
      }

      if (pathname === '/api/workspace/inspect' && method === 'GET') {
        const dir = url.searchParams.get('dir') || defaultWorkspaceDir;
        const info = await inspectWorkspace(dir);
        return sendJson(res, info.ok ? 200 : 400, info);
      }

      if (pathname === '/api/workspace/diff' && method === 'GET') {
        const dir = url.searchParams.get('dir') || defaultWorkspaceDir;
        const info = await getWorkspaceDiff(dir);
        return sendJson(res, 200, info);
      }

      if (pathname === '/api/workspace/media' && method === 'GET') {
        const dir = url.searchParams.get('dir') || defaultWorkspaceDir;
        const file = url.searchParams.get('file') || '';
        return await serveWorkspaceMedia(req, res, dir, file);
      }

      if (pathname === '/api/runs' && method === 'GET') {
        return sendJson(res, 200, {
          runs: store.list().map((r) => store.summarize(r)),
        });
      }

      if (pathname === '/api/runs' && method === 'POST') {
        const body = await readJsonBody(req);
        const run = await orchestrator.startRun(body);
        return sendJson(res, 201, { run });
      }

      if (pathname === '/api/events' && method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        if (typeof res.flushHeaders === 'function') res.flushHeaders();
        res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);
        store.subscribeGlobal(res);
        let cleaned = false;
        let hb = null;
        const cleanup = () => {
          if (cleaned) return;
          cleaned = true;
          if (hb) clearInterval(hb);
          store.unsubscribeGlobal(res);
        };
        hb = setInterval(() => {
          if (res.writableEnded || res.destroyed || res.closed) {
            cleanup();
            return;
          }
          try {
            res.write(': heartbeat\n\n');
          } catch {
            cleanup();
          }
        }, 20_000);
        if (typeof hb.unref === 'function') hb.unref();
        req.on('close', cleanup);
        res.on('close', cleanup);
        res.on('error', cleanup);
        return;
      }

      const runMatch = pathname.match(/^\/api\/runs\/([^/]+)(?:\/(stream|approve|cancel|diff|message|steer))?$/);
      if (runMatch) {
        const runId = runMatch[1];
        const sub = runMatch[2] || '';
        const run = store.get(runId);
        if (!run) return sendJson(res, 404, { error: '找不到该运行记录' });

        if (!sub && method === 'GET') {
          return sendJson(res, 200, { run });
        }

        if (!sub && method === 'PATCH') {
          const body = await readJsonBody(req);
          const updated = store.update(runId, (r) => {
            if (typeof body.title === 'string' && body.title.trim()) {
              r.title = body.title.trim().slice(0, 100);
            }
            if (typeof body.pinned === 'boolean') {
              r.pinned = body.pinned;
            }
          });
          return sendJson(res, 200, { run: store.summarize(updated) });
        }

        if (!sub && method === 'DELETE') {
          orchestrator.cleanupRun(runId);
          store.remove(runId);
          return sendJson(res, 200, { ok: true, id: runId });
        }

        if (sub === 'stream' && method === 'GET') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          });
          if (typeof res.flushHeaders === 'function') res.flushHeaders();
          res.write(`event: state\ndata: ${JSON.stringify(run)}\n\n`);
          store.subscribe(runId, res);
          let cleaned = false;
          let hb = null;
          const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            if (hb) clearInterval(hb);
            store.unsubscribe(runId, res);
          };
          hb = setInterval(() => {
            if (res.writableEnded || res.destroyed || res.closed) {
              cleanup();
              return;
            }
            try {
              res.write(': heartbeat\n\n');
            } catch {
              cleanup();
            }
          }, 15_000);
          if (typeof hb.unref === 'function') hb.unref();
          req.on('close', cleanup);
          res.on('close', cleanup);
          res.on('error', cleanup);
          return;
        }

        if (sub === 'message' && method === 'POST') {
          const body = await readJsonBody(req);
          const updated = await orchestrator.continueChat(runId, body);
          return sendJson(res, 200, { run: updated });
        }

        if (sub === 'steer' && method === 'POST') {
          const body = await readJsonBody(req);
          const out = await orchestrator.steerRun(runId, body);
          return sendJson(res, 200, out);
        }

        if (sub === 'steer' && method === 'DELETE') {
          const ok = orchestrator.clearPendingSteer(runId);
          return sendJson(res, 200, { ok, run: store.get(runId) });
        }

        if (sub === 'approve' && method === 'POST') {
          const body = await readJsonBody(req);
          const action = String(body.action || 'approve').trim();
          if (!VALID_GATE_ACTIONS.has(action)) {
            throw new ValidationError(`不支持的闸门决策操作：${action}`);
          }
          const ok = orchestrator.resolveGate(runId, {
            action,
            spec: body.spec || '',
            feedback: body.feedback || '',
          });
          if (!ok) return sendJson(res, 409, { error: '当前任务不处于等待拍板状态' });
          return sendJson(res, 200, { ok: true });
        }

        if (sub === 'cancel' && method === 'POST') {
          const ok = orchestrator.cancelRun(runId);
          return sendJson(res, 200, { ok });
        }

        if (sub === 'diff' && method === 'GET') {
          const info = await getWorkspaceDiff(run.effectiveWorkDir || run.workspaceDir);
          return sendJson(res, 200, info);
        }
      }

      if (pathname === '/api/assets' && method === 'GET') {
        const readTemplate = (name) =>
          readFirstExistingText([
            path.join(writableTemplatesDir, name),
            UNPACKED_TEMPLATES_DIR !== TEMPLATES_DIR ? path.join(UNPACKED_TEMPLATES_DIR, name) : null,
            path.join(TEMPLATES_DIR, name),
          ]);
        const readScript = (name) =>
          readFirstExistingText([
            UNPACKED_SCRIPTS_DIR !== SCRIPTS_DIR ? path.join(UNPACKED_SCRIPTS_DIR, name) : null,
            path.join(SCRIPTS_DIR, name),
          ]);
        const [geminiMd, codexMd, geminiAskJs, codexWorkerJs, codexReviewJs] = await Promise.all([
          readTemplate('GEMINI.md'),
          readTemplate('CODEX.md'),
          readScript('gemini-ask.mjs'),
          readScript('codex-worker.mjs'),
          readScript('codex-review.mjs'),
        ]);
        return sendJson(res, 200, {
          templates: {
            'GEMINI.md': geminiMd,
            'CODEX.md': codexMd,
          },
          scripts: {
            'scripts/gemini-ask.mjs': geminiAskJs,
            'scripts/codex-worker.mjs': codexWorkerJs,
            'scripts/codex-review.mjs': codexReviewJs,
          },
          workbenchDir: UNPACKED_ROOT,
        });
      }

      if (pathname === '/api/templates' && method === 'POST') {
        const body = await readJsonBody(req);
        const allowed = new Set(['GEMINI.md', 'CODEX.md']);
        if (!allowed.has(body.filename)) {
          return sendJson(res, 400, { error: '仅允许保存 GEMINI.md 或 CODEX.md 模板' });
        }
        const target = path.join(writableTemplatesDir, body.filename);
        await fs.mkdir(writableTemplatesDir, { recursive: true });
        await fs.writeFile(target, String(body.content || ''), 'utf8');
        return sendJson(res, 200, { ok: true, filename: body.filename });
      }

      // --- Static Files ---
      if (method === 'GET') {
        return await serveStatic(res, pathname);
      }

      return sendJson(res, 404, { error: 'Not Found' });
    } catch (err) {
      const statusCode = Number(err.statusCode) || 500;
      return sendJson(res, statusCode, { error: err.message || 'Internal Server Error' });
    }
  });

  return { server, store, orchestrator, providerStore, workflowStore, updater };
}

// Start standalone when run directly
const isDirectRun = Boolean(
  process.argv[1] && normalizeFsPath(process.argv[1]) === normalizeFsPath(__filename)
);
if (isDirectRun) {
  const PORT = Number(process.env.PORT) || 4177;
  const HOST = process.env.HOST || '127.0.0.1';
  const { server, store, orchestrator, workflowStore } = await createWorkbenchServer();

  const gracefulExit = () => {
    orchestrator.shutdown();
    store.closeAllStreams();
    void Promise.allSettled([store.flush(), workflowStore.flush()]).finally(() => {
      server.close(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', gracefulExit);
  process.on('SIGTERM', gracefulExit);

  server.listen(PORT, HOST, () => {
    console.log(`[TENON] Multi-Agent Workbench running at http://${HOST}:${PORT}`);
  });
}
