import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { scanDependencies } from './dependency-scanner';

const FIXTURE_ROOT = path.resolve(__dirname, '../../test/fixtures/node-js-nextjs');

describe('DependencyScanner', () => {
  it('detects pnpm as package manager from lock file', async () => {
    const { techStack } = await scanDependencies(FIXTURE_ROOT);
    const pm = techStack.find((e) => e.category === 'package_manager');
    expect(pm).toBeDefined();
    expect(pm!.name).toBe('pnpm');
  });

  it('detects TypeScript from devDependencies', async () => {
    const { techStack } = await scanDependencies(FIXTURE_ROOT);
    const ts = techStack.find((e) => e.name === 'TypeScript');
    expect(ts).toBeDefined();
    expect(ts!.category).toBe('language');
    expect(ts!.version).toBe('5.2.0');
  });

  it('detects Next.js framework', async () => {
    const { techStack } = await scanDependencies(FIXTURE_ROOT);
    expect(techStack.some((e) => e.name === 'Next.js')).toBe(true);
  });

  it('detects Prisma ORM', async () => {
    const { techStack } = await scanDependencies(FIXTURE_ROOT);
    expect(techStack.some((e) => e.name === 'Prisma' && e.category === 'orm')).toBe(true);
  });

  it('detects Vitest test tool', async () => {
    const { techStack } = await scanDependencies(FIXTURE_ROOT);
    expect(techStack.some((e) => e.name === 'Vitest')).toBe(true);
  });

  it('detects tsup build tool', async () => {
    const { techStack } = await scanDependencies(FIXTURE_ROOT);
    expect(techStack.some((e) => e.name === 'tsup')).toBe(true);
  });

  it('extracts commands from package.json scripts', async () => {
    const { commands } = await scanDependencies(FIXTURE_ROOT);
    expect(commands.find((c) => c.name === 'test')).toBeDefined();
    expect(commands.find((c) => c.name === 'build')).toBeDefined();
    expect(commands.find((c) => c.name === 'dev')).toBeDefined();
  });

  it('handles malformed package.json fields without throwing', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'roadie-deps-'));
    try {
      await fs.writeFile(path.join(tempDir, 'package.json'), JSON.stringify({
        dependencies: 42,
        devDependencies: ['typescript'],
        scripts: 'not-an-object',
      }), 'utf8');

      const { techStack, commands } = await scanDependencies(tempDir);
      expect(techStack.some((e) => e.name === 'Node.js')).toBe(true);
      expect(commands).toEqual([]);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('returns empty for non-existent workspace', async () => {
    const { techStack, commands } = await scanDependencies('/non/existent/path');
    expect(techStack).toEqual([]);
    expect(commands).toEqual([]);
  });
});
