/**
 * @module file-generator
 * @description Orchestrates generation of all .github/ files and AGENTS.md.
 *   Reads project model, calls templates, uses section-manager for markers
 *   and hash comparison. Skips write if content identical. Creates
 *   .github/.roadie/.gitignore on first run.
 *   Records each written file as a snapshot in LearningDatabase (if available).
 * @inputs ProjectModel, workspace root path, optional LearningDatabase,
 *   optional FileSystemProvider
 * @outputs GeneratedFile[] with write status
 * @depends-on section-manager.ts, templates/*.ts, types.ts, shell/logger.ts,
 *   learning/learning-database.ts, providers.ts
 * @depended-on-by extension.ts, workflow completion hooks, mcp/tools/generator-tools.ts
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ProjectModel, GeneratedFile, GeneratedFileType } from '../types';
import { buildSectionedFile, hashContent, type GeneratedSection } from './section-manager';
import {
  generateCopilotInstructions,
  COPILOT_INSTRUCTIONS_PATH,
} from './templates/copilot-instructions';
import { generateAgentDefinitions, AGENTS_MD_PATH } from './templates/agent-definitions';
import type { LearningDatabase } from '../learning/learning-database';
import type { FileSystemProvider } from '../providers';
import { getLogger } from '../shell/logger';

interface FileSpec {
  type: GeneratedFileType;
  path: string;
  generate: (model: ProjectModel) => GeneratedSection[];
}

const FILE_SPECS: FileSpec[] = [
  {
    type:     'copilot_instructions',
    path:     COPILOT_INSTRUCTIONS_PATH,
    generate: generateCopilotInstructions,
  },
  {
    type:     'agents_md',
    path:     AGENTS_MD_PATH,
    generate: generateAgentDefinitions,
  },
];

export class FileGenerator {
  private fileSystem: FileSystemProvider | null;

  constructor(
    private workspaceRoot: string,
    private learningDb?: LearningDatabase,
    fileSystem?: FileSystemProvider,
  ) {
    this.fileSystem = fileSystem ?? null;
  }

  /**
   * Check if a file is open in an editor (deferred write check).
   * In standalone mode (no FileSystemProvider), always returns false.
   */
  private isFileOpenInEditor(filePath: string): boolean {
    if (!this.fileSystem) return false;
    return this.fileSystem.isFileOpenInEditor(filePath);
  }

  /**
   * Generate all managed files. Returns results indicating what was written.
   */
  async generateAll(model: ProjectModel): Promise<GeneratedFile[]> {
    await this.ensureGitignore();

    const results: GeneratedFile[] = [];
    for (const spec of FILE_SPECS) {
      const result = await this.generateFile(spec, model);
      results.push(result);
    }
    return results;
  }

  /**
   * Generate a single file type.
   */
  async generate(fileType: GeneratedFileType, model: ProjectModel): Promise<GeneratedFile> {
    const spec = FILE_SPECS.find((s) => s.type === fileType);
    if (!spec) {
      getLogger().warn(`FileGenerator: unknown file type "${fileType}" — skipping`);
      return {
        type:        fileType,
        path:        '',
        content:     '',
        contentHash: '',
        written:     false,
      };
    }
    await this.ensureGitignore();
    return this.generateFile(spec, model);
  }

  private async generateFile(spec: FileSpec, model: ProjectModel): Promise<GeneratedFile> {
    const log = getLogger();
    log.debug(`FileGenerator: generating ${spec.type} → ${spec.path}`);

    // 1. Generate sections from template
    const sections = spec.generate(model);
    const content  = buildSectionedFile(sections);
    const newHash  = hashContent(content);

    // 2. Read existing file (if any)
    const fullPath = path.join(this.workspaceRoot, spec.path);
    let existingContent: string | null = null;
    try {
      existingContent = await fs.readFile(fullPath, 'utf8');
    } catch {
      // File doesn't exist yet — will be written fresh
    }

    // 3. Hash-compare — skip write if identical
    if (existingContent !== null && hashContent(existingContent) === newHash) {
      log.debug(`FileGenerator: ${spec.type} unchanged — skipped`);
      return {
        type:        spec.type,
        path:        spec.path,
        content:     existingContent,
        contentHash: `sha256:${newHash}`,
        written:     false,
      };
    }

    // 4. Skip write if file is open in editor (deferred write)
    if (this.isFileOpenInEditor(fullPath)) {
      log.debug(`FileGenerator: ${spec.type} is open in editor — deferring write`);
      return {
        type:        spec.type,
        path:        spec.path,
        content,
        contentHash: `sha256:${newHash}`,
        written:     false,
      };
    }

    // 5. Write file
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf8');

    const kb = (Buffer.byteLength(content, 'utf8') / 1024).toFixed(1);
    log.info(`FileGenerator: wrote ${spec.path} (${kb} KB)`);

    // 6. Record snapshot in LearningDatabase (if available)
    if (this.learningDb) {
      try {
        this.learningDb.recordSnapshot(spec.path, content, 'roadie');
        log.debug(`FileGenerator: snapshot recorded for ${spec.path}`);
      } catch (err) {
        log.warn(`FileGenerator: failed to record snapshot for ${spec.path}`, err);
      }
    }

    return {
      type:        spec.type,
      path:        spec.path,
      content,
      contentHash: `sha256:${newHash}`,
      written:     true,
    };
  }

  /**
   * Ensure .github/.roadie/.gitignore exists with database exclusion.
   */
  private async ensureGitignore(): Promise<void> {
    const log = getLogger();
    const gitignorePath = path.join(this.workspaceRoot, '.github', '.roadie', '.gitignore');
    try {
      await fs.access(gitignorePath);
      log.debug('FileGenerator: .github/.roadie/.gitignore already exists');
    } catch {
      await fs.mkdir(path.dirname(gitignorePath), { recursive: true });
      await fs.writeFile(gitignorePath, 'project-model.db\n*.db-journal\n', 'utf8');
      log.info('FileGenerator: created .github/.roadie/.gitignore');
    }
  }
}
