import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RoadieDatabase } from './database';
import type { TechStackEntry, DetectedPattern, ProjectCommand, DirectoryNode } from '../types';

describe('RoadieDatabase', () => {
  let db: RoadieDatabase;

  beforeEach(() => {
    db = new RoadieDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('creates schema on first open', () => {
    // If we can save and load, schema exists
    db.saveTechStack([]);
    expect(db.loadTechStack()).toEqual([]);
  });

  // ---- Tech Stack ----

  it('saves and loads tech stack entries', () => {
    const entries: TechStackEntry[] = [
      { category: 'language', name: 'TypeScript', version: '5.2.0', sourceFile: 'package.json' },
      { category: 'framework', name: 'Next.js', version: '14.0.0', sourceFile: 'package.json' },
    ];
    db.saveTechStack(entries);
    const loaded = db.loadTechStack();
    expect(loaded).toHaveLength(2);
    expect(loaded[0].name).toBe('TypeScript');
    expect(loaded[1].name).toBe('Next.js');
  });

  it('replaces tech stack on re-save', () => {
    db.saveTechStack([{ category: 'language', name: 'JS', sourceFile: 'pkg.json' }]);
    db.saveTechStack([{ category: 'language', name: 'TS', sourceFile: 'pkg.json' }]);
    const loaded = db.loadTechStack();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe('TS');
  });

  // ---- Directories ----

  it('saves and loads directory tree', () => {
    const root: DirectoryNode = {
      path: '/project',
      type: 'directory',
      role: 'source',
      children: [
        { path: '/project/src', type: 'directory', role: 'source' },
        { path: '/project/test', type: 'directory', role: 'test' },
      ],
    };
    db.saveDirectories(root);
    const loaded = db.loadDirectoryRoot();
    expect(loaded).not.toBeNull();
    expect(loaded!.path).toBe('/project');
    expect(loaded!.children).toHaveLength(2);
  });

  it('returns null for empty directory table', () => {
    expect(db.loadDirectoryRoot()).toBeNull();
  });

  // ---- Patterns ----

  it('saves and loads detected patterns', () => {
    const patterns: DetectedPattern[] = [
      {
        category: 'export_style',
        description: 'Uses named exports',
        evidence: { files: ['src/index.ts'], matchCount: 5, confidence: 0.9 },
        confidence: 0.9,
      },
    ];
    db.savePatterns(patterns);
    const loaded = db.loadPatterns();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].evidence.matchCount).toBe(5);
  });

  // ---- Commands ----

  it('saves and loads project commands', () => {
    const commands: ProjectCommand[] = [
      { name: 'test', command: 'vitest run', sourceFile: 'package.json', type: 'test' },
      { name: 'build', command: 'tsup', sourceFile: 'package.json', type: 'build' },
    ];
    db.saveCommands(commands);
    const loaded = db.loadCommands();
    expect(loaded).toHaveLength(2);
    expect(loaded[0].command).toBe('vitest run');
  });
});
