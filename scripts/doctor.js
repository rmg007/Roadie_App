#!/usr/bin/env node
/**
 * Roadie health check \u2014 verifies the install is correct.
 *
 * Checks:
 *   1. out/extension.js exists and is recent
 *   2. out/bin/roadie-mcp.js exists and is executable
 *   3. MCP server smoke test (responds to initialize within 3s)
 *   4. VS Code extension installed (code --list-extensions includes roadie.roadie)
 *   5. Claude Code ~/.claude.json has `roadie` in mcpServers
 *   6. .vsix file present in repo root
 *
 * Exit 0 if all checks pass, 1 if any failure. Warnings do not fail the check.
 */

const { existsSync, readFileSync, statSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { homedir, platform } = require('node:os');
const { spawnSync, spawn } = require('node:child_process');

const PACKAGE_ROOT = resolve(__dirname, '..');
const EXT_ENTRY = join(PACKAGE_ROOT, 'out', 'extension.js');
const MCP_ENTRY = join(PACKAGE_ROOT, 'out', 'bin', 'roadie-mcp.js');
const VSIX_NAME = 'roadie-0.5.0.vsix';
const VSIX_PATH = join(PACKAGE_ROOT, VSIX_NAME);
const EXTENSION_ID = 'roadie.roadie';

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};
const ok = (m) => console.log(`${C.green}\u2713${C.reset} ${m}`);
const warn = (m) => console.log(`${C.yellow}!${C.reset} ${m}`);
const err = (m) => console.log(`${C.red}\u2717${C.reset} ${m}`);
const head = (m) => console.log(`\n${C.bold}${m}${C.reset}`);

let failures = 0;
function fail(msg) {
  err(msg);
  failures++;
}

function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function getClaudeCodeConfigPath() {
  return join(homedir(), '.claude.json');
}

function getClaudeDesktopConfigPath() {
  const home = homedir();
  const p = platform();
  if (p === 'win32')
    return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  if (p === 'darwin')
    return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  return join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'Claude', 'claude_desktop_config.json');
}

// ── Check 1: extension build ─────────────────────────────────────────────────
function checkExtensionBuild() {
  head('1. VS Code extension build');
  if (!existsSync(EXT_ENTRY)) {
    fail(`out/extension.js missing at ${EXT_ENTRY} \u2014 run \`npm run build\``);
    return;
  }
  const s = statSync(EXT_ENTRY);
  const ageMin = ((Date.now() - s.mtimeMs) / 60000).toFixed(0);
  ok(`out/extension.js exists (${(s.size / 1024).toFixed(1)} KB, ${ageMin} min old)`);
}

// ── Check 2: MCP bundle ──────────────────────────────────────────────────────
function checkMcpBundle() {
  head('2. MCP server bundle');
  if (!existsSync(MCP_ENTRY)) {
    fail(`out/bin/roadie-mcp.js missing \u2014 run \`npm run build\``);
    return;
  }
  const s = statSync(MCP_ENTRY);
  const ageMin = ((Date.now() - s.mtimeMs) / 60000).toFixed(0);
  ok(`out/bin/roadie-mcp.js exists (${(s.size / 1024).toFixed(1)} KB, ${ageMin} min old)`);
  // Executable bit on POSIX; on Windows this is informational.
  if (process.platform !== 'win32') {
    const mode = s.mode & 0o777;
    if ((mode & 0o100) === 0) warn(`out/bin/roadie-mcp.js is not executable (mode ${mode.toString(8)})`);
  }
}

// ── Check 3: MCP smoke test ──────────────────────────────────────────────────
function checkMcpSmoke() {
  return new Promise((resolvePromise) => {
    head('3. MCP server smoke test');
    if (!existsSync(MCP_ENTRY)) {
      fail('skipped (no MCP bundle)');
      resolvePromise();
      return;
    }
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
        fail(reason);
        if (stderr) console.log(`${C.dim}${stderr.slice(0, 400)}${C.reset}`);
      }
      resolvePromise();
    };

    const timer = setTimeout(() => finish(false, 'server did not respond to initialize within 3s'), 3000);

    child.stdout.on('data', (buf) => {
      stdout += buf.toString('utf-8');
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
          // ignore partial frames
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

    const initMsg =
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          clientInfo: { name: 'roadie-doctor', version: '0.5.0' },
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

// ── Check 4: VS Code extension installed ─────────────────────────────────────
function checkExtensionInstalled() {
  head('4. VS Code extension registration');
  const codeCmd = process.platform === 'win32' ? 'code.cmd' : 'code';
  const r = spawnSync(codeCmd, ['--list-extensions'], { encoding: 'utf-8', shell: true });
  if (r.status !== 0) {
    warn('VS Code CLI `code` not available \u2014 cannot verify extension registration');
    return;
  }
  const list = (r.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean);
  if (list.includes(EXTENSION_ID)) ok(`${EXTENSION_ID} is installed`);
  else warn(`${EXTENSION_ID} not installed \u2014 run \`npm run install:all\` or \`code --install-extension ${VSIX_NAME}\``);
}

// ── Check 5: Claude Code config ──────────────────────────────────────────────
function checkClaudeCodeConfig() {
  head('5. Claude Code MCP registration');
  const path = getClaudeCodeConfigPath();
  const cfg = readJsonIfExists(path);
  if (!cfg) {
    warn(`${path} not found (Claude Code not installed or never launched)`);
    return;
  }
  const entry = cfg.mcpServers?.roadie;
  if (!entry) {
    fail(`roadie NOT registered in ${path}`);
    return;
  }
  ok(`roadie registered in ${path}`);
  const cmd = [entry.command, ...(entry.args || [])].join(' ');
  ok(`  command: ${cmd}`);
  const level = entry.env?.ROADIE_LOG_LEVEL;
  if (level) ok(`  ROADIE_LOG_LEVEL=${level}`);
  else warn('  ROADIE_LOG_LEVEL not set (defaults to INFO)');
}

// ── Check 6: .vsix present ───────────────────────────────────────────────────
function checkVsix() {
  head('6. Packaged .vsix');
  if (!existsSync(VSIX_PATH)) {
    fail(`${VSIX_NAME} not found in repo root. Run \`npm run package\`.`);
    return;
  }
  const s = statSync(VSIX_PATH);
  ok(`${VSIX_NAME} present (${(s.size / 1024).toFixed(0)} KB)`);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`${C.bold}Roadie \u2014 doctor${C.reset}`);
  console.log(`${C.dim}package: ${PACKAGE_ROOT}${C.reset}`);

  checkExtensionBuild();
  checkMcpBundle();
  await checkMcpSmoke();
  checkExtensionInstalled();
  checkClaudeCodeConfig();
  checkVsix();

  // Informational: Claude Desktop
  const desktopPath = getClaudeDesktopConfigPath();
  const desktopCfg = readJsonIfExists(desktopPath);
  if (desktopCfg?.mcpServers?.roadie) {
    head('7. Claude Desktop MCP registration');
    ok(`roadie registered in ${desktopPath}`);
  }

  console.log();
  if (failures === 0) {
    console.log(`${C.green}${C.bold}All checks passed.${C.reset} Roadie is ready to use.`);
    process.exit(0);
  } else {
    console.log(`${C.red}${C.bold}${failures} check(s) failed.${C.reset} Run \`npm run install:all\` to fix, or see messages above.`);
    process.exit(1);
  }
}

main().catch((e) => {
  err(`doctor crashed: ${e.message}`);
  if (e.stack) console.log(`${C.dim}${e.stack}${C.reset}`);
  process.exit(1);
});
