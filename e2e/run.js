/**
 * Roadie E2E test runner
 *
 * Launches VS Code with the packaged VSIX and runs all suites.
 * Must be called after `npm run package` produces roadie-*.vsix.
 *
 * Usage:
 *   node e2e/run.js [vsix-path] [vs-code-version]
 *
 * Examples:
 *   node e2e/run.js                            # latest stable VS Code
 *   node e2e/run.js roadie-0.7.14.vsix 1.93.0 # min-supported version
 */

// @ts-check
'use strict';

const path = require('path');
const fs = require('fs');
const { ExTester } = require('vscode-extension-tester');

const ROOT = path.resolve(__dirname, '..');

async function main() {
  const [, , vsixPath, vsCodeVersion] = process.argv;

  // Resolve VSIX — either passed as arg or auto-detect in project root
  const vsix = vsixPath ?? findVsix(ROOT);
  if (!vsix || !fs.existsSync(vsix)) {
    console.error(`[e2e] No VSIX found. Run 'npm run package' first, then: node e2e/run.js [path-to.vsix]`);
    process.exit(1);
  }

  const version = vsCodeVersion ?? 'stable';
  console.log(`[e2e] Running against VSIX: ${vsix} on VS Code ${version}`);

  const tester = new ExTester(
    path.join(ROOT, 'e2e', '.vscode-test'),
    undefined,
    path.join(ROOT, 'e2e', 'settings.json'),
  );

  await tester.downloadCode(version);
  await tester.installVsix(vsix);
  const result = await tester.runTests(path.join(__dirname, 'suites', '*.suite.js'), {
    settings: path.join(__dirname, 'settings.json'),
    cleanup: false,
  });
  process.exit(result);
}

/** Find the most recent .vsix file in project root. */
function findVsix(root) {
  const files = fs.readdirSync(root).filter((f) => f.endsWith('.vsix'));
  if (!files.length) return null;
  return path.join(root, files.sort().at(-1));
}

main().catch((err) => {
  console.error('[e2e] Fatal:', err);
  process.exit(1);
});
