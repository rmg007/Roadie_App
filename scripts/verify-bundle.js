// verify-bundle.js — basic post-build bundle validations
const fs = require('fs');
const vm = require('vm');
const outFile = 'out/extension.js';

if (!fs.existsSync(outFile)) {
  console.error(`[verify-bundle] ERROR: ${outFile} not found`);
  process.exit(1);
}

const content = fs.readFileSync(outFile, 'utf8');

// 1) Ensure no bare require("sqlite") remains
if (/require\((?:'|\")sqlite(?:'|\")\)/.test(content)) {
  console.error('[verify-bundle] ERROR: Found bare require("sqlite") in bundle');
  process.exit(1);
}

// 2) Ensure FakeModelProvider does not leak into production bundle
// (It should only be included when ROADIE_TEST_MODE env var is set)
// Look for the class definition or its usage patterns
if (process.env.ROADIE_TEST_MODE !== 'true') {
  const fakeProviderPatterns = [
    /class FakeModelProvider\s*{/,
    /class FakeProgressReporter\s*{/,
    /class FakeCancellationHandle\s*{/,
    /class FakeFileSystemProvider\s*{/,
    /class FakeConfigProvider\s*{/,
  ];

  for (const pattern of fakeProviderPatterns) {
    if (pattern.test(content)) {
      console.error('[verify-bundle] ERROR: FakeModelProvider detected in production bundle');
      console.error('[verify-bundle]   Set ROADIE_TEST_MODE=true if intentional, or use /* @__PURE__ */ marking');
      process.exit(1);
    }
  }
}

// 3) Basic sanity: try to parse the file in a vm context
try {
  new vm.Script(content, { filename: outFile });
} catch (err) {
  console.error('[verify-bundle] ERROR: Bundle is not valid JS:', err.message);
  process.exit(1);
}

// 3) Size checks
const sizeKB = Buffer.byteLength(content, 'utf8') / 1024;
if (sizeKB > 1024) {
  console.error(`[verify-bundle] ERROR: Bundle too large: ${Math.round(sizeKB)} KB`);
  process.exit(1);
}
if (sizeKB > 600) {
  console.warn(`[verify-bundle] WARNING: Bundle size is ${Math.round(sizeKB)} KB — consider optimising`);
}

console.log('[verify-bundle] OK');
