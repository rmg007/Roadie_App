/**
 * E2E Suite: Persistence across reload
 *
 * Verifies that workflow history written to .github/.roadie/project-model.db
 * survives a VS Code window reload, and that activation re-reads the row
 * count. The fixture DB is pre-seeded by `e2e/fixtures/seed-persistence-db.js`
 * with a known number of workflow_history rows.
 *
 * Flow:
 *   1. Seed the fixture DB (idempotent — blown away and rewritten each run).
 *   2. Open the workspace in VS Code — Roadie activates on
 *      `workspaceContains:.github/.roadie/project-model.db`.
 *   3. Run `Roadie: Show Stats`, read "Total runs: N" from the Output channel.
 *   4. Reload the window via `workbench.action.reloadWindow`.
 *   5. After re-activation, run `Roadie: Show Stats` again.
 *   6. Assert the count matches.
 *
 * If `workbench.action.reloadWindow` proves unreliable under extension-tester
 * (the WebDriver session can die with the window), we fall back to the
 * close-folder / re-open-folder path, which exercises the same DB-reopen
 * semantics on the extension side.
 */

'use strict';

const path = require('node:path');
const { VSBrowser, Workbench } = require('vscode-extension-tester');
const { runCommand, waitForOutputChannel } = require('../helpers/e2e-helpers');
const { swapWindowHandle } = require('../helpers/window');
const { seed, FIXTURE_ROOT } = require('../fixtures/seed-persistence-db');

const TOTAL_RUNS_RE = /Total runs:\s+(\d+)/i;
const SUMMARY_RE = /Roadie:\s+(\d+)\s+workflows?/i;

async function readStatsCount() {
  await runCommand('Roadie: Show Stats');
  const output = await waitForOutputChannel('Roadie', 'Roadie', 10_000).catch(() => '');
  const m = output.match(TOTAL_RUNS_RE) || output.match(SUMMARY_RE);
  if (!m) {
    throw new Error(
      `Roadie: Show Stats did not emit a recognisable count. Output excerpt: ${output.slice(-400)}`,
    );
  }
  return Number(m[1]);
}

describe('E2E: Persistence across reload', function () {
  this.timeout(120_000);

  let expectedCount;

  before(async function () {
    // Seed the fixture DB before VS Code is pointed at the workspace, so the
    // extension sees the pre-populated rows on first activation.
    const result = seed();
    expectedCount = result.rowCount;
    await VSBrowser.instance.openResources(FIXTURE_ROOT);
    await VSBrowser.instance.driver.sleep(3_000);
  });

  it('roadie.stats command runs after activation (smoke)', async function () {
    await runCommand('Roadie: Show Stats');
    const output = await waitForOutputChannel('Roadie', 'Roadie', 5_000).catch(() => '');
    if (output.toLowerCase().includes('unhandled')) {
      throw new Error(`stats command surfaced an unhandled error: ${output.substring(0, 200)}`);
    }
    new Workbench();
  });

  it('workflow history survives a window reload', async function () {
    const beforeCount = await readStatsCount();
    if (beforeCount !== expectedCount) {
      throw new Error(
        `Pre-reload count ${beforeCount} does not match seed count ${expectedCount}. ` +
        'Fixture seeding or activation-time DB open is broken.',
      );
    }

    // Reload the window. VS Code tears down and re-creates the extension host;
    // the Selenium session sticks with the new renderer because the CDP target
    // URL is preserved across a reload (same workspace window).
    await new Workbench().executeCommand('Developer: Reload Window');
    // Give the extension host time to re-activate against the workspace.
    await VSBrowser.instance.driver.sleep(8_000);

    // Re-attach to the workbench after reload and re-read the count.
    new Workbench();
    const afterCount = await readStatsCount();

    if (afterCount !== beforeCount) {
      throw new Error(
        `Workflow history count changed across reload: ${beforeCount} -> ${afterCount}. ` +
        'Expected the SQLite rows at .github/.roadie/project-model.db to survive.',
      );
    }
  });

  it.skip('workflow history survives a full close + re-open (fallback)', async function () {
    // TODO (D2): enable once vscode-extension-tester reliably survives the
    // window handle change that closeFolder triggers.
    //
    // The swapWindowHandle helper (e2e/helpers/window.js) is now available;
    // wire it up as follows when promoting from skip:
    //
    //   const driver = VSBrowser.instance.driver;
    //   const beforeHandle = await driver.getWindowHandle();
    //   const beforeCount = await readStatsCount();
    //
    //   await new Workbench().executeCommand('workbench.action.closeFolder');
    //   await driver.sleep(1_000);
    //
    //   await swapWindowHandle(driver, beforeHandle);
    //
    //   await VSBrowser.instance.openResources(FIXTURE_ROOT);
    //   await driver.sleep(5_000);
    //
    //   const afterCount = await readStatsCount();
    //   if (afterCount !== beforeCount) {
    //     throw new Error(
    //       `Count changed across close+re-open: ${beforeCount} -> ${afterCount}.`,
    //     );
    //   }
    //
    // Prerequisite: confirm that openResources() after closeFolder does not
    // create a second Selenium session (ExTester issue #847).
  });
});
