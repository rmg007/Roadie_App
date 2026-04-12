/**
 * @module file-generator
 * @description Orchestrates generation of all .github/ files and AGENTS.md.
 *   Reads project model, calls templates, uses section-manager for markers
 *   and hash comparison. Skips write if content identical. Creates
 *   .github/.roadie/.gitignore on first run.
 * @inputs ProjectModel, workspace root path
 * @outputs GeneratedFile[] with write status
 * @depends-on section-manager.ts, templates/*.ts, types.ts
 * @depended-on-by extension.ts, workflow completion hooks
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

interface FileSpec {
  type: GeneratedFileType;
  path: string;
  generate: (model: ProjectModel) => GeneratedSection[];
}

const FILE_SPECS: FileSpec[] = [
  {
    type: 'copilot_instructions',
    path: COPILOT_INSTRUCTIONS_PATH,
    generate: generateCopilotInstructions,
  },
  {
    type: 'agents_md',
    path: AGENTS_MD_PATH,
    generate: generateAgentDefinitions,
  },
];

export class FileGenerator {
  constructor(private workspaceRoot: string) {}

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
      return {
        type: fileType,
        path: '',
        content: '',
        contentHash: '',
        written: false,
      };
    }
    await this.ensureGitignore();
    return this.generateFile(spec, model);
  }

  private async generateFile(spec: FileSpec, model: ProjectModel): Promise<GeneratedFile> {
    // 1. Generate sections from template
    const sections = spec.generate(model);
    const content = buildSectionedFile(sections);
    const newHash = hashContent(content);

    // 2. Read existing file (if any)
    const fullPath = path.join(this.workspaceRoot, spec.path);
    let existingContent: string | null = null;
    try {
      existingContent = await fs.readFile(fullPath, 'utf8');
    } catch {
      // File doesn't exist yet
    }

    // 3. Hash-compare — skip write if identical
    if (existingContent !== null && hashContent(existingContent) === newHash) {
      return {
        type: spec.type,
        path: spec.path,
        content: existingContent,
        contentHash: `sha256:${newHash}`,
        written: false,
      };
    }

    // 4. Write file
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf8');

    return {
      type: spec.type,
      path: spec.path,
      content,
      contentHash: `sha256:${newHash}`,
      written: true,
    };
  }

  /**
   * Ensure .github/.roadie/.gitignore exists with database exclusion.
   */
  private async ensureGitignore(): Promise<void> {
    const gitignorePath = path.join(this.workspaceRoot, '.github', '.roadie', '.gitignore');
    try {
      await fs.access(gitignorePath);
    } catch {
      await fs.mkdir(path.dirname(gitignorePath), { recursive: true });
      await fs.writeFile(gitignorePath, 'project-model.db\n*.db-journal\n', 'utf8');
    }
  }
}
