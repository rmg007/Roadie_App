/**
 * @module generator/templates/claude-hooks
 * @description Generates .claude/settings.json with Claude Code lifecycle hooks.
 *   Hooks call the roadie-mcp CLI for: SessionStart (prime), PostToolUse (observe),
 *   and Stop (reconcile). This enables Roadie to stay up-to-date with changes
 *   Claude Code makes during a session.
 * @inputs projectRoot: string, binPath: string
 * @outputs Writes .claude/settings.json, returns content string
 * @depends-on node:fs/promises, node:path
 * @depended-on-by file-generator.ts (generate_all_files)
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export const CLAUDE_SETTINGS_PATH = '.claude/settings.json';

// =====================================================================
// Claude Code settings.json schema (hooks portion)
// =====================================================================

export interface ClaudeHook {
  /** Hook event lifecycle name */
  event: 'SessionStart' | 'PostToolUse' | 'Stop' | string;
  /** Shell command to execute */
  command: string;
  /** Optional description shown in Claude Code UI */
  description?: string;
}

export interface ClaudeSettings {
  hooks?: ClaudeHook[];
  [key: string]: unknown;
}

// =====================================================================
// generateClaudeHooks
// =====================================================================

export interface ClaudeHooksOptions {
  /** Absolute path to the project root (where .claude/ lives) */
  projectRoot: string;
  /**
   * Path to the roadie-mcp entry point.
   * Defaults to: node_modules/.bin/roadie-mcp relative to projectRoot.
   */
  binPath?: string;
  /**
   * If true, PostToolUse observe hook is included.
   * Default: true. Set false if the user prefers not to watch for changes.
   */
  includeObserve?: boolean;
}

/**
 * Generate or update .claude/settings.json with Roadie lifecycle hooks.
 * Performs an atomic read-merge-write cycle — other settings are preserved.
 * Returns the final JSON content as a string.
 */
export async function generateClaudeHooks(options: ClaudeHooksOptions): Promise<string> {
  const { projectRoot } = options;
  const includeObserve  = options.includeObserve ?? true;
  const settingsPath    = path.join(projectRoot, CLAUDE_SETTINGS_PATH);

  const binPath = options.binPath
    ?? path.join(projectRoot, 'node_modules', '.bin', 'roadie-mcp');

  // Read existing settings (if any)
  let existing: ClaudeSettings = {};
  try {
    const raw = await fs.readFile(settingsPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'object' && parsed !== null) {
      existing = parsed as ClaudeSettings;
    }
  } catch {
    // File doesn't exist yet — start fresh
  }

  // Build roadie hooks
  const roadieHooks: ClaudeHook[] = [
    {
      event:       'SessionStart',
      command:     `node "${binPath}" prime --project "${projectRoot}"`,
      description: 'Roadie: warm project model at session start',
    },
  ];

  if (includeObserve) {
    roadieHooks.push({
      event:       'PostToolUse',
      command:     `node "${binPath}" observe --project "${projectRoot}"`,
      description: 'Roadie: observe file changes after each tool use',
    });
  }

  roadieHooks.push({
    event:       'Stop',
    command:     `node "${binPath}" reconcile --project "${projectRoot}"`,
    description: 'Roadie: reconcile project model at session end',
  });

  // Merge: remove any existing roadie hooks, then append updated ones
  const existingHooks: ClaudeHook[] = Array.isArray(existing['hooks'])
    ? (existing['hooks'] as ClaudeHook[])
    : [];

  const nonRoadieHooks = existingHooks.filter(
    (h) => !h.description?.startsWith('Roadie:'),
  );

  const merged: ClaudeSettings = {
    ...existing,
    hooks: [...nonRoadieHooks, ...roadieHooks],
  };

  const content = JSON.stringify(merged, null, 2) + '\n';

  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, content, 'utf8');

  return content;
}
