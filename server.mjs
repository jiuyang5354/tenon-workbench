import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
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
import { inspectWorkspace, getWorkspaceDiff, discoverWorkspaces } from './lib/workspace.mjs';
import { RunStore } from './lib/store.mjs';
import { Orchestrator, ValidationError } from './lib/orchestrator.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, 'public');
const PUBLIC_PREFIX = `${PUBLIC_DIR}${path.sep}`;
const DATA_DIR = path.join(__dirname, 'data');
const TEMPLATES_DIR = path.join(__dirname, 'templates');
const SCRIPTS_DIR = path.join(__dirname, 'scripts');

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

async function serveWorkspaceMedia(req, res, workspaceDir, relFile) {
  if (!workspaceDir || !relFile) {
    return sendJson(res, 400, { error: '缺少 dir 或 file 参数' });
  }
  const base = path.resolve(workspaceDir);
  const candidate = path.isAbsolute(relFile) ? path.resolve(relFile) : path.resolve(base, relFile);
  const baseNorm = process.platform === 'win32' ? base.toLowerCase() : base;
  const candNorm = process.platform === 'win32' ? candidate.toLowerCase() : candidate;
  const prefix = baseNorm.endsWith(path.sep) ? baseNorm : `${baseNorm}${path.sep}`;
  if (candNorm !== baseNorm && !candNorm.startsWith(prefix)) {
    return sendJson(res, 403, { error: '拒绝访问工作区目录之外的媒体文件' });
  }
  const ext = path.extname(candidate).toLowerCase();
  if (!SAFE_MEDIA_EXTS.has(ext)) {
    return sendJson(res, 403, { error: '仅允许预览图片或视频媒体文件' });
  }
  let stat;
  try {
    stat = await fs.stat(candidate);
    if (!stat.isFile()) return sendJson(res, 404, { error: '媒体文件不存在' });
  } catch {
    return sendJson(res, 404, { error: '媒体文件不存在' });
  }

  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const total = stat.size;
  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      res.writeHead(416, { 'Content-Range': `bytes */${total}` });
      res.end();
      return;
    }
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
    if (start > end || start >= total) {
      res.writeHead(416, { 'Content-Range': `bytes */${total}` });
      res.end();
      return;
    }
    res.writeHead(206, {
      'Content-Type': contentType,
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Cache-Control': 'no-store',
    });
    createReadStream(candidate, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Content-Length': total,
    'Cache-Control': 'no-store',
  });
  createReadStream(candidate).pipe(res);
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/**
 * Guards state-mutating POST endpoints against cross-site browser CSRF requests.
 */
function verifyLocalPostSecurity(req) {
  const origin = req.headers.origin;
  if (origin) {
    try {
      const parsed = new URL(origin);
      const isLocal = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '[::1]';
      if (!isLocal) {
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
  if (req.headers['content-length'] && req.headers['content-length'] !== '0' && !ct.includes('application/json')) {
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
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
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
  const cleanPath = reqPath === '/' ? '/index.html' : reqPath;
  const resolved = path.resolve(PUBLIC_DIR, `.${cleanPath}`);
  if (resolved !== PUBLIC_DIR && !resolved.startsWith(PUBLIC_PREFIX)) {
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
    });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
}

export async function createWorkbenchServer(options = {}) {
  const dataDir = options.dataDir || DATA_DIR;
  const writableTemplatesDir = options.templatesDir || TEMPLATES_DIR;
  const defaultWorkspaceDir = options.defaultWorkspace || path.resolve(__dirname, '..');
  const store = new RunStore(dataDir);
  await store.init();
  const providerStore = new ProviderStore(dataDir);
  await providerStore.init();
  const appVersion = options.appVersion || (await readCurrentAppVersion(__dirname));
  const updater = new UpdateManager({
    currentVersion: appVersion,
    rootDir: __dirname,
    runtime: options.runtime || (process.versions?.electron ? 'electron' : 'node-web'),
    repo: options.updateRepo,
    apiBase: options.updateApiBase,
    fetchImpl: options.updateFetchImpl,
    onRequestQuit: options.onRequestQuit,
  });
  await updater.init();
  const orchestrator = new Orchestrator(store, { providerStore });
  const onPickDirectory = typeof options.onPickDirectory === 'function' ? options.onPickDirectory : null;

  let discoveryCache = { at: 0, data: null };
  const getDiscoveredWorkspaces = async (force = false) => {
    const now = Date.now();
    if (!force && discoveryCache.data && now - discoveryCache.at < 20_000) {
      return discoveryCache.data;
    }
    const recentRunDirs = store
      .list()
      .slice(0, 12)
      .map((r) => ({ path: r.workspaceDir, timestamp: r.updatedAt || r.createdAt }))
      .filter((r) => r.path);
    const data = await discoverWorkspaces({
      scanRoots: [__dirname, path.resolve(__dirname, '..'), defaultWorkspaceDir],
      recentRunDirs,
      ...(options.workspaceDiscoveryOptions || {}),
    });
    discoveryCache = { at: Date.now(), data };
    return data;
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
        const [health, discovery] = await Promise.all([
          checkEnvironmentHealth(),
          getDiscoveredWorkspaces(false).catch(() => ({ recommended: null, summary: null })),
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
          workbenchDir: __dirname,
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
        const cwd = body.cwd ? path.resolve(String(body.cwd)) : __dirname;
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
            provider: providerStore.toPublic(updated),
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

      if (pathname === '/api/workspace/inspect' && method === 'GET') {
        const dir = url.searchParams.get('dir') || __dirname;
        const info = await inspectWorkspace(dir);
        return sendJson(res, info.ok ? 200 : 400, info);
      }

      if (pathname === '/api/workspace/diff' && method === 'GET') {
        const dir = url.searchParams.get('dir') || __dirname;
        const info = await getWorkspaceDiff(dir);
        return sendJson(res, 200, info);
      }

      if (pathname === '/api/workspace/media' && method === 'GET') {
        const dir = url.searchParams.get('dir') || __dirname;
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
        });
        res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);
        store.subscribeGlobal(res);
        const hb = setInterval(() => {
          try {
            res.write(': heartbeat\n\n');
          } catch {
            clearInterval(hb);
          }
        }, 20_000);
        req.on('close', () => {
          clearInterval(hb);
          store.unsubscribeGlobal(res);
        });
        return;
      }

      const runMatch = pathname.match(/^\/api\/runs\/([^/]+)(?:\/(stream|approve|cancel|diff))?$/);
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
          orchestrator.cancelRun(runId);
          store.remove(runId);
          return sendJson(res, 200, { ok: true, id: runId });
        }

        if (sub === 'stream' && method === 'GET') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
          });
          res.write(`event: state\ndata: ${JSON.stringify(run)}\n\n`);
          store.subscribe(runId, res);
          const hb = setInterval(() => {
            try {
              res.write(': heartbeat\n\n');
            } catch {
              clearInterval(hb);
            }
          }, 15_000);
          req.on('close', () => {
            clearInterval(hb);
            store.unsubscribe(runId, res);
          });
          return;
        }

        if (sub === 'approve' && method === 'POST') {
          const body = await readJsonBody(req);
          const ok = orchestrator.resolveGate(runId, {
            action: body.action || 'approve',
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
        const readTemplate = async (name) => {
          const override = await fs.readFile(path.join(writableTemplatesDir, name), 'utf8').catch(() => '');
          if (override) return override;
          return fs.readFile(path.join(TEMPLATES_DIR, name), 'utf8').catch(() => '');
        };
        const [geminiMd, codexMd, geminiAskJs, codexWorkerJs, codexReviewJs] = await Promise.all([
          readTemplate('GEMINI.md'),
          readTemplate('CODEX.md'),
          fs.readFile(path.join(SCRIPTS_DIR, 'gemini-ask.mjs'), 'utf8').catch(() => ''),
          fs.readFile(path.join(SCRIPTS_DIR, 'codex-worker.mjs'), 'utf8').catch(() => ''),
          fs.readFile(path.join(SCRIPTS_DIR, 'codex-review.mjs'), 'utf8').catch(() => ''),
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
          workbenchDir: __dirname,
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

  return { server, store, orchestrator, providerStore, updater };
}

// Start standalone when run directly
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isDirectRun) {
  const PORT = Number(process.env.PORT) || 4177;
  const HOST = process.env.HOST || '127.0.0.1';
  const { server, orchestrator } = await createWorkbenchServer();

  const gracefulExit = () => {
    orchestrator.shutdown();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', gracefulExit);
  process.on('SIGTERM', gracefulExit);

  server.listen(PORT, HOST, () => {
    console.log(`[TENON] Multi-Agent Workbench running at http://${HOST}:${PORT}`);
  });
}
