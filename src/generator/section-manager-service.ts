/**
 * @module section-manager-service
 * @description Phase 1.5 extension of section-manager. Adds:
 *   - SectionManagerService class with per-file write locking
 *   - Multi-format section markers (markdown, yaml, shell)
 *   - Atomic file writes (write to .tmp, rename)
 *   - mtime-based conflict detection
 * @depends-on section-manager, node:fs/promises, node:path, node:crypto
 * @depended-on-by file-generator.ts
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { hashContent, mergeSections, type GeneratedSection } from './section-manager.js';
import type { Logger } from '../platform-adapters';
import { STUB_LOGGER } from '../platform-adapters';

// Re-export for convenience
export { hashContent, GeneratedSection };

/* ------------------------------------------------------------------ */
/*  Interfaces                                                         */
/* ------------------------------------------------------------------ */

export interface MergeConflictInfo {
  sectionId: string;
  reason: 'user-edited' | 'marker-deleted' | 'content-changed';
  resolution: 'append-below';
}

export interface WriteSectionResult {
  written: boolean;
  deferred: boolean;
  reason?: string;
  contentHash: string;
  mergeConflicts: MergeConflictInfo[];
}

export interface ParsedSection {
  id: string;
  startLine: number;
  endLine: number;
  content: string;
  hash: string | null;
  fileType: 'markdown' | 'yaml' | 'shell';
}

/* ------------------------------------------------------------------ */
/*  Marker patterns per file type                                      */
/* ------------------------------------------------------------------ */

type FileType = 'markdown' | 'yaml' | 'shell';

interface MarkerPatterns {
  start: RegExp;
  end: RegExp;
  hashLine: RegExp;
  buildStart: (id: string) => string;
  buildEnd: (id: string) => string;
  buildHash: (hash: string) => string;
}

const MARKERS: Record<FileType, MarkerPatterns> = {
  markdown: {
    start: /^<!--\s*roadie:start:(\S+)\s*-->$/,
    end: /^<!--\s*roadie:end:(\S+)\s*-->$/,
    hashLine: /^<!--\s*hash:([a-f0-9]+)\s*-->$/,
    buildStart: (id: string) => `<!-- roadie:start:${id} -->`,
    buildEnd: (id: string) => `<!-- roadie:end:${id} -->`,
    buildHash: (hash: string) => `<!-- hash:${hash} -->`,
  },
  yaml: {
    start: /^#\s*roadie:start:(\S+)$/,
    end: /^#\s*roadie:end:(\S+)$/,
    hashLine: /^#\s*hash:([a-f0-9]+)$/,
    buildStart: (id: string) => `# roadie:start:${id}`,
    buildEnd: (id: string) => `# roadie:end:${id}`,
    buildHash: (hash: string) => `# hash:${hash}`,
  },
  shell: {
    start: /^#\s*roadie:start:(\S+)$/,
    end: /^#\s*roadie:end:(\S+)$/,
    hashLine: /^#\s*hash:([a-f0-9]+)$/,
    buildStart: (id: string) => `# roadie:start:${id}`,
    buildEnd: (id: string) => `# roadie:end:${id}`,
    buildHash: (hash: string) => `# hash:${hash}`,
  },
};

/* ------------------------------------------------------------------ */
/*  SectionManagerService                                              */
/* ------------------------------------------------------------------ */

export class SectionManagerService {
  constructor(private log: Logger = STUB_LOGGER) {}
  private locks: Map<string, Promise<void>> = new Map();

  /* ---- public helpers ---- */

  /** Compute normalized hash using the existing hashContent function. */
  computeHash(content: string): string {
    return hashContent(content);
  }

  /** Verify that content matches an expected hash. */
  verifyHash(content: string, expectedHash: string): boolean {
    return hashContent(content) === expectedHash;
  }

  /* ---- parsing ---- */

  /** Parse roadie-managed sections from file content. */
  parseSections(content: string, fileType: FileType = 'markdown'): ParsedSection[] {
    const markers = MARKERS[fileType];
    // Strip BOM
    const clean = content.replace(/^\uFEFF/, '');
    const lines = clean.split('\n');
    const sections: ParsedSection[] = [];

    let i = 0;
    while (i < lines.length) {
      const lineI = lines[i];
      if (lineI === undefined) { i++; continue; }
      const startMatch = lineI.trim().match(markers.start);
      if (!startMatch) { i++; continue; }

      const id = startMatch[1] ?? '';
      const startLine = i;
      let hash: string | null = null;
      let endLine = -1;

      // Look for optional hash line right after start marker
      if (i + 1 < lines.length) {
        const lineNext = lines[i + 1];
        const hm = lineNext !== undefined ? lineNext.trim().match(markers.hashLine) : null;
        if (hm) { hash = hm[1] ?? null; }
      }

      // Find matching end marker
      for (let j = i + 1; j < lines.length; j++) {
        const lineJ = lines[j];
        const endMatch = lineJ !== undefined ? lineJ.trim().match(markers.end) : null;
        if (endMatch && endMatch[1] === id) {
          endLine = j;
          break;
        }
      }

      if (endLine === -1) {
        // Malformed — no closing marker. Skip this start marker.
        this.log.warn(`Unclosed section marker: ${id}`);
        i++;
        continue;
      }

      // Extract content between markers (excluding hash line if present)
      const contentStart = hash !== null ? startLine + 2 : startLine + 1;
      const innerLines = lines.slice(contentStart, endLine);
      const innerContent = innerLines.join('\n').trim();

      sections.push({ id, startLine, endLine, content: innerContent, hash, fileType });
      i = endLine + 1;
    }

    return sections;
  }

  /* ---- writing ---- */

  /**
   * Write sections to a file with per-file lock protection,
   * atomic writes, and mtime-based conflict detection.
   */
  async writeSectionFile(
    filePath: string,
    sections: GeneratedSection[],
  ): Promise<WriteSectionResult> {
    const resolved = path.resolve(filePath);
    return this.withLock(resolved, () => this.doWrite(resolved, sections));
  }

  /* ---- internals ---- */

  private async doWrite(
    filePath: string,
    sections: GeneratedSection[],
  ): Promise<WriteSectionResult> {
    const mergeConflicts: MergeConflictInfo[] = [];
    let existingContent = '';
    let mtimeBefore: number | null = null;

    // Read existing file (if any)
    try {
      const stat = await fs.stat(filePath);
      mtimeBefore = stat.mtimeMs;
      existingContent = await fs.readFile(filePath, 'utf-8');
    } catch {
      // File doesn't exist — that's fine, we'll create it.
    }

    // Detect file type from extension
    const fileType = this.detectFileType(filePath);
    const markers = MARKERS[fileType];

    // Build the new content
    let finalContent: string;

    if (!existingContent) {
      // Brand new file — build from scratch with markers and hashes
      const parts: string[] = [];
      for (const section of sections) {
        const h = hashContent(section.content.trim());
        parts.push(markers.buildStart(section.id));
        parts.push(markers.buildHash(h));
        parts.push(section.content.trim());
        parts.push(markers.buildEnd(section.id));
        parts.push('');
      }
      finalContent = parts.join('\n').trim() + '\n';
    } else {
      // Merge into existing content
      const parsed = this.parseSections(existingContent, fileType);
      const existingIds = new Set(parsed.map((p) => p.id));
      let result = existingContent;

      for (const section of sections) {
        const startMarker = markers.buildStart(section.id);
        const endMarker = markers.buildEnd(section.id);
        const newHash = hashContent(section.content.trim());
        const hashLine = markers.buildHash(newHash);
        const newBlock = `${startMarker}\n${hashLine}\n${section.content.trim()}\n${endMarker}`;

        if (!existingIds.has(section.id)) {
          // Append new section
          result = result.trimEnd() + '\n\n' + newBlock + '\n';
          continue;
        }

        // Find the existing parsed section
        const existing = parsed.find((p) => p.id === section.id);
        if (!existing) { continue; }

        const existingInnerHash = hashContent(existing.content);

        // Check if content is unchanged
        if (existing.content === section.content.trim()) {
          // Content identical — skip
          continue;
        }

        // Check for human edits
        if (existing.hash && existingInnerHash !== existing.hash) {
          // Human edited — append below
          mergeConflicts.push({
            sectionId: section.id,
            reason: 'user-edited',
            resolution: 'append-below',
          });

          const lines = result.split('\n');
          const endLineIdx = existing.endLine;
          const before = lines.slice(0, endLineIdx + 1).join('\n');
          const after = lines.slice(endLineIdx + 1).join('\n');
          result = before + '\n' + newBlock + (after ? '\n' + after : '\n');
        } else {
          // No human edits — replace in-place
          const lines = result.split('\n');
          const before = lines.slice(0, existing.startLine).join('\n');
          const after = lines.slice(existing.endLine + 1).join('\n');
          result = (before ? before + '\n' : '') + newBlock + (after ? '\n' + after : '\n');
        }
      }

      finalContent = result;
    }

    // mtime conflict detection
    if (mtimeBefore !== null) {
      try {
        const statAfter = await fs.stat(filePath);
        if (statAfter.mtimeMs !== mtimeBefore) {
          return {
            written: false,
            deferred: true,
            reason: 'mtime_changed',
            contentHash: `sha256:${hashContent(finalContent)}`,
            mergeConflicts,
          };
        }
      } catch {
        // File was deleted between read and write — proceed with create
      }
    }

    // Atomic write: write to temp, then rename
    const tmpPath = `${filePath}.roadie-tmp-${process.pid}-${Date.now()}`;
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(tmpPath, finalContent, 'utf-8');
      await fs.rename(tmpPath, filePath);
    } catch (err: unknown) {
      try { await fs.unlink(tmpPath); } catch { /* best effort cleanup */ }
      return {
        written: false,
        deferred: false,
        reason: 'write_error',
        contentHash: `sha256:${hashContent(finalContent)}`,
        mergeConflicts,
      };
    }

    return {
      written: true,
      deferred: false,
      contentHash: `sha256:${hashContent(finalContent)}`,
      mergeConflicts,
    };
  }

  /** Serialize concurrent writes to the same file path. */
  private async withLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(filePath) ?? Promise.resolve();
    let releaseLock: () => void;
    const next = new Promise<void>((resolve) => { releaseLock = resolve; });
    this.locks.set(filePath, next);

    await prev;
    try {
      return await fn();
    } finally {
      releaseLock!();
    }
  }

  /** Detect file type from extension. */
  private detectFileType(filePath: string): FileType {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.yml' || ext === '.yaml') return 'yaml';
    if (ext === '.sh' || ext === '.bash' || ext === '.zsh') return 'shell';
    return 'markdown';
  }
}
