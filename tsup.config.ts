import { defineConfig } from 'tsup';

export default defineConfig([
  // ---- VS Code extension bundle ----
  {
    entry:   { extension: 'src/extension.ts' },
    outDir:  'out',
    format:  ['cjs'],
    // vscode is provided by the VS Code runtime.
    // node:sqlite is a Node.js 22.5+ built-in — stays external.
    // fast-glob and zod are pure-JS — bundle them so the .vsix needs no node_modules.
    external:   ['vscode', 'node:sqlite'],
    noExternal: ['fast-glob', 'zod'],
    sourcemap: true,
    clean:    true,
    target:   'node20',
    // After tsup writes the file, restore the "node:" prefix that esbuild strips.
    onSuccess: 'node scripts/fix-sqlite-require.js',
  },
]);
