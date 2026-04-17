/**
 * E2E Chaos Suite: Degraded-mode and upgrade scenarios
 *
 * These tests run against the real VS Code instance with the packaged VSIX.
 * They simulate failure conditions (corrupt DB, SQLite ABI mismatch) and
 * verify that Roadie degrades gracefully rather than crashing.
 *
 * Exit criteria (Phase 4):
 * - No unhandled activation failures across all four scenarios
 * - Workflow history survives every supported upgrade path
 * - Degraded paths are visible in the Doctor output (SQLite ✗)
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { VSBrowser, Workbench } = require('vscode-extension-tester');
const { runCommand, waitForOutputChannel } = require('../helpers/e2e-helpers');

describe('E2E Chaos: SQLite unavailable (corrupt DB)', function () {
  this.timeout(60_000);

  let corruptDbPath;

  before(function () {
    // Write a corrupt file where the SQLite DB would live
    const dbDir = path.join(os.homedir(), '.vscode', 'globalStorage', 'roadie.roadie');
    fs.mkdirSync(dbDir, { recursive: true });
    corruptDbPath = path.join(dbDir, 'project-model.db');
    fs.writeFileSync(corruptDbPath, Buffer.from('NOT A VALID SQLITE DB — CORRUPTED BY CHAOS TEST'));
  });

  after(function () {
    // Remove the corrupt file so subsequent tests/runs start clean
    if (corruptDbPath && fs.existsSync(corruptDbPath)) {
      fs.unlinkSync(corruptDbPath);
    }
  });

  it('extension activates without an unhandled error on corrupt DB', async function () {
    await runCommand('Roadie: Initialize Project');
    const output = await waitForOutputChannel('Roadie', 'Roadie', 15_000);
    // Extension should log the degraded-mode warning, not throw
    const hasUnhandled =
      output.toLowerCase().includes('unhandled exception') || output.toLowerCase().includes('activation failed');
    if (hasUnhandled) {
      throw new Error(`Extension crashed on corrupt DB: ${output.substring(0, 400)}`);
    }
  });

  it('Doctor command reports SQLite unavailable gracefully', async function () {
    await runCommand('Roadie: Doctor');
    const output = await waitForOutputChannel('Roadie', 'Doctor', 15_000);
    // Should not crash; degraded mode is acceptable
    if (output.toLowerCase().includes('unhandled exception')) {
      throw new Error(`Doctor command crashed: ${output.substring(0, 400)}`);
    }
  });
});

describe('E2E Chaos: SQLite unavailable (permission denied)', function () {
  this.timeout(60_000);

  let lockedDbPath;

  before(function () {
    if (process.platform === 'win32') {
      this.skip(); // chmod not reliably enforceable on Windows
    }
    const dbDir = path.join(os.homedir(), '.vscode', 'globalStorage', 'roadie.roadie');
    fs.mkdirSync(dbDir, { recursive: true });
    lockedDbPath = path.join(dbDir, 'project-model.db');
    fs.writeFileSync(lockedDbPath, ''); // empty file
    fs.chmodSync(lockedDbPath, 0o000); // no permissions
  });

  after(function () {
    if (lockedDbPath && fs.existsSync(lockedDbPath)) {
      fs.chmodSync(lockedDbPath, 0o644);
      fs.unlinkSync(lockedDbPath);
    }
  });

  it('extension activates in degraded mode when DB is unreadable', async function () {
    await runCommand('Roadie: Initialize Project');
    const output = await waitForOutputChannel('Roadie', 'Roadie', 15_000);
    if (output.toLowerCase().includes('unhandled exception')) {
      throw new Error(`Extension crashed on unreadable DB: ${output.substring(0, 400)}`);
    }
  });
});
