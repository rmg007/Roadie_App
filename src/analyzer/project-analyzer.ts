/**
 * @module project-analyzer
 * @description Orchestrates project analysis with a plugin architecture.
 *   Phase 1: Node.js plugin only. Calls dependency-scanner and
 *   directory-scanner, populates the InMemoryProjectModel.
 *   Phase 1.5: Also derives DetectedPattern[] from the tech stack and
 *   directory structure, and (when an EntityWriter is provided) extracts
 *   code entities from source files into the codebase dictionary.
 * @inputs Workspace root path, InMemoryProjectModel, optional EntityWriter
 * @outputs Populated project model (side effect)
 * @depends-on dependency-scanner.ts, directory-scanner.ts,
 *   project-model.ts, shell/logger.ts
 * @depended-on-by extension.ts (activation), commands (roadie.rescan)
 */

import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import fg from 'fast-glob';
import { scanDependencies } from './dependency-scanner';
import { scanDirectories } from './directory-scanner';
import type { InMemoryProjectModel } from '../model/project-model';
import { ProjectConventionsExtractor } from './project-conventions-extractor';
import type { TechStackEntry, DirectoryNode, DetectedPattern, EntityWriter } from '../types';
import type { LearningDatabase } from '../learning/learning-database';
import type { Logger } from '../platform-adapters';
import { CONSOLE_LOGGER } from '../platform-adapters';

export class ProjectAnalyzer {
  constructor(
    private model: InMemoryProjectModel,
    private entityWriter?: EntityWriter,
    private learningDb?: LearningDatabase,
    private log: Logger = CONSOLE_LOGGER,
  ) {}

  private buildPatternId(pattern: DetectedPattern): string {
    return `${pattern.category}:${pattern.description.replace(/\s*\(v\d+(?:\.\d+)*\)$/, '')}`;
  }

  /**
   * Run a full analysis of the workspace.
   * Phase 1: Node.js projects only (package.json detection).
   * Phase 1.5: Also populates detected_patterns and codebase_entities.
   */
  async analyze(workspaceRoot: string): Promise<void> {
    this.log.info(`ProjectAnalyzer: starting analysis of ${workspaceRoot}`);

    // 1. Scan dependencies (package.json, lock files)
    this.log.debug(`ProjectAnalyzer: scanning dependencies…`);
    const { techStack, commands } = await scanDependencies(workspaceRoot, this.log);
    this.model.setTechStack(techStack);
    this.model.setCommands(commands);
    this.log.info(
      `ProjectAnalyzer: dependency scan complete — ` +
      `${techStack.length} tech entries, ${commands.length} commands`,
    );

    // 2. Scan directory structure
    this.log.debug('ProjectAnalyzer: scanning directories…');
    const directoryTree = await scanDirectories(workspaceRoot);
    this.model.setDirectoryTree(directoryTree);
    const dirCount = countNodes(directoryTree);
    this.log.info(`ProjectAnalyzer: directory scan complete — ${dirCount} entries`);

    // 2.5. Parse Project Conventions (CLAUDE.md)
    this.log.debug('ProjectAnalyzer: parsing project conventions…');
    const conventionsExtractor = new ProjectConventionsExtractor();
    const conventions = await conventionsExtractor.extract(workspaceRoot);
    if (conventions) {
      this.model.setConventions(conventions);
      this.log.info(
        `ProjectAnalyzer: convention parsing complete — ` +
        `${conventions.techStack?.length ?? 0} tech, ${conventions.codingStyle?.length ?? 0} styles`,
      );
    } else {
      this.log.info('ProjectAnalyzer: no project conventions found (CLAUDE.md missing)');
    }

    // 3. Derive detected patterns from tech stack + directory structure
    this.log.debug('ProjectAnalyzer: deriving patterns…');
    const patterns = derivePatterns(techStack, directoryTree);

    // ... (rest of logic using this.log instead of log)

    // Apply observation-count confidence boost from LearningDatabase
    if (this.learningDb) {
      try {
        const counts = this.learningDb.getPatternObservationCounts();
        const countMap = new Map(counts.map((c) => [c.patternId, c.observationCount]));
        for (const p of patterns) {
          const id = this.buildPatternId(p);
          const obs = countMap.get(id);
          if (obs && obs > 1) {
            p.confidence = Math.min(1.0, p.confidence * (1 + Math.log10(obs) * 0.1));
          }
        }
      } catch {
        // Non-fatal — proceed with unmodified confidence values
      }
    }

    if (this.learningDb) {
      for (const p of patterns) {
        try {
          this.learningDb.recordPatternObservation(this.buildPatternId(p));
        } catch {
          // Non-fatal; observation recording is advisory
        }
      }
    }

    this.model.setPatterns(patterns);
    this.log.info(`ProjectAnalyzer: pattern derivation complete — ${patterns.length} patterns`);

    // 4. Extract code entities into codebase dictionary (when entity writer provided)
    if (this.entityWriter) {
      this.log.debug('ProjectAnalyzer: extracting code entities…');
      const entityCount = await this.extractEntities(workspaceRoot);
      this.log.info(`ProjectAnalyzer: entity extraction complete — ${entityCount} files processed`);
    }

    // 5. Flush to SQLite (no-op when database is null)
    this.model.flush();
    this.log.info('ProjectAnalyzer: analysis complete');
  }

  /** Scan TypeScript/JavaScript source files and record code entities. */
  private async extractEntities(workspaceRoot: string): Promise<number> {
    if (!this.entityWriter) return 0;
    // use this.log

    const sourceFiles = await fg(['**/*.{ts,tsx,js,jsx}'], {
      cwd: workspaceRoot,
      ignore: [
        '**/node_modules/**', '**/dist/**', '**/build/**',
        '**/coverage/**', '**/*.d.ts', '**/.next/**',
      ],
      absolute: true,
    });

    let processed = 0;
    let skipped = 0;
    for (const filePath of sourceFiles) {
      try {
        const content = await readFile(filePath, 'utf8');
        await this.entityWriter.recordEntities({
          filePath,
          fileContent: content,
          workflowType: 'initial-scan',
          stepId:        'entity-extraction',
          originalPrompt: 'Initial project analysis',
        });
        processed++;
      } catch (err) {
        skipped++;
        this.log.debug(`ProjectAnalyzer: entity extraction skipped ${path.basename(filePath)}: ${String(err)}`);
      }
    }

    if (skipped > 0) {
      const ratio = skipped / sourceFiles.length;
      if (ratio >= 0.1) {
        this.log.warn(
          `ProjectAnalyzer: entity extraction failed for ${skipped}/${sourceFiles.length} files ` +
          `(>=10%). The project dictionary may be incomplete.`,
        );
      } else {
        this.log.info(`ProjectAnalyzer: entity extraction skipped ${skipped}/${sourceFiles.length} files.`);
      }
    }

    return processed;
  }
}

/**
 * Derive high-level DetectedPatterns from the tech stack and directory tree.
 * These represent project-level conventions and structure, not individual
 * code entities (those go into the codebase_entities table via EntityWriter).
 */
function derivePatterns(
  techStack: TechStackEntry[],
  directoryTree: DirectoryNode,
): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];

  // Language
  const tsEntry = techStack.find((e) => e.name === 'TypeScript');
  if (tsEntry) {
    patterns.push({
      category: 'language',
      description: `TypeScript project${tsEntry.version ? ` (v${tsEntry.version})` : ''}`,
      evidence: { files: ['package.json'], matchCount: 1, confidence: 1.0 },
      confidence: 1.0,
    });
  } else if (techStack.some((e) => e.category === 'language' && e.name === 'JavaScript')) {
    patterns.push({
      category: 'language',
      description: 'JavaScript project',
      evidence: { files: ['package.json'], matchCount: 1, confidence: 1.0 },
      confidence: 1.0,
    });
  }

  // Testing framework
  const testEntry = techStack.find((e) => e.category === 'test_tool');
  if (testEntry) {
    patterns.push({
      category: 'testing',
      description: `Uses ${testEntry.name} for testing${testEntry.version ? ` (v${testEntry.version})` : ''}`,
      evidence: { files: ['package.json'], matchCount: 1, confidence: 1.0 },
      confidence: 1.0,
    });
  }

  // Build tool
  const buildEntry = techStack.find((e) => e.category === 'build_tool');
  if (buildEntry) {
    patterns.push({
      category: 'build',
      description: `Uses ${buildEntry.name} as build tool${buildEntry.version ? ` (v${buildEntry.version})` : ''}`,
      evidence: { files: ['package.json'], matchCount: 1, confidence: 1.0 },
      confidence: 1.0,
    });
  }

  // Package manager
  const pmEntry = techStack.find((e) => e.category === 'package_manager');
  if (pmEntry) {
    patterns.push({
      category: 'package_manager',
      description: `Uses ${pmEntry.name} as package manager`,
      evidence: { files: ['package.json'], matchCount: 1, confidence: 0.95 },
      confidence: 0.95,
    });
  }

  // Runtime
  const runtimeEntry = techStack.find((e) => e.category === 'runtime');
  if (runtimeEntry) {
    patterns.push({
      category: 'runtime',
      description: `Runs on ${runtimeEntry.name}`,
      evidence: { files: ['package.json'], matchCount: 1, confidence: 0.95 },
      confidence: 0.95,
    });
  }

  // Directory structure conventions
  const children = directoryTree.children ?? [];
  const sourceDir = children.find((d) => d.role === 'source' && d.path !== directoryTree.path);
  if (sourceDir) {
    patterns.push({
      category: 'structure',
      description: `Source code organised under ${path.basename(sourceDir.path)}/`,
      evidence: { files: [sourceDir.path], matchCount: 1, confidence: 0.9 },
      confidence: 0.9,
    });
  }

  // Agent Discovery
  const agentsDir = children.find((d) => path.basename(d.path).toLowerCase() === 'agents' && d.type === 'directory');
  if (agentsDir) {
    patterns.push({
      category: 'agent_lifecycle',
      description: 'Project contains local AI agents in agents/',
      evidence: { files: [agentsDir.path], matchCount: 1, confidence: 1.0 },
      confidence: 1.0,
    });
  }

  const mcpConfig = children.find((d) => path.basename(d.path).toLowerCase() === 'mcp.json');
  if (mcpConfig) {
    patterns.push({
      category: 'agent_lifecycle',
      description: 'Project uses mcp.json for agent registration',
      evidence: { files: [mcpConfig.path], matchCount: 1, confidence: 1.0 },
      confidence: 1.0,
    });
  }

  const testDir = children.find((d) => d.role === 'test');
  if (testDir) {
    patterns.push({
      category: 'structure',
      description: `Tests in ${path.basename(testDir.path)}/`,
      evidence: { files: [testDir.path], matchCount: 1, confidence: 0.9 },
      confidence: 0.9,
    });
  }

  // Module system (ESM vs CJS) — detected from package.json "type" field
  // (DependencyScanner does not expose this directly, so we infer from tsup presence)
  if (buildEntry?.name === 'tsup') {
    patterns.push({
      category: 'module_system',
      description: 'Dual ESM+CJS output via tsup',
      evidence: { files: ['package.json'], matchCount: 1, confidence: 0.8 },
      confidence: 0.8,
    });
  }

  return patterns;
}

/** Count total nodes in the directory tree. */
function countNodes(node: { children?: unknown[] }): number {
  return 1 + (node.children?.reduce((sum: number, child) =>
    sum + countNodes(child as { children?: unknown[] }), 0) ?? 0);
}
