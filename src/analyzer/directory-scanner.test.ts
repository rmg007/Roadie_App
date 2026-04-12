import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { scanDirectories } from './directory-scanner';

const FIXTURE_ROOT = path.resolve(__dirname, '../../test/fixtures/node-js-nextjs');

describe('DirectoryScanner', () => {
  it('returns a root DirectoryNode', async () => {
    const root = await scanDirectories(FIXTURE_ROOT);
    expect(root.type).toBe('directory');
    expect(root.path).toBe(FIXTURE_ROOT);
  });

  it('detects src/ directory with source role', async () => {
    const root = await scanDirectories(FIXTURE_ROOT);
    const src = root.children?.find((c) => c.path.endsWith('src'));
    expect(src).toBeDefined();
    expect(src!.role).toBe('source');
  });

  it('detects __tests__/ directory with test role', async () => {
    const root = await scanDirectories(FIXTURE_ROOT);
    const tests = root.children?.find((c) => c.path.endsWith('__tests__'));
    expect(tests).toBeDefined();
    expect(tests!.role).toBe('test');
  });

  it('does not include node_modules', async () => {
    const root = await scanDirectories(FIXTURE_ROOT);
    const nm = root.children?.find((c) => c.path.includes('node_modules'));
    expect(nm).toBeUndefined();
  });
});
