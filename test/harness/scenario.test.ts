import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getScenarioFiles } from './validate-scenarios';
import { runScenario } from './scenario-runner';

describe('scenario runner', () => {
  const scenarioDir = path.join(process.cwd(), 'test', 'harness', 'scenarios');
  const scenarioFiles = getScenarioFiles(scenarioDir);

  it('discovers scenario files', () => {
    expect(scenarioFiles.length).toBeGreaterThanOrEqual(3);
  });

  for (const scenarioFile of scenarioFiles) {
    const scenarioName = path.basename(scenarioFile);
    it(`executes ${scenarioName}`, async () => {
      const result = await runScenario(scenarioFile);
      expect(result.scenarioId.length).toBeGreaterThan(0);
      expect(result.stepsExecuted).toBeGreaterThan(0);
    });
  }
});
