#!/usr/bin/env node
/**
 * Roadie health check — verifies the VS Code extension install is correct.
 *
 * Checks:
 *   1. out/extension.js exists
 *   2. roadie-0.5.0.vsix present in repo root (warn if missing, not fail)
 *   3. VS Code CLI available and extension registered
 *      (`code --list-extensions | grep roadie.roadie`)
 *
 * Exit 0 if all checks pass, 1 if any hard failure. Warnings do not fail.
 */

const { existsSync, statSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const PACKAGE_ROOT = resolve(__dirname, '..');
const EXT_ENTRY    = join(PACKAGE_ROOT, 'out', 'extension.js');
const packageJson  = require(join(PACKAGE_ROOT, 'package.json'));
const { version, publisher, name } = packageJson;
const VSIX_NAME    = `roadie-${version}.vsix`;
const VSIX_PATH    = join(PACKAGE_ROOT, VSIX_NAME);
const EXTENSION_ID = `${publisher}.${name}`;

const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
};
const ok   = (m) => console.log(`${C.green}\u2713${C.reset} ${m}`);
const warn = (m) => console.log(`${C.yellow}!${C.reset} ${m}`);
const err  = (m) => console.log(`${C.red}\u2717${C.reset} ${m}`);
const head = (m) => console.log(`\n${C.bold}${m}${C.reset}`);

let failures = 0;
function fail(msg) { err(msg); failures++; }

const codeCmd = process.platform === 'win32' ? 'code.cmd' : 'code';

// ── Check 1: extension build ──────────────────────────────────────────────────
function checkExtensionBuild() {
  head('1. VS Code extension build');
  if (!existsSync(EXT_ENTRY)) {
    fail(`out/extension.js missing \u2014 run \`npm run build\``);
    return;
  }
  const s = statSync(EXT_ENTRY);
  const ageMin = ((Date.now() - s.mtimeMs) / 60000).toFixed(0);
  ok(`out/extension.js exists (${(s.size / 1024).toFixed(1)} KB, ${ageMin} min old)`);
}

// ── Check 2: marketplace readiness ───────────────────────────────────────────
function checkMarketplaceReadiness() {
  head('2. Marketplace readiness');

  const iconPath = join(PACKAGE_ROOT, 'images', 'icon.png');
  if (existsSync(iconPath)) {
    ok('images/icon.png exists');
  } else {
    fail('images/icon.png missing — add a valid 128x128 PNG before packaging');
  }

  const vscodeIgnorePath = join(PACKAGE_ROOT, '.vscodeignore');
  if (existsSync(vscodeIgnorePath)) {
    ok('.vscodeignore exists');
  } else {
    warn('.vscodeignore missing — package may include unnecessary files');
  }

  if (typeof packageJson.license === 'string' && packageJson.license.trim()) {
    ok(`license set to ${packageJson.license}`);
  } else {
    warn('package.json license field missing');
  }

  const keywordCount = Array.isArray(packageJson.keywords) ? packageJson.keywords.length : 0;
  if (keywordCount <= 5) {
    ok(`keywords count is ${keywordCount}`);
  } else {
    warn(`keywords count is ${keywordCount} — Marketplace uses at most 5`);
  }
}

// ── Check 3: .vsix present (warn only) ───────────────────────────────────────
function checkVsix() {
  head('3. Packaged .vsix');
  if (!existsSync(VSIX_PATH)) {
    warn(`${VSIX_NAME} not found in repo root. Run \`npm run package\` to create it.`);
    return;
  }
  const s = statSync(VSIX_PATH);
  ok(`${VSIX_NAME} present (${(s.size / 1024).toFixed(0)} KB)`);
}

// ── Check 4: VS Code extension registered ────────────────────────────────────
function checkExtensionInstalled() {
  head('4. VS Code extension registration');
  const r = spawnSync(codeCmd, ['--list-extensions'], { encoding: 'utf-8', shell: true });
  if (r.status !== 0) {
    warn('VS Code CLI `code` not available \u2014 cannot verify extension registration.');
    warn('  In VS Code run: Shell Command: Install \'code\' command in PATH');
    return;
  }
  const list = (r.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean);
  if (list.includes(EXTENSION_ID)) {
    ok(`${EXTENSION_ID} is installed`);
  } else {
    fail(`${EXTENSION_ID} not installed \u2014 run \`npm run install:all\``);
  }
}

// ── Check 5: generated context files present (warn only) ─────────────────────
function checkGeneratedFiles() {
  head('5. Generated context files');
  const expectedFiles = [
    'AGENTS.md',
    '.github/copilot-instructions.md',
    'CLAUDE.md',
    '.cursor/rules/project.mdc',
  ];
  let allPresent = true;
  for (const f of expectedFiles) {
    const filePath = join(PACKAGE_ROOT, f);
    if (existsSync(filePath)) {
      ok(`${f} exists`);
    } else {
      warn(`${f} missing — run \`roadie.init\` in VS Code to generate it`);
      allPresent = false;
    }
  }
  // Fifth generated family: per-directory path instructions
  const instructionsDir = join(PACKAGE_ROOT, '.github', 'instructions');
  if (existsSync(instructionsDir)) {
    ok('.github/instructions/ directory exists');
  } else {
    warn('.github/instructions/ missing — run `roadie.init` in VS Code to generate it');
    allPresent = false;
  }
  if (allPresent) ok('All 5 context file families present');
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  console.log(`${C.bold}Roadie \u2014 doctor${C.reset}`);
  console.log(`${C.dim}package: ${PACKAGE_ROOT}${C.reset}`);

  checkExtensionBuild();
  checkMarketplaceReadiness();
  checkVsix();
  checkExtensionInstalled();
  checkGeneratedFiles();

  console.log();
  if (failures === 0) {
    console.log(`${C.green}${C.bold}All checks passed.${C.reset} Roadie is ready to use.`);
    process.exit(0);
  } else {
    console.log(
      `${C.red}${C.bold}${failures} check(s) failed.${C.reset} ` +
      `Run \`npm run install:all\` to fix, or see messages above.`,
    );
    process.exit(1);
  }
}

main();
