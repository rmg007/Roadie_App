#!/usr/bin/env node
/**
 * v1.0 release gate. Runs all phase exit criteria back-to-back.
 * Exit code 0 = ready to ship. Exit code 1 = not ready.
 *
 * Usage: node scripts/verify-1.0.js
 */
const { execSync } = require('node:child_process');

const gates = [
  { name: 'Lint',           cmd: 'npm run lint' },
  { name: 'Tests (861+)',   cmd: 'npm test' },
  { name: 'Build',          cmd: 'npm run build' },
  { name: 'Bundle size',    cmd: 'node scripts/check-bundle-size.js' },
  { name: 'Licenses',       cmd: 'node scripts/check-licenses.js' },
  { name: 'Doctor',         cmd: 'node scripts/doctor.js' },
  { name: 'SBOM',           cmd: 'node scripts/generate-sbom.js' },
];

let passed = 0, failed = 0;
for (const gate of gates) {
  try {
    execSync(gate.cmd, { stdio: 'inherit' });
    console.log(`PASS ${gate.name}`);
    passed++;
  } catch {
    console.error(`FAIL ${gate.name}`);
    failed++;
  }
}

console.log(`\n${passed}/${gates.length} gates passed`);
if (failed > 0) {
  console.error('Not ready to ship v1.0.0');
  process.exit(1);
}
console.log('v1.0.0 is ready to ship!');
