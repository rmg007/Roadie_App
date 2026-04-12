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
    const startMarker = MARKER_START(section.id);
    const endMarker = MARKER_END(section.id);
    const startIdx = result.indexOf(startMarker);
    const endIdx = result.indexOf(endMarker);

    const newBlock = `${startMarker}\n${section.content.trim()}\n${endMarker}`;

    if (startIdx === -1 || endIdx === -1) {
      // Section doesn't exist in file — append
      result = result.trimEnd() + '\n\n' + newBlock + '\n';
    } else {
      // Section exists — check if human-edited
      const existingBlock = result.slice(startIdx + startMarker.length, endIdx).trim();
      const existingHash = hashContent(existingBlock);
      const storedHash = storedHashes.get(section.id);

      if (storedHash && existingHash !== storedHash) {
        // Human edited — append below with merge marker
        const mergeBlock = `\n${MARKER_MERGED()}\n${newBlock}`;
        result = result.slice(0, endIdx + endMarker.length) + mergeBlock + result.slice(endIdx + endMarker.length);
        anyMerged = true;
      } else {
        // No human edits — replace entirely
        result = result.slice(0, startIdx) + newBlock + result.slice(endIdx + endMarker.length);
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
