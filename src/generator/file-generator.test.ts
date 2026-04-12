import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { FileGenerator } from './file-generator';
import { InMemoryProjectModel } from '../model/project-model';
import type { TechStackEntry, ProjectCommand } from '../types';

describe('FileGenerator', () => {
  let tmpDir: string;
  let generator: FileGenerator;
  let model: InMemoryProjectModel;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'roadie-test-'));
    generator = new FileGenerator(tmpDir);
    model = new InMemoryProjectModel(null);
    model.setTechStack([
      { category: 'language', name: 'TypeScript', version: '5.2', sourceFile: 'package.json' },
      { category: 'framework', name: 'Next.js', version: '14.0', sourceFile: 'package.json' },
    ]);
    model.setCommands([
      { name: 'test', command: 'vitest run', sourceFile: 'package.json', type: 'test' },
      { name: 'build', command: 'next build', sourceFile: 'package.json', type: 'build' },
    ]);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('generates copilot-instructions.md with tech stack', async () => {
    const results = await generator.generateAll(model);
    const copilot = results.find((r) => r.type === 'copilot_instructions');
    expect(copilot).toBeDefined();
    expect(copilot!.written).toBe(true);
    expect(copilot!.content).toContain('TypeScript');
    expect(copilot!.content).toContain('Next.js');

    // File should exist on disk
    const content = await fs.readFile(path.join(tmpDir, '.github', 'copilot-instructions.md'), 'utf8');
    expect(content).toContain('<!-- roadie:start:tech-stack -->');
  });

  it('generates AGENTS.md with project overview', async () => {
    const results = await generator.generateAll(model);
    const agents = results.find((r) => r.type === 'agents_md');
    expect(agents).toBeDefined();
    expect(agents!.written).toBe(true);
    expect(agents!.content).toContain('TypeScript');
    expect(agents!.content).toContain('Agent Roles');
    expect(agents!.content).toContain('Bug Fix');
  });

  it('files contain section markers', async () => {
    const results = await generator.generateAll(model);
    for (const r of results) {
      expect(r.content).toContain('<!-- roadie:start:');
      expect(r.content).toContain('<!-- roadie:end:');
    }
  });

  it('skips write when content is identical (hash match)', async () => {
    // Generate once
    const first = await generator.generateAll(model);
    expect(first.every((r) => r.written)).toBe(true);

    // Generate again with same model — should skip
    const second = await generator.generateAll(model);
    expect(second.every((r) => !r.written)).toBe(true);
  });

  it('creates .github/.roadie/.gitignore', async () => {
    await generator.generateAll(model);
    const gitignore = await fs.readFile(
      path.join(tmpDir, '.github', '.roadie', '.gitignore'),
      'utf8',
    );
    expect(gitignore).toContain('project-model.db');
  });

  it('includes commands in copilot-instructions.md', async () => {
    const results = await generator.generateAll(model);
    const copilot = results.find((r) => r.type === 'copilot_instructions');
    expect(copilot!.content).toContain('vitest run');
    expect(copilot!.content).toContain('next build');
  });

  it('contentHash starts with sha256:', async () => {
    const results = await generator.generateAll(model);
    for (const r of results) {
      expect(r.contentHash).toMatch(/^sha256:[a-f0-9]+$/);
    }
  });
});
