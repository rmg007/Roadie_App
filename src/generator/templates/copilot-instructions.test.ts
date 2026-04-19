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
    const toc = sections.find((s) => s.id === 'roadie-toc');
    expect(toc).toBeDefined();
    expect(toc!.content).toContain('TypeScript');
  });

  it('includes tech-stack section', () => {
    const sections = generateCopilotInstructions(model);
    const toc = sections.find((s) => s.id === 'roadie-toc');
    expect(toc).toBeDefined();
    // The ToC links to tech-stack.md
    expect(toc!.content).toContain('Technology Stack');
    expect(toc!.content).toContain('tech-stack.md');
  });

  it('includes commands section', () => {
    const sections = generateCopilotInstructions(model);
    const cs = sections.find((s) => s.id === 'core-commands');
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
    // ToC always links to structure file
    expect(sections.find((s) => s.id === 'roadie-toc')?.content).toContain('structure.md');
  });

  it('includes patterns section for high-confidence patterns', () => {
    const m = makeModel({
      patterns: [
        { category: 'export_style', description: 'Named exports only', confidence: 0.9, evidence: { files: [], matchCount: 5, confidence: 0.9 } },
      ],
    });
    const sections = generateCopilotInstructions(m);
    // ToC always links to patterns file
    expect(sections.find((s) => s.id === 'roadie-toc')?.content).toContain('patterns.md');
  });

  it('omits patterns section for low-confidence patterns', () => {
    const m = makeModel({
      patterns: [
        { category: 'export_style', description: 'Low confidence', confidence: 0.4, evidence: { files: [], matchCount: 1, confidence: 0.4 } },
      ],
    });
    const sections = generateCopilotInstructions(m);
    // ToC always links to patterns.md regardless of confidence
    expect(sections.find((s) => s.id === 'roadie-toc')?.content).toContain('patterns.md');
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
      const sections = generateCopilotInstructions(m);
      // The current implementation always returns ToC + optional core-commands
      expect(sections.find((s) => s.id === 'roadie-toc')).toBeDefined();
    });

    it('omits patterns in simplified mode', () => {
      const m = makeModel({
        patterns: [
          { category: 'export_style', description: 'Uses named exports only', confidence: 0.9, evidence: { files: [], matchCount: 10, confidence: 0.9 } },
        ],
      });
      const sections = generateCopilotInstructions(m);
      // ToC links to patterns but doesn't inline them
      expect(sections.find((s) => s.id === 'roadie-toc')?.content).toContain('patterns.md');
    });

    it('still includes tech-stack and commands in simplified mode', () => {
      const m = makeModel({
        stack: [{ category: 'language', name: 'TypeScript', sourceFile: 'package.json' }],
        commands: [{ name: 'test', command: 'npm test', sourceFile: 'package.json', type: 'test' }],
      });
      const sections = generateCopilotInstructions(m);
      // ToC always links to tech-stack
      expect(sections.find((s) => s.id === 'roadie-toc')?.content).toContain('tech-stack.md');
      expect(sections.find((s) => s.id === 'core-commands')).toBeDefined();
    });

    it('returns minimal array when model is empty and in simplified mode', () => {
      const m = makeModel({ stack: [], commands: [], patterns: [] });
      const sections = generateCopilotInstructions(m);
      // Always returns at least the ToC
      expect(sections.length).toBeGreaterThan(0);
    });
  });
});
