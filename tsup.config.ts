import { defineConfig } from 'tsup';

export default defineConfig([
  // ---- VS Code extension bundle ----
  {
    entry:   { extension: 'src/extension.ts' },
    outDir:  'out',
    format:  ['cjs'],
    // vscode is provided by the VS Code runtime.
    // better-sqlite3 is a native module — stays external.
    // fast-glob and zod are pure-JS — bundle them so the .vsix needs no node_modules.
    external:   ['vscode', 'better-sqlite3'],
    noExternal: ['fast-glob', 'zod'],
    sourcemap: true,
    clean:    true,
    target:   'node20',
  },
]);
