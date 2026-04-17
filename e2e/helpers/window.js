/**
 * e2e/helpers/window.js
 *
 * Window-handle swap helper for vscode-extension-tester (WebdriverIO / Selenium).
 *
 * After `workbench.action.closeFolder` VS Code opens a new window whose CDP
 * target is a fresh handle.  The WebDriver session must be switched to the new
 * handle before any further Workbench interactions work.
 */

'use strict';

const DEFAULT_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 500;

/**
 * After the current window is closed/replaced, poll for a new CDP window handle
 * and switch the driver to it.  Resolves once the new window is ready.
 *
 * @param {import('selenium-webdriver').WebDriver} driver
 * @param {string} previousHandle  - handle returned by driver.getWindowHandle() before close
 * @param {number} [timeout]       - max wait in ms (default 20 000)
 * @returns {Promise<string>}      - the new window handle
 */
async function swapWindowHandle(driver, previousHandle, timeout = DEFAULT_TIMEOUT_MS) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const handles = await driver.getAllWindowHandles();
    const newHandle = handles.find((h) => h !== previousHandle);
    if (newHandle) {
      await driver.switchTo().window(newHandle);
      // Give the VS Code workbench time to finish its startup sequence.
      await driver.sleep(3_000);
      return newHandle;
    }
    await driver.sleep(POLL_INTERVAL_MS);
  }

  throw new Error(
    `swapWindowHandle: no new window handle appeared within ${timeout}ms. ` +
      'The previous handle was: ' + previousHandle,
  );
}

module.exports = { swapWindowHandle };
