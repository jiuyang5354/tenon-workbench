import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_REPO = 'jiuyang5354/tenon-workbench';

const ALLOWED_DOWNLOAD_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'github-releases.githubusercontent.com',
]);

/**
 * Compares two SemVer strings (e.g. "v1.2.0" vs "1.1.9").
 * Returns 1 if a > b, -1 if a < b, 0 if equal.
 */
export function compareSemver(a = '0.0.0', b = '0.0.0') {
  const parse = (v) => {
    const clean = String(v || '').trim().replace(/^v/i, '');
    const [core, pre = ''] = clean.split('-', 2);
    const nums = core.split('.').map((n) => {
      const parsed = Number.parseInt(n, 10);
      return Number.isFinite(parsed) ? parsed : 0;
    });
    while (nums.length < 3) nums.push(0);
    return { nums: nums.slice(0, 3), pre };
  };

  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i += 1) {
    if (pa.nums[i] > pb.nums[i]) return 1;
    if (pa.nums[i] < pb.nums[i]) return -1;
  }
  // Stable release > prerelease of same core version
  if (!pa.pre && pb.pre) return 1;
  if (pa.pre && !pb.pre) return -1;
  if (pa.pre !== pb.pre) return pa.pre > pb.pre ? 1 : -1;
  return 0;
}

export function isAllowedDownloadUrl(urlStr, repo = DEFAULT_REPO) {
  let parsed;
  try {
    parsed = new URL(String(urlStr || '').trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_DOWNLOAD_HOSTS.has(host)) return false;
  if (host === 'github.com') {
    const normPath = parsed.pathname.toLowerCase();
    if (!normPath.startsWith(`/${repo.toLowerCase()}/releases/`)) return false;
  }
  return true;
}

export async function readCurrentAppVersion(rootDir = path.resolve(__dirname, '..')) {
  try {
    const raw = await fs.readFile(path.join(rootDir, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw);
    return String(pkg.version || '1.0.0').trim();
  } catch {
    return '1.0.0';
  }
}

export function selectPlatformAsset(assets = [], platform = process.platform) {
  if (!Array.isArray(assets) || assets.length === 0) return null;
  if (platform === 'win32') {
    return (
      assets.find((a) => /setup.*\.exe$/i.test(a.name || '')) ||
      assets.find((a) => /\.exe$/i.test(a.name || '')) ||
      assets.find((a) => /\.msi$/i.test(a.name || '')) ||
      null
    );
  }
  if (platform === 'darwin') {
    return assets.find((a) => /\.dmg$/i.test(a.name || '')) || null;
  }
  return assets.find((a) => /\.AppImage$/i.test(a.name || '')) || null;
}

/**
 * Self-contained update manager supporting GitHub Releases checks, safe installer download
 * with live byte progress, and Windows Setup .exe handoff.
 */
export class UpdateManager {
  constructor(options = {}) {
    this.repo = options.repo || DEFAULT_REPO;
    this.runtime = options.runtime || (process.versions?.electron ? 'electron' : 'node-web');
    this.currentVersion = options.currentVersion || '1.0.0';
    this.rootDir = options.rootDir || path.resolve(__dirname, '..');
    this.apiBase = (options.apiBase || 'https://api.github.com').replace(/\/+$/, '');
    this.onRequestQuit = typeof options.onRequestQuit === 'function' ? options.onRequestQuit : null;
    this.downloadDir = options.downloadDir || path.join(os.tmpdir(), 'tenon-updates');
    this.fetchImpl = options.fetchImpl || globalThis.fetch;

    this.lastCheck = null;
    this.downloadState = {
      state: 'idle', // idle | downloading | downloaded | error
      progress: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      assetName: '',
      filePath: '',
      version: '',
      error: null,
    };
    this.activeAbort = null;
  }

  async init() {
    if (!this.currentVersion || this.currentVersion === '0.0.0') {
      this.currentVersion = await readCurrentAppVersion(this.rootDir);
    }
  }

  getInfo() {
    return {
      appName: 'TENON（榫）',
      currentVersion: this.currentVersion,
      repo: this.repo,
      repoUrl: `https://github.com/${this.repo}`,
      releasesUrl: `https://github.com/${this.repo}/releases`,
      runtime: this.runtime,
      isDesktopApp: this.runtime === 'electron',
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      electronVersion: process.versions?.electron || null,
      lastCheck: this.lastCheck,
      download: { ...this.downloadState },
    };
  }

  async checkForUpdates() {
    const checkedAt = new Date().toISOString();
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': `TENON-Workbench/${this.currentVersion}`,
    };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    try {
      const latestUrl = `${this.apiBase}/repos/${this.repo}/releases/latest`;
      let res = await this.fetchImpl(latestUrl, { headers, signal: ctrl.signal });

      // If no published Release exists yet (HTTP 404), gracefully check tags or package.json on main
      if (res.status === 404) {
        const tagsRes = await this.fetchImpl(`${this.apiBase}/repos/${this.repo}/tags?per_page=5`, {
          headers,
          signal: ctrl.signal,
        });
        if (tagsRes.ok) {
          const tags = await tagsRes.json().catch(() => []);
          const topTag = Array.isArray(tags) && tags[0]?.name ? String(tags[0].name) : '';
          const latestVersion = topTag ? topTag.replace(/^v/i, '') : this.currentVersion;
          const hasUpdate = Boolean(topTag) && compareSemver(latestVersion, this.currentVersion) > 0;
          const result = {
            ok: true,
            checkedAt,
            currentVersion: this.currentVersion,
            latestVersion,
            hasUpdate,
            source: topTag ? 'github-tag' : 'no-release-yet',
            releaseName: topTag ? `TENON ${topTag}` : `TENON v${this.currentVersion}`,
            releaseNotes: topTag
              ? `检测到远端版本标签 ${topTag}，可前往 GitHub 查看更新说明。`
              : '远端仓库尚未发布新版 Release，当前已为最新开发构建。',
            publishedAt: null,
            releaseUrl: `https://github.com/${this.repo}/releases`,
            downloadUrl: null,
            assetName: null,
            assetSize: 0,
            error: null,
          };
          this.lastCheck = result;
          return result;
        }
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        const rateLimited = res.status === 403 && /rate limit/i.test(errText);
        const result = {
          ok: false,
          checkedAt,
          currentVersion: this.currentVersion,
          latestVersion: null,
          hasUpdate: false,
          source: 'github-release',
          releaseUrl: `https://github.com/${this.repo}/releases`,
          downloadUrl: null,
          assetName: null,
          assetSize: 0,
          error: rateLimited
            ? 'GitHub API 访问频次已达本机限额，请稍后再试或直接打开发布页查看。'
            : `检测更新失败 (HTTP ${res.status})：${errText.slice(0, 160)}`,
        };
        this.lastCheck = result;
        return result;
      }

      const rel = await res.json();
      const rawTag = String(rel.tag_name || rel.name || '').trim();
      const latestVersion = rawTag.replace(/^v/i, '') || this.currentVersion;
      const hasUpdate = compareSemver(latestVersion, this.currentVersion) > 0;
      const asset = selectPlatformAsset(rel.assets || [], process.platform);

      const result = {
        ok: true,
        checkedAt,
        currentVersion: this.currentVersion,
        latestVersion,
        hasUpdate,
        source: 'github-release',
        releaseName: rel.name || `TENON v${latestVersion}`,
        releaseNotes: String(rel.body || '').trim(),
        publishedAt: rel.published_at || null,
        releaseUrl: rel.html_url || `https://github.com/${this.repo}/releases`,
        downloadUrl: asset?.browser_download_url || null,
        assetName: asset?.name || null,
        assetSize: Number(asset?.size) || 0,
        error: null,
      };
      this.lastCheck = result;
      return result;
    } catch (err) {
      const result = {
        ok: false,
        checkedAt,
        currentVersion: this.currentVersion,
        latestVersion: null,
        hasUpdate: false,
        source: 'network-error',
        releaseUrl: `https://github.com/${this.repo}/releases`,
        downloadUrl: null,
        assetName: null,
        assetSize: 0,
        error:
          err.name === 'AbortError'
            ? '连接 GitHub Releases 超时（超过 12s），请检查网络或代理设置后重试。'
            : `无法连接更新服务器：${err.message}`,
      };
      this.lastCheck = result;
      return result;
    } finally {
      clearTimeout(timer);
    }
  }

  async startDownload(explicitUrl = '', explicitName = '') {
    if (this.downloadState.state === 'downloading') {
      return { ok: true, download: { ...this.downloadState } };
    }

    const url = String(explicitUrl || this.lastCheck?.downloadUrl || '').trim();
    if (!url) {
      throw new Error('当前发布版本未包含可直接下载的 Windows 安装包 (.exe)');
    }
    if (!isAllowedDownloadUrl(url, this.repo)) {
      throw new Error('安全拦截：仅允许从官方 GitHub Releases 域名下载更新安装包');
    }

    const rawName = String(explicitName || this.lastCheck?.assetName || 'TENON-Setup-Update.exe').trim();
    const safeName = path.basename(rawName).replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!/\.(exe|msi|dmg|AppImage)$/i.test(safeName)) {
      throw new Error('安装包文件名后缀不受支持');
    }

    await fs.mkdir(this.downloadDir, { recursive: true });
    const targetPath = path.join(this.downloadDir, safeName);
    const tmpPath = `${targetPath}.part`;

    const ctrl = new AbortController();
    this.activeAbort = ctrl;
    this.downloadState = {
      state: 'downloading',
      progress: 0,
      downloadedBytes: 0,
      totalBytes: Number(this.lastCheck?.assetSize) || 0,
      assetName: safeName,
      filePath: targetPath,
      version: this.lastCheck?.latestVersion || '',
      error: null,
    };

    // Kick off streaming download asynchronously so UI can poll `/api/update/status` smoothly
    (async () => {
      try {
        const res = await this.fetchImpl(url, {
          headers: { 'User-Agent': `TENON-Workbench/${this.currentVersion}` },
          redirect: 'follow',
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error(`下载响应异常 (HTTP ${res.status})`);
        }
        const total = Number(res.headers.get('content-length')) || this.downloadState.totalBytes || 0;
        this.downloadState.totalBytes = total;

        const outStream = createWriteStream(tmpPath);
        const reader = res.body.getReader();
        let received = 0;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          received += value.byteLength;
          outStream.write(Buffer.from(value));
          this.downloadState.downloadedBytes = received;
          this.downloadState.progress = total > 0 ? Math.min(99, Math.round((received / total) * 100)) : 50;
        }

        await new Promise((resolve, reject) => {
          outStream.on('finish', resolve);
          outStream.on('error', reject);
          outStream.end();
        });

        await fs.rename(tmpPath, targetPath);
        this.downloadState.state = 'downloaded';
        this.downloadState.progress = 100;
        this.downloadState.downloadedBytes = received;
        this.downloadState.totalBytes = received;
      } catch (err) {
        await fs.unlink(tmpPath).catch(() => {});
        this.downloadState.state = 'error';
        this.downloadState.error = err.name === 'AbortError' ? '下载已取消' : `下载失败：${err.message}`;
      } finally {
        if (this.activeAbort === ctrl) this.activeAbort = null;
      }
    })();

    return { ok: true, download: { ...this.downloadState } };
  }

  async launchInstaller() {
    if (this.downloadState.state !== 'downloaded' || !this.downloadState.filePath) {
      throw new Error('尚未完成更新包下载，请先下载安装包');
    }
    const target = path.resolve(this.downloadState.filePath);
    const dirPrefix = `${path.resolve(this.downloadDir)}${path.sep}`;
    if (!target.startsWith(dirPrefix)) {
      throw new Error('拒绝启动非受管更新目录中的程序');
    }
    const stat = await fs.stat(target).catch(() => null);
    if (!stat || !stat.isFile()) {
      throw new Error('找不到已下载的安装包文件，请重新下载');
    }

    const child = spawn(target, [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();

    // If running inside Electron desktop app, gracefully quit after handoff so installer can replace files cleanly
    if (this.onRequestQuit) {
      setTimeout(() => {
        try { this.onRequestQuit(); } catch { /* ignore */ }
      }, 650).unref();
    }

    return {
      ok: true,
      launched: true,
      filePath: target,
      willQuitApp: Boolean(this.onRequestQuit),
    };
  }
}
