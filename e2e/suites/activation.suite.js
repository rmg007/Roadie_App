/**
 * E2E Suite: Activation
 *
 * Verifies that the Roadie extension activates correctly when VS Code opens
 * a workspace containing .github/.roadie/project-model.db, or when the
 * roadie.init command is invoked.
 */

'use strict';

const { VSBrowser, Workbench } = require('vscode-extension-tester');
const { runCommand, waitForOutputChannel } = require('../helpers/e2e-helpers');

describe('E2E: Extension activation', function () {
  this.timeout(30_000);

  it('activates when roadie.init command is run', async function () {
    await runCommand('Roadie: Initialize Project');
    // Extension should produce output in the Roadie output channel
    const output = await waitForOutputChannel('Roadie', 'Roadie');
    // Should not throw an activation error
    if (output.toLowerCase().includes('unhandled') || output.toLowerCase().includes('activation error')) {
      throw new Error(`Unexpected activation error in output: ${output.substring(0, 300)}`);
    }
  });

  it('roadie.doctor command completes without errors', async function () {
    await runCommand('Roadie: Doctor');
    const output = await waitForOutputChannel('Roadie', 'Doctor');
    if (output.toLowerCase().includes('unhandled exception')) {
      throw new Error(`Doctor command failed: ${output.substring(0, 300)}`);
    }
  });
});
