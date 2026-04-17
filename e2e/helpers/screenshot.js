/**
 * e2e/helpers/screenshot.js
 *
 * Captures a PNG screenshot via the WebDriver session and writes it to
 * e2e/screenshots/<sanitised-test-title>-<timestamp>.png.
 *
 * Usage in a Mocha afterEach hook:
 *
 *   const { captureOnFailure } = require('./screenshot');
 *
 *   afterEach(async function () {
 *     if (this.currentTest.state === 'failed') {
 *       const file = await captureOnFailure(
 *         VSBrowser.instance.driver,
 *         this.currentTest.fullTitle(),
 *       );
 *       console.log(`Screenshot saved: ${file}`);
 *     }
 *   });
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SCREENSHOTS_DIR = path.join(__dirname, '..', 'screenshots');

/**
 * Take a screenshot and save it to e2e/screenshots/.
 *
 * @param {import('selenium-webdriver').WebDriver} driver
 * @param {string} testTitle  - full Mocha test title (spaces replaced with dashes)
 * @returns {Promise<string>} - absolute path of the saved PNG file
 */
async function captureOnFailure(driver, testTitle) {
  const png = await driver.takeScreenshot();
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  const safeName = testTitle.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9\-_.]/g, '_');
  const file = path.join(SCREENSHOTS_DIR, `${safeName}-${Date.now()}.png`);
  fs.writeFileSync(file, Buffer.from(png, 'base64'));
  return file;
}

module.exports = { captureOnFailure };
