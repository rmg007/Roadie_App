// Post-build fixup: esbuild strips the "node:" prefix from require("node:sqlite").
// VS Code's Electron/Node 22 only exposes sqlite as "node:sqlite", not bare "sqlite".
const fs = require('fs');
const outFile = 'out/extension.js';
const content = fs.readFileSync(outFile, 'utf8');
const fixed = content.replaceAll('require("sqlite")', 'require("node:sqlite")');
if (fixed !== content) {
  fs.writeFileSync(outFile, fixed);
  const count = (content.match(/require\("sqlite"\)/g) || []).length;
  console.log(`[fix-sqlite-require] Restored ${count} require("node:sqlite") call(s).`);
} else {
  console.log('[fix-sqlite-require] No bare require("sqlite") found — nothing to fix.');
}
