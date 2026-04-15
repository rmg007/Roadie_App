import { describe, it, expect } from 'vitest';
import { PromptBuilder } from './prompt-builder';
import type { AgentConfig } from '../types';

const builder = new PromptBuilder();

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    role: 'fixer',
    modelTier: 'free',
    tools: 'implementation',
    promptTemplate: 'Fix the bug in {file}',
    context: { file: 'src/auth.ts', techStack: 'TypeScript, React' },
    timeoutMs: 5000,
    ...overrides,
  };
}

describe('PromptBuilder', () => {
  it('includes role prompt as first layer', () => {
    const prompt = builder.build(makeConfig());
    expect(prompt).toContain('code fixer');
  });

  it('includes context as second layer', () => {
    const prompt = builder.build(makeConfig());
    expect(prompt).toContain('Project Context:');
    expect(prompt).toContain('techStack: TypeScript, React');
  });

  it('substitutes {variable} placeholders in task prompt', () => {
    const prompt = builder.build(makeConfig());
    expect(prompt).toContain('Fix the bug in src/auth.ts');
    expect(prompt).not.toContain('{file}');
  });

  it('preserves unmatched placeholders', () => {
    const prompt = builder.build(makeConfig({ promptTemplate: 'Fix {unknown}' }));
    expect(prompt).toContain('{unknown}');
  });

  it('handles empty context', () => {
    const prompt = builder.build(makeConfig({ context: {} }));
    expect(prompt).not.toContain('Project Context:');
  });

  it('serializes non-string context values as JSON', () => {
    const prompt = builder.build(makeConfig({ context: { items: ['a', 'b'] } }));
    // serializeContext uses JSON.stringify(value, null, 2) for readability
    expect(prompt).toContain('"a"');
    expect(prompt).toContain('"b"');
    expect(prompt).toContain('items:');
  });

  it('uses correct role prompt for each agent role', () => {
    const diagnostician = builder.build(makeConfig({ role: 'diagnostician' }));
    expect(diagnostician).toContain('diagnostic expert');

    const reviewer = builder.build(makeConfig({ role: 'security_reviewer' }));
    expect(reviewer).toContain('security expert');
  });

  it('builds chat messages with a system role and user prompt', () => {
    const messages = builder.buildMessages(makeConfig());
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('code fixer');
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toContain('Fix the bug in src/auth.ts');
  });
});
