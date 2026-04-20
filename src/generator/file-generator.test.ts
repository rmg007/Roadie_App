import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock vscode so the module can be imported in test environments
vi.mock('vscode', () => ({
  window: { createOutputChannel: vi.fn(() => ({ appendLine: vi.fn(), dispose: vi.fn(), show: vi.fn() })) },
}));

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

    // File should exist on disk at the actual path
    const content = await fs.readFile(path.join(tmpDir, '.roadie', 'instructions.md'), 'utf8');
    expect(content).toContain('<!-- roadie:start:roadie-toc -->');
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
    // Skill files use YAML front-matter format, not roadie section markers
    const sectionedResults = results.filter((r) => (r as any).type !== 'skill');
    for (const r of sectionedResults) {
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

  it('writeReason is "new" on first write', async () => {
    const results = await generator.generateAll(model);
    for (const r of results) {
      expect(r.writeReason).toBe('new');
    }
  });

  it('writeReason is "unchanged" when content is identical', async () => {
    await generator.generateAll(model);
    const second = await generator.generateAll(model);
    for (const r of second) {
      expect(r.writeReason).toBe('unchanged');
    }
  });

  it('writeReason is "updated" when content changes', async () => {
    await generator.generateAll(model);

    // Change the model to trigger a content change
    model.setTechStack([
      { category: 'language', name: 'TypeScript', version: '5.4', sourceFile: 'package.json' },
      { category: 'framework', name: 'React', version: '18.0', sourceFile: 'package.json' },
    ]);

    const second = await generator.generateAll(model);
    // At least the core files (Copilot, agents_md) should be updated
    const updated = second.filter((r) => r.writeReason === 'updated');
    expect(updated.length).toBeGreaterThan(0);
    
    // agents_md includes the full tech stack, so it should be updated when the model changes
    const agents = second.find((r) => r.type === 'agents_md');
    expect(agents!.writeReason).toBe('updated');
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

  it('AGENTS.md includes commands section (content contract)', async () => {
    const results = await generator.generateAll(model);
    const agents = results.find((r) => r.type === 'agents_md');
    expect(agents!.content).toContain('## Project Commands');
    expect(agents!.content).toContain('vitest run');
    expect(agents!.content).toContain('next build');
  });

  it('AGENTS.md includes directory structure section (content contract)', async () => {
    const results = await generator.generateAll(model);
    const agents = results.find((r) => r.type === 'agents_md');
    expect(agents!.content).toContain('## Directory Structure');
  });

  it('AGENTS.md includes all required sections (content contract)', async () => {
    const results = await generator.generateAll(model);
    const agents = results.find((r) => r.type === 'agents_md');
    const content = agents!.content;
    // All 5 required sections must be present
    expect(content).toContain('<!-- roadie:start:project-overview -->');
    expect(content).toContain('<!-- roadie:start:commands -->');
    expect(content).toContain('<!-- roadie:start:agent-roles -->');
    expect(content).toContain('<!-- roadie:start:workflows -->');
    expect(content).toContain('<!-- roadie:start:directory-structure -->');
  });

  it('contentHash starts with sha256:', async () => {
    const results = await generator.generateAll(model);
    for (const r of results) {
      expect(r.contentHash).toMatch(/^sha256:[a-f0-9]+$/);
    }
  });
});
