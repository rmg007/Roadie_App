import { describe, it, expect } from 'vitest';
import { generateCursorRulesDir, buildCursorRulesDirPreamble, CURSOR_RULES_DIR } from './cursor-rules-dir';
import { InMemoryProjectModel } from '../../model/project-model';
import type { DirectoryNode, DetectedPattern, ProjectCommand } from '../../types';

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

describe('generateCursorRulesDir', () => {
  it('returns empty array when tree has no children', () => {
    const model = makeModel({ tree: { path: '/project', type: 'directory', children: [] } });
    expect(generateCursorRulesDir(model)).toEqual([]);
  });

  it('excludes directories with fewer than 3 source files', () => {
    const model = makeModel({
      tree: {
        path: '/project', type: 'directory',
        children: [makeDir('src', 'source', 2)],
      },
    });
    expect(generateCursorRulesDir(model)).toHaveLength(0);
  });

  it('includes directories with exactly 3 source files', () => {
    const model = makeModel({
      tree: {
        path: '/project', type: 'directory',
        children: [makeDir('src', 'source', 3)],
      },
    });
    expect(generateCursorRulesDir(model)).toHaveLength(1);
  });

  it('generates correct file path with .mdc extension', () => {
    const model = makeModel({
      tree: {
        path: '/project', type: 'directory',
        children: [makeDir('src', 'source', 4)],
      },
    });
    const [result] = generateCursorRulesDir(model);
    expect(result.filePath).toBe(`${CURSOR_RULES_DIR}/src.mdc`);
  });

  it('excludes non-source non-test directories', () => {
    const model = makeModel({
      tree: {
        path: '/project', type: 'directory',
        children: [
          { path: '/project/dist', type: 'directory', role: 'output', children: Array.from({ length: 5 }, (_, i) => ({ path: `/project/dist/f${i}.js`, type: 'file' as const })) },
        ],
      },
    });
    expect(generateCursorRulesDir(model)).toHaveLength(0);
  });

  it('caps output at 6 files regardless of directory count', () => {
    const children = ['src', 'lib', 'utils', 'core', 'api', 'services', 'middleware', 'helpers'].map(
      (name) => makeDir(name, 'source', 5),
    );
    const model = makeModel({ tree: { path: '/project', type: 'directory', children } });
    expect(generateCursorRulesDir(model).length).toBeLessThanOrEqual(6);
  });

  it('injects preamble with correct globs for directory name', () => {
    const model = makeModel({
      tree: {
        path: '/project', type: 'directory',
        children: [makeDir('utils', 'source', 4)],
      },
    });
    const [result] = generateCursorRulesDir(model);
    expect(result.preamble).toContain('alwaysApply: false');
    expect(result.preamble).toContain('globs: "utils/**"');
  });

  it('includes high-confidence patterns in content', () => {
    const model = makeModel({
      tree: {
        path: '/project', type: 'directory',
        children: [makeDir('src', 'source', 4)],
      },
      patterns: [
        { category: 'export_style', description: 'Named exports only', confidence: 0.9, evidence: { files: [], matchCount: 5, confidence: 0.9 } },
        { category: 'style', description: 'Low confidence', confidence: 0.3, evidence: { files: [], matchCount: 1, confidence: 0.3 } },
      ],
    });
    const [result] = generateCursorRulesDir(model);
    const content = result.sections[0].content;
    expect(content).toContain('Named exports only');
    expect(content).not.toContain('Low confidence');
  });

  it('includes test command for test directories', () => {
    const model = makeModel({
      tree: {
        path: '/project', type: 'directory',
        children: [makeDir('test', 'test', 4)],
      },
      commands: [{ name: 'test', command: 'vitest run', sourceFile: 'package.json', type: 'test' }],
    });
    const [result] = generateCursorRulesDir(model);
    const content = result.sections[0].content;
    expect(content).toContain('vitest run');
  });

  it('section id uses cursor-rules-dir: prefix with dir name', () => {
    const model = makeModel({
      tree: {
        path: '/project', type: 'directory',
        children: [makeDir('src', 'source', 4)],
      },
    });
    const [result] = generateCursorRulesDir(model);
    expect(result.sections[0].id).toBe('cursor-rules-dir:src');
  });

  it('handles both source and test directories', () => {
    const model = makeModel({
      tree: {
        path: '/project', type: 'directory',
        children: [makeDir('src', 'source', 4), makeDir('test', 'test', 4)],
      },
    });
    const results = generateCursorRulesDir(model);
    expect(results).toHaveLength(2);
    const paths = results.map((r) => r.filePath);
    expect(paths.some((p) => p.includes('src'))).toBe(true);
    expect(paths.some((p) => p.includes('test'))).toBe(true);
  });

  it('each result has non-empty sections', () => {
    const model = makeModel({
      tree: {
        path: '/project', type: 'directory',
        children: [makeDir('src', 'source', 4)],
      },
    });
    const [result] = generateCursorRulesDir(model);
    expect(result.sections.length).toBeGreaterThan(0);
    expect(result.sections[0].content.length).toBeGreaterThan(0);
  });
});

describe('buildCursorRulesDirPreamble', () => {
  it('includes MDC frontmatter delimiters', () => {
    const preamble = buildCursorRulesDirPreamble('src');
    expect(preamble).toContain('---');
  });

  it('sets alwaysApply: false', () => {
    const preamble = buildCursorRulesDirPreamble('src');
    expect(preamble).toContain('alwaysApply: false');
  });

  it('sets globs to match the directory', () => {
    const preamble = buildCursorRulesDirPreamble('components');
    expect(preamble).toContain('globs: "components/**"');
  });

  it('ends with newline for clean concatenation', () => {
    const preamble = buildCursorRulesDirPreamble('src');
    expect(preamble.endsWith('\n')).toBe(true);
  });
});
