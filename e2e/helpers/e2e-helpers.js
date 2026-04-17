/**
 * E2E helpers — shared utilities for Roadie test suites
 */

'use strict';

const { VSBrowser, WebDriver, Workbench, EditorView } = require('vscode-extension-tester');

const ROADIE_PARTICIPANT_ID = 'roadie';
const CHAT_OPEN_TIMEOUT_MS = 10_000;
const COMMAND_TIMEOUT_MS = 15_000;

/**
 * Open the VS Code chat panel and set it up for Roadie interaction.
 * @returns {Promise<{workbench: Workbench}>}
 */
async function openRoadieChat() {
  const workbench = new Workbench();
  await workbench.openCommandPrompt();
  // Open chat via keyboard shortcut or command palette
  await workbench.executeCommand('Chat: Open Chat');
  await VSBrowser.instance.driver.sleep(1_500);
  return { workbench };
}

/**
 * Execute a VS Code command and wait for it to complete.
 * @param {string} command
 * @param {number} [timeoutMs]
 */
async function runCommand(command, timeoutMs = COMMAND_TIMEOUT_MS) {
  const workbench = new Workbench();
  await workbench.executeCommand(command);
  await VSBrowser.instance.driver.sleep(2_000);
}

/**
 * Wait until the output channel contains the expected text.
 * @param {string} channelName
 * @param {string} expected
 * @param {number} [timeoutMs]
 */
async function waitForOutputChannel(channelName, expected, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  const driver = VSBrowser.instance.driver;
  while (Date.now() < deadline) {
    const workbench = new Workbench();
    const outputView = await workbench.openOutputView();
    await outputView.selectChannel(channelName);
    const text = await outputView.getText();
    if (text.includes(expected)) return text;
    await driver.sleep(500);
  }
  throw new Error(`Timeout waiting for '${expected}' in output channel '${channelName}'`);
}

module.exports = {
  ROADIE_PARTICIPANT_ID,
  CHAT_OPEN_TIMEOUT_MS,
  COMMAND_TIMEOUT_MS,
  openRoadieChat,
  runCommand,
  waitForOutputChannel,
};
