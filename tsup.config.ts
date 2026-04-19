import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    outDir: 'out',
    format: ['cjs'],
    // better-sqlite3 uses native binaries, must be external.
    external: ['better-sqlite3'],
    noExternal: ['fast-glob', 'zod', '@modelcontextprotocol/sdk'],
    sourcemap: true,
    clean: true,
    target: 'node22',
    // Shebang fix for the generated index.js
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
]);
