/**
 * Integration test: ProjectAnalyzer + FileGenerator against ts-calculator fixture.
 * Exercises the full scan → model → generate pipeline for a minimal TypeScript project.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

vi.mock('vscode', () => ({
  window: { createOutputChannel: vi.fn(() => ({ appendLine: vi.fn(), dispose: vi.fn(), show: vi.fn() })) },
}));

import { ProjectAnalyzer } from './project-analyzer';
import { FileGenerator } from '../generator/file-generator';
import { InMemoryProjectModel } from '../model/project-model';

const FIXTURE_ROOT = path.resolve(__dirname, '../../test/fixtures/ts-calculator');

describe('ProjectAnalyzer + FileGenerator — ts-calculator', () => {
  let tmpDir: string;
  let model: InMemoryProjectModel;

  beforeEach(async () => {
    // Work in a temp dir so generated files don't pollute the fixture
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'roadie-calc-'));
    // Copy just the package.json and tsconfig.json into tmpDir (minimum needed)
    await fs.copyFile(
      path.join(FIXTURE_ROOT, 'package.json'),
      path.join(tmpDir, 'package.json'),
    );
    await fs.copyFile(
      path.join(FIXTURE_ROOT, 'tsconfig.json'),
      path.join(tmpDir, 'tsconfig.json'),
    );

    model = new InMemoryProjectModel(null);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('analyzes fixture and populates tech stack', async () => {
    const analyzer = new ProjectAnalyzer(model);
    await analyzer.analyze(tmpDir);

    const stack = model.getTechStack();
    expect(stack.length).toBeGreaterThan(0);
    expect(stack.some((e) => e.name === 'TypeScript')).toBe(true);
    expect(stack.some((e) => e.name === 'Vitest')).toBe(true);
    expect(stack.some((e) => e.name === 'tsup')).toBe(true);
  });

  it('analyzes fixture and extracts commands', async () => {
    const analyzer = new ProjectAnalyzer(model);
    await analyzer.analyze(tmpDir);

    const cmds = model.getCommands();
    expect(cmds.length).toBeGreaterThan(0);
    expect(cmds.some((c) => c.type === 'test')).toBe(true);
    expect(cmds.some((c) => c.type === 'build')).toBe(true);
  });

  it('generates copilot-instructions.md with correct tech content', async () => {
    const analyzer = new ProjectAnalyzer(model);
    await analyzer.analyze(tmpDir);

    const generator = new FileGenerator(tmpDir);
    const results = await generator.generateAll(model);

    const copilot = results.find((r) => r.type === 'copilot_instructions');
    expect(copilot).toBeDefined();
    expect(copilot!.written).toBe(true);
    expect(copilot!.content).toContain('TypeScript');
    expect(copilot!.content).toContain('Vitest');
    expect(copilot!.content).toContain('tsup');
    // No hallucinated frameworks
    expect(copilot!.content).not.toContain('Next.js');
    expect(copilot!.content).not.toContain('React');
  });

  it('generates copilot-instructions.md with formatted test command', async () => {
    // DependencyScanner formats commands as "<pm> run <name>", not the raw script value.
    // So the stored command is "npm run test", not "vitest run".
    const analyzer = new ProjectAnalyzer(model);
    await analyzer.analyze(tmpDir);

    const generator = new FileGenerator(tmpDir);
    const results = await generator.generateAll(model);

    const copilot = results.find((r) => r.type === 'copilot_instructions');
    expect(copilot!.content).toContain('npm run test');
    expect(copilot!.content).toContain('npm run build');
  });

  it('generates AGENTS.md with project overview section', async () => {
    const analyzer = new ProjectAnalyzer(model);
    await analyzer.analyze(tmpDir);

    const generator = new FileGenerator(tmpDir);
    const results = await generator.generateAll(model);

    const agents = results.find((r) => r.type === 'agents_md');
    expect(agents).toBeDefined();
    expect(agents!.written).toBe(true);
    expect(agents!.content).toContain('TypeScript');
    expect(agents!.content).toContain('<!-- roadie:start:project-overview -->');
  });

  it('second generate call skips write (hash match)', async () => {
    const analyzer = new ProjectAnalyzer(model);
    await analyzer.analyze(tmpDir);
    const generator = new FileGenerator(tmpDir);

    const first = await generator.generateAll(model);
    expect(first.every((r) => r.written)).toBe(true);

    const second = await generator.generateAll(model);
    expect(second.every((r) => !r.written)).toBe(true);
  });

  it('toContext() returns non-empty serialized string after analysis', async () => {
    const analyzer = new ProjectAnalyzer(model);
    await analyzer.analyze(tmpDir);

    const ctx = model.toContext({ maxTokens: 1000 });
    expect(ctx.serialized.length).toBeGreaterThan(0);
    expect(ctx.serialized).toContain('TypeScript');
  });

  it('populates detected patterns after analysis', async () => {
    const analyzer = new ProjectAnalyzer(model);
    await analyzer.analyze(tmpDir);

    const patterns = model.getPatterns();
    expect(patterns.length).toBeGreaterThan(0);
    expect(patterns.some((p) => p.category === 'language')).toBe(true);
    expect(patterns.some((p) => p.category === 'testing')).toBe(true);
    expect(patterns.some((p) => p.description.includes('TypeScript'))).toBe(true);
    expect(patterns.some((p) => p.description.includes('Vitest'))).toBe(true);
  });

  it('all detected patterns have confidence between 0 and 1', async () => {
    const analyzer = new ProjectAnalyzer(model);
    await analyzer.analyze(tmpDir);

    const patterns = model.getPatterns();
    for (const p of patterns) {
      expect(p.confidence).toBeGreaterThan(0);
      expect(p.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('mixed-js-ts fixture derives TypeScript pattern without throwing', async () => {
    const mixedRoot = path.resolve(__dirname, '../../test/fixtures/mixed-js-ts');
    const mixedTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'roadie-mixed-'));
    try {
      await fs.copyFile(path.join(mixedRoot, 'package.json'), path.join(mixedTmpDir, 'package.json'));
      await fs.copyFile(path.join(mixedRoot, 'tsconfig.json'), path.join(mixedTmpDir, 'tsconfig.json'));
      const mixedModel = new InMemoryProjectModel(null);
      const mixedAnalyzer = new ProjectAnalyzer(mixedModel);
      await expect(mixedAnalyzer.analyze(mixedTmpDir)).resolves.not.toThrow();
      const patterns = mixedModel.getPatterns();
      expect(patterns.some((p) => p.category === 'language')).toBe(true);
    } finally {
      await fs.rm(mixedTmpDir, { recursive: true, force: true });
    }
  });
});
