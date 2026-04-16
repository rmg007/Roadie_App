import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
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

  // ---- Error paths ----

  it('recovers from a corrupted database file by recreating it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roadie-db-test-'));
    const dbPath = path.join(dir, 'test.db');

    // Write garbage bytes to simulate corruption
    fs.writeFileSync(dbPath, Buffer.from('not a sqlite database -- corrupted!'));

    // Should NOT throw — should delete and recreate
    let recovered: RoadieDatabase | null = null;
    expect(() => { recovered = new RoadieDatabase(dbPath); }).not.toThrow();

    // Should be fully functional after recovery
    recovered!.saveTechStack([{ category: 'language', name: 'TS', sourceFile: 'package.json' }]);
    expect(recovered!.loadTechStack()).toHaveLength(1);
    recovered!.close();

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('WAL checkpoint runs without error on close', () => {
    // Verifies close() doesn't throw even with WAL checkpoint
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roadie-db-close-'));
    const dbPath = path.join(dir, 'test.db');
    const fileDb = new RoadieDatabase(dbPath);
    fileDb.saveTechStack([{ category: 'runtime', name: 'Node.js', sourceFile: 'package.json' }]);
    expect(() => fileDb.close()).not.toThrow();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
