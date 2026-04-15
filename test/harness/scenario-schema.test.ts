import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getScenarioFiles, validateScenarioFile } from './validate-scenarios';

describe('scenario schema validation', () => {
  const scenarioDir = path.join(process.cwd(), 'test', 'harness', 'scenarios');
  const scenarioFiles = getScenarioFiles(scenarioDir);

  it('discovers scenario files', () => {
    expect(scenarioFiles.length).toBeGreaterThan(0);
  });

  for (const scenarioFile of scenarioFiles) {
    const scenarioName = path.basename(scenarioFile);
    it(`validates ${scenarioName}`, () => {
      const errors = validateScenarioFile(scenarioDir, scenarioFile);
      expect(errors).toEqual([]);
    });
  }
});
