/**
 * @module project-model
 * @description In-memory project model with debounced SQLite persistence.
 *   Implements the ProjectModel interface. Loads from SQLite at construction,
 *   applies delta updates, debounces writes (every 5s max), and serializes
 *   to a context string for LLM prompt injection.
 * @inputs RoadieDatabase
 * @outputs ProjectModel interface methods
 * @depends-on database.ts, types.ts
 * @depended-on-by workflow-engine.ts, agent-spawner.ts
 */

import type {
  ProjectModel,
  TechStackEntry,
  DirectoryNode,
  DetectedPattern,
  ProjectCommand,
  DeveloperPreferences,
  ProjectContext,
  ProjectModelDelta,
} from '../types';
import type { RoadieDatabase } from './database';

const DEBOUNCE_MS = 5_000;

export class InMemoryProjectModel implements ProjectModel {
  private techStack: TechStackEntry[] = [];
  private directoryTree: DirectoryNode = { path: '', type: 'directory', children: [] };
  private patterns: DetectedPattern[] = [];
  private commands: ProjectCommand[] = [];
  private preferences: DeveloperPreferences = { telemetryEnabled: false, autoCommit: false };
  private dirty = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private database: RoadieDatabase | null) {
    if (database) {
      this.loadFromDatabase(database);
    }
  }

  private loadFromDatabase(db: RoadieDatabase): void {
    this.techStack = db.loadTechStack();
    const root = db.loadDirectoryRoot();
    if (root) this.directoryTree = root;
    this.patterns = db.loadPatterns();
    this.commands = db.loadCommands();
  }

  // ---- ProjectModel interface ----

  getTechStack(): TechStackEntry[] {
    return this.techStack;
  }

  getDirectoryStructure(): DirectoryNode {
    return this.directoryTree;
  }

  getPatterns(): DetectedPattern[] {
    return this.patterns;
  }

  getPreferences(): DeveloperPreferences {
    return this.preferences;
  }

  getCommands(): ProjectCommand[] {
    return this.commands;
  }

  toContext(options?: {
    maxTokens?: number;
    scope?: 'full' | 'stack' | 'structure' | 'commands' | 'patterns';
    relevantPaths?: string[];
  }): ProjectContext {
    const scope = options?.scope ?? 'full';
    const parts: string[] = [];

    if (scope === 'full' || scope === 'stack') {
      parts.push('## Tech Stack');
      for (const entry of this.techStack) {
        const ver = entry.version ? `@${entry.version}` : '';
        parts.push(`- ${entry.name}${ver} (${entry.category}, from ${entry.sourceFile})`);
      }
    }

    if (scope === 'full' || scope === 'structure') {
      parts.push('\n## Directory Structure');
      this.serializeTree(this.directoryTree, parts, 0);
    }

    if (scope === 'full' || scope === 'commands') {
      parts.push('\n## Commands');
      for (const cmd of this.commands) {
        parts.push(`- ${cmd.name}: \`${cmd.command}\` (${cmd.type})`);
      }
    }

    if (scope === 'full' || scope === 'patterns') {
      parts.push('\n## Detected Patterns');
      for (const p of this.patterns) {
        parts.push(`- ${p.category}: ${p.description} (confidence: ${p.confidence.toFixed(2)})`);
      }
    }

    let serialized = parts.join('\n');
    if (options?.maxTokens !== undefined) {
      // Priority-ordered trimming: commands → patterns → structure → stack
      // Build priority sections independently and drop/trim lower-priority ones first
      serialized = priorityTrim(parts, options.maxTokens);
    }

    return {
      techStack: this.techStack,
      directoryStructure: this.directoryTree,
      patterns: this.patterns,
      commands: this.commands,
      serialized,
    };
  }

  update(delta: ProjectModelDelta): void {
    if (delta.techStack) this.techStack = delta.techStack;
    if (delta.directories) {
      this.directoryTree = {
        path: this.directoryTree.path,
        type: 'directory',
        children: delta.directories,
      };
    }
    if (delta.patterns) this.patterns = delta.patterns;
    if (delta.commands) this.commands = delta.commands;

    this.dirty = true;
    this.scheduleDebouncedWrite();
  }

  /** Force-set the full model state (used by ProjectAnalyzer after scan). */
  setTechStack(entries: TechStackEntry[]): void {
    this.techStack = entries;
    this.dirty = true;
    this.scheduleDebouncedWrite();
  }

  setDirectoryTree(tree: DirectoryNode): void {
    this.directoryTree = tree;
    this.dirty = true;
    this.scheduleDebouncedWrite();
  }

  setCommands(commands: ProjectCommand[]): void {
    this.commands = commands;
    this.dirty = true;
    this.scheduleDebouncedWrite();
  }

  setPatterns(patterns: DetectedPattern[]): void {
    this.patterns = patterns;
    this.dirty = true;
    this.scheduleDebouncedWrite();
  }

  /** Immediately flush dirty state to SQLite. */
  flush(): void {
    if (!this.dirty || !this.database) return;
    this.database.saveTechStack(this.techStack);
    this.database.saveDirectories(this.directoryTree);
    this.database.savePatterns(this.patterns);
    this.database.saveCommands(this.commands);
    this.dirty = false;
  }

  /** Cancel any pending debounce timer. Call on deactivation. */
  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.flush();
  }

  private scheduleDebouncedWrite(): void {
    if (this.debounceTimer) return; // already scheduled
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.flush();
    }, DEBOUNCE_MS);
  }

  private serializeTree(node: DirectoryNode, parts: string[], depth: number): void {
    if (depth > 10) return; // MAX_TREE_DEPTH
    const indent = '  '.repeat(depth);
    const role = node.role ? ` [${node.role}]` : '';
    parts.push(`${indent}${node.path}${role}`);
    if (node.children) {
      for (const child of node.children) {
        this.serializeTree(child, parts, depth + 1);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Priority-ordered token trimmer (module-level helper)
// ---------------------------------------------------------------------------

/**
 * Trims a serialized context string to fit within a token budget.
 * Sections are ordered by priority: commands > patterns > structure > stack.
 * Lower-priority sections are dropped or truncated first.
 */
function priorityTrim(parts: string[], maxTokens: number): string {
  if (maxTokens <= 0) return '';
  const budget = maxTokens * 4; // 4 chars per token approximation

  // Extract named sections from parts array
  const sections = splitIntoSections(parts.join('\n'));

  // Priority order (highest first): commands > patterns > structure > stack
  const PRIORITY: string[] = ['## Commands', '## Detected Patterns', '## Directory Structure', '## Tech Stack'];

  // Build the output by adding sections from highest to lowest priority
  const selected: string[] = [];
  let remaining = budget;

  for (const header of PRIORITY) {
    const section = sections.find((s) => s.startsWith(header));
    if (!section) continue;

    if (section.length <= remaining) {
      selected.push(section);
      remaining -= section.length;
    } else if (remaining > header.length + 20) {
      // Partial include with truncation marker
      selected.push(section.slice(0, remaining - 12) + '\n[truncated]');
      remaining = 0;
      break;
    }
    // else: skip section entirely — budget exhausted
  }

  return selected.join('\n\n');
}

function splitIntoSections(text: string): string[] {
  const lines = text.split('\n');
  const results: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line.startsWith('## ') && current.length > 0) {
      results.push(current.join('\n').trim());
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) {
    results.push(current.join('\n').trim());
  }
  return results.filter((s) => s.length > 0);
}
