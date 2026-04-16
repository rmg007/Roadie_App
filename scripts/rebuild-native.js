#!/usr/bin/env node
/**
 * Rebuilds native modules (better-sqlite3) for VS Code's Electron runtime.
 *
 * Finds the installed VS Code's package.json to read the exact Electron version,
 * then runs @electron/rebuild targeting that version.
 *
 * Usage: node scripts/rebuild-native.js
 */

const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// ── Locate VS Code's Electron version ────────────────────────────────────────
function findVSCodeElectronVersion() {
  const candidates = [];

  if (process.platform === 'win32') {
    const localPrograms = path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
      'Programs',
      'Microsoft VS Code'
    );
    // VS Code installs to a hashed subdirectory under its root
    if (existsSync(localPrograms)) {
      const { readdirSync } = require('node:fs');
      for (const entry of readdirSync(localPrograms)) {
        const pkgJson = path.join(localPrograms, entry, 'resources', 'app', 'package.json');
        if (existsSync(pkgJson)) candidates.push(pkgJson);
      }
    }
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Visual Studio Code.app/Contents/Resources/app/package.json'
    );
  } else {
    candidates.push(
      '/usr/share/code/resources/app/package.json',
      '/usr/lib/code/resources/app/package.json'
    );
  }

  for (const pkgPath of candidates) {
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(require('node:fs').readFileSync(pkgPath, 'utf8'));
        const ver = pkg.electron || pkg.electronVersion;
        if (ver && /^\d+\.\d+\.\d+/.test(ver)) return ver;
      } catch {
        // ignore parse errors
      }
    }
  }
  return null;
}

// ── Main ─────────────────────────────────────────────────────────────────────
const detectedVersion = findVSCodeElectronVersion();
const overrideVersion = process.env.ELECTRON_VERSION || detectedVersion;

if (!overrideVersion) {
  console.error('Could not determine VS Code Electron version. Skipping native rebuild.');
  console.error('Set ELECTRON_VERSION env var to override, e.g.: ELECTRON_VERSION=39.8.7 node scripts/rebuild-native.js');
  process.exit(0); // non-fatal: let packaging continue
}
console.log(`Rebuilding native modules for Electron ${overrideVersion} ...`);

const rebuildBin = path.join(__dirname, '..', 'node_modules', '.bin', 'electron-rebuild');
const cmd = process.platform === 'win32' ? `${rebuildBin}.cmd` : rebuildBin;

const result = spawnSync(
  cmd,
  ['-v', overrideVersion, '-t', 'electron', '-m', path.join(__dirname, '..'), '--only', 'better-sqlite3'],
  { stdio: 'inherit', shell: true }
);

if (result.status !== 0) {
  console.error(`electron-rebuild failed with exit code ${result.status}`);
  process.exit(result.status ?? 1);
}

console.log('Native rebuild complete.');
