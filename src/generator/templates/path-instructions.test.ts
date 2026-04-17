import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generatePathInstructions, generatePathInstructionSections, PATH_INSTRUCTIONS_DIR, setTimestampForTesting, resetTimestamp } from './path-instructions';
import { InMemoryProjectModel } from '../../model/project-model';
import type { DirectoryNode, DetectedPattern, ProjectCommand } from '../../types';

const FIXED_TIMESTAMP = '2026-04-17T12:00:00Z';

beforeEach(() => {
  setTimestampForTesting(() => FIXED_TIMESTAMP);
});

afterEach(() => {
  resetTimestamp();
});

function makeModel(opts: {
  tree: DirectoryNode;
  patterns?: DetectedPattern[];
  commands?: ProjectCommand[];
}): InMemoryProjectModel {
  const model = new InMemoryProjectModel(null);
  model.setDirectoryTree(opts.tree);
  model.setPatterns(opts.patterns ?? []);
  model.setCommands(opts.commands ?? []);
  return model;
}

/** Build a directory node with N source files under it. */
function makeDir(name: string, role: 'source' | 'test', fileCount: number): DirectoryNode {
  const children: DirectoryNode[] = Array.from({ length: fileCount }, (_, i) => ({
    path: `/project/${name}/file${i}.ts`,
    type: 'file' as const,
  }));
  return {
    path: `/project/${name}`,
    type: 'directory' as const,
    role,
    children,
  };
}

describe('generatePathInstructions', () => {
  it('returns empty array for empty directory tree', () => {
    const model = makeModel({ tree: { path: '/project', type: 'directory', children: [] } });
    expect(generatePathInstructions(model)).toEqual([]);
  });

  it('returns empty array when no children with qualifying roles', () => {
    const model = makeModel({
      tree: {
        path: '/project', type: 'directory',
        children: [{ path: '/project/dist', type: 'directory', role: 'output', children: [] }],
      },
    });
    expect(generatePathInstructions(model)).toEqual([]);
  });

  it('excludes directories with fewer than 3 source files', () => {
    const model = makeModel({
      tree: {
        path: '/project', type: 'directory',
        children: [makeDir('src', 'source', 2)],
      },
    });
    expect(generatePathInstructions(model)).toEqual([]);
  });

  it('includes directories with exactly 3 source files', () => {
    const model = makeModel({
      tree: {
        path: '/project', type: 'directory',
        children: [makeDir('src', 'source', 3)],
      },
    });
    const results = generatePathInstructions(model);
    expect(results).toHaveLength(1);
    expect(results[0].filePath).toBe(`${PATH_INSTRUCTIONS_DIR}/src.md`);
  });

  it('caps output at 6 files regardless of directory count', () => {
    const children = ['src', 'lib', 'utils', 'core', 'api', 'services', 'middleware', 'helpers'].map(
      (name) => makeDir(name, 'source', 5),
    );
    const model = makeModel({
      tree: { path: '/project', type: 'directory', children },
    });
    const results = generatePathInstructions(model);
    expect(results.length).toBeLessThanOrEqual(6);
  });

  it('generates correct file path for a qualifying directory', () => {
    const model = makeModel({
      tree: {
        path: '/project', type: 'directory',
        children: [makeDir('src', 'source', 4)],
      },
    });
    const [result] = generatePathInstructions(model);
    expect(result.filePath).toBe('.github/instructions/src.md');
  });

  it('both source and test roles qualify', () => {
    const model = makeModel({
      tree: {
        path: '/project', type: 'directory',
        children: [makeDir('src', 'source', 4), makeDir('test', 'test', 4)],
      },
    });
    const results = generatePathInstructions(model);
    expect(results).toHaveLength(2);
    const paths = results.map((r) => r.filePath);
    expect(paths.some((p) => p.includes('src'))).toBe(true);
    expect(paths.some((p) => p.includes('test'))).toBe(true);
  });

  it('injects relevant patterns into sections', () => {
    const model = makeModel({
      tree: {
        path: '/project', type: 'directory',
        children: [makeDir('src', 'source', 4)],
      },
      patterns: [
        { category: 'exports', description: 'Named exports only', confidence: 0.9, evidence: { files: [], matchCount: 5, confidence: 0.9 } },
      ],
    });
    const [result] = generatePathInstructions(model);
    const content = result.sections.map((s) => s.content).join('\n');
    expect(content).toContain('Named exports only');
  });

  it('test directory section mentions test guidance', () => {
    const model = makeModel({
      tree: {
        path: '/project', type: 'directory',
        children: [makeDir('test', 'test', 4)],
      },
      commands: [{ name: 'test', command: 'vitest run', sourceFile: 'package.json', type: 'test' }],
    });
    const [result] = generatePathInstructions(model);
    const content = result.sections.map((s) => s.content).join('\n');
    expect(content).toContain('test');
  });

  it('includes test command in test directory instructions', () => {
    const model = makeModel({
      tree: {
        path: '/project', type: 'directory',
        children: [makeDir('test', 'test', 4)],
      },
      commands: [{ name: 'test', command: 'vitest run', sourceFile: 'package.json', type: 'test' }],
    });
    const [result] = generatePathInstructions(model);
    const content = result.sections.map((s) => s.content).join('\n');
    expect(content).toContain('vitest run');
  });

  it('each result has non-empty sections', () => {
    const model = makeModel({
      tree: {
        path: '/project', type: 'directory',
        children: [makeDir('src', 'source', 4), makeDir('test', 'test', 4)],
      },
    });
    const results = generatePathInstructions(model);
    for (const result of results) {
      expect(result.sections.length).toBeGreaterThan(0);
      expect(result.sections[0].content.length).toBeGreaterThan(0);
    }
  });
});

describe('generatePathInstructionSections', () => {
  it('section id does not contain trailing slash artifact', () => {
    const model = makeModel({
      tree: {
        path: '/project', type: 'directory',
        children: [makeDir('src', 'source', 4)],
      },
    });
    const sections = generatePathInstructionSections(model);
    expect(sections.length).toBeGreaterThan(0);
    for (const s of sections) {
      expect(s.id).not.toMatch(/\/$/);
      expect(s.id).not.toContain('/x');
      expect(s.id).toMatch(/^path-instructions:[^/]+$/);
    }
  });

  it('section id uses basename of the file without extension', () => {
    const model = makeModel({
      tree: {
        path: '/project', type: 'directory',
        children: [makeDir('src', 'source', 4)],
      },
    });
    const sections = generatePathInstructionSections(model);
    expect(sections[0].id).toBe('path-instructions:src');
  });
});

describe('generatePathInstructions simplified mode', () => {
  it('omits pattern lines when simplified: true', () => {
    const model = makeModel({
      tree: {
        path: '/project', type: 'directory',
        children: [makeDir('src', 'source', 4)],
      },
      patterns: [
        { category: 'exports', description: 'Named exports only', confidence: 0.9, evidence: { files: [], matchCount: 5, confidence: 0.9 } },
      ],
    });
    const results = generatePathInstructions(model, { simplified: true });
    const content = results.map((r) => r.sections.map((s) => s.content).join('\n')).join('\n');
    expect(content).not.toContain('Project conventions');
    expect(content).not.toContain('Named exports only');
  });

  it('still returns qualifying directories in simplified mode', () => {
    const model = makeModel({
      tree: {
        path: '/project', type: 'directory',
        children: [makeDir('src', 'source', 4)],
      },
    });
    const results = generatePathInstructions(model, { simplified: true });
    expect(results).toHaveLength(1);
  });
});
