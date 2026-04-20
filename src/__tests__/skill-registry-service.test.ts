/**
 * Tests for SkillRegistryService.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { SkillRegistryService } from '../engine/skill-registry-service';

async function makeTempSkillDir(): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'roadie-skill-test-'));
  const codingDir = path.join(tmp, 'assets', 'skills', 'coding');
  await fs.mkdir(codingDir, { recursive: true });
  await fs.writeFile(path.join(codingDir, 'typescript.md'), '# TypeScript\n\nA typed JS language.');
  await fs.writeFile(path.join(codingDir, 'python.md'), '# Python\n\nA dynamic language.');
  return tmp;
}

describe('SkillRegistryService', () => {
  let tmpRoot: string;
  let service: SkillRegistryService;

  beforeEach(async () => {
    tmpRoot = await makeTempSkillDir();
    service = new SkillRegistryService(tmpRoot);
  });

  afterEach(async () => {
    service.stopWatcher();
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('lists skills from the assets/skills directory', async () => {
    const skills = await service.listSkills();
    expect(skills.length).toBeGreaterThanOrEqual(2);
    const names = skills.map((s) => s.name);
    expect(names).toContain('typescript');
    expect(names).toContain('python');
  });

  it('returns cached results on second call (no watcher change)', async () => {
    // Call twice — second call should return same result without re-scanning
    const first = await service.listSkills();
    const second = await service.listSkills();
    expect(first).toEqual(second);
  });

  it('assigns the correct category to each skill', async () => {
    const skills = await service.listSkills();
    for (const skill of skills) {
      expect(skill.category).toBe('coding');
    }
  });

  it('findRelevantSkills returns matching skills by name or description', async () => {
    const results = await service.findRelevantSkills('typescript');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toBe('typescript');
  });

  it('returns empty array for no skills directory', async () => {
    const emptyRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'roadie-empty-'));
    try {
      const emptySvc = new SkillRegistryService(emptyRoot);
      const skills = await emptySvc.listSkills();
      emptySvc.stopWatcher();
      expect(skills).toEqual([]);
    } finally {
      await fs.rm(emptyRoot, { recursive: true, force: true });
    }
  });
});
