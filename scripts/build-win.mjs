import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveInstalledElectronVersion(rootDir) {
  try {
    const elecPkg = JSON.parse(
      await fs.readFile(path.join(rootDir, 'node_modules', 'electron', 'package.json'), 'utf8')
    );
    if (elecPkg?.version) return String(elecPkg.version).trim();
  } catch {
    // Fall back to root package.json devDependencies
  }
  const pkg = JSON.parse(await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'));
  return String(pkg.devDependencies?.electron || '').replace(/^[^0-9]*/, '').trim();
}

async function findCachedElectronZip(version) {
  if (!version) return null;
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const cacheDir = path.join(localAppData, 'electron', 'Cache');
  const targetName = `electron-v${version}-win32-x64.zip`;
  try {
    const entries = await fs.readdir(cacheDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        const candidate = path.join(cacheDir, e.name, targetName);
        if (await exists(candidate)) return candidate;
      } else if (e.name === targetName) {
        return path.join(cacheDir, e.name);
      }
    }
  } catch {
    // No cache dir
  }
  return null;
}

async function resolveOfflineElectronDist(version) {
  const cachedZip = await findCachedElectronZip(version);
  if (cachedZip) {
    console.log(`[TENON Build] Using local cached Electron zip: ${cachedZip}`);
    return cachedZip;
  }
  const localDist = path.join(ROOT, 'node_modules', 'electron', 'dist');
  if (await exists(path.join(localDist, 'electron.exe'))) {
    console.log(`[TENON Build] Using local unpacked Electron dist: ${localDist}`);
    return localDist;
  }
  return null;
}

const electronVersion = await resolveInstalledElectronVersion(ROOT);
const offlineDist = await resolveOfflineElectronDist(electronVersion);

const userArgs = process.argv.slice(2);
const builderArgs = userArgs.length > 0 ? [...userArgs] : ['--win', 'nsis'];
if (offlineDist && !builderArgs.some((a) => a.startsWith('--config.electronDist='))) {
  builderArgs.push(`--config.electronDist=${offlineDist}`);
}

const localBuilderCli = path.join(ROOT, 'node_modules', 'electron-builder', 'cli.js');
const useDirectNode = await exists(localBuilderCli);

const spawnEnv = {
  ...process.env,
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/',
};

let child;
if (useDirectNode) {
  // Invoke electron-builder directly via Node to avoid cmd.exe quoting issues on paths with spaces
  child = spawn(process.execPath, [localBuilderCli, ...builderArgs], {
    cwd: ROOT,
    stdio: 'inherit',
    env: spawnEnv,
  });
} else {
  const isWin = process.platform === 'win32';
  const cmd = isWin ? 'npx.cmd' : 'npx';
  child = spawn(cmd, ['electron-builder', ...builderArgs], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: isWin,
    env: spawnEnv,
  });
}

child.on('error', (err) => {
  console.error(`[TENON Build] Failed to launch electron-builder: ${err.message}`);
  process.exit(1);
});

child.on('close', (code) => process.exit(code ?? 1));
