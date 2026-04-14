#!/usr/bin/env node
/**
 * Roadie plug-and-play installer.
 *
 * Installs the VS Code extension (.vsix) and registers the Roadie MCP server
 * in Claude Code (~/.claude.json) and Claude Desktop config, so cross-tool
 * clients can use Roadie standalone in addition to the VS Code chat
 * participant.
 *
 * Usage:
 *   node scripts/install.js                  # full install (extension + MCP)
 *   node scripts/install.js --skip-extension # MCP-only (Claude Code users)
 *   node scripts/install.js --skip-mcp       # VS Code extension only
 *   node scripts/install.js --log-level LEVEL
 *   node scripts/install.js --uninstall      # reverse both
 *   node scripts/install.js -h | --help
 *
 * Safe to re-run. Atomic JSON writes (temp + rename). Timestamped backups on
 * any config mutation.
 */

const { existsSync, readFileSync, writeFileSync, renameSync, copyFileSync, statSync } = require('node:fs');
const { join, dirname, resolve } = require('node:path');
const { homedir, platform } = require('node:os');
const { spawnSync, spawn } = require('node:child_process');

const PACKAGE_ROOT = resolve(__dirname, '..');
const EXT_ENTRY = join(PACKAGE_ROOT, 'out', 'extension.js');
const MCP_ENTRY = join(PACKAGE_ROOT, 'out', 'bin', 'roadie-mcp.js');
const VSIX_NAME = 'roadie-0.5.0.vsix';
const VSIX_PATH = join(PACKAGE_ROOT, VSIX_NAME);
const EXTENSION_ID = 'roadie.roadie';

// ── ANSI colors ──────────────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};
const ok = (m) => console.log(`${C.green}\u2713${C.reset} ${m}`);
const warn = (m) => console.log(`${C.yellow}!${C.reset} ${m}`);
const err = (m) => console.log(`${C.red}\u2717${C.reset} ${m}`);
const info = (m) => console.log(`${C.cyan}\u203A${C.reset} ${m}`);
const head = (m) => console.log(`\n${C.bold}${m}${C.reset}`);

// ── Config discovery ─────────────────────────────────────────────────────────
function getClaudeDesktopConfigPath() {
  const home = homedir();
  const p = platform();
  if (p === 'win32')
    return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  if (p === 'darwin')
    return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  return join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'Claude', 'claude_desktop_config.json');
}

function getClaudeCodeConfigPath() {
  return join(homedir(), '.claude.json');
}

// ── JSON I/O ─────────────────────────────────────────────────────────────────
function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    throw new Error(`Could not parse ${path}: ${e.message}`);
  }
}

function writeJsonAtomic(path, data) {
  if (existsSync(path)) {
    const backup = `${path}.backup-${Date.now()}`;
    copyFileSync(path, backup);
    info(`backed up existing config \u2192 ${backup}`);
  }
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  renameSync(tmp, path);
}

// ── Argument parsing ─────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {
    skipExtension: false,
    skipMcp: false,
    uninstall: false,
    logLevel: 'INFO',
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--skip-extension') args.skipExtension = true;
    else if (a === '--skip-mcp') args.skipMcp = true;
    else if (a === '--uninstall') args.uninstall = true;
    else if (a === '--log-level') args.logLevel = argv[++i] || 'INFO';
    else if (a === '-h' || a === '--help') args.help = true;
    else {
      err(`unknown flag: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Roadie plug-and-play installer

Usage:
  node scripts/install.js [options]

Options:
  --skip-extension   skip the VS Code extension step (MCP-only install)
  --skip-mcp         skip the MCP registration step (VS Code-only install)
  --uninstall        reverse: uninstall extension + remove MCP entries
  --log-level LEVEL  ROADIE_LOG_LEVEL written into MCP entries (default: INFO)
  -h, --help         print this message`);
}

// ── Prerequisite checks ──────────────────────────────────────────────────────
function checkPrereqs(args) {
  head('Prerequisites');

  // Node version
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major < 20) {
    err(`Node ${process.versions.node} detected; Roadie requires Node 20+`);
    process.exit(1);
  }
  ok(`Node ${process.versions.node}`);

  // npm
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const npmR = spawnSync(npmCmd, ['--version'], { encoding: 'utf-8', shell: true });
  if (npmR.status !== 0) {
    err('npm not found on PATH');
    process.exit(1);
  }
  ok(`npm ${(npmR.stdout || '').trim()}`);

  // VS Code CLI (only required when installing/uninstalling the extension)
  const needsCode = !args.skipExtension;
  if (needsCode) {
    const codeCmd = process.platform === 'win32' ? 'code.cmd' : 'code';
    const r = spawnSync(codeCmd, ['--version'], { encoding: 'utf-8', shell: true });
    if (r.status !== 0) {
      warn('VS Code CLI `code` not found on PATH. Extension step will be skipped.');
      warn('  To enable: in VS Code run the command "Shell Command: Install \'code\' command in PATH".');
      args.skipExtension = true;
    } else {
      const firstLine = (r.stdout || '').split('\n')[0].trim();
      ok(`VS Code CLI ${firstLine}`);
    }
  }
}

// ── Build ────────────────────────────────────────────────────────────────────
function ensureBuilt() {
  head('Build artifacts');
  const extOk = existsSync(EXT_ENTRY);
  const mcpOk = existsSync(MCP_ENTRY);
  if (extOk && mcpOk) {
    const age = ((Date.now() - statSync(MCP_ENTRY).mtimeMs) / 60000).toFixed(0);
    info(`out/extension.js + out/bin/roadie-mcp.js found (${age} min old)`);
    return;
  }
  warn('build artifacts missing \u2014 running `npm run build`');
  const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
    cwd: PACKAGE_ROOT,
    stdio: 'inherit',
    shell: true,
  });
  if (r.status !== 0) {
    err('build failed');
    process.exit(1);
  }
  ok('build complete');
}

// ── VS Code extension install/uninstall ──────────────────────────────────────
function installExtension() {
  head('VS Code extension');
  if (!existsSync(VSIX_PATH)) {
    err(`${VSIX_NAME} not found in repo root. Run \`npm run package\` first.`);
    return false;
  }
  const codeCmd = process.platform === 'win32' ? 'code.cmd' : 'code';
  const r = spawnSync(codeCmd, ['--install-extension', VSIX_PATH, '--force'], {
    encoding: 'utf-8',
    shell: true,
  });
  if (r.status !== 0) {
    err(`code --install-extension failed (exit ${r.status})`);
    if (r.stderr) console.log(`${C.dim}${r.stderr.trim()}${C.reset}`);
    return false;
  }
  ok(`installed ${VSIX_NAME}`);
  return true;
}

function uninstallExtension() {
  head('VS Code extension');
  const codeCmd = process.platform === 'win32' ? 'code.cmd' : 'code';
  const r = spawnSync(codeCmd, ['--uninstall-extension', EXTENSION_ID], {
    encoding: 'utf-8',
    shell: true,
  });
  if (r.status === 0) {
    ok(`uninstalled ${EXTENSION_ID}`);
  } else {
    info(`${EXTENSION_ID} not installed (or uninstall reported no-op) \u2014 nothing to do`);
  }
  return true;
}

// ── MCP smoke test ───────────────────────────────────────────────────────────
/**
 * Spawn the built MCP server, send an `initialize` JSON-RPC message on stdin,
 * wait up to 3s for a `result`. Returns true if the server responds.
 */
function smokeTestMcp() {
  head('MCP server smoke test');
  if (!existsSync(MCP_ENTRY)) {
    err(`${MCP_ENTRY} missing \u2014 cannot smoke test`);
    return false;
  }

  return new Promise((resolvePromise) => {
    const child = spawn(
      process.execPath,
      [MCP_ENTRY, '--project', PACKAGE_ROOT, '--log-level', 'ERROR'],
      { cwd: PACKAGE_ROOT, stdio: ['pipe', 'pipe', 'pipe'] }
    );

    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (pass, reason) => {
      if (settled) return;
      settled = true;
      try {
        child.kill('SIGTERM');
      } catch (_) {
        /* ignore */
      }
      if (pass) ok(reason);
      else {
        err(reason);
        if (stderr) console.log(`${C.dim}${stderr.slice(0, 500)}${C.reset}`);
      }
      resolvePromise(pass);
    };

    const timer = setTimeout(() => finish(false, 'server did not respond to initialize within 3s'), 3000);

    child.stdout.on('data', (buf) => {
      stdout += buf.toString('utf-8');
      // MCP frames are JSON-RPC messages, one per line.
      for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed);
          if (msg.id === 1 && msg.result) {
            clearTimeout(timer);
            finish(true, 'server responded to initialize');
            return;
          }
        } catch (_) {
          // partial frame or non-JSON stderr leakage \u2014 ignore
        }
      }
    });

    child.stderr.on('data', (buf) => {
      stderr += buf.toString('utf-8');
    });

    child.on('error', (e) => {
      clearTimeout(timer);
      finish(false, `spawn failed: ${e.message}`);
    });

    child.on('exit', (code) => {
      if (!settled) {
        clearTimeout(timer);
        finish(false, `server exited early (code ${code}) before responding`);
      }
    });

    // Send JSON-RPC initialize
    const initMsg =
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          clientInfo: { name: 'roadie-installer', version: '0.5.0' },
          capabilities: {},
        },
      }) + '\n';
    try {
      child.stdin.write(initMsg);
    } catch (e) {
      clearTimeout(timer);
      finish(false, `failed to write initialize: ${e.message}`);
    }
  });
}

// ── MCP config mutators ──────────────────────────────────────────────────────
function buildRoadieEntry(logLevel) {
  return {
    type: 'stdio',
    command: 'npx',
    args: ['roadie-mcp', '--project', '.'],
    env: { ROADIE_LOG_LEVEL: logLevel },
  };
}

function installMcpIn(path, clientName, logLevel) {
  const config = readJsonIfExists(path) ?? {};
  if (!config.mcpServers) config.mcpServers = {};
  const existing = config.mcpServers.roadie;
  config.mcpServers.roadie = buildRoadieEntry(logLevel);
  writeJsonAtomic(path, config);
  ok(`${clientName}: ${existing ? 'updated' : 'added'} roadie in ${path}`);
}

function uninstallMcpFrom(path, clientName) {
  const config = readJsonIfExists(path);
  if (!config || !config.mcpServers?.roadie) {
    info(`${clientName}: roadie not registered \u2014 nothing to remove`);
    return;
  }
  delete config.mcpServers.roadie;
  writeJsonAtomic(path, config);
  ok(`${clientName}: removed roadie from ${path}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  head(args.uninstall ? 'Roadie installer \u2014 uninstall' : 'Roadie installer \u2014 install');

  checkPrereqs(args);

  if (!args.uninstall) {
    ensureBuilt();

    if (!args.skipMcp) {
      const pass = await smokeTestMcp();
      if (!pass) {
        err('aborting install \u2014 fix MCP server startup errors first');
        process.exit(1);
      }
    }
  }

  // VS Code extension
  if (!args.skipExtension) {
    if (args.uninstall) uninstallExtension();
    else installExtension();
  }

  // MCP registration (Claude Code + Claude Desktop)
  if (!args.skipMcp) {
    head('MCP registration');
    const codePath = getClaudeCodeConfigPath();
    const desktopPath = getClaudeDesktopConfigPath();
    try {
      if (args.uninstall) uninstallMcpFrom(codePath, 'Claude Code');
      else installMcpIn(codePath, 'Claude Code', args.logLevel);
    } catch (e) {
      err(`Claude Code: ${e.message}`);
    }
    try {
      if (args.uninstall) uninstallMcpFrom(desktopPath, 'Claude Desktop');
      else installMcpIn(desktopPath, 'Claude Desktop', args.logLevel);
    } catch (e) {
      err(`Claude Desktop: ${e.message}`);
    }
  }

  head('Next steps');
  if (args.uninstall) {
    info('Restart VS Code, Claude Desktop, and any Claude Code sessions for changes to take effect.');
  } else {
    info(`${C.bold}Open a VS Code workspace and type ${C.cyan}@roadie${C.reset}${C.bold} in chat${C.reset}.`);
    info('Optional: restart Claude Code sessions to pick up the new MCP registration.');
    info('');
    info('Run `npm run doctor` anytime to verify your install.');
  }
  console.log();
}

main().catch((e) => {
  err(`installer crashed: ${e.message}`);
  if (e.stack) console.log(`${C.dim}${e.stack}${C.reset}`);
  process.exit(1);
});
