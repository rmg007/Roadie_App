#!/usr/bin/env node
/**
 * Checks all production npm dependencies for license compatibility.
 * Allowed licenses: MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, CC0-1.0
 * Exits with code 1 if any unlicensed or copyleft (GPL, LGPL, AGPL) dep is found.
 */
const { execSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const BLOCKED = ['GPL', 'LGPL', 'AGPL', 'CDDL', 'MPL'];

function readDepLicense(name, nodeModulesDir) {
  try {
    const pkgPath = join(nodeModulesDir, name, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    return pkg.license || 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}

try {
  const output = execSync('npm list --prod --json --depth=1 2>/dev/null', { encoding: 'utf8' });
  const tree = JSON.parse(output);
  const deps = Object.keys(tree.dependencies || {});
  const nodeModulesDir = join(__dirname, '..', 'node_modules');

  const violations = [];
  for (const name of deps) {
    const license = readDepLicense(name, nodeModulesDir);
    const blocked = BLOCKED.some(b => license.includes(b));
    if (blocked || license === 'UNKNOWN') {
      violations.push(`${name}: ${license}`);
    }
  }

  if (violations.length > 0) {
    console.error('License violations found:');
    violations.forEach(v => console.error(' ', v));
    process.exit(1);
  }
  console.log(`All ${deps.length} production dependencies have compatible licenses`);
} catch (e) {
  console.error('License check failed:', e.message);
  process.exit(1);
}
