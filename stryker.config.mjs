/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: 'npm',
  reporters: ['html', 'clear-text', 'progress'],
  testRunner: 'vitest',
  coverageAnalysis: 'perTest',
  mutate: ['src/classifier/**/*.ts', '!src/classifier/**/*.test.ts'],
  vitest: { configFile: 'vitest.config.ts' },
  thresholds: { high: 70, low: 60, break: 50 },
  incremental: true,
  incrementalFile: '.stryker-tmp/incremental.json',
};
