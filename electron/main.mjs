import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, Menu, shell, dialog } from 'electron';
import { createWorkbenchServer } from '../server.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

let mainWindow = null;
let workbench = null;
let serverUrl = '';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function listenWithFallback(server, preferredPort = 4177, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const onErr = (err) => {
      if (err.code === 'EADDRINUSE' && preferredPort !== 0) {
        server.removeListener('error', onErr);
        server.listen(0, host, () => {
          const addr = server.address();
          resolve(addr.port);
        });
      } else {
        reject(err);
      }
    };
    server.once('error', onErr);
    server.listen(preferredPort, host, () => {
      server.removeListener('error', onErr);
      const addr = server.address();
      resolve(addr.port);
    });
  });
}

async function startEmbeddedWorkbench() {
  const userDataDir = app.getPath('userData');
  const dataDir = path.join(userDataDir, 'data');
  const templatesDir = path.join(userDataDir, 'templates');

  workbench = await createWorkbenchServer({
    dataDir,
    templatesDir,
    defaultWorkspace: os.homedir(),
    runtime: 'electron',
    appVersion: app.getVersion(),
    onPickDirectory: async (defaultPath) => {
      const targetWin = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
      const result = await dialog.showOpenDialog(targetWin, {
        title: '选择目标工程目录',
        defaultPath: defaultPath || os.homedir(),
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

function createMainWindow(url) {
  const iconPath = path.join(ROOT_DIR, 'build', 'icon.ico');
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    title: 'TENON（榫）— 多模型协同工作台',
    icon: iconPath,
    backgroundColor: '#141618',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

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

  // Open external links (GitHub Releases, docs) in the system default browser
  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (/^https?:\/\//i.test(targetUrl) && !targetUrl.startsWith(serverUrl)) {
      shell.openExternal(targetUrl);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL(url);
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
  if (workbench) {
    try { workbench.orchestrator.shutdown(); } catch { /* ignore */ }
    try { workbench.server.close(); } catch { /* ignore */ }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
