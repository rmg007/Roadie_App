/**
 * Performance benchmarks for core Roadie operations.
 * Uses Vitest's bench API.
 *
 * Thresholds (enforced via test assertions):
 *  - ProjectAnalyzer.analyze()      ≤ 3 000 ms
 *  - FileGenerator.generateAll()    ≤ 2 000 ms
 */

import { describe, bench, it, expect, beforeAll } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { ProjectAnalyzer } from '../../src/analyzer/project-analyzer';
import { FileGenerator } from '../../src/generator/file-generator';
import { InMemoryProjectModel } from '../../src/model/project-model';
import { STUB_LOGGER } from '../../src/platform-adapters';

let tmpRoot: string;
let model: InMemoryProjectModel;

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'roadie-bench-'));
  // Create minimal project structure for analysis
  await fs.writeFile(path.join(tmpRoot, 'package.json'), JSON.stringify({
    name: 'bench-project', version: '1.0.0',
    dependencies: { typescript: '^5.2.0' },
    devDependencies: { vitest: '^0.34.0' },
  }));
  await fs.mkdir(path.join(tmpRoot, 'src'), { recursive: true });
  await fs.writeFile(path.join(tmpRoot, 'src', 'index.ts'), 'export const hello = "world";');

  model = new InMemoryProjectModel();
});

describe('ProjectAnalyzer performance', () => {
  it('analyze() completes in ≤ 3 000 ms', async () => {
    const analyzer = new ProjectAnalyzer(model, undefined, undefined, STUB_LOGGER);
    const start = performance.now();
    await analyzer.analyze(tmpRoot);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(3000);
  });

  bench('analyze() throughput', async () => {
    const m = new InMemoryProjectModel();
    const analyzer = new ProjectAnalyzer(m, undefined, undefined, STUB_LOGGER);
    await analyzer.analyze(tmpRoot);
  }, { iterations: 3 });
});

describe('FileGenerator performance', () => {
  it('generateAll() completes in ≤ 2 000 ms', async () => {
    const gen = new FileGenerator(tmpRoot, undefined, undefined, STUB_LOGGER, true /* dryRun */);
    const pm = model as any; // FileGenerator accepts ProjectModel
    const start = performance.now();
    await gen.generateAll(pm);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });

  bench('generateAll() throughput (dry-run)', async () => {
    const gen = new FileGenerator(tmpRoot, undefined, undefined, STUB_LOGGER, true);
    await gen.generateAll(model as any);
  }, { iterations: 3 });
});
