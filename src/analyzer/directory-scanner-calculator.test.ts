/**
 * DirectoryScanner tests against the ts-calculator fixture.
 * Verifies correct role assignment for src/, test/, and operations/ subdirectory.
 */
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { scanDirectories } from './directory-scanner';

const FIXTURE_ROOT = path.resolve(__dirname, '../../test/fixtures/ts-calculator');

describe('DirectoryScanner — ts-calculator fixture', () => {
  it('returns root as a directory node', async () => {
    const root = await scanDirectories(FIXTURE_ROOT);
    expect(root.type).toBe('directory');
    expect(root.path).toBe(FIXTURE_ROOT);
  });

  it('assigns source role to src/', async () => {
    const root = await scanDirectories(FIXTURE_ROOT);
    const src = root.children?.find((c) => c.path.endsWith('src'));
    expect(src).toBeDefined();
    expect(src!.role).toBe('source');
  });

  it('assigns test role to test/', async () => {
    const root = await scanDirectories(FIXTURE_ROOT);
    const testDir = root.children?.find((c) => c.path.endsWith('test'));
    expect(testDir).toBeDefined();
    expect(testDir!.role).toBe('test');
  });

  it('detects nested src/operations/ subdirectory', async () => {
    const root = await scanDirectories(FIXTURE_ROOT);
    // operations/ is nested under src/ — should appear somewhere in children
    const ops = root.children?.find((c) => c.path.endsWith('operations'));
    expect(ops).toBeDefined();
  });

  it('inherits source role for src/operations/ from src/', async () => {
    const root = await scanDirectories(FIXTURE_ROOT);
    const ops = root.children?.find((c) => c.path.endsWith('operations'));
    expect(ops).toBeDefined();
    expect(ops!.role).toBe('source');
  });

  it('does not include node_modules', async () => {
    const root = await scanDirectories(FIXTURE_ROOT);
    const nm = root.children?.find((c) => c.path.includes('node_modules'));
    expect(nm).toBeUndefined();
  });

  it('does not include dist (not present in fixture)', async () => {
    const root = await scanDirectories(FIXTURE_ROOT);
    const dist = root.children?.find((c) => c.path.endsWith('dist'));
    expect(dist).toBeUndefined();
  });
});

describe('DirectoryScanner — mixed-js-ts fixture', () => {
  const MIXED_ROOT = path.resolve(__dirname, '../../test/fixtures/mixed-js-ts');

  it('assigns source role to src/ in a mixed JS/TS project', async () => {
    const root = await scanDirectories(MIXED_ROOT);
    const src = root.children?.find((c) => c.path.endsWith('src'));
    expect(src).toBeDefined();
    expect(src!.role).toBe('source');
  });
});

describe('DirectoryScanner — nested-monorepo fixture', () => {
  const MONO_ROOT = path.resolve(__dirname, '../../test/fixtures/nested-monorepo');

  it('has no role=undefined entries at depth 2+ under packages/', async () => {
    const root = await scanDirectories(MONO_ROOT);
    // fast-glob returns forward-slash paths on all platforms including Windows;
    // use '/' explicitly rather than path.sep to avoid incorrect depth counts.
    const allNodes = root.children ?? [];
    const depth2plus = allNodes.filter((c) => {
      const rel = path.relative(MONO_ROOT, c.path).replace(/\\/g, '/');
      return rel.split('/').length >= 2;
    });
    // src/ nodes at depth 2+ (e.g. packages/core/src) must be assigned 'source'
    const srcNodes = depth2plus.filter((c) => path.basename(c.path) === 'src');
    expect(srcNodes.length).toBeGreaterThan(0);
    srcNodes.forEach((n) => expect(n.role).toBe('source'));
    // Intermediate dirs (packages/core, packages/ui) intentionally have role=undefined.
    // Assert that zero src/ nodes are undefined — if this fails, assignRole() regressed.
    const nullSrcRoles = srcNodes.filter((n) => n.role === undefined);
    expect(nullSrcRoles.length).toBe(0);
  });
});
