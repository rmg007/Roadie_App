/**
 * @module section-manager
 * @description Manages ownership markers in generated Markdown files.
 *   Parses <!-- roadie:start:section --> / <!-- roadie:end:section --> markers.
 *   Computes SHA-256 hashes to detect human edits. Merge strategy:
 *   unedited sections are replaced; human-edited sections get new content
 *   appended below with <!-- roadie:merged:timestamp -->.
 * @inputs Section ID, new content, existing file content
 * @outputs Merged file content with markers
 * @depends-on node:crypto
 * @depended-on-by file-generator.ts
 */

import { createHash } from 'node:crypto';

export interface GeneratedSection {
  id: string;
  content: string;
}

export interface SectionWriteResult {
  finalContent: string;
  written: boolean;
  merged: boolean;
  contentHash: string;
}

const MARKER_START = (id: string): string => `<!-- roadie:start:${id} -->`;
const MARKER_END = (id: string): string => `<!-- roadie:end:${id} -->`;
const MARKER_MERGED = (): string => `<!-- roadie:merged:${new Date().toISOString()} -->`;

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findSectionMatch(content: string, id: string): RegExpExecArray | null {
  const escapedId = escapeRegex(id);
  const regex = new RegExp(
    `<!--\\s*roadie:start:${escapedId}\\s*-->([\\s\\S]*?)<!--\\s*roadie:end:${escapedId}\\s*-->`,
    'i',
  );
  return regex.exec(content);
}

/** Compute SHA-256 hash of content. */
export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Build a complete file from sections, each wrapped in ownership markers.
 */
export function buildSectionedFile(sections: GeneratedSection[]): string {
  const parts: string[] = [];
  for (const section of sections) {
    parts.push(MARKER_START(section.id));
    parts.push(section.content.trim());
    parts.push(MARKER_END(section.id));
    parts.push(''); // blank line between sections
  }
  return parts.join('\n').trim() + '\n';
}

/**
 * Merge new sections into an existing file, respecting human edits.
 *
 * For each section:
 *   - If the section doesn't exist in existing: append it
 *   - If the section exists and content hash matches: replace (no human edits)
 *   - If the section exists but hash differs: append below with merge marker
 */
export function mergeSections(
  existingContent: string,
  newSections: GeneratedSection[],
  storedHashes: Map<string, string>,
): SectionWriteResult {
  let result = existingContent;
  let anyMerged = false;

  for (const section of newSections) {
    const newBlock = `${MARKER_START(section.id)}\n${section.content.trim()}\n${MARKER_END(section.id)}`;
    const match = findSectionMatch(result, section.id);

    if (!match) {
      // Section doesn't exist in file — append
      result = result.trimEnd() + '\n\n' + newBlock + '\n';
    } else {
      const fullMatch = match[0];
      const existingBlock = (match[1] ?? '').trim();
      const existingHash = hashContent(existingBlock);
      const storedHash = storedHashes.get(section.id);
      const startIdx = match.index;
      const endIdx = match.index + fullMatch.length;

      if (storedHash && existingHash !== storedHash) {
        // Human edited — append below with merge marker
        const mergeBlock = `\n${MARKER_MERGED()}\n${newBlock}`;
        result = result.slice(0, endIdx) + mergeBlock + result.slice(endIdx);
        anyMerged = true;
      } else {
        // No human edits — replace entirely
        result = result.slice(0, startIdx) + newBlock + result.slice(endIdx);
      }
    }
  }

  const finalHash = hashContent(result);
  return {
    finalContent: result,
    written: true,
    merged: anyMerged,
    contentHash: `sha256:${finalHash}`,
  };
}
