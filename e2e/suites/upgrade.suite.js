/**
 * E2E Suite: Upgrade path
 * Verifies that data and settings written by v0.9.x survive upgrade to v1.0.
 * This suite is marked it.skip until a v0.9.x fixture DB is committed.
 */
'use strict';
const { VSBrowser, Workbench } = require('vscode-extension-tester');

describe('E2E: Upgrade path v0.9 → v1.0', function () {
  this.timeout(60_000);

  it.skip('workflow history survives version upgrade', async function () {
    // TODO: pre-seed a v0.9.x fixture DB, install v0.9.x, write data,
    // upgrade to v1.0.x, assert all rows preserved and settings unchanged.
    // Requires: e2e/fixtures/workspaces/upgrade/ with a pre-seeded DB.
    // Unblock by committing the fixture and implementing the swap logic.
  });
});
