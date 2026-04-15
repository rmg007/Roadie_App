#!/usr/bin/env node

const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const packageJsonPath = join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

const baseName = 'Roadie';
const suffix = 'AI Workflow Engine for Copilot';
const expectedDisplayName = `${baseName} v${packageJson.version} — ${suffix}`;

if (packageJson.displayName !== expectedDisplayName) {
  packageJson.displayName = expectedDisplayName;
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
  console.log(`Updated displayName to: ${expectedDisplayName}`);
} else {
  console.log(`displayName already in sync: ${expectedDisplayName}`);
}
