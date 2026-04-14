#!/usr/bin/env node
/**
 * Phase 2 MCP server verification \u2014 end-to-end smoke test.
 *
 * Spawns `node out/bin/roadie-mcp.js --project <temp-dir>` and drives it over
 * stdio with real JSON-RPC frames:
 *   1. initialize           \u2192 expect result
 *   2. tools/list           \u2192 expect 10 tools
 *   3. tools/call analyze_project(temp-dir) \u2192 expect structured result
 *   4. SIGTERM              \u2192 expect clean exit
 *
 * Exit 0 on full pass, non-zero otherwise. Used by the installer's smoke-test
 * gate and as a manual post-build verification.
 */

const { existsSync, mkdtempSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawn } = require('node:child_process');

const PACKAGE_ROOT = resolve(__dirname, '..');
const MCP_ENTRY = join(PACKAGE_ROOT, 'out', 'bin', 'roadie-mcp.js');

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
const err = (m) => console.log(`${C.red}\u2717${C.reset} ${m}`);
const info = (m) => console.log(`${C.cyan}\u203A${C.reset} ${m}`);
const head = (m) => console.log(`\n${C.bold}${m}${C.reset}`);

function startServer(projectDir) {
  return spawn(process.execPath, [MCP_ENTRY, '--project', projectDir, '--log-level', 'ERROR'], {
    cwd: PACKAGE_ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/**
 * Drive a JSON-RPC exchange with the server.
 * Returns a promise that resolves once the server has responded to `id` with
 * either `result` (resolves) or `error` (rejects), or rejects on timeout.
 */
function rpc(child, pending, id, method, params, timeoutMs) {
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      rejectPromise(new Error(`timeout waiting for response to ${method} (${timeoutMs}ms)`));
    }, timeoutMs);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      if (msg.error) rejectPromise(new Error(`${method} error: ${JSON.stringify(msg.error)}`));
      else resolvePromise(msg.result);
    });
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    child.stdin.write(payload);
  });
}

function attachFrameReader(child, pending) {
  let buffer = '';
  child.stdout.on('data', (buf) => {
    buffer += buf.toString('utf-8');
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        if (msg.id != null && pending.has(msg.id)) {
          const cb = pending.get(msg.id);
          pending.delete(msg.id);
          cb(msg);
        }
      } catch (_) {
        // Non-JSON or partial frame \u2014 skip.
      }
    }
  });
}

async function main() {
  head('Roadie MCP \u2014 Phase 2 verification');
  if (!existsSync(MCP_ENTRY)) {
    err(`${MCP_ENTRY} not found. Run \`npm run build\` first.`);
    process.exit(1);
  }

  const tempProject = mkdtempSync(join(tmpdir(), 'roadie-verify-'));
  info(`scratch project: ${tempProject}`);

  const child = startServer(tempProject);
  const pending = new Map();
  attachFrameReader(child, pending);

  let stderrBuf = '';
  child.stderr.on('data', (b) => {
    stderrBuf += b.toString('utf-8');
  });

  let exited = false;
  let exitCode = null;
  let exitSignal = null;
  child.on('exit', (code, signal) => {
    exited = true;
    exitCode = code;
    exitSignal = signal;
  });

  try {
    // 1. initialize
    const initResult = await rpc(
      child,
      pending,
      1,
      'initialize',
      {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'roadie-verify', version: '0.5.0' },
        capabilities: {},
      },
      3000
    );
    if (!initResult || typeof initResult !== 'object') {
      err('initialize: no result object returned');
      throw new Error('initialize failed');
    }
    ok(`initialize \u2192 protocolVersion=${initResult.protocolVersion ?? '?'}`);

    // 2. tools/list
    const listResult = await rpc(child, pending, 2, 'tools/list', {}, 3000);
    const tools = listResult?.tools ?? [];
    if (tools.length !== 10) {
      err(`tools/list: expected 10 tools, got ${tools.length}`);
      if (tools.length) info(`  tools: ${tools.map((t) => t.name).join(', ')}`);
      throw new Error('tools/list mismatch');
    }
    ok(`tools/list \u2192 10 tools (${tools.map((t) => t.name).join(', ')})`);

    // 3. tools/call analyze_project
    const callResult = await rpc(
      child,
      pending,
      3,
      'tools/call',
      { name: 'analyze_project', arguments: { projectPath: tempProject } },
      10000
    );
    if (!callResult || typeof callResult !== 'object') {
      err('tools/call analyze_project: no result');
      throw new Error('tools/call failed');
    }
    // Accept any structured result (content array per MCP spec, or tool-specific payload).
    const hasContent = Array.isArray(callResult.content) && callResult.content.length > 0;
    const hasStructured = typeof callResult === 'object' && Object.keys(callResult).length > 0;
    if (!hasContent && !hasStructured) {
      err('tools/call analyze_project: empty payload');
      throw new Error('analyze_project empty');
    }
    ok(`tools/call analyze_project \u2192 structured result`);

    // 4. SIGTERM + clean exit
    child.kill('SIGTERM');
    const exitDeadline = Date.now() + 3000;
    while (!exited && Date.now() < exitDeadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (!exited) {
      err('server did not exit within 3s of SIGTERM');
      try {
        child.kill('SIGKILL');
      } catch (_) {
        /* ignore */
      }
      throw new Error('unclean exit');
    }
    ok(`clean exit on SIGTERM (code=${exitCode}, signal=${exitSignal})`);

    console.log(`\n${C.green}${C.bold}Phase 2 verification passed.${C.reset}`);
    process.exit(0);
  } catch (e) {
    console.log(`\n${C.red}${C.bold}Phase 2 verification FAILED:${C.reset} ${e.message}`);
    if (stderrBuf) console.log(`${C.dim}--- server stderr ---\n${stderrBuf.slice(0, 1000)}${C.reset}`);
    try {
      child.kill('SIGKILL');
    } catch (_) {
      /* ignore */
    }
    process.exit(1);
  }
}

main().catch((e) => {
  err(`verify crashed: ${e.message}`);
  process.exit(1);
});
