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

  // ---- MCP CLI bundle ----
  {
    entry:   { 'bin/roadie-mcp': 'bin/roadie-mcp.ts' },
    outDir:  'out',
    format:  ['cjs'],
    // vscode is never imported in standalone mode, but keep it external
    // in case a transitive import slips in (it will fail at runtime, not build time).
    external:   ['vscode', 'better-sqlite3'],
    noExternal: ['fast-glob', 'zod', '@modelcontextprotocol/sdk'],
    sourcemap: true,
    // Do not clean here — the extension bundle runs first and owns `clean: true`
    clean:    false,
    target:   'node20',
    // Make the output executable on POSIX systems
    banner:   { js: '#!/usr/bin/env node' },
  },
]);
