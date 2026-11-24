import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

async function findCachedElectronZip(version) {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const cacheDir = path.join(localAppData, 'electron', 'Cache');
  const targetName = `electron-v${version}-win32-x64.zip`;
  try {
    const entries = await fs.readdir(cacheDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        const candidate = path.join(cacheDir, e.name, targetName);
        try {
          await fs.access(candidate);
          return candidate;
        } catch {
          // continue
        }
      } else if (e.name === targetName) {
        return path.join(cacheDir, e.name);
      }
    }
  } catch {
    // No cache dir
  }
  return null;
}

const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
const rawElecVer = String(pkg.devDependencies?.electron || '').replace(/^[^0-9]*/, '');
const cachedZip = rawElecVer ? await findCachedElectronZip(rawElecVer) : null;

const args = ['electron-builder', '--win', 'nsis'];
if (cachedZip) {
  console.log(`[TENON Build] Using local cached Electron zip: ${cachedZip}`);
  args.push(`--config.electronDist=${cachedZip}`);
}

const isWin = process.platform === 'win32';
const cmd = isWin ? (process.env.ComSpec || 'cmd.exe') : 'npx';
const spawnArgs = isWin ? ['/d', '/s', '/c', 'npx.cmd', ...args] : args;

const child = spawn(cmd, spawnArgs, {
  cwd: ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/',
  },
});

child.on('close', (code) => process.exit(code ?? 1));
