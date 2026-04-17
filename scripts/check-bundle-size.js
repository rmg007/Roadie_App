#!/usr/bin/env node
/**
 * Enforces the 600 KB bundle size budget for out/extension.js.
 * Run after `npm run build`. Exit code 1 if budget exceeded by > 5%.
 *
 * Usage: node scripts/check-bundle-size.js [--threshold-kb <n>]
 */
const fs = require('node:fs');
const path = require('node:path');

const BUDGET_KB = 600;
const TOLERANCE = 0.05; // 5%
const HARD_LIMIT_KB = BUDGET_KB * (1 + TOLERANCE);

const outFile = path.join(__dirname, '..', 'out', 'extension.js');

if (!fs.existsSync(outFile)) {
  console.error('out/extension.js not found. Run npm run build first.');
  process.exit(1);
}

const sizeKB = fs.statSync(outFile).size / 1024;
const status = sizeKB <= HARD_LIMIT_KB ? 'PASS' : 'FAIL';
console.log(`[${status}] Bundle size: ${sizeKB.toFixed(1)} KB (budget: ${BUDGET_KB} KB, hard limit: ${HARD_LIMIT_KB.toFixed(0)} KB)`);

if (sizeKB > HARD_LIMIT_KB) {
  console.error(`Bundle exceeds hard limit by ${(sizeKB - HARD_LIMIT_KB).toFixed(1)} KB`);
  process.exit(1);
}
