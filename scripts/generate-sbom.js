#!/usr/bin/env node
/**
 * Generates a CycloneDX-format SBOM (Software Bill of Materials) for the
 * Roadie extension. Writes sbom.json to the project root.
 *
 * Usage: node scripts/generate-sbom.js [--output <path>]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

// Parse --output flag
const args = process.argv.slice(2);
const outputFlagIdx = args.indexOf('--output');
const outputPath = outputFlagIdx !== -1 && args[outputFlagIdx + 1]
  ? path.resolve(args[outputFlagIdx + 1])
  : path.join(projectRoot, 'sbom.json');

// Read package.json
const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));

// Read package-lock.json
const lockPath = path.join(projectRoot, 'package-lock.json');
let lock = { packages: {} };
if (fs.existsSync(lockPath)) {
  lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
}

// Build components list from lock packages (v2/v3 format)
const components = [];
const packages = lock.packages || {};

for (const [pkgPath, pkgMeta] of Object.entries(packages)) {
  // Skip the root package entry (empty string key)
  if (!pkgPath || pkgPath === '') continue;

  // Strip "node_modules/" prefix to get the package name
  const name = pkgPath.replace(/^node_modules\//, '').replace(/\/node_modules\//g, '/');

  // Skip internal workspace packages
  if (!name) continue;

  const version = pkgMeta.version || 'unknown';
  const license = pkgMeta.license || 'unknown';

  const component = {
    type: 'library',
    name,
    version,
  };

  if (license && license !== 'unknown') {
    component.licenses = [{ license: { id: license } }];
  }

  components.push(component);
}

// Build CycloneDX 1.4 SBOM
const sbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.4',
  version: 1,
  serialNumber: `urn:uuid:${randomUUID()}`,
  metadata: {
    timestamp: new Date().toISOString(),
    component: {
      type: 'application',
      name: pkg.name,
      version: pkg.version,
      description: pkg.description || '',
      licenses: pkg.license ? [{ license: { id: pkg.license } }] : [],
    },
  },
  components,
};

fs.writeFileSync(outputPath, JSON.stringify(sbom, null, 2), 'utf8');
console.log(`SBOM written to: ${outputPath} (${components.length} components)`);

/**
 * Minimal UUID v4 generator — no external dependencies.
 * @returns {string}
 */
function randomUUID() {
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = bytes.map(b => b.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}
