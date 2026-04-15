import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  FileGeneratorManager,
  type FileTypeGenerator,
  type GeneratedContent,
  type GenerationResult,
} from './file-generator-manager.js';
import type { ProjectModel, ProjectModelDelta } from '../types.js';

// ---- Mock helpers ----

function createMockGenerator(
  fileType: string,
  triggers: string[],
  delay = 0,
): FileTypeGenerator {
  return {
    fileType,
    triggers,
    generate: vi.fn().mockImplementation(async (): Promise<GeneratedContent> => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      return {
        filePath: `.github/${fileType}.md`,
        sections: [{ id: 'test', content: 'generated content' }],
      };
    }),
  };
}

const mockSectionManager = {
  writeSectionFile: vi.fn().mockResolvedValue({
    written: true,
    deferred: false,
    contentHash: 'abc123',
    mergeConflicts: [],
  }),
  parseSections: vi.fn().mockReturnValue([]),
  computeHash: vi.fn().mockReturnValue('hash'),
  verifyHash: vi.fn().mockReturnValue(true),
};

const mockLearningDb = {
  recordSnapshot: vi.fn(),
  initialize: vi.fn(),
  close: vi.fn(),
  getSnapshots: vi.fn().mockReturnValue([]),
  getLatestSnapshot: vi.fn().mockReturnValue(null),
};

const mockModel = {
  getTechStack: vi.fn().mockReturnValue([]),
  getDirectoryStructure: vi.fn().mockReturnValue({ path: '', type: 'directory', children: [] }),
  getPatterns: vi.fn().mockReturnValue([]),
  getPreferences: vi.fn().mockReturnValue({ telemetryEnabled: false, autoCommit: false }),
  getCommands: vi.fn().mockReturnValue([]),
  toContext: vi.fn().mockReturnValue({ techStack: [], directoryStructure: { path: '', type: 'directory' }, patterns: [], commands: [], serialized: '' }),
  update: vi.fn(),
} as unknown as ProjectModel;

// ---- Tests ----

describe('FileGeneratorManager', () => {
  let manager: FileGeneratorManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new FileGeneratorManager(
      mockSectionManager as any,
      mockLearningDb as any,
      { timeoutMs: 500 },
    );
  });

  describe('register', () => {
    it('adds generator to registry', () => {
      const gen = createMockGenerator('copilot_instructions', ['techStack']);
      manager.register(gen);
      expect(manager.getRegisteredTypes()).toEqual(['copilot_instructions']);
    });

    it('allows multiple generators', () => {
      manager.register(createMockGenerator('copilot_instructions', ['techStack']));
      manager.register(createMockGenerator('agents_md', ['patterns']));
      expect(manager.getRegisteredTypes()).toHaveLength(2);
    });
  });

  describe('generate', () => {
    it('runs single generator and returns result', async () => {
      manager.register(createMockGenerator('copilot_instructions', ['techStack']));
      const result = await manager.generate('copilot_instructions', mockModel);

      expect(result.fileType).toBe('copilot_instructions');
      expect(result.filePath).toBe('.github/copilot_instructions.md');
      expect(result.written).toBe(true);
      expect(result.deferred).toBe(false);
      expect(result.contentHash).toBe('abc123');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });

    it('returns error for unknown generator', async () => {
      const result = await manager.generate('nonexistent', mockModel);
      expect(result.written).toBe(false);
      expect(result.error?.code).toBe('UNKNOWN_GENERATOR');
    });

    it('calls sectionManager.writeSectionFile with generated content', async () => {
      manager.register(createMockGenerator('agents_md', ['patterns']));
      await manager.generate('agents_md', mockModel);

      expect(mockSectionManager.writeSectionFile).toHaveBeenCalledWith(
        '.github/agents_md.md',
        [{ id: 'test', content: 'generated content' }],
      );
    });
  });

  describe('generateAll', () => {
    it('runs all generators in parallel', async () => {
      const gen1 = createMockGenerator('copilot_instructions', ['techStack']);
      const gen2 = createMockGenerator('agents_md', ['patterns']);
      manager.register(gen1);
      manager.register(gen2);

      const results = await manager.generateAll(mockModel);
      expect(results).toHaveLength(2);
      expect(gen1.generate).toHaveBeenCalledOnce();
      expect(gen2.generate).toHaveBeenCalledOnce();
    });

    it('returns results for all generators even if one fails', async () => {
      const goodGen = createMockGenerator('copilot_instructions', ['techStack']);
      const badGen: FileTypeGenerator = {
        fileType: 'agents_md',
        triggers: ['patterns'],
        generate: vi.fn().mockRejectedValue(new Error('generation failed')),
      };
      manager.register(goodGen);
      manager.register(badGen);

      const results = await manager.generateAll(mockModel);
      expect(results).toHaveLength(2);

      const good = results.find(r => r.fileType === 'copilot_instructions');
      const bad = results.find(r => r.fileType === 'agents_md');
      expect(good?.written).toBe(true);
      expect(bad?.written).toBe(false);
      expect(bad?.error?.code).toBe('GENERATOR_ERROR');
    });
  });

  describe('onModelChanged', () => {
    it('triggers correct generators based on delta keys', async () => {
      const techGen = createMockGenerator('copilot_instructions', ['techStack']);
      const patternGen = createMockGenerator('agents_md', ['patterns']);
      manager.register(techGen);
      manager.register(patternGen);

      const delta: ProjectModelDelta = { techStack: [] };
      await manager.onModelChanged(delta, mockModel);

      expect(techGen.generate).toHaveBeenCalledOnce();
      expect(patternGen.generate).not.toHaveBeenCalled();
    });

    it('skips generators with no matching triggers', async () => {
      const gen = createMockGenerator('copilot_instructions', ['techStack']);
      manager.register(gen);

      const delta: ProjectModelDelta = { patterns: [] };
      await manager.onModelChanged(delta, mockModel);

      expect(gen.generate).not.toHaveBeenCalled();
    });

    it('triggers multiple generators when delta has multiple keys', async () => {
      const gen1 = createMockGenerator('copilot_instructions', ['techStack']);
      const gen2 = createMockGenerator('agents_md', ['patterns']);
      manager.register(gen1);
      manager.register(gen2);

      const delta: ProjectModelDelta = { techStack: [], patterns: [] };
      await manager.onModelChanged(delta, mockModel);

      expect(gen1.generate).toHaveBeenCalledOnce();
      expect(gen2.generate).toHaveBeenCalledOnce();
    });

    it('does nothing for empty delta', async () => {
      const gen = createMockGenerator('copilot_instructions', ['techStack']);
      manager.register(gen);

      await manager.onModelChanged({}, mockModel);
      expect(gen.generate).not.toHaveBeenCalled();
    });
  });

  describe('timeout', () => {
    it('returns timeout error when generator exceeds timeout', async () => {
      const slowGen = createMockGenerator('copilot_instructions', ['techStack'], 1000);
      manager.register(slowGen);

      const result = await manager.generate('copilot_instructions', mockModel);
      expect(result.written).toBe(false);
      expect(result.error?.code).toBe('GENERATOR_TIMEOUT');
      expect(result.durationMs).toBeGreaterThanOrEqual(400);
    });
  });

  describe('deferred writes', () => {
    it('tracks deferred writes when section manager returns deferred=true', async () => {
      mockSectionManager.writeSectionFile.mockResolvedValueOnce({
        written: false,
        deferred: true,
        reason: 'mtime_changed',
        contentHash: 'def456',
        mergeConflicts: [],
      });

      manager.register(createMockGenerator('copilot_instructions', ['techStack']));
      const result = await manager.generate('copilot_instructions', mockModel);

      expect(result.deferred).toBe(true);
      expect(manager.getDeferredWrites().has('.github/copilot_instructions.md')).toBe(true);
    });

    it('processDeferredWrite flushes pending write', async () => {
      mockSectionManager.writeSectionFile.mockResolvedValueOnce({
        written: false,
        deferred: true,
        reason: 'mtime_changed',
        contentHash: 'def456',
        mergeConflicts: [],
      });

      manager.register(createMockGenerator('copilot_instructions', ['techStack']));
      await manager.generate('copilot_instructions', mockModel);

      // Reset mock for the deferred write call
      mockSectionManager.writeSectionFile.mockResolvedValueOnce({
        written: true,
        deferred: false,
        contentHash: 'def456',
        mergeConflicts: [],
      });

      await manager.processDeferredWrite('.github/copilot_instructions.md');

      expect(mockSectionManager.writeSectionFile).toHaveBeenCalledTimes(2);
      expect(manager.getDeferredWrites().has('.github/copilot_instructions.md')).toBe(false);
    });

    it('processDeferredWrite does nothing for unknown path', async () => {
      await manager.processDeferredWrite('/unknown/path.md');
      expect(mockSectionManager.writeSectionFile).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('handles generator that throws error gracefully', async () => {
      const failGen: FileTypeGenerator = {
        fileType: 'skills',
        triggers: ['techStack'],
        generate: vi.fn().mockRejectedValue(new Error('something broke')),
      };
      manager.register(failGen);

      const result = await manager.generate('skills', mockModel);
      expect(result.written).toBe(false);
      expect(result.error?.code).toBe('GENERATOR_ERROR');
      expect(result.error?.message).toBe('something broke');
    });
  });

  describe('learning DB', () => {
    it('records snapshot on successful write', async () => {
      manager.register(createMockGenerator('copilot_instructions', ['techStack']));
      await manager.generate('copilot_instructions', mockModel);

      expect(mockLearningDb.recordSnapshot).toHaveBeenCalledWith(
        '.github/copilot_instructions.md',
        'generated content',
        'roadie',
      );
    });

    it('does not record snapshot when write is deferred', async () => {
      mockSectionManager.writeSectionFile.mockResolvedValueOnce({
        written: false,
        deferred: true,
        reason: 'mtime_changed',
        contentHash: 'def456',
        mergeConflicts: [],
      });

      manager.register(createMockGenerator('agents_md', ['patterns']));
      await manager.generate('agents_md', mockModel);

      expect(mockLearningDb.recordSnapshot).not.toHaveBeenCalled();
    });

    it('does not fail if learning DB throws', async () => {
      mockLearningDb.recordSnapshot.mockImplementationOnce(() => {
        throw new Error('DB error');
      });

      manager.register(createMockGenerator('copilot_instructions', ['techStack']));
      const result = await manager.generate('copilot_instructions', mockModel);

      // Should still report success despite DB error
      expect(result.written).toBe(true);
    });
  });

  describe('getRegisteredTypes', () => {
    it('returns all registered types', () => {
      manager.register(createMockGenerator('copilot_instructions', ['techStack']));
      manager.register(createMockGenerator('agents_md', ['patterns']));
      manager.register(createMockGenerator('skills', ['commands']));

      const types = manager.getRegisteredTypes();
      expect(types).toEqual(['copilot_instructions', 'agents_md', 'skills']);
    });

    it('returns empty array when no generators registered', () => {
      expect(manager.getRegisteredTypes()).toEqual([]);
    });
  });

  describe('simplified retry', () => {
    it('retry passes simplified=true to generator.generate', async () => {
      let callCount = 0;
      const failThenSucceedGen: FileTypeGenerator = {
        fileType: 'copilot_instructions',
        triggers: ['techStack'],
        generate: vi.fn().mockImplementation(async (_model, options) => {
          callCount++;
          if (callCount === 1) throw new Error('first attempt fails');
          // On retry, options.simplified should be true
          return {
            filePath: '.github/copilot_instructions.md',
            sections: [{ id: 'test', content: `simplified=${options?.simplified ?? false}` }],
          };
        }),
      };
      manager.register(failThenSucceedGen);

      const result = await manager.generate('copilot_instructions', mockModel);
      expect(callCount).toBe(2);
      expect(failThenSucceedGen.generate).toHaveBeenNthCalledWith(2, mockModel, { simplified: true });
      expect(result.written).toBe(true);
    });
  });

  describe('dispose', () => {
    it('clears generators and deferred writes', () => {
      manager.register(createMockGenerator('copilot_instructions', ['techStack']));
      manager.dispose();

      expect(manager.getRegisteredTypes()).toEqual([]);
      expect(manager.getDeferredWrites().size).toBe(0);
    });
  });
});
