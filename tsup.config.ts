import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/extension.ts'],
  outDir: 'out',
  format: ['cjs'],
  external: ['vscode'],
  sourcemap: true,
  clean: true,
  target: 'node20',
});
