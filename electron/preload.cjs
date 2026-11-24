'use strict';

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('TenonDesktop', {
  isDesktopApp: true,
  platform: process.platform,
  arch: process.arch,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  },
});
