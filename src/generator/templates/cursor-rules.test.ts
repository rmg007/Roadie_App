import { describe, it, expect, beforeEach } from 'vitest';
import { generateCursorRules, buildCursorRulesPreamble } from './cursor-rules';
import { InMemoryProjectModel } from '../../model/project-model';
import type { TechStackEntry, ProjectCommand, DetectedPattern } from '../../types';

function makeModel(opts?: {
  stack?: TechStackEntry[];
  commands?: ProjectCommand[];
  patterns?: DetectedPattern[];
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
  return model;
}

describe('generateCursorRules', () => {
  let model: InMemoryProjectModel;

  beforeEach(() => {
    model = makeModel();
  });

  it('returns sections array', () => {
    const sections = generateCursorRules(model);
    expect(Array.isArray(sections)).toBe(true);
    expect(sections.length).toBeGreaterThan(0);
  });

  it('includes tech-stack section with detected technologies', () => {
    const sections = generateCursorRules(model);
    const ts = sections.find((s) => s.id === 'tech-stack');
    expect(ts).toBeDefined();
    expect(ts!.content).toContain('TypeScript');
    expect(ts!.content).toContain('Vitest');
  });

  it('includes commands section', () => {
    const sections = generateCursorRules(model);
    const cs = sections.find((s) => s.id === 'commands');
    expect(cs).toBeDefined();
    expect(cs!.content).toContain('npm test');
    expect(cs!.content).toContain('npm run build');
  });

  it('includes coding-standards for patterns with confidence >= 0.7', () => {
    const m = makeModel({
      patterns: [
        { category: 'export_style', description: 'Named exports only', confidence: 0.8, evidence: { files: [], matchCount: 5, confidence: 0.8 } },
        { category: 'style', description: 'Low confidence pattern', confidence: 0.4, evidence: { files: [], matchCount: 1, confidence: 0.4 } },
      ],
    });
    const sections = generateCursorRules(m);
    const cs = sections.find((s) => s.id === 'coding-standards');
    expect(cs).toBeDefined();
    expect(cs!.content).toContain('Named exports only');
    expect(cs!.content).not.toContain('Low confidence pattern');
  });

  it('omits coding-standards when no high-confidence patterns', () => {
    const m = makeModel({ patterns: [] });
    const sections = generateCursorRules(m);
    expect(sections.find((s) => s.id === 'coding-standards')).toBeUndefined();
  });

  it('enforces 80-line budget', () => {
    const bigStack: TechStackEntry[] = Array.from({ length: 50 }, (_, i) => ({
      category: 'framework',
      name: `Framework${i}`,
      sourceFile: 'package.json',
    }));
    const m = makeModel({ stack: bigStack });
    const sections = generateCursorRules(m);
    const preamble = buildCursorRulesPreamble();
    const preambleLines = preamble.split('\n').length;
    const sectionLines = sections.reduce((acc, s) => acc + s.content.split('\n').length + 1, 0);
    expect(preambleLines + sectionLines).toBeLessThanOrEqual(80);
  });

  it('handles empty model gracefully (no tech stack)', () => {
    const m = makeModel({ stack: [], commands: [] });
    const sections = generateCursorRules(m);
    // Should return an empty or minimal sections array without throwing
    expect(Array.isArray(sections)).toBe(true);
  });

  it('section ids are unique', () => {
    const sections = generateCursorRules(model);
    const ids = sections.map((s) => s.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  describe('simplified mode', () => {
    it('omits coding-standards even when patterns present', () => {
      const m = makeModel({
        patterns: [
          { category: 'export_style', description: 'Named exports only', confidence: 0.9, evidence: { files: [], matchCount: 5, confidence: 0.9 } },
        ],
      });
      const sections = generateCursorRules(m, '', { simplified: true });
      expect(sections.find((s) => s.id === 'coding-standards')).toBeUndefined();
    });

    it('still includes tech-stack and commands in simplified mode', () => {
      const sections = generateCursorRules(model, '', { simplified: true });
      expect(sections.find((s) => s.id === 'tech-stack')).toBeDefined();
      expect(sections.find((s) => s.id === 'commands')).toBeDefined();
    });
  });
});

describe('buildCursorRulesPreamble', () => {
  it('returns MDC frontmatter with alwaysApply: true', () => {
    const preamble = buildCursorRulesPreamble();
    expect(preamble).toContain('---');
    expect(preamble).toContain('alwaysApply: true');
  });

  it('ends with newline for clean concatenation', () => {
    const preamble = buildCursorRulesPreamble();
    expect(preamble.endsWith('\n')).toBe(true);
  });
});
