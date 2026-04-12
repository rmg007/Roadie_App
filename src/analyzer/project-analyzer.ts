/**
 * @module project-analyzer
 * @description Orchestrates project analysis with a plugin architecture.
 *   Phase 1: Node.js plugin only. Calls dependency-scanner and
 *   directory-scanner, populates the InMemoryProjectModel.
 * @inputs Workspace root path, InMemoryProjectModel
 * @outputs Populated project model (side effect)
 * @depends-on dependency-scanner.ts, directory-scanner.ts, project-model.ts
 * @depended-on-by extension.ts (activation), commands (roadie.rescan)
 */

import { scanDependencies } from './dependency-scanner';
import { scanDirectories } from './directory-scanner';
import type { InMemoryProjectModel } from '../model/project-model';

export class ProjectAnalyzer {
  constructor(private model: InMemoryProjectModel) {}

  /**
   * Run a full analysis of the workspace.
   * Phase 1: Node.js projects only (package.json detection).
   */
  async analyze(workspaceRoot: string): Promise<void> {
    // 1. Scan dependencies (package.json, lock files)
    const { techStack, commands } = await scanDependencies(workspaceRoot);
    this.model.setTechStack(techStack);
    this.model.setCommands(commands);

    // 2. Scan directory structure
    const directoryTree = await scanDirectories(workspaceRoot);
    this.model.setDirectoryTree(directoryTree);

    // 3. Flush to SQLite
    this.model.flush();
  }
}
