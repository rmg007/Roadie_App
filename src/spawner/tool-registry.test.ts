import { describe, it, expect } from 'vitest';
import { ToolRegistry } from './tool-registry';

const registry = new ToolRegistry();

describe('ToolRegistry', () => {
  it('research scope returns only read-only tools', () => {
    const tools = registry.getTools('research');
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.every((t) => t.readOnly)).toBe(true);
  });

  it('implementation scope returns all tools including write', () => {
    const tools = registry.getTools('implementation');
    const readOnly = tools.filter((t) => t.readOnly);
    const writeable = tools.filter((t) => !t.readOnly);
    expect(readOnly.length).toBeGreaterThan(0);
    expect(writeable.length).toBeGreaterThan(0);
  });

  it('review scope returns only read-only tools', () => {
    const tools = registry.getTools('review');
    expect(tools.every((t) => t.readOnly)).toBe(true);
  });

  it('documentation scope includes writeFile and editFile', () => {
    const names = registry.getToolNames('documentation');
    expect(names).toContain('writeFile');
    expect(names).toContain('editFile');
    expect(names).not.toContain('runCommand');
  });

  it('getToolNames returns string array', () => {
    const names = registry.getToolNames('research');
    expect(names.every((n) => typeof n === 'string')).toBe(true);
    expect(names).toContain('readFile');
  });
});
