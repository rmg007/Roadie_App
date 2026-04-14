/**
 * @module project-analyzer
 * @description Orchestrates project analysis with a plugin architecture.
 *   Phase 1: Node.js plugin only. Calls dependency-scanner and
 *   directory-scanner, populates the InMemoryProjectModel.
 * @inputs Workspace root path, InMemoryProjectModel
 * @outputs Populated project model (side effect)
 * @depends-on dependency-scanner.ts, directory-scanner.ts,
 *   project-model.ts, shell/logger.ts
 * @depended-on-by extension.ts (activation), commands (roadie.rescan)
 */

import { scanDependencies } from './dependency-scanner';
import { scanDirectories } from './directory-scanner';
import type { InMemoryProjectModel } from '../model/project-model';
import { getLogger } from '../shell/logger';

export class ProjectAnalyzer {
  constructor(private model: InMemoryProjectModel) {}

  /**
   * Run a full analysis of the workspace.
   * Phase 1: Node.js projects only (package.json detection).
   */
  async analyze(workspaceRoot: string): Promise<void> {
    const log = getLogger();
    log.info(`ProjectAnalyzer: starting analysis of ${workspaceRoot}`);

    // 1. Scan dependencies (package.json, lock files)
    log.debug('ProjectAnalyzer: scanning dependencies…');
    const { techStack, commands } = await scanDependencies(workspaceRoot);
    this.model.setTechStack(techStack);
    this.model.setCommands(commands);
    log.info(
      `ProjectAnalyzer: dependency scan complete — ` +
      `${techStack.length} tech entries, ${commands.length} commands`,
    );

    // 2. Scan directory structure
    log.debug('ProjectAnalyzer: scanning directories…');
    const directoryTree = await scanDirectories(workspaceRoot);
    this.model.setDirectoryTree(directoryTree);
    const dirCount = countNodes(directoryTree);
    log.info(`ProjectAnalyzer: directory scan complete — ${dirCount} entries`);

    // 3. Flush to SQLite (no-op in Phase 1 when database is null)
    this.model.flush();
    log.info('ProjectAnalyzer: analysis complete');
  }
}

/** Count total nodes in the directory tree. */
function countNodes(node: { children?: unknown[] }): number {
  return 1 + (node.children?.reduce((sum: number, child) =>
    sum + countNodes(child as { children?: unknown[] }), 0) ?? 0);
}
