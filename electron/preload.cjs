'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const VALID_SURFACES = new Set(['weave', 'paper', 'charcoal']);

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
      const clean = VALID_SURFACES.has(surface) ? surface : 'weave';
      ipcRenderer.send('tenon:titlebar-theme', clean);
    } catch {
      // Ignore IPC errors during shutdown
    }
  },
});
