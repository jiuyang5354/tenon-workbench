'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('TenonDesktop', {
  isDesktopApp: true,
  platform: process.platform,
  arch: process.arch,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  },
  setTitleBarTheme: (surface) => {
    try {
      ipcRenderer.send('tenon:titlebar-theme', String(surface || 'weave'));
    } catch {
      // Ignore IPC errors during shutdown
    }
  },
});
