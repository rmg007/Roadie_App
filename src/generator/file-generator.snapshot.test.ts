/**
 * Phase 1 — Generated artifact safety
 *
 * Snapshot every file produced by FileGenerator. When a template changes, the
 * snapshot diff makes the change visible and reviewable in PR. A broken template
 * that produces `undefined` or empty content fails immediately.
 *
 * To update snapshots after an intentional template change:
 *   npx vitest -u src/generator/file-generator.snapshot.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateCopilotInstructions } from './templates/copilot-instructions';
import { generateClaudeMd } from './templates/claude-md';
import { generateCursorRules } from './templates/cursor-rules';
import { generateAgentDefinitions } from './templates/agent-definitions';
import { generatePathInstructions, setTimestampForTesting as setPathInstructionsTimestamp, resetTimestamp as resetPathInstructionsTimestamp } from './templates/path-instructions';
import { generateCursorRulesDir, setTimestampForTesting as setCursorRulesDirTimestamp, resetTimestamp as resetCursorRulesDirTimestamp } from './templates/cursor-rules-dir';
import { buildSectionedFile } from './section-manager';
import type { ProjectModel, TechStackEntry, DirectoryNode, ProjectCommand } from '../types';

const FIXED_TIMESTAMP = '2026-04-17T12:00:00Z';

beforeEach(() => {
  setPathInstructionsTimestamp(() => FIXED_TIMESTAMP);
  setCursorRulesDirTimestamp(() => FIXED_TIMESTAMP);
});

afterEach(() => {
  resetPathInstructionsTimestamp();
  resetCursorRulesDirTimestamp();
});

// ---------------------------------------------------------------------------
// Stable fixture model — keep this deterministic across runs
// ---------------------------------------------------------------------------

const TECH_STACK: TechStackEntry[] = [
  { category: 'language', name: 'TypeScript', version: '5.2.0', sourceFile: 'package.json' },
  { category: 'runtime', name: 'Node.js', sourceFile: 'package.json' },
  { category: 'test_tool', name: 'Vitest', version: '0.34.0', sourceFile: 'package.json' },
  { category: 'build_tool', name: 'tsup', version: '8.0.0', sourceFile: 'package.json' },
  { category: 'package_manager', name: 'npm', sourceFile: 'package.json' },
];

const srcFiles = (dir: string, count: number) =>
  Array.from({ length: count }, (_, i) => ({
    path: `${dir}/file${i}.ts`,
    type: 'file' as const,
    children: [],
  }));

const DIR_STRUCTURE: DirectoryNode = {
  path: '/workspace',
  type: 'directory',
  children: [
    { path: '/workspace/src', type: 'directory', role: 'source', children: srcFiles('/workspace/src', 4) },
    { path: '/workspace/test', type: 'directory', role: 'test', children: srcFiles('/workspace/test', 3) },
    { path: '/workspace/scripts', type: 'directory', role: 'scripts', children: [] },
  ],
};

const COMMANDS: ProjectCommand[] = [
  { name: 'build', command: 'npm run build', sourceFile: 'package.json', type: 'build' },
  { name: 'test', command: 'npm test', sourceFile: 'package.json', type: 'test' },
  { name: 'lint', command: 'npm run lint', sourceFile: 'package.json', type: 'lint' },
];

const FIXTURE_MODEL: ProjectModel = {
  getTechStack: () => TECH_STACK,
  getDirectoryStructure: () => DIR_STRUCTURE,
  getPatterns: () => [],
  getCommands: () => COMMANDS,
  getPreferences: () => ({ telemetryEnabled: false, autoCommit: false }),
  toContext: () => ({
    techStack: TECH_STACK,
    directoryStructure: DIR_STRUCTURE,
    patterns: [],
    commands: COMMANDS,
    serialized: '',
  }),
  update: () => {},
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertNoEmptyPlaceholders(content: string, label: string): void {
  expect(content, `${label}: should not contain "undefined"`).not.toContain('undefined');
  expect(content.trim().length, `${label}: should not be empty`).toBeGreaterThan(0);
  // Sections must be non-empty (markers without content are a template bug)
  const startMarkerCount = (content.match(/<!-- roadie:start:/g) ?? []).length;
  const endMarkerCount = (content.match(/<!-- roadie:end:/g) ?? []).length;
  expect(startMarkerCount, `${label}: mismatched section markers`).toBe(endMarkerCount);
}

// ---------------------------------------------------------------------------
// copilot-instructions.md
// ---------------------------------------------------------------------------

describe('Snapshot: .github/copilot-instructions.md', () => {
  it('renders to a stable snapshot', () => {
    const sections = generateCopilotInstructions(FIXTURE_MODEL);
    const output = buildSectionedFile(sections);
    assertNoEmptyPlaceholders(output, 'copilot-instructions');
    expect(output).toMatchSnapshot();
  });

  it('contains expected tech-stack entries', () => {
    const sections = generateCopilotInstructions(FIXTURE_MODEL);
    const output = buildSectionedFile(sections);
    expect(output).toContain('TypeScript');
    expect(output).toContain('Vitest');
  });

  it('contains expected commands', () => {
    const sections = generateCopilotInstructions(FIXTURE_MODEL);
    const output = buildSectionedFile(sections);
    expect(output).toContain('npm test');
  });
});

// ---------------------------------------------------------------------------
// CLAUDE.md
// ---------------------------------------------------------------------------

describe('Snapshot: CLAUDE.md', () => {
  it('renders to a stable snapshot', () => {
    const sections = generateClaudeMd(FIXTURE_MODEL);
    const output = buildSectionedFile(sections);
    assertNoEmptyPlaceholders(output, 'CLAUDE.md');
    expect(output).toMatchSnapshot();
  });

  it('stays within the 120-line cap', () => {
    const sections = generateClaudeMd(FIXTURE_MODEL);
    const output = buildSectionedFile(sections);
    const lines = output.split('\n').length;
    expect(lines).toBeLessThanOrEqual(120);
  });
});

// ---------------------------------------------------------------------------
// .cursor/rules/project.mdc
// ---------------------------------------------------------------------------

describe('Snapshot: .cursor/rules/project.mdc', () => {
  it('renders to a stable snapshot', () => {
    const sections = generateCursorRules(FIXTURE_MODEL);
    const output = buildSectionedFile(sections);
    assertNoEmptyPlaceholders(output, 'cursor-rules');
    expect(output).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// AGENTS.md
// ---------------------------------------------------------------------------

describe('Snapshot: AGENTS.md', () => {
  it('renders to a stable snapshot (no learningDb)', () => {
    const sections = generateAgentDefinitions(FIXTURE_MODEL);
    const output = buildSectionedFile(sections);
    assertNoEmptyPlaceholders(output, 'AGENTS.md');
    expect(output).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// .github/instructions/*.instructions.md
// ---------------------------------------------------------------------------

describe('Snapshot: path-instructions', () => {
  it('produces at least one instruction file', () => {
    const files = generatePathInstructions(FIXTURE_MODEL);
    expect(files.length).toBeGreaterThan(0);
  });

  it('every instruction file has valid content', () => {
    const files = generatePathInstructions(FIXTURE_MODEL);
    for (const file of files) {
      const output = buildSectionedFile(file.sections);
      assertNoEmptyPlaceholders(output, file.filePath);
      expect(file.filePath).toMatch(/\.md$/);
    }
  });

  it('first instruction file renders to a stable snapshot', () => {
    const files = generatePathInstructions(FIXTURE_MODEL);
    const first = files[0];
    const output = buildSectionedFile(first.sections);
    expect(output).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// .cursor/rules/{dir}.mdc
// ---------------------------------------------------------------------------

describe('Snapshot: .cursor/rules/{dir}.mdc', () => {
  it('produces at least one per-directory rules file', () => {
    const files = generateCursorRulesDir(FIXTURE_MODEL);
    expect(files.length).toBeGreaterThan(0);
  });

  it('every per-directory rules file has valid content', () => {
    const files = generateCursorRulesDir(FIXTURE_MODEL);
    for (const file of files) {
      const output = buildSectionedFile(file.sections);
      assertNoEmptyPlaceholders(output, file.filePath);
      expect(file.filePath).toMatch(/\.mdc$/);
    }
  });

  it('first per-directory rules file renders to a stable snapshot', () => {
    const files = generateCursorRulesDir(FIXTURE_MODEL);
    const first = files[0];
    const output = buildSectionedFile(first.sections);
    expect(output).toMatchSnapshot();
  });
});
