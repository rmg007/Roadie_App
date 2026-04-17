/**
 * audit-e2e-coverage.js
 *
 * Reads package.json contributes.commands and all e2e/suites/*.suite.js files,
 * then reports which commands have no E2E coverage.
 *
 * Usage:
 *   node scripts/audit-e2e-coverage.js             # exits 1 if gaps found
 *   node scripts/audit-e2e-coverage.js --report-only  # always exits 0
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const REPORT_ONLY = process.argv.includes('--report-only');

// ── 1. Extract commands from package.json ────────────────────────────────────
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const allCommands = (pkg.contributes?.commands ?? []).map((c) => c.command);

if (allCommands.length === 0) {
  console.error('audit-e2e-coverage: no commands found in package.json contributes.commands');
  process.exit(1);
}

// ── 2. Extract referenced commands from suite files ──────────────────────────
const SUITES_DIR = path.join(ROOT, 'e2e', 'suites');
const suiteFiles = fs
  .readdirSync(SUITES_DIR)
  .filter((f) => f.endsWith('.suite.js'))
  .map((f) => path.join(SUITES_DIR, f));

// Match runCommand('roadie.xyz') and executeCommand('roadie.xyz')
const COMMAND_RE = /(?:runCommand|executeCommand)\(\s*['"]([^'"]+)['"]/g;

/** @type {Set<string>} */
const coveredCommands = new Set();

for (const file of suiteFiles) {
  const src = fs.readFileSync(file, 'utf8');
  let m;
  while ((m = COMMAND_RE.exec(src)) !== null) {
    coveredCommands.add(m[1]);
  }
}

// ── 3. Compute gaps ──────────────────────────────────────────────────────────
const gaps = allCommands.filter((cmd) => !coveredCommands.has(cmd));
const covered = allCommands.filter((cmd) => coveredCommands.has(cmd));

// ── 4. Print summary table ───────────────────────────────────────────────────
const pct = allCommands.length === 0 ? 100 : Math.round((covered.length / allCommands.length) * 100);

console.log('\nE2E Command Coverage Audit');
console.log('==========================');
console.log(`Total commands : ${allCommands.length}`);
console.log(`Covered        : ${covered.length}`);
console.log(`Gaps           : ${gaps.length}`);
console.log(`Coverage       : ${pct}%\n`);

if (gaps.length > 0) {
  console.log('Commands with NO E2E coverage:');
  for (const cmd of gaps) {
    console.log(`  [GAP] ${cmd}`);
  }
  console.log('');
}

if (covered.length > 0) {
  console.log('Commands with E2E coverage:');
  for (const cmd of covered) {
    console.log(`  [OK]  ${cmd}`);
  }
  console.log('');
}

// ── 5. Exit code ─────────────────────────────────────────────────────────────
if (gaps.length > 0 && !REPORT_ONLY) {
  console.error(`audit-e2e-coverage: ${gaps.length} command(s) have no E2E coverage. Add suite coverage or pass --report-only.`);
  process.exit(1);
}

process.exit(0);
