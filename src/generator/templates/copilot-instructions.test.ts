import { describe, it, expect, beforeEach } from 'vitest';
import { generateCopilotInstructions } from './copilot-instructions';
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
    { category: 'test_tool', name: 'Vitest', version: '0.34', sourceFile: 'package.json' },
  ]);
  model.setCommands(opts?.commands ?? [
    { name: 'test', command: 'npm test', sourceFile: 'package.json', type: 'test' },
    { name: 'build', command: 'npm run build', sourceFile: 'package.json', type: 'build' },
  ]);
  model.setPatterns(opts?.patterns ?? []);
  if (opts?.tree) model.setDirectoryTree(opts.tree);
  return model;
}

describe('generateCopilotInstructions', () => {
  let model: InMemoryProjectModel;

  beforeEach(() => {
    model = makeModel();
  });

  it('returns sections array', () => {
    const sections = generateCopilotInstructions(model);
    expect(Array.isArray(sections)).toBe(true);
    expect(sections.length).toBeGreaterThan(0);
  });

  it('includes project-overview section', () => {
    const sections = generateCopilotInstructions(model);
    const ov = sections.find((s) => s.id === 'project-overview');
    expect(ov).toBeDefined();
    expect(ov!.content).toContain('TypeScript');
  });

  it('includes tech-stack section', () => {
    const sections = generateCopilotInstructions(model);
    const ts = sections.find((s) => s.id === 'tech-stack');
    expect(ts).toBeDefined();
    expect(ts!.content).toContain('TypeScript');
    expect(ts!.content).toContain('Vitest');
  });

  it('includes commands section', () => {
    const sections = generateCopilotInstructions(model);
    const cs = sections.find((s) => s.id === 'commands');
    expect(cs).toBeDefined();
    expect(cs!.content).toContain('npm test');
    expect(cs!.content).toContain('npm run build');
  });

  it('includes project-structure when directory tree is present', () => {
    const tree: DirectoryNode = {
      path: '/project',
      type: 'directory',
      children: [
        { path: '/project/src', type: 'directory', role: 'source', children: [] },
      ],
    };
    const m = makeModel({ tree });
    const sections = generateCopilotInstructions(m);
    expect(sections.find((s) => s.id === 'project-structure')).toBeDefined();
  });

  it('includes patterns section for high-confidence patterns', () => {
    const m = makeModel({
      patterns: [
        { category: 'export_style', description: 'Named exports only', confidence: 0.9, evidence: { files: [], matchCount: 5, confidence: 0.9 } },
      ],
    });
    const sections = generateCopilotInstructions(m);
    const pat = sections.find((s) => s.id === 'patterns');
    expect(pat).toBeDefined();
    expect(pat!.content).toContain('Named exports only');
  });

  it('omits patterns section for low-confidence patterns', () => {
    const m = makeModel({
      patterns: [
        { category: 'export_style', description: 'Low confidence', confidence: 0.4, evidence: { files: [], matchCount: 1, confidence: 0.4 } },
      ],
    });
    const sections = generateCopilotInstructions(m);
    expect(sections.find((s) => s.id === 'patterns')).toBeUndefined();
  });

  it('handles empty model gracefully', () => {
    const m = makeModel({ stack: [], commands: [], patterns: [] });
    const sections = generateCopilotInstructions(m);
    expect(sections.length).toBeGreaterThan(0);
  });

  describe('simplified mode', () => {
    it('omits project-structure in simplified mode', () => {
      const tree: DirectoryNode = {
        path: '/project',
        type: 'directory',
        children: [
          { path: '/project/src', type: 'directory', role: 'source', children: [] },
        ],
      };
      const m = makeModel({ tree });
      const sections = generateCopilotInstructions(m, '', { simplified: true });
      expect(sections.find((s) => s.id === 'project-structure')).toBeUndefined();
    });

    it('omits patterns in simplified mode', () => {
      const m = makeModel({
        patterns: [
          { category: 'export_style', description: 'Uses named exports only', confidence: 0.9, evidence: { files: [], matchCount: 10, confidence: 0.9 } },
        ],
      });
      const sections = generateCopilotInstructions(m, '', { simplified: true });
      expect(sections.find((s) => s.id === 'patterns')).toBeUndefined();
    });

    it('still includes tech-stack and commands in simplified mode', () => {
      const m = makeModel({
        stack: [{ category: 'language', name: 'TypeScript', sourceFile: 'package.json' }],
        commands: [{ name: 'test', command: 'npm test', sourceFile: 'package.json', type: 'test' }],
      });
      const sections = generateCopilotInstructions(m, '', { simplified: true });
      expect(sections.find((s) => s.id === 'tech-stack')).toBeDefined();
      expect(sections.find((s) => s.id === 'commands')).toBeDefined();
    });

    it('returns minimal array when model is empty and in simplified mode', () => {
      const m = makeModel({ stack: [], commands: [], patterns: [] });
      const sections = generateCopilotInstructions(m, '', { simplified: true });
      expect(sections).toHaveLength(1);
    });
  });
});
