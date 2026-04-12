/**
 * @module tool-registry
 * @description Maintains all available tools and returns scoped subsets
 *   based on step type. Research steps get read-only tools. Implementation
 *   steps get read/write tools. Review and documentation steps get their
 *   own scoped sets.
 * @inputs ToolScope ('research' | 'implementation' | 'review' | 'documentation')
 * @outputs Filtered tool list for the requested scope
 * @depends-on types.ts (ToolScope)
 * @depended-on-by agent-spawner.ts
 */

import type { ToolScope } from '../types';

/** Represents a tool available to subagents. */
export interface ToolDefinition {
  name: string;
  description: string;
  readOnly: boolean;
}

/** All tools available in the Roadie extension. */
const ALL_TOOLS: ToolDefinition[] = [
  // Read-only tools (available to all scopes)
  { name: 'readFile', description: 'Read the contents of a file', readOnly: true },
  { name: 'searchWorkspace', description: 'Search files by pattern or content', readOnly: true },
  { name: 'listDirectory', description: 'List files in a directory', readOnly: true },
  { name: 'getFileInfo', description: 'Get file metadata (size, modified date)', readOnly: true },
  { name: 'searchSymbols', description: 'Search for symbols (functions, classes) in the workspace', readOnly: true },

  // Write tools (implementation and some review scopes)
  { name: 'writeFile', description: 'Write content to a file', readOnly: false },
  { name: 'editFile', description: 'Apply edits to a specific range in a file', readOnly: false },
  { name: 'createFile', description: 'Create a new file', readOnly: false },
  { name: 'runCommand', description: 'Execute a shell command (test runner, linter)', readOnly: false },
];

/** Tool scope definitions: which tools are available for each scope. */
const SCOPE_FILTERS: Record<ToolScope, (tool: ToolDefinition) => boolean> = {
  research: (tool) => tool.readOnly,
  implementation: () => true, // all tools
  review: (tool) => tool.readOnly,
  documentation: (tool) => tool.readOnly || tool.name === 'writeFile' || tool.name === 'editFile',
};

export class ToolRegistry {
  /** Get tools available for the given scope. */
  getTools(scope: ToolScope): ToolDefinition[] {
    return ALL_TOOLS.filter(SCOPE_FILTERS[scope]);
  }

  /** Get tool names for the given scope (for passing to LLM API). */
  getToolNames(scope: ToolScope): string[] {
    return this.getTools(scope).map((t) => t.name);
  }
}
