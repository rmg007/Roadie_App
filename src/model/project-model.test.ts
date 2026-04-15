import { describe, it, expect } from 'vitest';
import { InMemoryProjectModel } from './project-model';
import type { TechStackEntry, ProjectCommand } from '../types';

describe('InMemoryProjectModel', () => {
  it('starts empty without a database', () => {
    const model = new InMemoryProjectModel(null);
    expect(model.getTechStack()).toEqual([]);
    expect(model.getCommands()).toEqual([]);
    expect(model.getPatterns()).toEqual([]);
  });

  it('returns tech stack after setTechStack', () => {
    const model = new InMemoryProjectModel(null);
    const entries: TechStackEntry[] = [
      { category: 'language', name: 'TypeScript', version: '5.2', sourceFile: 'package.json' },
    ];
    model.setTechStack(entries);
    expect(model.getTechStack()).toHaveLength(1);
    expect(model.getTechStack()[0].name).toBe('TypeScript');
  });

  it('update() applies delta', () => {
    const model = new InMemoryProjectModel(null);
    model.update({
      techStack: [{ category: 'framework', name: 'React', sourceFile: 'package.json' }],
      commands: [{ name: 'test', command: 'vitest', sourceFile: 'package.json', type: 'test' }],
    });
    expect(model.getTechStack()[0].name).toBe('React');
    expect(model.getCommands()[0].command).toBe('vitest');
  });

  it('toContext() produces readable serialized output', () => {
    const model = new InMemoryProjectModel(null);
    model.setTechStack([
      { category: 'language', name: 'TypeScript', version: '5.2', sourceFile: 'package.json' },
      { category: 'framework', name: 'Next.js', version: '14.0', sourceFile: 'package.json' },
    ]);
    model.setCommands([
      { name: 'test', command: 'vitest run', sourceFile: 'package.json', type: 'test' },
    ]);

    const ctx = model.toContext();
    expect(ctx.serialized).toContain('TypeScript');
    expect(ctx.serialized).toContain('Next.js');
    expect(ctx.serialized).toContain('vitest run');
    expect(ctx.techStack).toHaveLength(2);
  });

  it('toContext() respects scope parameter', () => {
    const model = new InMemoryProjectModel(null);
    model.setTechStack([{ category: 'language', name: 'TS', sourceFile: 'p.json' }]);
    model.setCommands([{ name: 'test', command: 'vitest', sourceFile: 'p.json', type: 'test' }]);

    const stackOnly = model.toContext({ scope: 'stack' });
    expect(stackOnly.serialized).toContain('TS');
    expect(stackOnly.serialized).not.toContain('vitest');
  });

  it('toContext() truncates with maxTokens', () => {
    const model = new InMemoryProjectModel(null);
    model.setTechStack([
      { category: 'language', name: 'TypeScript', version: '5.2', sourceFile: 'package.json' },
    ]);
    const ctx = model.toContext({ maxTokens: 5 }); // very small budget
    // priorityTrim drops sections cleanly rather than mid-content slicing
    const charBudget = 5 * 4; // maxTokens * 4 chars/token
    expect(ctx.serialized.length).toBeLessThanOrEqual(charBudget);
  });

  it('toContext() with maxTokens=0 returns empty serialized', () => {
    const model = new InMemoryProjectModel(null);
    model.setTechStack([
      { category: 'language', name: 'TypeScript', version: '5.2', sourceFile: 'package.json' },
    ]);
    const ctx = model.toContext({ maxTokens: 0 });
    expect(ctx.serialized).toBe('');
  });

  it('toContext() with single large section and small budget truncates correctly', () => {
    const model = new InMemoryProjectModel(null);
    model.setCommands([
      { name: 'test', command: 'vitest run --reporter verbose --all-tests', sourceFile: 'package.json', type: 'test' },
    ]);
    // Budget of 10 tokens = 40 chars — section header alone is ~12 chars
    const ctx = model.toContext({ maxTokens: 10 });
    expect(ctx.serialized.length).toBeLessThanOrEqual(40);
  });

  it('dispose() cancels debounce timer without error', () => {
    const model = new InMemoryProjectModel(null);
    model.update({ techStack: [] }); // triggers debounce
    model.dispose(); // should not throw
  });
});
