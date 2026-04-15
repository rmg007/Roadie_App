import { describe, it, expect, beforeEach } from 'vitest';
import { generateClaudeMd } from './claude-md';
import { InMemoryProjectModel } from '../../model/project-model';
import type { TechStackEntry, ProjectCommand, DetectedPattern, DirectoryNode } from '../../types';

function makeModel(opts?: {
  stack?: TechStackEntry[];
  commands?: ProjectCommand[];
  patterns?: DetectedPattern[];
  tree?: DirectoryNode;
}): InMemoryProjectModel {
  const model = new InMemoryProjectModel(null);
  model.setTechStack(opts?.stack ?? [
    { category: 'language', name: 'TypeScript', version: '5.2', sourceFile: 'package.json' },
    { category: 'runtime', name: 'Node.js', sourceFile: 'package.json' },
  ]);
  model.setCommands(opts?.commands ?? [
    { name: 'test', command: 'vitest run', sourceFile: 'package.json', type: 'test' },
    { name: 'build', command: 'tsup src/index.ts', sourceFile: 'package.json', type: 'build' },
  ]);
  model.setPatterns(opts?.patterns ?? []);
  if (opts?.tree) model.setDirectoryTree(opts.tree);
  return model;
}

describe('generateClaudeMd', () => {
  let model: InMemoryProjectModel;

  beforeEach(() => {
    model = makeModel();
  });

  it('returns sections array', () => {
    const sections = generateClaudeMd(model);
    expect(Array.isArray(sections)).toBe(true);
    expect(sections.length).toBeGreaterThan(0);
  });

  it('includes workspace-rules section', () => {
    const sections = generateClaudeMd(model);
    const ws = sections.find((s) => s.id === 'workspace-rules');
    expect(ws).toBeDefined();
    expect(ws!.content).toContain('TypeScript');
    expect(ws!.content).toContain('vitest run');
  });

  it('includes repo-map section', () => {
    const sections = generateClaudeMd(model);
    const rm = sections.find((s) => s.id === 'repo-map');
    expect(rm).toBeDefined();
  });

  it('includes forbidden section as stub', () => {
    const sections = generateClaudeMd(model);
    const forbidden = sections.find((s) => s.id === 'forbidden');
    expect(forbidden).toBeDefined();
    expect(forbidden!.content).toContain('Forbidden');
  });

  it('includes high-confidence patterns in workspace-rules', () => {
    const m = makeModel({
      patterns: [
        { category: 'export_style', description: 'Uses named exports only', confidence: 0.9, evidence: { files: [], matchCount: 10, confidence: 0.9 } },
        { category: 'test_convention', description: 'Uses it() blocks', confidence: 0.5, evidence: { files: [], matchCount: 3, confidence: 0.5 } },
      ],
    });
    const sections = generateClaudeMd(m);
    const ws = sections.find((s) => s.id === 'workspace-rules');
    expect(ws!.content).toContain('Uses named exports only');
    expect(ws!.content).not.toContain('Uses it() blocks');
  });

  it('repo-map lists directory children when tree is populated', () => {
    const tree: DirectoryNode = {
      path: '/project',
      type: 'directory',
      children: [
        { path: '/project/src', type: 'directory', role: 'source', children: [
          { path: '/project/src/index.ts', type: 'file' },
          { path: '/project/src/utils.ts', type: 'file' },
          { path: '/project/src/helpers.ts', type: 'file' },
        ]},
        { path: '/project/test', type: 'directory', role: 'test', children: [] },
      ],
    };
    const m = makeModel({ tree });
    const sections = generateClaudeMd(m);
    const rm = sections.find((s) => s.id === 'repo-map');
    expect(rm!.content).toContain('src');
  });

  it('enforces 120-line budget on output', () => {
    // Create a model with a huge stack to potentially exceed budget
    const bigStack: TechStackEntry[] = Array.from({ length: 60 }, (_, i) => ({
      category: 'framework',
      name: `Framework${i}`,
      sourceFile: 'package.json',
    }));
    const m = makeModel({ stack: bigStack });
    const sections = generateClaudeMd(m);
    const totalLines = sections.reduce((acc, s) => acc + s.content.split('\n').length, 0);
    expect(totalLines).toBeLessThanOrEqual(120);
  });

  it('handles empty model gracefully', () => {
    const m = makeModel({ stack: [], commands: [], patterns: [] });
    const sections = generateClaudeMd(m);
    expect(sections.length).toBeGreaterThan(0);
    // Should still have repo-map and forbidden sections
    expect(sections.find((s) => s.id === 'repo-map')).toBeDefined();
  });

  it('section ids are unique', () => {
    const sections = generateClaudeMd(model);
    const ids = sections.map((s) => s.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  describe('simplified mode', () => {
    it('returns only workspace-rules section', () => {
      const sections = generateClaudeMd(model, { simplified: true });
      expect(sections).toHaveLength(1);
      expect(sections[0].id).toBe('workspace-rules');
    });

    it('omits repo-map in simplified mode', () => {
      const sections = generateClaudeMd(model, { simplified: true });
      expect(sections.find((s) => s.id === 'repo-map')).toBeUndefined();
    });

    it('omits forbidden section in simplified mode', () => {
      const sections = generateClaudeMd(model, { simplified: true });
      expect(sections.find((s) => s.id === 'forbidden')).toBeUndefined();
    });

    it('still includes workspace-rules content in simplified mode', () => {
      const m = makeModel({ stack: [{ category: 'language', name: 'TypeScript', sourceFile: 'package.json' }] });
      const sections = generateClaudeMd(m, { simplified: true });
      expect(sections[0].content.length).toBeGreaterThan(0);
    });

    it('passing simplified: false behaves identically to default', () => {
      const full = generateClaudeMd(model);
      const notSimplified = generateClaudeMd(model, { simplified: false });
      expect(notSimplified.length).toBe(full.length);
      expect(notSimplified.map((s) => s.id)).toEqual(full.map((s) => s.id));
    });
  });
});
