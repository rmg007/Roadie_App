import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { buildSectionedFile, mergeSections, hashContent, type GeneratedSection } from './section-manager';
import { SectionManagerService, type WriteSectionResult, type ParsedSection } from './section-manager-service';

describe('SectionManager', () => {
  describe('hashContent', () => {
    it('returns a 16-char hex string', () => {
      const hash = hashContent('hello world');
      expect(hash).toMatch(/^[a-f0-9]{16}$/);
    });

    it('produces different hashes for different content', () => {
      expect(hashContent('foo')).not.toBe(hashContent('bar'));
    });

    it('produces same hash for same content', () => {
      expect(hashContent('test')).toBe(hashContent('test'));
    });
  });

  describe('buildSectionedFile', () => {
    it('wraps sections in markers', () => {
      const sections: GeneratedSection[] = [
        { id: 'tech-stack', content: '## Tech Stack\n- TypeScript' },
      ];
      const file = buildSectionedFile(sections);
      expect(file).toContain('<!-- roadie:start:tech-stack -->');
      expect(file).toContain('<!-- roadie:end:tech-stack -->');
      expect(file).toContain('## Tech Stack');
    });

    it('handles multiple sections', () => {
      const sections: GeneratedSection[] = [
        { id: 'a', content: 'Section A' },
        { id: 'b', content: 'Section B' },
      ];
      const file = buildSectionedFile(sections);
      expect(file).toContain('<!-- roadie:start:a -->');
      expect(file).toContain('<!-- roadie:end:a -->');
      expect(file).toContain('<!-- roadie:start:b -->');
      expect(file).toContain('Section B');
    });
  });

  describe('mergeSections', () => {
    it('appends new sections to existing file', () => {
      const existing = '# My File\nSome content\n';
      const sections: GeneratedSection[] = [{ id: 'new', content: 'New stuff' }];
      const result = mergeSections(existing, sections, new Map());
      expect(result.finalContent).toContain('<!-- roadie:start:new -->');
      expect(result.finalContent).toContain('New stuff');
    });

    it('replaces unedited sections (hash matches stored)', () => {
      const innerContent = 'Original content';
      const existing = `<!-- roadie:start:test -->\n${innerContent}\n<!-- roadie:end:test -->`;
      const storedHashes = new Map([['test', hashContent(innerContent)]]);
      const sections: GeneratedSection[] = [{ id: 'test', content: 'Updated content' }];

      const result = mergeSections(existing, sections, storedHashes);
      expect(result.finalContent).toContain('Updated content');
      expect(result.finalContent).not.toContain('Original content');
      expect(result.merged).toBe(false);
    });

    it('appends below when human-edited (hash differs)', () => {
      const storedContent = 'Original from Roadie';
      const humanEdited = 'Human changed this';
      const existing = `<!-- roadie:start:test -->\n${humanEdited}\n<!-- roadie:end:test -->`;
      const storedHashes = new Map([['test', hashContent(storedContent)]]);
      const sections: GeneratedSection[] = [{ id: 'test', content: 'New from Roadie' }];

      const result = mergeSections(existing, sections, storedHashes);
      // Both old human content and new Roadie content should be present
      expect(result.finalContent).toContain(humanEdited);
      expect(result.finalContent).toContain('New from Roadie');
      expect(result.finalContent).toContain('<!-- roadie:merged:');
      expect(result.merged).toBe(true);
    });
  });
});

/* ================================================================== */
/*  Phase 1.5 — SectionManagerService tests                           */
/* ================================================================== */

describe('SectionManagerService', () => {
  let svc: SectionManagerService;
  let tmpDir: string;

  beforeEach(async () => {
    svc = new SectionManagerService();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'roadie-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  /* ---- parseSections: markdown ---- */

  describe('parseSections — markdown', () => {
    it('parses markdown sections with markers', () => {
      const content = [
        '<!-- roadie:start:intro -->',
        '<!-- hash:abc123 -->',
        'Hello world',
        '<!-- roadie:end:intro -->',
      ].join('\n');

      const sections = svc.parseSections(content, 'markdown');
      expect(sections).toHaveLength(1);
      expect(sections[0].id).toBe('intro');
      expect(sections[0].content).toBe('Hello world');
      expect(sections[0].hash).toBe('abc123');
      expect(sections[0].fileType).toBe('markdown');
      expect(sections[0].startLine).toBe(0);
      expect(sections[0].endLine).toBe(3);
    });

    it('parses multiple markdown sections', () => {
      const content = [
        '<!-- roadie:start:a -->',
        'Section A',
        '<!-- roadie:end:a -->',
        '',
        '<!-- roadie:start:b -->',
        'Section B',
        '<!-- roadie:end:b -->',
      ].join('\n');

      const sections = svc.parseSections(content, 'markdown');
      expect(sections).toHaveLength(2);
      expect(sections[0].id).toBe('a');
      expect(sections[1].id).toBe('b');
    });

    it('returns null hash when no hash line present', () => {
      const content = [
        '<!-- roadie:start:x -->',
        'No hash here',
        '<!-- roadie:end:x -->',
      ].join('\n');

      const sections = svc.parseSections(content, 'markdown');
      expect(sections[0].hash).toBeNull();
      expect(sections[0].content).toBe('No hash here');
    });
  });

  /* ---- parseSections: yaml ---- */

  describe('parseSections — yaml', () => {
    it('parses yaml sections with # markers', () => {
      const content = [
        '# roadie:start:config',
        '# hash:def456',
        'key: value',
        '# roadie:end:config',
      ].join('\n');

      const sections = svc.parseSections(content, 'yaml');
      expect(sections).toHaveLength(1);
      expect(sections[0].id).toBe('config');
      expect(sections[0].content).toBe('key: value');
      expect(sections[0].hash).toBe('def456');
      expect(sections[0].fileType).toBe('yaml');
    });
  });

  /* ---- parseSections: shell ---- */

  describe('parseSections — shell', () => {
    it('parses shell sections with # markers', () => {
      const content = [
        '#!/bin/bash',
        '# roadie:start:setup',
        'echo "hello"',
        '# roadie:end:setup',
      ].join('\n');

      const sections = svc.parseSections(content, 'shell');
      expect(sections).toHaveLength(1);
      expect(sections[0].id).toBe('setup');
      expect(sections[0].content).toBe('echo "hello"');
      expect(sections[0].fileType).toBe('shell');
    });
  });

  /* ---- hash computation & verification ---- */

  describe('hash computation and verification', () => {
    it('computeHash returns a 16-char hex string', () => {
      const hash = svc.computeHash('test content');
      expect(hash).toMatch(/^[a-f0-9]{16}$/);
    });

    it('verifyHash returns true for matching content', () => {
      const content = 'some content';
      const hash = svc.computeHash(content);
      expect(svc.verifyHash(content, hash)).toBe(true);
    });

    it('verifyHash returns false for mismatched content', () => {
      const hash = svc.computeHash('original');
      expect(svc.verifyHash('modified', hash)).toBe(false);
    });
  });

  /* ---- writeSectionFile ---- */

  describe('writeSectionFile', () => {
    it('creates new file with markers and hash', async () => {
      const filePath = path.join(tmpDir, 'new.md');
      const sections: GeneratedSection[] = [
        { id: 'intro', content: 'Hello world' },
      ];

      const result = await svc.writeSectionFile(filePath, sections);
      expect(result.written).toBe(true);
      expect(result.deferred).toBe(false);
      expect(result.mergeConflicts).toHaveLength(0);

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toContain('<!-- roadie:start:intro -->');
      expect(content).toContain('<!-- roadie:end:intro -->');
      expect(content).toContain('Hello world');
      expect(content).toContain('<!-- hash:');
    });

    it('merges with append-below on human edits', async () => {
      const filePath = path.join(tmpDir, 'edited.md');
      const originalContent = 'Original content';
      const h = hashContent(originalContent);

      // Write initial file with markers and hash
      const initial = [
        `<!-- roadie:start:doc -->`,
        `<!-- hash:${h} -->`,
        originalContent,
        `<!-- roadie:end:doc -->`,
        '',
      ].join('\n');
      await fs.writeFile(filePath, initial, 'utf-8');

      // Simulate human edit (change content but keep markers)
      const humanEdited = initial.replace(originalContent, 'Human changed this');
      await fs.writeFile(filePath, humanEdited, 'utf-8');

      // Now write new sections
      const sections: GeneratedSection[] = [
        { id: 'doc', content: 'New from Roadie' },
      ];
      const result = await svc.writeSectionFile(filePath, sections);

      expect(result.written).toBe(true);
      expect(result.mergeConflicts).toHaveLength(1);
      expect(result.mergeConflicts[0].sectionId).toBe('doc');
      expect(result.mergeConflicts[0].reason).toBe('user-edited');

      const final = await fs.readFile(filePath, 'utf-8');
      expect(final).toContain('Human changed this');
      expect(final).toContain('New from Roadie');
    });

    it('skips write when content is unchanged', async () => {
      const filePath = path.join(tmpDir, 'unchanged.md');
      const content = 'Same content';
      const h = hashContent(content);

      const initial = [
        `<!-- roadie:start:sec -->`,
        `<!-- hash:${h} -->`,
        content,
        `<!-- roadie:end:sec -->`,
        '',
      ].join('\n');
      await fs.writeFile(filePath, initial, 'utf-8');

      const sections: GeneratedSection[] = [
        { id: 'sec', content: 'Same content' },
      ];
      const result = await svc.writeSectionFile(filePath, sections);

      expect(result.written).toBe(true);
      expect(result.mergeConflicts).toHaveLength(0);
    });

    it('creates nested directories if needed', async () => {
      const filePath = path.join(tmpDir, 'deep', 'nested', 'file.md');
      const sections: GeneratedSection[] = [
        { id: 'a', content: 'Nested' },
      ];

      const result = await svc.writeSectionFile(filePath, sections);
      expect(result.written).toBe(true);
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toContain('Nested');
    });

    it('uses yaml markers for .yml files', async () => {
      const filePath = path.join(tmpDir, 'config.yml');
      const sections: GeneratedSection[] = [
        { id: 'deps', content: 'dependency: foo' },
      ];

      await svc.writeSectionFile(filePath, sections);
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toContain('# roadie:start:deps');
      expect(content).toContain('# roadie:end:deps');
      expect(content).toContain('# hash:');
    });
  });

  /* ---- per-file locking ---- */

  describe('per-file locking', () => {
    it('serializes concurrent writes to the same file', async () => {
      const filePath = path.join(tmpDir, 'concurrent.md');
      const order: string[] = [];

      // Wrap writeSectionFile to track ordering
      const write = async (id: string) => {
        const result = await svc.writeSectionFile(filePath, [
          { id, content: `Content for ${id}` },
        ]);
        order.push(id);
        return result;
      };

      // Fire off multiple concurrent writes
      const p1 = write('first');
      const p2 = write('second');
      const p3 = write('third');

      await Promise.all([p1, p2, p3]);

      // All three should have completed in order
      expect(order).toEqual(['first', 'second', 'third']);

      // Final file should contain all three sections
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toContain('Content for first');
      expect(content).toContain('Content for second');
      expect(content).toContain('Content for third');
    });
  });

  /* ---- edge cases ---- */

  describe('edge cases', () => {
    it('handles empty content', () => {
      const sections = svc.parseSections('', 'markdown');
      expect(sections).toEqual([]);
    });

    it('handles BOM markers', () => {
      const content = '\uFEFF<!-- roadie:start:bom -->\nBOM content\n<!-- roadie:end:bom -->';
      const sections = svc.parseSections(content, 'markdown');
      expect(sections).toHaveLength(1);
      expect(sections[0].id).toBe('bom');
      expect(sections[0].content).toBe('BOM content');
    });

    it('handles malformed markers gracefully (no end marker)', () => {
      const content = [
        '<!-- roadie:start:orphan -->',
        'Some content',
        'No end marker here',
      ].join('\n');

      const sections = svc.parseSections(content, 'markdown');
      expect(sections).toHaveLength(0);
    });

    it('handles malformed markers gracefully (mismatched ids)', () => {
      const content = [
        '<!-- roadie:start:alpha -->',
        'Content',
        '<!-- roadie:end:beta -->',
      ].join('\n');

      const sections = svc.parseSections(content, 'markdown');
      expect(sections).toHaveLength(0);
    });
  });
});
