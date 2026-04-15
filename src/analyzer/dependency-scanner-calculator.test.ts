/**
 * DependencyScanner tests against the ts-calculator fixture.
 * Verifies that a pure-TypeScript / tsup / vitest project is detected correctly.
 */
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { scanDependencies } from './dependency-scanner';

const FIXTURE_ROOT = path.resolve(__dirname, '../../test/fixtures/ts-calculator');

describe('DependencyScanner — ts-calculator fixture', () => {
  it('detects npm as the package manager (no lock file present)', async () => {
    const { techStack } = await scanDependencies(FIXTURE_ROOT);
    const pm = techStack.find((e) => e.category === 'package_manager');
    expect(pm).toBeDefined();
    expect(pm!.name).toBe('npm');
  });

  it('detects TypeScript from devDependencies', async () => {
    const { techStack } = await scanDependencies(FIXTURE_ROOT);
    const ts = techStack.find((e) => e.name === 'TypeScript');
    expect(ts).toBeDefined();
    expect(ts!.category).toBe('language');
    expect(ts!.version).toBe('5.4.0');
  });

  it('detects tsup build tool', async () => {
    const { techStack } = await scanDependencies(FIXTURE_ROOT);
    expect(techStack.some((e) => e.name === 'tsup' && e.category === 'build_tool')).toBe(true);
  });

  it('detects Vitest test tool', async () => {
    const { techStack } = await scanDependencies(FIXTURE_ROOT);
    expect(techStack.some((e) => e.name === 'Vitest' && e.category === 'test_tool')).toBe(true);
  });

  it('does NOT falsely detect React or Next.js (clean minimal project)', async () => {
    const { techStack } = await scanDependencies(FIXTURE_ROOT);
    expect(techStack.some((e) => e.name === 'React')).toBe(false);
    expect(techStack.some((e) => e.name === 'Next.js')).toBe(false);
  });

  it('does NOT falsely detect any ORM', async () => {
    const { techStack } = await scanDependencies(FIXTURE_ROOT);
    expect(techStack.some((e) => e.category === 'orm')).toBe(false);
  });

  it('extracts build command', async () => {
    const { commands } = await scanDependencies(FIXTURE_ROOT);
    const build = commands.find((c) => c.name === 'build');
    expect(build).toBeDefined();
    expect(build!.type).toBe('build');
    expect(build!.command).toBe('npm run build');
  });

  it('extracts test command', async () => {
    const { commands } = await scanDependencies(FIXTURE_ROOT);
    const test = commands.find((c) => c.name === 'test');
    expect(test).toBeDefined();
    expect(test!.type).toBe('test');
    expect(test!.command).toBe('npm run test');
  });

  it('extracts dev command', async () => {
    const { commands } = await scanDependencies(FIXTURE_ROOT);
    const dev = commands.find((c) => c.name === 'dev');
    expect(dev).toBeDefined();
    expect(dev!.type).toBe('dev');
  });

  it('extracts lint command', async () => {
    const { commands } = await scanDependencies(FIXTURE_ROOT);
    const lint = commands.find((c) => c.name === 'lint');
    expect(lint).toBeDefined();
    expect(lint!.type).toBe('lint');
  });

  it('version strip: tsup version does not contain ^ or ~', async () => {
    const { techStack } = await scanDependencies(FIXTURE_ROOT);
    const tsup = techStack.find((e) => e.name === 'tsup');
    expect(tsup?.version).toBeDefined();
    expect(tsup!.version).not.toMatch(/[\^~]/);
  });
});
