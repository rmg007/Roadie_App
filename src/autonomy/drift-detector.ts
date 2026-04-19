/**
 * @module drift-detector
 * @description Detects project changes (new files, missing files, modified package.json, new deps)
 *   and compares against last recorded state in LearningDatabase.
 *   Triggers remediation workflow if drift detected.
 *
 * @outputs detectDrift(): { drifted: boolean, changes: Change[], remediationWorkflow?: string }
 * @depends-on fs, path, LearningDatabase
 * @depended-on-by autonomy-loop
 */

import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { createHash } from 'node:crypto';
import type { Logger } from '../platform-adapters';
import { STUB_LOGGER } from '../platform-adapters';

// ---- Types ----

export interface FileChange {
  type: 'added' | 'removed' | 'modified';
  filePath: string;
  oldHash?: string;
  newHash?: string;
  oldSize?: number;
  newSize?: number;
}

export interface DependencyChange {
  type: 'added' | 'removed' | 'updated';
  name: string;
  oldVersion?: string;
  newVersion?: string;
}

export type Change = FileChange | DependencyChange;

export interface ProjectSnapshot {
  timestamp: string;
  fileHashes: Map<string, string>;
  packageJson: Record<string, unknown>;
  lockfileHash: string;
}

export interface DriftDetectionResult {
  drifted: boolean;
  changes: Change[];
  remediationWorkflow?: string;
  severity: 'critical' | 'major' | 'minor' | 'none';
}

// ---- DriftDetector ----

export class DriftDetector {
  private logger: Logger = STUB_LOGGER;
  private lastSnapshot: ProjectSnapshot | null = null;
  private projectRoot: string;
  private watchedExtensions = ['.ts', '.js', '.json', '.md', '.yaml', '.yml'];

  constructor(projectRoot: string, logger?: Logger) {
    this.projectRoot = projectRoot;
    if (logger) this.logger = logger;
  }

  /**
   * Create a snapshot of the current project state.
   */
  captureSnapshot(): ProjectSnapshot {
    const fileHashes = new Map<string, string>();
    const packageJsonPath = nodePath.join(this.projectRoot, 'package.json');
    let packageJson: Record<string, unknown> = {};
    let lockfileHash = '';

    // Capture package.json
    if (fs.existsSync(packageJsonPath)) {
      const content = fs.readFileSync(packageJsonPath, 'utf-8');
      packageJson = JSON.parse(content);
      fileHashes.set('package.json', this.hashContent(content));
    }

    // Capture lockfile (package-lock.json or yarn.lock or pnpm-lock.yaml)
    const lockfiles = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];
    for (const lockfile of lockfiles) {
      const lockfilePath = nodePath.join(this.projectRoot, lockfile);
      if (fs.existsSync(lockfilePath)) {
        const content = fs.readFileSync(lockfilePath, 'utf-8');
        lockfileHash = this.hashContent(content);
        break;
      }
    }

    // Capture source files (shallow scan of src/ and lib/)
    this.scanDirectory(
      nodePath.join(this.projectRoot, 'src'),
      fileHashes,
    );

    return {
      timestamp: new Date().toISOString(),
      fileHashes,
      packageJson,
      lockfileHash,
    };
  }

  /**
   * Detect drift between current state and last recorded snapshot.
   */
  detectDrift(lastSnapshot?: ProjectSnapshot): DriftDetectionResult {
    const currentSnapshot = this.captureSnapshot();
    const comparisonSnapshot = lastSnapshot ?? this.lastSnapshot;

    if (!comparisonSnapshot) {
      this.lastSnapshot = currentSnapshot;
      return {
        drifted: false,
        changes: [],
        severity: 'none',
      };
    }

    const changes: Change[] = [];
    let severity: 'critical' | 'major' | 'minor' | 'none' = 'none';

    // Check for package.json changes
    const pkgChanges = this.detectDependencyChanges(
      comparisonSnapshot.packageJson,
      currentSnapshot.packageJson,
    );
    if (pkgChanges.length > 0) {
      changes.push(...pkgChanges);
      severity = 'critical'; // Dependency changes are critical
    }

    // Check for lockfile changes
    if (comparisonSnapshot.lockfileHash !== currentSnapshot.lockfileHash) {
      changes.push({
        type: 'modified',
        filePath: 'lockfile',
      });
      if (severity === 'none') severity = 'major';
    }

    // Check for file additions/removals/modifications
    const fileChanges = this.detectFileChanges(
      comparisonSnapshot.fileHashes,
      currentSnapshot.fileHashes,
    );
    changes.push(...fileChanges);
    if (fileChanges.length > 0 && severity === 'none') severity = 'minor';

    this.lastSnapshot = currentSnapshot;

    return {
      drifted: changes.length > 0,
      changes,
      remediationWorkflow: this.determineRemediationWorkflow(changes),
      severity,
    };
  }

  /**
   * Scan a directory and compute file hashes.
   */
  private scanDirectory(
    dirPath: string,
    hashes: Map<string, string>,
    maxDepth = 3,
    currentDepth = 0,
  ): void {
    if (!fs.existsSync(dirPath) || currentDepth >= maxDepth) {
      return;
    }

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        // Skip common ignore patterns
        if (['.git', 'node_modules', '.next', 'dist', 'build'].includes(entry.name)) {
          continue;
        }

        const fullPath = nodePath.join(dirPath, entry.name);
        const relativePath = nodePath.relative(this.projectRoot, fullPath);

        if (entry.isDirectory()) {
          this.scanDirectory(fullPath, hashes, maxDepth, currentDepth + 1);
        } else if (entry.isFile()) {
          const ext = nodePath.extname(entry.name);
          if (this.watchedExtensions.includes(ext)) {
            try {
              const content = fs.readFileSync(fullPath, 'utf-8');
              hashes.set(relativePath, this.hashContent(content));
            } catch {
              // File read error, skip
            }
          }
        }
      }
    } catch (err) {
      this.logger.warn(`[DriftDetector] Failed to scan ${dirPath}:`, err);
    }
  }

  /**
   * Detect changes in file hashes.
   */
  private detectFileChanges(
    oldHashes: Map<string, string>,
    newHashes: Map<string, string>,
  ): FileChange[] {
    const changes: FileChange[] = [];

    // Check for added/modified files
    for (const [filePath, newHash] of newHashes) {
      const oldHash = oldHashes.get(filePath);
      if (!oldHash) {
        changes.push({
          type: 'added',
          filePath,
          newHash,
        });
      } else if (oldHash !== newHash) {
        changes.push({
          type: 'modified',
          filePath,
          oldHash,
          newHash,
        });
      }
    }

    // Check for removed files
    for (const [filePath, oldHash] of oldHashes) {
      if (!newHashes.has(filePath)) {
        changes.push({
          type: 'removed',
          filePath,
          oldHash,
        });
      }
    }

    return changes;
  }

  /**
   * Detect changes in dependencies (package.json).
   */
  private detectDependencyChanges(
    oldPkg: Record<string, unknown>,
    newPkg: Record<string, unknown>,
  ): DependencyChange[] {
    const changes: DependencyChange[] = [];
    const oldDeps = { ...((oldPkg.dependencies as Record<string, string>) ?? {}) };
    const newDeps = { ...((newPkg.dependencies as Record<string, string>) ?? {}) };
    const oldDevDeps = { ...((oldPkg.devDependencies as Record<string, string>) ?? {}) };
    const newDevDeps = { ...((newPkg.devDependencies as Record<string, string>) ?? {}) };

    const allOldDeps = { ...oldDeps, ...oldDevDeps };
    const allNewDeps = { ...newDeps, ...newDevDeps };

    // Check for added/updated deps
    for (const [name, newVersion] of Object.entries(allNewDeps)) {
      const oldVersion = allOldDeps[name];
      if (!oldVersion) {
        changes.push({ type: 'added', name, newVersion });
      } else if (oldVersion !== newVersion) {
        changes.push({ type: 'updated', name, oldVersion, newVersion });
      }
    }

    // Check for removed deps
    for (const [name, oldVersion] of Object.entries(allOldDeps)) {
      if (!(name in allNewDeps)) {
        changes.push({ type: 'removed', name, oldVersion });
      }
    }

    return changes;
  }

  /**
   * Determine which remediation workflow to trigger based on changes.
   */
  private determineRemediationWorkflow(changes: Change[]): string | undefined {
    const hasDependencyChanges = changes.some((c) => 'name' in c);
    const hasFileAdditions = changes.some((c) => 'filePath' in c && c.type === 'added');
    const hasFileDeletions = changes.some((c) => 'filePath' in c && c.type === 'removed');

    if (hasDependencyChanges) {
      return 'dependency_remediation';
    }
    if (hasFileAdditions) {
      return 'file_integration';
    }
    if (hasFileDeletions) {
      return 'file_reconciliation';
    }

    return undefined;
  }

  /**
   * Compute SHA256 hash of content.
   */
  private hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }
}

export function createDriftDetector(projectRoot: string, logger?: Logger): DriftDetector {
  return new DriftDetector(projectRoot, logger);
}
