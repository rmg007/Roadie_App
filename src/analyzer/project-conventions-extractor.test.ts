import { describe, it, expect, vi } from 'vitest';
import { ProjectConventionsExtractor } from './project-conventions-extractor';
import * as fs from 'node:fs/promises';

vi.mock('node:fs/promises');

describe('ProjectConventionsExtractor', () => {
  it('extracts conventions from a standard CLAUDE.md', async () => {
    const mockContent = `
# Project Info
### Tech Stack
- TypeScript
- node.js
- Vitest

### Naming Conventions
- Use camelCase for variables
- Use PascalCase for classes

### Coding Style
- Prefer functional programming
- Use async/await
    `;
    
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockResolvedValue(mockContent);

    const extractor = new ProjectConventionsExtractor();
    const result = await extractor.extract('/fake/root');

    expect(result).toEqual({
      techStack: ['TypeScript', 'node.js', 'Vitest'],
      namingConventions: ['Use camelCase for variables', 'Use PascalCase for classes'],
      codingStyle: ['Prefer functional programming', 'Use async/await'],
      forbidden: undefined,
      constraints: undefined
    });
  });

  it('returns null if no CLAUDE.md is found', async () => {
    vi.mocked(fs.access).mockRejectedValue(new Error('no such file'));

    const extractor = new ProjectConventionsExtractor();
    const result = await extractor.extract('/fake/root');

    expect(result).toBeNull();
  });
});
