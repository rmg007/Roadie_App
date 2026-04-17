/**
 * @module file-generator-manager
 * @description Phase 1.5 orchestrator (M19). Subscribes to model changes
 *   and triggers appropriate file generators through the section manager.
 *   Supports per-generator timeouts, deferred writes, and learning DB snapshots.
 * @depends-on section-manager-service, learning-database, types
 * @depended-on-by chat-participant-handler, file-watcher-manager
 */

import type { ProjectModel, ProjectModelDelta } from '../types.js';
import type { SectionManagerService, WriteSectionResult } from './section-manager-service.js';
import type { GeneratedSection } from './section-manager.js';
import type { LearningDatabase } from '../learning/learning-database.js';

// =====================================================================
// Public types
// =====================================================================

export type GeneratedFileType =
  | 'copilot_instructions' | 'agents_md' | 'path_instructions'
  | 'agent_definitions' | 'skills' | 'hooks'
  | 'workflows' | 'templates' | 'codebase_dictionary';

export interface GenerationResult {
  fileType: string;
  filePath: string;
  written: boolean;
  merged: boolean;
  deferred: boolean;
  contentHash: string;
  durationMs: number;
  error?: { code: string; message: string };
}

export interface FileTypeGenerator {
  fileType: string;
  triggers: string[];
  generate(model: ProjectModel, options?: { simplified?: boolean }): Promise<GeneratedContent>;
}

export interface GeneratedContent {
  filePath: string;
  sections: GeneratedSection[];
}

// =====================================================================
// Constants
// =====================================================================

const DEFAULT_TIMEOUT_MS = 2000;

// =====================================================================
// FileGeneratorManager
// =====================================================================

export class FileGeneratorManager {
  private generators: Map<string, FileTypeGenerator> = new Map();
  private deferredWrites: Map<string, GeneratedSection[]> = new Map();
  private timeoutMs: number;

  constructor(
    private sectionManager: SectionManagerService,
    private learningDb?: LearningDatabase,
    options?: { timeoutMs?: number },
  ) {
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Register a file type generator. */
  register(generator: FileTypeGenerator): void {
    this.generators.set(generator.fileType, generator);
  }

  /** Run a single generator through the full pipeline.
   *  If the first attempt fails, retries with { simplified: true } to emit
   *  only required sections, preventing files from being left empty.
   */
  async generate(fileType: string, model: ProjectModel, options?: { simplified?: boolean }): Promise<GenerationResult> {
    const generator = this.generators.get(fileType);
    if (!generator) {
      return {
        fileType,
        filePath: '',
        written: false,
        merged: false,
        deferred: false,
        contentHash: '',
        durationMs: 0,
        error: { code: 'UNKNOWN_GENERATOR', message: `No generator registered for '${fileType}'` },
      };
    }

    const start = Date.now();

    try {
      // Run generator with timeout
      const content = await Promise.race<GeneratedContent>([
        generator.generate(model, options),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('GENERATOR_TIMEOUT')), this.timeoutMs),
        ),
      ]);

      // Write through section manager
      const writeResult: WriteSectionResult = await this.sectionManager.writeSectionFile(
        content.filePath,
        content.sections,
      );

      const durationMs = Date.now() - start;

      // Track deferred writes
      if (writeResult.deferred) {
        this.deferredWrites.set(content.filePath, content.sections);
      }

      // Record snapshot to learning DB on successful write
      if (writeResult.written && this.learningDb) {
        try {
          const combinedContent = content.sections.map(s => s.content).join('\n');
          this.learningDb.recordSnapshot(content.filePath, combinedContent, 'roadie');
        } catch {
          // Learning DB failures should not break generation
        }
      }

      return {
        fileType,
        filePath: content.filePath,
        written: writeResult.written,
        merged: writeResult.mergeConflicts.length > 0,
        deferred: writeResult.deferred,
        contentHash: writeResult.contentHash,
        durationMs,
      };
    } catch (err: unknown) {
      const durationMs = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      const code = message === 'GENERATOR_TIMEOUT' ? 'GENERATOR_TIMEOUT' : 'GENERATOR_ERROR';

      // Self-healing retry: if this is the first attempt, retry with simplified=true
      if (!options?.simplified) {
        return this.generate(fileType, model, { simplified: true });
      }

      return {
        fileType,
        filePath: '',
        written: false,
        merged: false,
        deferred: false,
        contentHash: '',
        durationMs,
        error: { code, message },
      };
    }
  }

  /** Run all registered generators in parallel. */
  async generateAll(model: ProjectModel): Promise<GenerationResult[]> {
    const fileTypes = Array.from(this.generators.keys());
    const settled = await Promise.allSettled(
      fileTypes.map(ft => this.generate(ft, model)),
    );

    return settled.map((result, i) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      return {
        fileType: fileTypes[i] ?? '',
        filePath: '',
        written: false,
        merged: false,
        deferred: false,
        contentHash: '',
        durationMs: 0,
        error: { code: 'GENERATOR_ERROR', message: String(result.reason) },
      };
    });
  }

  /** Handle a model change by triggering generators whose triggers match delta keys. */
  async onModelChanged(delta: ProjectModelDelta, model: ProjectModel): Promise<void> {
    const changedKeys = Object.keys(delta).filter(
      k => delta[k as keyof ProjectModelDelta] !== undefined,
    );

    if (changedKeys.length === 0) return;

    const toRun = new Set<string>();
    for (const generator of this.generators.values()) {
      for (const trigger of generator.triggers) {
        if (changedKeys.includes(trigger)) {
          toRun.add(generator.fileType);
          break;
        }
      }
    }

    if (toRun.size === 0) return;

    await Promise.allSettled(
      Array.from(toRun).map(ft => this.generate(ft, model)),
    );
  }

  /** Process a deferred write (e.g., when file is saved in editor). */
  async processDeferredWrite(filePath: string): Promise<void> {
    const sections = this.deferredWrites.get(filePath);
    if (!sections) return;

    this.deferredWrites.delete(filePath);
    await this.sectionManager.writeSectionFile(filePath, sections);
  }

  /** Return all registered generator type names. */
  getRegisteredTypes(): string[] {
    return Array.from(this.generators.keys());
  }

  /** Get the current deferred writes map (for testing/inspection). */
  getDeferredWrites(): Map<string, GeneratedSection[]> {
    return this.deferredWrites;
  }

  /** Clean up resources. */
  dispose(): void {
    this.generators.clear();
    this.deferredWrites.clear();
  }
}
