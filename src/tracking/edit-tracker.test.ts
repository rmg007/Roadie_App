import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { EditTracker } from './edit-tracker.js';
import type { EditTrackerConfig } from './edit-tracker.js';

// ---- Mock fs ----
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

import { readFile } from 'node:fs/promises';
const mockReadFile = vi.mocked(readFile);

// ---- Helpers ----

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

// ---- Mock dependencies ----

function createMockLearningDb() {
  return {
    recordSnapshot: vi.fn(),
    getSnapshots: vi.fn().mockReturnValue([]),
    getLatestSnapshot: vi.fn().mockReturnValue(null),
    getSectionHash: vi.fn().mockReturnValue(null),
    setSectionHash: vi.fn(),
    initialize: vi.fn(),
    close: vi.fn(),
    recordWorkflowOutcome: vi.fn(),
    getWorkflowHistory: vi.fn().mockReturnValue([]),
    getWorkflowStats: vi.fn(),
    prune: vi.fn().mockReturnValue({ snapshotsRemoved: 0, historyEntriesRemoved: 0 }),
    getDatabaseSize: vi.fn().mockReturnValue(0),
  };
}

function createMockSectionManager() {
  return {
    parseSections: vi.fn().mockReturnValue([]),
    computeHash: vi.fn((c: string) =>
      createHash('sha256').update(c).digest('hex').slice(0, 16),
    ),
    verifyHash: vi.fn().mockReturnValue(true),
    writeSectionFile: vi.fn(),
  };
}

function makeSnapshot(filePath: string, content: string, source: 'roadie' | 'human' = 'roadie') {
  return {
    id: 1,
    filePath,
    content,
    contentHash: sha256(content),
    source,
    createdAt: new Date().toISOString(),
  };
}

// ---- Tests ----

describe('EditTracker', () => {
  let tracker: EditTracker;
  let mockDb: ReturnType<typeof createMockLearningDb>;
  let mockSm: ReturnType<typeof createMockSectionManager>;
  const config: EditTrackerConfig = { editTracking: true };
  const disabledConfig: EditTrackerConfig = { editTracking: false };
  const testFile = '/workspace/README.md';

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockLearningDb();
    mockSm = createMockSectionManager();
    tracker = new EditTracker(mockDb as any, mockSm as any);
  });

  // ---- trackEdit ----

  describe('trackEdit', () => {
    it('returns null when edit tracking is disabled', async () => {
      tracker.initialize(disabledConfig);
      const result = await tracker.trackEdit(testFile);
      expect(result).toBeNull();
      expect(mockReadFile).not.toHaveBeenCalled();
    });

    it('returns null when file content is unchanged', async () => {
      tracker.initialize(config);
      const content = '# Hello World\n';
      mockDb.getLatestSnapshot.mockReturnValue(makeSnapshot(testFile, content));
      mockReadFile.mockResolvedValue(content);

      const result = await tracker.trackEdit(testFile);
      expect(result).toBeNull();
      expect(mockDb.recordSnapshot).not.toHaveBeenCalled();
    });

    it('detects edits inside Roadie sections', async () => {
      tracker.initialize(config);
      const oldContent = '<!-- roadie:start:deps -->\nold deps\n<!-- roadie:end:deps -->\n';
      const newContent = '<!-- roadie:start:deps -->\nnew deps\n<!-- roadie:end:deps -->\n';

      mockDb.getLatestSnapshot.mockReturnValue(makeSnapshot(testFile, oldContent));
      mockReadFile.mockResolvedValue(newContent);

      // Return parsed sections for old and new content
      mockSm.parseSections
        .mockReturnValueOnce([{ id: 'deps', startLine: 0, endLine: 2, content: 'old deps', hash: null, fileType: 'markdown' }])
        .mockReturnValueOnce([{ id: 'deps', startLine: 0, endLine: 2, content: 'new deps', hash: null, fileType: 'markdown' }]);

      const result = await tracker.trackEdit(testFile);
      expect(result).not.toBeNull();
      expect(result!.editedSections).toContain('deps');
    });

    it('detects content added outside markers', async () => {
      tracker.initialize(config);
      const oldContent = '<!-- roadie:start:s1 -->\nstuff\n<!-- roadie:end:s1 -->\n';
      const newContent = '<!-- roadie:start:s1 -->\nstuff\n<!-- roadie:end:s1 -->\nextra line\n';

      mockDb.getLatestSnapshot.mockReturnValue(makeSnapshot(testFile, oldContent));
      mockReadFile.mockResolvedValue(newContent);

      mockSm.parseSections
        .mockReturnValueOnce([{ id: 's1', startLine: 0, endLine: 2, content: 'stuff', hash: null, fileType: 'markdown' }])
        .mockReturnValueOnce([{ id: 's1', startLine: 0, endLine: 2, content: 'stuff', hash: null, fileType: 'markdown' }]);

      const result = await tracker.trackEdit(testFile);
      expect(result).not.toBeNull();
      expect(result!.addedOutsideMarkers).toBe(true);
    });

    it('stores snapshot with source human', async () => {
      tracker.initialize(config);
      const oldContent = 'old';
      const newContent = 'new';

      mockDb.getLatestSnapshot.mockReturnValue(makeSnapshot(testFile, oldContent));
      mockReadFile.mockResolvedValue(newContent);

      await tracker.trackEdit(testFile);
      expect(mockDb.recordSnapshot).toHaveBeenCalledWith(testFile, newContent, 'human');
    });

    it('computes diff summary correctly', async () => {
      tracker.initialize(config);
      const oldContent = 'line1\nline2\nline3\n';
      const newContent = 'line1\nmodified\nline3\nnewline\n';

      mockDb.getLatestSnapshot.mockReturnValue(makeSnapshot(testFile, oldContent));
      mockReadFile.mockResolvedValue(newContent);

      const result = await tracker.trackEdit(testFile);
      expect(result).not.toBeNull();
      // 'line1\nline2\nline3\n' splits to ['line1','line2','line3',''] (4)
      // 'line1\nmodified\nline3\nnewline\n' splits to ['line1','modified','line3','newline',''] (5)
      // index 1: line2 vs modified = modified; index 3: '' vs 'newline' = modified => 2
      // index 4 is extra in new => 1 added
      expect(result!.diffSummary.linesModified).toBe(2);
      expect(result!.diffSummary.linesAdded).toBe(1);
      expect(result!.diffSummary.linesRemoved).toBe(0);
    });

    it('handles missing snapshot gracefully (first time tracking)', async () => {
      tracker.initialize(config);
      mockDb.getLatestSnapshot.mockReturnValue(null);
      mockReadFile.mockResolvedValue('some content');

      const result = await tracker.trackEdit(testFile);
      expect(result).toBeNull();
      // Should store initial snapshot
      expect(mockDb.recordSnapshot).toHaveBeenCalledWith(testFile, 'some content', 'human');
    });

    it('handles file read errors gracefully', async () => {
      tracker.initialize(config);
      mockDb.getLatestSnapshot.mockReturnValue(makeSnapshot(testFile, 'old'));
      mockReadFile.mockRejectedValue(new Error('ENOENT'));

      const result = await tracker.trackEdit(testFile);
      expect(result).toBeNull();
    });
  });

  // ---- hasHumanEdits ----

  describe('hasHumanEdits', () => {
    it('returns true when content has changed', async () => {
      tracker.initialize(config);
      mockDb.getLatestSnapshot.mockReturnValue(makeSnapshot(testFile, 'original'));
      mockReadFile.mockResolvedValue('modified');

      expect(await tracker.hasHumanEdits(testFile)).toBe(true);
    });

    it('returns false when content is unchanged', async () => {
      tracker.initialize(config);
      const content = 'same content';
      mockDb.getLatestSnapshot.mockReturnValue(makeSnapshot(testFile, content));
      mockReadFile.mockResolvedValue(content);

      expect(await tracker.hasHumanEdits(testFile)).toBe(false);
    });

    it('returns false when tracking is disabled', async () => {
      tracker.initialize(disabledConfig);
      expect(await tracker.hasHumanEdits(testFile)).toBe(false);
    });

    it('returns false when no snapshot exists', async () => {
      tracker.initialize(config);
      mockDb.getLatestSnapshot.mockReturnValue(null);

      expect(await tracker.hasHumanEdits(testFile)).toBe(false);
    });

    it('returns false when file read fails', async () => {
      tracker.initialize(config);
      mockDb.getLatestSnapshot.mockReturnValue(makeSnapshot(testFile, 'content'));
      mockReadFile.mockRejectedValue(new Error('EACCES'));

      expect(await tracker.hasHumanEdits(testFile)).toBe(false);
    });
  });

  // ---- getEditHistory ----

  describe('getEditHistory', () => {
    it('returns empty array', async () => {
      tracker.initialize(config);
      const history = await tracker.getEditHistory(testFile);
      expect(history).toEqual([]);
    });

    it('returns empty array with limit parameter', async () => {
      tracker.initialize(config);
      const history = await tracker.getEditHistory(testFile, 10);
      expect(history).toEqual([]);
    });
  });

  // ---- dispose ----

  describe('dispose', () => {
    it('is safe to call multiple times', () => {
      tracker.initialize(config);
      expect(() => {
        tracker.dispose();
        tracker.dispose();
        tracker.dispose();
      }).not.toThrow();
    });

    it('disables tracking after dispose', async () => {
      tracker.initialize(config);
      tracker.dispose();

      const result = await tracker.trackEdit(testFile);
      expect(result).toBeNull();
      expect(mockReadFile).not.toHaveBeenCalled();
    });
  });
});
