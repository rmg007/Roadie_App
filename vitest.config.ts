import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    passWithNoTests: true,
    exclude: [
      'node_modules/**',
      'dist/**',
      // Fixture projects contain stub files that are not real test suites
      'test/fixtures/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Thresholds — current actual: ~87 lines, ~85 branches, ~84 functions.
      // Set a few points below to allow headroom while enforcing a meaningful floor.
      lines: 85,
      branches: 82,
      functions: 80,
      statements: 85,
    },
  },
});
