/**
 * @module file-generator
 * @description Orchestrates generation of all .roadie/ files and AGENTS.md.
 *   Reads project model, calls templates, uses section-manager for markers
 *   and hash comparison. Skips write if content identical. Creates
 *   .roadie/.gitignore on first run.
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
import type { ProjectModel, GeneratedFile, GeneratedFileType, WriteReason } from '../types';
import type { LearningDatabase } from '../learning/learning-database';
import { buildSectionedFile, hashContent, type GeneratedSection } from './section-manager';
import { generateCopilotInstructions } from './templates/copilot-instructions';
import { generateAgentDefinitions } from './templates/agent-definitions';
import { generateClaudeMd } from './templates/claude-md';
import { generateOperatingRules } from './templates/operating-rules';
import { generateProjectModelJson } from './templates/project-model-json';
import { generatePromptsMd } from './templates/prompts-md';
import { generateGranularAgents } from './templates/granular-agents';
import { FrontendDesignSkill } from './templates/frontend-design';
import { EngineeringRigorSkill } from './templates/engineering-rigor';
import {
  AGENTS_MD_PATH,
  CLAUDE_MD_PATH,
  OPERATING_RULES_PATH,
  PROJECT_MODEL_JSON_PATH,
  PROMPTS_MD_PATH,
  ROADIE_INSTRUCTIONS_PATH,
  ROADIE_OUTPUT_DIR,
} from './output-paths';
import type { FileSystemProvider } from '../providers';
import type { Logger } from '../platform-adapters';
import { CONSOLE_LOGGER } from '../platform-adapters';
import { getConfig } from '../config-loader';
import { getAuditLog } from '../observability/audit-log';

interface FileSpec {
  type: GeneratedFileType;
  path: string;
  generate: (model: ProjectModel) => GeneratedSection[];
  /** Optional preamble prepended before the roadie marker block */
  preamble?: () => string;
}

export class FileGenerator {
  private fileSystem: FileSystemProvider | null;
  private fileSpecs: FileSpec[];

  constructor(
    private workspaceRoot: string,
    private learningDb?: LearningDatabase,
    fileSystem?: FileSystemProvider,
    private log: Logger = CONSOLE_LOGGER,
    private isDryRun: boolean = false,
  ) {
    this.fileSystem = fileSystem ?? null;
    this.fileSpecs = [
      {
        type:     'roadie_instructions',
        path:     ROADIE_INSTRUCTIONS_PATH,
        generate: (model) => generateCopilotInstructions(model),
      },
      {
        type:     'agents_md',
        path:     AGENTS_MD_PATH,
        generate: (model) => generateAgentDefinitions(model, this.learningDb),
      },
      {
        type:     'claude_md',
        path:     CLAUDE_MD_PATH,
        generate: (model) => generateClaudeMd(model),
      },
      {
        type:     'agent_operating_rules',
        path:     OPERATING_RULES_PATH,
        generate: (model) => generateOperatingRules(model),
      },
      {
        type:     'project_model_json',
        path:     PROJECT_MODEL_JSON_PATH,
        generate: (model) => generateProjectModelJson(model),
      },
      {
        type:     'prompts_md',
        path:     PROMPTS_MD_PATH,
        generate: (model) => generatePromptsMd(model),
      },
    ];
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
   * Safe write: enforces dry-run, safe-mode (whitelist-only), path-traversal guard,
   * and emits an audit event on every write or block.
   */
  private async safeWrite(fullPath: string, content: string, reason: WriteReason): Promise<boolean> {
    const cfg = getConfig(this.workspaceRoot);
    const audit = getAuditLog(this.workspaceRoot);
    const relativePath = path.relative(this.workspaceRoot, fullPath);

    // Path traversal guard — reject writes outside workspaceRoot
    const resolved = path.resolve(fullPath);
    const root = path.resolve(this.workspaceRoot);
    if (!resolved.startsWith(root + path.sep) && resolved !== root) {
      this.log.warn(`FileGenerator: BLOCKED path traversal attempt: ${fullPath}`);
      audit.append({ type: 'dry_run_blocked', filePath: relativePath, message: 'path traversal blocked' });
      return false;
    }

    // Dry-run mode: log intent but don't write
    if (this.isDryRun || cfg.dryRun) {
      this.log.info(`FileGenerator: DRY RUN - would write ${relativePath} (reason=${reason})`);
      audit.append({ type: 'dry_run_blocked', filePath: relativePath, message: `dry-run: ${reason}` });
      return false;
    }

    // Safe mode: only allow writes inside .claude/roadie/ (Roadie's own output directory)
    if (cfg.safeMode) {
      const isRoadieOwned = relativePath.startsWith(ROADIE_OUTPUT_DIR);
      if (!isRoadieOwned) {
        this.log.warn(`FileGenerator: SAFE MODE - blocked write to ${relativePath}. Only ${ROADIE_OUTPUT_DIR}/ allowed.`);
        audit.append({ type: 'dry_run_blocked', filePath: relativePath, message: `safe-mode: write outside ${ROADIE_OUTPUT_DIR}/ blocked` });
        return false;
      }
    }

    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf8');
    audit.append({ type: 'file_written', filePath: relativePath, message: reason });
    return true;
  }

  /**
   * Generate all managed files. Returns results indicating what was written.
   */
  async generateAll(model: ProjectModel): Promise<GeneratedFile[]> {
    await this.ensureGitignore();

    const results: GeneratedFile[] = [];
    for (const spec of this.fileSpecs) {
      const result = await this.generateFile(spec, model);
      results.push(result);
    }

    // Granular agents: multi-file output
    const agentResults = await this.generateGranularAgentFiles(model);
    results.push(...agentResults);

    // Skill library: multi-file output
    const skillResults = await this.generateSkillFiles(model);
    results.push(...skillResults);

    return results;
  }

  private async generateSkillFiles(model: ProjectModel): Promise<GeneratedFile[]> {
    const skills = [
      FrontendDesignSkill(model),
      EngineeringRigorSkill(model),
    ];
    const results: GeneratedFile[] = [];

    for (const skill of skills) {
      const content = skill.content;
      const fullPath = path.join(this.workspaceRoot, skill.path);
      const newHash  = hashContent(content);

      let existingContent: string | null = null;
      try {
        existingContent = await fs.readFile(fullPath, 'utf8');
      } catch { /* new file */ }

      if (existingContent !== null && hashContent(existingContent) === newHash) {
        results.push({
          type: 'skill' as unknown as GeneratedFileType,
          path: skill.path,
          content: existingContent,
          contentHash: `sha256:${newHash}`,
          written: false,
          writeReason: 'unchanged',
        });
        continue;
      }

      if (this.isFileOpenInEditor(fullPath)) {
        results.push({
          type: 'skill' as unknown as GeneratedFileType,
          path: skill.path,
          content,
          contentHash: `sha256:${newHash}`,
          written: false,
          writeReason: 'deferred',
        });
        continue;
      }

      const writeReason: WriteReason = existingContent === null ? 'new' : 'updated';
      let written = false;
      try {
        written = await this.safeWrite(fullPath, content, writeReason);
      } catch (err: unknown) {
        this.log.warn(`FileGenerator: failed to write skill ${skill.path}`, err);
        results.push({
          type: 'skill' as unknown as GeneratedFileType,
          path: skill.path,
          content,
          contentHash: `sha256:${newHash}`,
          written: false,
          writeReason: 'error' as WriteReason,
        });
        continue;
      }

      if (written) this.log.info(`FileGenerator: wrote skill ${skill.path} (reason=${writeReason})`);
      results.push({
        type: 'skill' as unknown as GeneratedFileType,
        path: skill.path,
        content,
        contentHash: `sha256:${newHash}`,
        written: true,
        writeReason,
      });
    }

    return results;
  }

  /**
   * Generate per-agent .github/agents/*.agent.md files.
   */
  private async generateGranularAgentFiles(model: ProjectModel): Promise<GeneratedFile[]> {
    const agents = generateGranularAgents(model);
    const results: GeneratedFile[] = [];

    for (const agent of agents) {
      const content = agent.preamble + buildSectionedFile(agent.sections);
      const fullPath = path.join(this.workspaceRoot, agent.filePath);
      const newHash  = hashContent(content);

      let existingContent: string | null = null;
      try {
        existingContent = await fs.readFile(fullPath, 'utf8');
      } catch { /* new file */ }

      if (existingContent !== null && hashContent(existingContent) === newHash) {
        results.push({
          type: 'granular_agent',
          path: agent.filePath,
          content: existingContent,
          contentHash: `sha256:${newHash}`,
          written: false,
          writeReason: 'unchanged',
        });
        continue;
      }

      if (this.isFileOpenInEditor(fullPath)) {
        results.push({
          type: 'granular_agent',
          path: agent.filePath,
          content,
          contentHash: `sha256:${newHash}`,
          written: false,
          writeReason: 'deferred',
        });
        continue;
      }

      const writeReason: WriteReason = existingContent === null ? 'new' : 'updated';
      let agentWritten = false;
      try {
        agentWritten = await this.safeWrite(fullPath, content, writeReason);
      } catch (err: unknown) {
        this.log.warn(`FileGenerator: failed to write ${agent.filePath}`, err);
        results.push({
          type: 'granular_agent',
          path: agent.filePath,
          content,
          contentHash: `sha256:${newHash}`,
          written: false,
          writeReason: 'error' as WriteReason,
        });
        continue;
      }

      if (agentWritten) {
        this.log.info(`FileGenerator: wrote ${agent.filePath} (reason=${writeReason})`);

        if (this.learningDb) {
          try {
            this.learningDb.recordSnapshot(agent.filePath, content, 'roadie');
          } catch { /* snapshots are non-critical */ }
        }
      }

      results.push({
        type: 'granular_agent',
        path: agent.filePath,
        content,
        contentHash: `sha256:${newHash}`,
        written: agentWritten,
        writeReason,
      });
    }

    return results;
  }

  /**
   * Generate a single file type.
   */
  async generate(fileType: GeneratedFileType, model: ProjectModel): Promise<GeneratedFile> {
    const spec = this.fileSpecs.find((s) => s.type === fileType);
    if (!spec) {
      this.log.warn(`FileGenerator: unknown file type "${fileType}" — skipping`);
      return {
        type:        fileType,
        path:        '',
        content:     '',
        contentHash: '',
        written:     false,
        writeReason: 'unchanged',
      };
    }
    await this.ensureGitignore();
    return this.generateFile(spec, model);
  }

  private async generateFile(spec: FileSpec, model: ProjectModel): Promise<GeneratedFile> {
    this.log.debug(`FileGenerator: generating ${spec.type} → ${spec.path}`);

    // 1. Generate sections from template
    const sections = spec.generate(model);
    const preamble = spec.preamble ? spec.preamble() : '';
    const content  = preamble + buildSectionedFile(sections);
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
      this.log.debug(
        `FileGenerator: ${spec.type} unchanged (hash=${newHash.slice(0, 8)}…) — skipped. ` +
        `Hash inputs: generated content. ` +
        `Note: version-only changes in package.json do not affect generated content.`,
      );
      return {
        type:        spec.type,
        path:        spec.path,
        content:     existingContent,
        contentHash: `sha256:${newHash}`,
        written:     false,
        writeReason: 'unchanged' as WriteReason,
      };
    }

    // 4. Skip write if file is open in editor (deferred write)
    if (this.isFileOpenInEditor(fullPath)) {
      this.log.debug(`FileGenerator: ${spec.type} is open in editor — deferring write`);
      return {
        type:        spec.type,
        path:        spec.path,
        content,
        contentHash: `sha256:${newHash}`,
        written:     false,
        writeReason: 'deferred' as WriteReason,
      };
    }

    // 5. Determine write reason before writing
    const writeReason: WriteReason = existingContent === null ? 'new' : 'updated';

    let written = false;
    try {
      written = await this.safeWrite(fullPath, content, writeReason);
    } catch (err: unknown) {
      this.log.warn(`FileGenerator: write failed for ${spec.type} -> ${spec.path}`, err);
      return {
        type:        spec.type,
        path:        spec.path,
        content,
        contentHash: `sha256:${newHash}`,
        written:     false,
        writeReason: 'error' as WriteReason,
      };
    }

    if (written) {
      const kb = (Buffer.byteLength(content, 'utf8') / 1024).toFixed(1);
      this.log.info(
        `FileGenerator: wrote ${spec.path} (${kb} KB, reason=${writeReason}, ` +
        `hash=${newHash.slice(0, 8)}…)`,
      );

      // 7. Record snapshot in LearningDatabase (if available)
      if (this.learningDb) {
        try {
          this.learningDb.recordSnapshot(spec.path, content, 'roadie');
          this.log.debug(`FileGenerator: snapshot recorded for ${spec.path}`);
        } catch (err) {
          this.log.warn(`FileGenerator: failed to record snapshot for ${spec.path}`, err);
        }
      }
    }

    return {
      type:        spec.type,
      path:        spec.path,
      content,
      contentHash: `sha256:${newHash}`,
      written,
      writeReason,
    };
  }

  /**
   * Ensure .claude/roadie/.gitignore exists with database exclusion.
   */
  private async ensureGitignore(): Promise<void> {
    const gitignorePath = path.join(this.workspaceRoot, ROADIE_OUTPUT_DIR, '.gitignore');
    try {
      await fs.access(gitignorePath);
      this.log.debug(`FileGenerator: ${ROADIE_OUTPUT_DIR}/.gitignore already exists`);
    } catch {
      await fs.mkdir(path.dirname(gitignorePath), { recursive: true });
      await fs.writeFile(gitignorePath, 'project-model.db\n*.db-journal\n*.lance\n', 'utf8');
      this.log.info(`FileGenerator: created ${ROADIE_OUTPUT_DIR}/.gitignore`);
    }
  }
}
