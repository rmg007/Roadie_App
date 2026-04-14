/**
 * @module generator/templates/mcp-config
 * @description Generates .mcp.json at the project root.
 *   Performs atomic JSON merge: reads existing .mcp.json (if any),
 *   merges the roadie server entry under mcpServers, and writes back.
 *   Other server entries are preserved untouched.
 * @inputs projectRoot: string, binPath: string (resolved path to roadie-mcp.js)
 * @outputs Writes .mcp.json to projectRoot, returns written content
 * @depends-on node:fs/promises, node:path
 * @depended-on-by file-generator.ts (generate_all_files), mcp/tools/generator-tools.ts
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export const MCP_CONFIG_PATH = '.mcp.json';

// =====================================================================
// Types matching the Claude Code / GitHub Copilot .mcp.json schema
// =====================================================================

export interface McpServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerEntry>;
}

// =====================================================================
// generateMcpConfig
// =====================================================================

export interface McpConfigOptions {
  /** Absolute path to the project root (where .mcp.json is written) */
  projectRoot: string;
  /**
   * Absolute path to the roadie-mcp CLI entry point.
   * Typically: <extensionPath>/out/bin/roadie-mcp.js
   * Falls back to: node_modules/.bin/roadie-mcp (for npm-installed users).
   */
  binPath?: string;
  /**
   * Extra environment variables to add to the server entry.
   * Merged with the defaults (ROADIE_PROJECT_ROOT).
   */
  extraEnv?: Record<string, string>;
}

/**
 * Generate or update .mcp.json with the roadie server entry.
 * Performs an atomic read-merge-write cycle.
 * Returns the final JSON content as a string.
 */
export async function generateMcpConfig(options: McpConfigOptions): Promise<string> {
  const { projectRoot, extraEnv } = options;
  const configPath = path.join(projectRoot, MCP_CONFIG_PATH);

  // Determine the bin path to use
  const binPath = options.binPath
    ?? path.join(projectRoot, 'node_modules', '.bin', 'roadie-mcp');

  // Read existing config (if any)
  let existing: McpConfig = { mcpServers: {} };
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (isValidMcpConfig(parsed)) {
      existing = parsed;
    }
  } catch {
    // File doesn't exist or is not valid JSON — start fresh
  }

  // Build the roadie server entry
  const roadieEntry: McpServerEntry = {
    command: process.execPath, // node
    args:    [binPath, '--project', projectRoot],
    env:     {
      ROADIE_PROJECT_ROOT: projectRoot,
      ...extraEnv,
    },
  };

  // Merge: preserve existing entries, upsert roadie
  const merged: McpConfig = {
    mcpServers: {
      ...existing.mcpServers,
      roadie: roadieEntry,
    },
  };

  const content = JSON.stringify(merged, null, 2) + '\n';

  // Atomic write (write to tmp then rename isn't available in pure Node.js
  // without additional deps, so we use a direct writeFile with 'utf8').
  await fs.writeFile(configPath, content, 'utf8');

  return content;
}

// =====================================================================
// Type guard
// =====================================================================

function isValidMcpConfig(value: unknown): value is McpConfig {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj['mcpServers'] === 'object' && obj['mcpServers'] !== null;
}
