// Post-build fixup: esbuild strips the "node:" prefix from require("node:sqlite").
// VS Code's Electron/Node 22 only exposes sqlite as "node:sqlite", not bare "sqlite".
const fs = require('fs');
const outFile = 'out/extension.js';
if (!fs.existsSync(outFile)) {
  console.error(`[fix-sqlite-require] ERROR: ${outFile} not found.`);
  process.exitCode = 1;
  return;
}
const content = fs.readFileSync(outFile, 'utf8');
const barePattern = /require\((?:'|\")sqlite(?:'|\")\)/g;
const fixed = content.replaceAll('require("sqlite")', 'require("node:sqlite")');
if (fixed !== content) {
  fs.writeFileSync(outFile, fixed);
  const count = (content.match(barePattern) || []).length;
  console.log(`[fix-sqlite-require] Restored ${count} require("node:sqlite") call(s).`);
} else {
  console.log('[fix-sqlite-require] No bare require("sqlite") found — nothing to fix.');
}

// Final verification: fail the script if any bare require("sqlite") still exists
const finalContent = fs.readFileSync(outFile, 'utf8');
if (barePattern.test(finalContent)) {
  console.error('[fix-sqlite-require] FATAL: Bare require("sqlite") still present in bundle after fix.');
  process.exitCode = 1;
}
