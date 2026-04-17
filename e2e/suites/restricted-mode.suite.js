/**
 * E2E Suite: Restricted-mode (untrusted workspace)
 *
 * Verifies that Roadie commands which write to disk are either disabled or
 * surface a trust warning when VS Code opens the workspace in restricted mode
 * (workspace.isTrusted === false).
 *
 * Scope:
 *   - roadie.init        → should be blocked (writes .github/.roadie/)
 *   - roadie.rescan      → should be blocked (writes project-model.db)
 *   - roadie.reset       → should be blocked (deletes DB)
 *   - roadie.runWorkflow → should be blocked (triggers LLM + file writes)
 *
 * The test asserts that no `.github/.roadie/` directory is created/modified
 * under the fixture workspace root after the commands are attempted.
 *
 * Implementation note — it.skip rationale:
 *   vscode-extension-tester does not expose a first-class API for opening a
 *   workspace in restricted mode.  The trusted-workspace popup can be triggered
 *   by opening a folder that VS Code has never seen before, but this is
 *   non-deterministic across runs (VS Code caches trust decisions in its global
 *   storage).
 *
 *   TODO: when ExTester adds `VSBrowser.instance.openResourcesUntrusted()` (or
 *   equivalent), implement the full test body using that API.  In the meantime,
 *   the suite is scaffolded so the structure, assertions, and fixture path are
 *   already defined and can be wired up without structural changes.
 *
 * Reference: https://code.visualstudio.com/api/extension-guides/workspace-trust
 */

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { VSBrowser, Workbench } = require('vscode-extension-tester');
const { runCommand } = require('../helpers/e2e-helpers');
const { captureOnFailure } = require('../helpers/screenshot');

// Fixture workspace that Roadie should NOT write into when untrusted.
const FIXTURE_ROOT = path.join(__dirname, '..', 'fixtures', 'untrusted-workspace');
const ROADIE_DIR = path.join(FIXTURE_ROOT, '.github', '.roadie');

/** Commands that must not write to disk when workspace is untrusted */
const WRITE_COMMANDS = [
  'Roadie: Initialize',
  'Roadie: Rescan Project',
  'Roadie: Reset',
  'Roadie: Run Workflow',
];

describe('E2E: Restricted-mode (untrusted workspace)', function () {
  this.timeout(60_000);

  afterEach(async function () {
    if (this.currentTest && this.currentTest.state === 'failed') {
      try {
        const file = await captureOnFailure(
          VSBrowser.instance.driver,
          this.currentTest.fullTitle(),
        );
        console.log(`Screenshot saved: ${file}`);
      } catch (_) {
        // Screenshot failure must not mask the real test failure.
      }
    }
  });

  it.skip(
    'write commands are disabled or warn when workspace is untrusted',
    async function () {
      // TODO: implement once vscode-extension-tester supports opening an
      // untrusted workspace programmatically.  Steps when unblocked:
      //
      // 1. Create a fresh fixture directory that VS Code has never trusted.
      //    fs.mkdirSync(FIXTURE_ROOT, { recursive: true });
      //
      // 2. Open the workspace — VS Code should present the trust dialog.
      //    await VSBrowser.instance.openResources(FIXTURE_ROOT);
      //
      // 3. Dismiss the dialog by clicking "No, I don't trust the authors".
      //    (Requires locating and clicking the dialog button via ExTester.)
      //
      // 4. For each write command, run it and assert that either:
      //    a. The command palette shows the command as disabled (greyed-out), OR
      //    b. The Roadie output channel emits a trust-warning message, AND
      //    c. No .github/.roadie/ directory is created.
      //
      //    for (const cmd of WRITE_COMMANDS) {
      //      const dotRoadieBefore = fs.existsSync(ROADIE_DIR);
      //      await runCommand(cmd);
      //      await VSBrowser.instance.driver.sleep(2_000);
      //      const dotRoadieAfter = fs.existsSync(ROADIE_DIR);
      //      if (!dotRoadieBefore && dotRoadieAfter) {
      //        throw new Error(
      //          `Command "${cmd}" created .github/.roadie/ in an untrusted workspace.`
      //        );
      //      }
      //    }
      //
      // 5. Verify no DB file was written.
      //    const dbPath = path.join(ROADIE_DIR, 'project-model.db');
      //    if (fs.existsSync(dbPath)) {
      //      throw new Error('project-model.db was written in an untrusted workspace.');
      //    }
    },
  );

  it.skip(
    'no .github/.roadie/ writes occur in untrusted mode',
    async function () {
      // TODO: depends on the same trust-dialog API as above.
      // Assert that ROADIE_DIR does not exist after opening an untrusted workspace.
      if (fs.existsSync(ROADIE_DIR)) {
        throw new Error(
          '.github/.roadie/ directory exists before test — clean fixture to get a reliable baseline.',
        );
      }
    },
  );
});
