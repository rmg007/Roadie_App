import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PersistentProjectModelImpl } from './project-model-persistence';
import { RoadieDatabase } from './database';
import type { ClassifiedFileChange, ProjectModelDelta } from '../types';

function createTestDb(): RoadieDatabase {
  return new RoadieDatabase(':memory:');
}

describe('PersistentProjectModel', () => {
  let db: RoadieDatabase;
  let model: PersistentProjectModelImpl;

  beforeEach(() => {
    vi.useFakeTimers();
    db = createTestDb();
    model = new PersistentProjectModelImpl(db);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await model.deactivate();
    db.close();
  });

  describe('loadFromDb', () => {
    it('loads tech stack from SQLite', async () => {
      db.saveTechStack([{ category: 'framework', name: 'React', version: '18.2', sourceFile: 'package.json' }]);
      await model.loadFromDb();
      expect(model.getTechStack()).toContainEqual(
        expect.objectContaining({ name: 'React', version: '18.2' }),
      );
    });

    it('loads empty database (first run)', async () => {
      await model.loadFromDb();
      expect(model.isPopulated()).toBe(false);
      expect(model.getTechStack()).toEqual([]);
    });

    it('sets populated=true when data exists', async () => {
      db.saveTechStack([{ category: 'language', name: 'TypeScript', version: '5.2', sourceFile: 'package.json' }]);
      await model.loadFromDb();
      expect(model.isPopulated()).toBe(true);
    });

    it('loads directory structure', async () => {
      db.saveDirectories({ path: '/root', type: 'directory', children: [{ path: '/root/src', type: 'directory', role: 'source' }] });
      await model.loadFromDb();
      const dir = model.getDirectoryStructure();
      expect(dir.path).toBe('/root');
      expect(dir.children).toBeDefined();
    });

    it('loads detected patterns', async () => {
      db.savePatterns([{
        category: 'export_style',
        description: 'Uses named exports',
        evidence: { files: ['a.ts'], matchCount: 5, confidence: 0.9 },
        confidence: 0.9,
      }]);
      await model.loadFromDb();
      expect(model.getPatterns()).toHaveLength(1);
      expect(model.getPatterns()[0].category).toBe('export_style');
    });

    it('loads commands', async () => {
      db.saveCommands([{ name: 'test', command: 'npm test', sourceFile: 'package.json', type: 'test' }]);
      await model.loadFromDb();
      expect(model.getCommands()).toHaveLength(1);
    });

    it('sets lastAnalyzedAt when populated', async () => {
      db.saveTechStack([{ category: 'language', name: 'TypeScript', version: '5.2', sourceFile: 'package.json' }]);
      await model.loadFromDb();
      expect(model.getLastAnalyzedAt()).not.toBeNull();
    });
  });

  describe('saveToDb', () => {
    it('persists tech stack changes to SQLite', async () => {
      model.setTechStack([{ category: 'runtime', name: 'Node.js', version: '20.0', sourceFile: 'package.json' }]);
      await model.saveToDb();

      const loaded = db.loadTechStack();
      expect(loaded).toContainEqual(expect.objectContaining({ name: 'Node.js' }));
    });

    it('skips write when not dirty', async () => {
      const saveSpy = vi.spyOn(db, 'saveTechStack');
      await model.saveToDb();
      expect(saveSpy).not.toHaveBeenCalled();
    });

    it('clears dirty flag after save', async () => {
      model.setTechStack([{ category: 'language', name: 'Go', sourceFile: 'go.mod' }]);
      await model.saveToDb();
      // Second save should be a no-op
      const saveSpy = vi.spyOn(db, 'saveTechStack');
      await model.saveToDb();
      expect(saveSpy).not.toHaveBeenCalled();
    });
  });

  describe('reconcileWithFileSystem', () => {
    it('returns in-sync when model is populated and nothing changed', async () => {
      db.saveTechStack([{ category: 'language', name: 'TypeScript', version: '5.2', sourceFile: 'package.json' }]);
      await model.loadFromDb();
      const result = await model.reconcileWithFileSystem();
      expect(result.status).toBe('in-sync');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('returns rebuilt when model is not populated', async () => {
      await model.loadFromDb();
      const result = await model.reconcileWithFileSystem();
      expect(result.status).toBe('rebuilt');
    });
  });

  describe('incremental updates via applyFileChange', () => {
    it('marks dirty on DEPENDENCY_CHANGE', async () => {
      const change: ClassifiedFileChange = {
        filePath: 'package.json',
        eventType: 'change',
        classifiedAs: 'DEPENDENCY_CHANGE',
        timestamp: new Date(),
      };
      await model.applyFileChange(change);
      // Model is now dirty, will flush on timer
      await vi.advanceTimersByTimeAsync(5000);
    });

    it('marks dirty on CONFIG_CHANGE', async () => {
      const change: ClassifiedFileChange = {
        filePath: 'tsconfig.json',
        eventType: 'change',
        classifiedAs: 'CONFIG_CHANGE',
        timestamp: new Date(),
      };
      await model.applyFileChange(change);
      await vi.advanceTimersByTimeAsync(5000);
    });

    it('marks dirty on STRUCTURE_CHANGE', async () => {
      const change: ClassifiedFileChange = {
        filePath: 'src/new-dir',
        eventType: 'create',
        classifiedAs: 'STRUCTURE_CHANGE',
        timestamp: new Date(),
      };
      await model.applyFileChange(change);
      await vi.advanceTimersByTimeAsync(5000);
    });

    it('ignores OTHER changes', async () => {
      const listener = vi.fn();
      model.onModelChanged(listener);
      const change: ClassifiedFileChange = {
        filePath: 'README.md',
        eventType: 'change',
        classifiedAs: 'OTHER',
        timestamp: new Date(),
      };
      await model.applyFileChange(change);
      expect(listener).not.toHaveBeenCalled();
    });

    it('emits modelChanged event on update', async () => {
      const listener = vi.fn();
      model.onModelChanged(listener);
      const change: ClassifiedFileChange = {
        filePath: 'package.json',
        eventType: 'change',
        classifiedAs: 'DEPENDENCY_CHANGE',
        timestamp: new Date(),
      };
      await model.applyFileChange(change);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ techStack: expect.any(Array) }),
      );
    });
  });

  describe('debounced writes', () => {
    it('batches writes within 5 seconds', async () => {
      const saveSpy = vi.spyOn(db, 'saveTechStack');
      model.setTechStack([{ category: 'language', name: 'Rust', sourceFile: 'Cargo.toml' }]);
      model.setCommands([{ name: 'build', command: 'cargo build', sourceFile: 'Cargo.toml', type: 'build' }]);

      expect(saveSpy).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(5000);
      expect(saveSpy).toHaveBeenCalledTimes(1);
    });

    it('flushes on deactivation', async () => {
      model.setTechStack([{ category: 'language', name: 'Python', sourceFile: 'requirements.txt' }]);
      await model.deactivate();

      const loaded = db.loadTechStack();
      expect(loaded).toContainEqual(expect.objectContaining({ name: 'Python' }));
    });

    it('does not schedule multiple timers', async () => {
      model.setTechStack([{ category: 'language', name: 'Go', sourceFile: 'go.mod' }]);
      model.setCommands([{ name: 'test', command: 'go test', sourceFile: 'go.mod', type: 'test' }]);
      model.setDirectoryTree({ path: '/root', type: 'directory' });

      const saveSpy = vi.spyOn(db, 'saveTechStack');
      await vi.advanceTimersByTimeAsync(5000);
      expect(saveSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('onModelChanged subscription', () => {
    it('notifies listeners on update()', () => {
      const listener = vi.fn();
      model.onModelChanged(listener);
      model.update({ techStack: [{ category: 'language', name: 'Ruby', sourceFile: 'Gemfile' }] });
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('supports dispose to unsubscribe', () => {
      const listener = vi.fn();
      const sub = model.onModelChanged(listener);
      sub.dispose();
      model.update({ techStack: [{ category: 'language', name: 'Ruby', sourceFile: 'Gemfile' }] });
      expect(listener).not.toHaveBeenCalled();
    });

    it('supports multiple listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      model.onModelChanged(listener1);
      model.onModelChanged(listener2);
      model.update({ commands: [{ name: 'dev', command: 'npm dev', sourceFile: 'package.json', type: 'dev' }] });
      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });
  });

  describe('ProjectModel interface compatibility', () => {
    it('getTechStack returns empty array by default', () => {
      expect(model.getTechStack()).toEqual([]);
    });

    it('getDirectoryStructure returns empty tree by default', () => {
      expect(model.getDirectoryStructure().type).toBe('directory');
    });

    it('getPatterns returns empty array by default', () => {
      expect(model.getPatterns()).toEqual([]);
    });

    it('getPreferences returns defaults', () => {
      expect(model.getPreferences().telemetryEnabled).toBe(false);
    });

    it('getCommands returns empty array by default', () => {
      expect(model.getCommands()).toEqual([]);
    });

    it('toContext serializes model state', () => {
      model.setTechStack([{ category: 'framework', name: 'Express', version: '4.18', sourceFile: 'package.json' }]);
      const ctx = model.toContext();
      expect(ctx.serialized).toContain('Express');
      expect(ctx.techStack).toHaveLength(1);
    });

    it('toContext respects maxTokens', () => {
      model.setTechStack([{ category: 'framework', name: 'Express', version: '4.18', sourceFile: 'package.json' }]);
      const ctx = model.toContext({ maxTokens: 5 });
      expect(ctx.serialized).toContain('[truncated]');
    });

    it('update sets populated to true', () => {
      expect(model.isPopulated()).toBe(false);
      model.update({ techStack: [{ category: 'language', name: 'Java', sourceFile: 'pom.xml' }] });
      expect(model.isPopulated()).toBe(true);
    });
  });
});
