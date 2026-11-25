import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, Menu, shell, dialog, ipcMain, nativeTheme } from 'electron';
import { hydrateRuntimePath, killAllActiveChildrenSync } from '../lib/runners.mjs';
import { createWorkbenchServer } from '../server.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const VALID_SURFACES = new Set(['weave', 'paper', 'charcoal']);

let mainWindow = null;
let workbench = null;
let serverUrl = '';
let isShuttingDown = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function resolveUnpackedPath(...segments) {
  const raw = path.join(ROOT_DIR, ...segments);
  if (app.isPackaged) {
    const unpacked = raw.replace(/app\.asar([\\/])/i, 'app.asar.unpacked$1');
    if (fsSync.existsSync(unpacked)) return unpacked;
  }
  return raw;
}

function isUsableRealDir(dirPath) {
  if (!dirPath || typeof dirPath !== 'string') return false;
  if (/\.asar(?:[\\/]|$)/i.test(dirPath)) return false;
  try {
    return fsSync.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function resolveDefaultWorkspace() {
  const candidates = [
    os.homedir(),
    (() => { try { return app.getPath('documents'); } catch { return ''; } })(),
    (() => { try { return app.getPath('home'); } catch { return ''; } })(),
  ];
  for (const dir of candidates) {
    if (isUsableRealDir(dir)) return path.resolve(dir);
  }
  return os.homedir();
}

function getChromePrefsPath() {
  return path.join(app.getPath('userData'), 'ui-chrome.json');
}

let lastSavedSurface = null;

function readSavedSurface() {
  try {
    const raw = fsSync.readFileSync(getChromePrefsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (VALID_SURFACES.has(parsed?.surface)) {
      lastSavedSurface = parsed.surface;
      return parsed.surface;
    }
  } catch {
    // First launch or unreadable prefs — default to Weave daylight
  }
  return 'weave';
}

function saveSurfacePreference(surface) {
  if (!VALID_SURFACES.has(surface) || surface === lastSavedSurface) return;
  try {
    const prefsPath = getChromePrefsPath();
    fsSync.mkdirSync(path.dirname(prefsPath), { recursive: true });
    fsSync.writeFileSync(prefsPath, JSON.stringify({ surface }, null, 2), 'utf8');
    lastSavedSurface = surface;
  } catch {
    // Best-effort UI preference persistence
  }
}

function listenWithFallback(server, preferredPort = 4177, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const onPreferredErr = (err) => {
      if (err.code === 'EADDRINUSE' && preferredPort !== 0) {
        server.removeListener('error', onPreferredErr);
        const onFallbackErr = (fallbackErr) => reject(fallbackErr);
        server.once('error', onFallbackErr);
        server.listen(0, host, () => {
          server.removeListener('error', onFallbackErr);
          const addr = server.address();
          resolve(addr.port);
        });
      } else {
        reject(err);
      }
    };
    server.once('error', onPreferredErr);
    server.listen(preferredPort, host, () => {
      server.removeListener('error', onPreferredErr);
      const addr = server.address();
      resolve(addr.port);
    });
  });
}

async function startEmbeddedWorkbench() {
  // Hydrate PATH before initializing server/workspace/providers so Explorer/Start Menu launches
  // reliably find agy, codex, claude, git, gh, node, npm, etc.
  hydrateRuntimePath({ mergeRegistry: true });

  const userDataDir = app.getPath('userData');
  const dataDir = path.join(userDataDir, 'data');
  const templatesDir = path.join(userDataDir, 'templates');
  const updatesDir = path.join(userDataDir, 'updates');
  const defaultWorkspace = resolveDefaultWorkspace();

  // Route updater downloads into writable per-userData directory (isolated & safe from %TEMP% GPO)
  process.env.TENON_UPDATE_DIR = updatesDir;

  workbench = await createWorkbenchServer({
    dataDir,
    templatesDir,
    defaultWorkspace,
    runtime: 'electron',
    appVersion: app.getVersion(),
    onPickDirectory: async (defaultPath) => {
      const targetWin = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
      const safeDefault = isUsableRealDir(defaultPath) ? path.resolve(defaultPath) : defaultWorkspace;
      const result = await dialog.showOpenDialog(targetWin, {
        title: '选择目标工程目录',
        defaultPath: safeDefault,
        properties: ['openDirectory'],
      });
      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return null;
      }
      return result.filePaths[0];
    },
    onRequestQuit: () => {
      app.quit();
    },
  });

  const preferred = Number(process.env.PORT) || 4177;
  const port = await listenWithFallback(workbench.server, preferred, '127.0.0.1');
  serverUrl = `http://127.0.0.1:${port}/`;
  return serverUrl;
}

function resolveTitleBarPalette(surface = 'weave') {
  if (surface === 'charcoal') {
    return { themeSource: 'dark', bg: '#1c1e21', overlayColor: '#1c1e21', symbolColor: '#e6eaf2' };
  }
  if (surface === 'paper') {
    return { themeSource: 'light', bg: '#f3f2ee', overlayColor: '#f3f2ee', symbolColor: '#141413' };
  }
  return { themeSource: 'light', bg: '#eff1f4', overlayColor: '#eff1f4', symbolColor: '#111315' };
}

function applyWindowChromeTheme(win, rawSurface = 'weave') {
  const surface = VALID_SURFACES.has(rawSurface) ? rawSurface : 'weave';
  const pal = resolveTitleBarPalette(surface);
  saveSurfacePreference(surface);
  try {
    nativeTheme.themeSource = pal.themeSource;
  } catch { /* ignore */ }
  if (!win || win.isDestroyed()) return;
  try {
    win.setBackgroundColor(pal.bg);
  } catch { /* ignore */ }
  if (process.platform !== 'darwin' && typeof win.setTitleBarOverlay === 'function') {
    try {
      win.setTitleBarOverlay({
        color: pal.overlayColor,
        symbolColor: pal.symbolColor,
        height: 47,
      });
    } catch { /* ignore */ }
  }
}

ipcMain.on('tenon:titlebar-theme', (event, surface) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  applyWindowChromeTheme(win, typeof surface === 'string' ? surface : 'weave');
});

function isSameServerOrigin(targetUrl) {
  if (!serverUrl || !targetUrl) return false;
  try {
    return new URL(targetUrl).origin === new URL(serverUrl).origin;
  } catch {
    return false;
  }
}

function createMainWindow(url) {
  const iconCandidate = resolveUnpackedPath('build', 'icon.ico');
  const iconPath = fsSync.existsSync(iconCandidate) ? iconCandidate : undefined;
  const isMac = process.platform === 'darwin';
  const initialSurface = readSavedSurface();
  const initialPal = resolveTitleBarPalette(initialSurface);
  try {
    nativeTheme.themeSource = initialPal.themeSource;
  } catch { /* ignore */ }

  const windowOpts = {
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    title: 'TENON（榫）— 多模型协同工作台',
    ...(iconPath ? { icon: iconPath } : {}),
    backgroundColor: initialPal.bg,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac
      ? {}
      : {
          titleBarOverlay: {
            color: initialPal.overlayColor,
            symbolColor: initialPal.symbolColor,
            height: 47,
          },
        }),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };

  mainWindow = new BrowserWindow(windowOpts);

  // Clean minimal menu keeping standard shortcuts (Copy/Paste/Reload/DevTools) while hidden by default
  const menu = Menu.buildFromTemplate([
    {
      label: 'TENON',
      submenu: [
        { label: '重新加载', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.reload() },
        { label: '开发者工具', accelerator: 'CmdOrCtrl+Shift+I', click: () => mainWindow?.webContents.toggleDevTools() },
        { type: 'separator' },
        { role: 'quit', label: '退出 TENON' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);

  // Open external http(s) links in the system default browser; deny unknown/unsafe protocols
  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (isSameServerOrigin(targetUrl)) {
      return { action: 'allow' };
    }
    if (/^https?:\/\//i.test(targetUrl)) {
      shell.openExternal(targetUrl).catch(() => {});
    }
    return { action: 'deny' };
  });

  // Prevent accidental drag-and-drop or link clicks from navigating the workbench away from local server
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (isSameServerOrigin(targetUrl)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(targetUrl)) {
      shell.openExternal(targetUrl).catch(() => {});
    }
  });

  let shown = false;
  const showWindowSafely = () => {
    if (shown || !mainWindow || mainWindow.isDestroyed()) return;
    shown = true;
    mainWindow.show();
  };

  const showFallbackTimer = setTimeout(showWindowSafely, 4500);
  showFallbackTimer.unref();

  mainWindow.once('ready-to-show', () => {
    clearTimeout(showFallbackTimer);
    showWindowSafely();
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return; // Ignore aborted sub-loads
    clearTimeout(showFallbackTimer);
    showWindowSafely();
    dialog.showErrorBox(
      'TENON 页面加载异常',
      `无法加载本地工作台界面 (${validatedURL || url})：\n${errorDescription} (${errorCode})`
    );
  });

  mainWindow.on('closed', () => {
    clearTimeout(showFallbackTimer);
    mainWindow = null;
  });

  mainWindow.loadURL(url);
}

function shutdownWorkbench() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  if (workbench) {
    try { workbench.updater?.cancelDownload?.(); } catch { /* ignore */ }
    try { workbench.orchestrator?.shutdown?.(); } catch { /* ignore */ }
    try { workbench.workflowStore?.flush?.(); } catch { /* ignore */ }
  }

  // Synchronously reap every spawned agy/codex/claude/custom CLI tree before process exit
  try { killAllActiveChildrenSync(); } catch { /* ignore */ }

  if (workbench?.server) {
    try {
      if (typeof workbench.server.closeAllConnections === 'function') {
        workbench.server.closeAllConnections();
      }
      workbench.server.close();
    } catch { /* ignore */ }
  }
}

app.whenReady().then(async () => {
  if (!gotLock) return;
  try {
    const url = await startEmbeddedWorkbench();
    createMainWindow(url);
  } catch (err) {
    dialog.showErrorBox('TENON 启动失败', `无法初始化本地协同服务：\n${err.message || err}`);
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && serverUrl) {
    createMainWindow(serverUrl);
  }
});

app.on('before-quit', () => {
  shutdownWorkbench();
});

app.on('will-quit', () => {
  shutdownWorkbench();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
