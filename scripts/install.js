#!/usr/bin/env node
/**
 * Roadie VS Code extension installer.
 *
 * 1. Check prerequisites (Node >= 20, VS Code CLI `code` on PATH)
 * 2. Run `npm run build` if `out/extension.js` is missing
 * 3. Package `.vsix` via `npm run package` if `roadie-0.5.0.vsix` is missing
 * 4. Install the extension: `code --install-extension roadie-0.5.0.vsix --force`
 * 5. Print next steps: "Reload VS Code window and type @roadie in Copilot chat"
 *
 * Usage:
 *   node scripts/install.js               # install
 *   node scripts/install.js --uninstall   # uninstall
 *   node scripts/install.js -h | --help
 */

const { existsSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const PACKAGE_ROOT = resolve(__dirname, '..');
const EXT_ENTRY    = join(PACKAGE_ROOT, 'out', 'extension.js');
const { version }  = require(join(PACKAGE_ROOT, 'package.json'));
const VSIX_NAME    = `roadie-${version}.vsix`;
const VSIX_PATH    = join(PACKAGE_ROOT, VSIX_NAME);
const EXTENSION_ID = 'roadie.roadie';

// ── ANSI colors ───────────────────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
};
const ok   = (m) => console.log(`${C.green}\u2713${C.reset} ${m}`);
const warn = (m) => console.log(`${C.yellow}!${C.reset} ${m}`);
const err  = (m) => console.log(`${C.red}\u2717${C.reset} ${m}`);
const info = (m) => console.log(`${C.cyan}\u203A${C.reset} ${m}`);
const head = (m) => console.log(`\n${C.bold}${m}${C.reset}`);

const npmCmd  = process.platform === 'win32' ? 'npm.cmd'  : 'npm';
const codeCmd = process.platform === 'win32' ? 'code.cmd' : 'code';

// ── Argument parsing ──────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { uninstall: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--uninstall') args.uninstall = true;
    else if (a === '-h' || a === '--help') args.help = true;
    else { err(`unknown flag: ${a}`); process.exit(2); }
  }
  return args;
}

function printHelp() {
  console.log(`Roadie VS Code extension installer

Usage:
  node scripts/install.js [options]

Options:
  --uninstall    uninstall the VS Code extension
  -h, --help     print this message`);
}

// ── Prerequisite checks ───────────────────────────────────────────────────────
function checkPrereqs() {
  head('Prerequisites');

  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major < 20) {
    err(`Node ${process.versions.node} detected; Roadie requires Node 20+`);
    process.exit(1);
  }
  ok(`Node ${process.versions.node}`);

  const r = spawnSync(codeCmd, ['--version'], { encoding: 'utf-8', shell: true });
  if (r.status !== 0) {
    err('VS Code CLI `code` not found on PATH.');
    err('  In VS Code run: Shell Command: Install \'code\' command in PATH');
    process.exit(1);
  }
  const firstLine = (r.stdout || '').split('\n')[0].trim();
  ok(`VS Code CLI ${firstLine}`);
}

// ── Build ─────────────────────────────────────────────────────────────────────
function ensureBuilt() {
  head('Build');
  if (existsSync(EXT_ENTRY)) {
    ok('out/extension.js present');
    return;
  }
  warn('out/extension.js missing \u2014 running `npm run build`');
  const r = spawnSync(npmCmd, ['run', 'build'], {
    cwd: PACKAGE_ROOT, stdio: 'inherit', shell: true,
  });
  if (r.status !== 0) { err('build failed'); process.exit(1); }
  ok('build complete');
}

// ── Package .vsix ─────────────────────────────────────────────────────────────
function ensureVsix() {
  head('Package');
  if (existsSync(VSIX_PATH)) {
    ok(`${VSIX_NAME} present`);
    return;
  }
  warn(`${VSIX_NAME} missing \u2014 running \`npm run package\``);
  const r = spawnSync(npmCmd, ['run', 'package'], {
    cwd: PACKAGE_ROOT, stdio: 'inherit', shell: true,
  });
  if (r.status !== 0) { err('package failed'); process.exit(1); }
  ok(`${VSIX_NAME} created`);
}

// ── Install extension ─────────────────────────────────────────────────────────
function installExtension() {
  head('VS Code extension');
  const r = spawnSync(codeCmd, ['--install-extension', VSIX_PATH, '--force'], {
    encoding: 'utf-8', shell: true,
  });
  if (r.status !== 0) {
    err(`code --install-extension failed (exit ${r.status})`);
    if (r.stderr) console.log(`${C.dim}${r.stderr.trim()}${C.reset}`);
    process.exit(1);
  }
  ok(`installed ${VSIX_NAME}`);
}

function uninstallExtension() {
  head('VS Code extension');
  const r = spawnSync(codeCmd, ['--uninstall-extension', EXTENSION_ID], {
    encoding: 'utf-8', shell: true,
  });
  if (r.status === 0) ok(`uninstalled ${EXTENSION_ID}`);
  else info(`${EXTENSION_ID} not installed \u2014 nothing to do`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printHelp(); return; }

  head(args.uninstall ? 'Roadie \u2014 uninstall' : 'Roadie \u2014 install');

  checkPrereqs();

  if (args.uninstall) {
    uninstallExtension();
    head('Done');
    info('Reload your VS Code window for changes to take effect.');
  } else {
    ensureBuilt();
    ensureVsix();
    installExtension();
    head('Next steps');
    info(`Reload the VS Code window (${C.bold}Ctrl+Shift+P${C.reset} \u203A Developer: Reload Window).`);
    info(`Then type ${C.cyan}@roadie${C.reset} in Copilot chat to get started.`);
  }
  console.log();
}

main();
