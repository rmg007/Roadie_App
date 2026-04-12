/**
 * @module edit-tracker (M21)
 * @description Detects developer edits to Roadie-generated files and records
 *   them. Compares current file content against the last known snapshot,
 *   computes a line-level diff summary, and identifies which Roadie-managed
 *   sections were modified.
 * @depends-on learning-database (M23), section-manager-service (M22)
 * @depended-on-by file-watcher-manager (M15)
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { LearningDatabase, FileSnapshot } from '../learning/learning-database.js';
import type { SectionManagerService, ParsedSection } from '../generator/section-manager-service.js';

// ---- Public types ----

export interface EditRecord {
  filePath: string;
  timestamp: Date;
  editedSections: string[];
  addedOutsideMarkers: boolean;
  diffSummary: {
    linesAdded: number;
    linesRemoved: number;
    linesModified: number;
  };
}

export interface EditTrackerConfig {
  editTracking: boolean;
}

// ---- Helpers ----

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function computeDiffSummary(
  oldContent: string,
  newContent: string,
): { linesAdded: number; linesRemoved: number; linesModified: number } {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const maxLen = Math.max(oldLines.length, newLines.length);
  const minLen = Math.min(oldLines.length, newLines.length);

  let linesModified = 0;
  for (let i = 0; i < minLen; i++) {
    if (oldLines[i] !== newLines[i]) {
      linesModified++;
    }
  }

  const linesAdded = newLines.length > oldLines.length ? maxLen - minLen : 0;
  const linesRemoved = oldLines.length > newLines.length ? maxLen - minLen : 0;

  return { linesAdded, linesRemoved, linesModified };
}

function findEditedSections(
  oldSections: ParsedSection[],
  newSections: ParsedSection[],
): string[] {
  const oldMap = new Map<string, string>();
  for (const s of oldSections) {
    oldMap.set(s.id, sha256(s.content));
  }

  const edited: string[] = [];
  for (const s of newSections) {
    const oldHash = oldMap.get(s.id);
    if (oldHash !== undefined && oldHash !== sha256(s.content)) {
      edited.push(s.id);
    }
  }
  return edited;
}

function hasContentOutsideMarkers(
  oldContent: string,
  newContent: string,
  sections: ParsedSection[],
): boolean {
  if (sections.length === 0) return false;

  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  // Build a set of line indices that fall inside markers (in new content)
  const insideMarker = new Set<number>();
  for (const s of sections) {
    for (let i = s.startLine; i <= s.endLine && i < newLines.length; i++) {
      insideMarker.add(i);
    }
  }

  // Check lines outside markers in the new content
  for (let i = 0; i < newLines.length; i++) {
    if (insideMarker.has(i)) continue;
    // If this line index is beyond old content or differs, new content was added outside
    if (i >= oldLines.length || newLines[i] !== oldLines[i]) {
      return true;
    }
  }

  return false;
}

// ---- Class ----

export class EditTracker {
  private active = false;

  constructor(
    private learningDb: LearningDatabase,
    private sectionManager: SectionManagerService,
  ) {}

  initialize(config: EditTrackerConfig): void {
    this.active = config.editTracking;
  }

  async trackEdit(filePath: string): Promise<EditRecord | null> {
    if (!this.active) return null;

    const snapshot = this.learningDb.getLatestSnapshot(filePath);

    let currentContent: string;
    try {
      currentContent = await readFile(filePath, 'utf-8');
    } catch {
      return null;
    }

    const currentHash = sha256(currentContent);

    // No snapshot yet — record this as baseline and return null
    if (!snapshot) {
      this.learningDb.recordSnapshot(filePath, currentContent, 'human');
      return null;
    }

    // Content unchanged
    if (currentHash === snapshot.contentHash) {
      return null;
    }

    const diffSummary = computeDiffSummary(snapshot.content, currentContent);
    const oldSections = this.sectionManager.parseSections(snapshot.content);
    const newSections = this.sectionManager.parseSections(currentContent);
    const editedSections = findEditedSections(oldSections, newSections);
    const addedOutsideMarkers = hasContentOutsideMarkers(
      snapshot.content,
      currentContent,
      newSections,
    );

    // Store new snapshot
    this.learningDb.recordSnapshot(filePath, currentContent, 'human');

    return {
      filePath,
      timestamp: new Date(),
      editedSections,
      addedOutsideMarkers,
      diffSummary,
    };
  }

  async hasHumanEdits(filePath: string): Promise<boolean> {
    if (!this.active) return false;

    const snapshot = this.learningDb.getLatestSnapshot(filePath);
    if (!snapshot) return false;

    let currentContent: string;
    try {
      currentContent = await readFile(filePath, 'utf-8');
    } catch {
      return false;
    }

    return sha256(currentContent) !== snapshot.contentHash;
  }

  async getEditHistory(filePath: string, _limit?: number): Promise<EditRecord[]> {
    // Full history requires schema extension; return empty for now
    return [];
  }

  dispose(): void {
    this.active = false;
  }
}
