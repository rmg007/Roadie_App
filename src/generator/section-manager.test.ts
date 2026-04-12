import { describe, it, expect } from 'vitest';
import { buildSectionedFile, mergeSections, hashContent, type GeneratedSection } from './section-manager';

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
