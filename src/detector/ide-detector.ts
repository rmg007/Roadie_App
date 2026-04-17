/**
 * @module detector/ide-detector
 * @description Detects active IDEs/tools in workspace via env vars + file system markers.
 *   Used to conditionally generate tool-specific config files.
 * @inputs workspaceRoot: string
 * @outputs DetectionResult with detected IDEs and primary IDE
 * @depends-on providers (FileSystemProvider for file checks)
 * @depended-on-by file-generator.ts
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface DetectionResult {
  isVSCode: boolean;
  isCursor: boolean;
  isClaudeCode: boolean;
  isWindsurf: boolean;
  detectedIDEs: string[];
  primaryIDE: string | null;
}

/**
 * Detects which IDEs/tools are active in the workspace.
 * Checks environment variables first, then file system markers.
 * Returns ambiguous result if multiple IDEs detected.
 */
export async function detectIDEs(workspaceRoot: string): Promise<DetectionResult> {
  const detected: string[] = [];

  // 1. Check environment: VS Code sets VSCODE_PID when running extensions
  if (process.env.VSCODE_PID) {
    detected.push('vscode');
  }

  // 2. File system markers: Cursor
  try {
    await fs.stat(path.join(workspaceRoot, '.cursor'));
    detected.push('cursor');
  } catch {
    // .cursor doesn't exist, continue
  }

  // 3. File system markers: Claude Code
  const hasMcpJson = await fileExists(path.join(workspaceRoot, '.mcp.json'));
  const hasClaudeDir = await fileExists(path.join(workspaceRoot, '.claude'));
  if (hasMcpJson || hasClaudeDir) {
    detected.push('claude-code');
  }

  // 4. File system markers: Windsurf
  try {
    await fs.stat(path.join(workspaceRoot, '.windsurf'));
    detected.push('windsurf');
  } catch {
    // .windsurf doesn't exist, continue
  }

  // Determine primary IDE (unambiguous if only one detected)
  const primaryIDE: string | null = detected.length === 1 ? (detected[0] ?? null) : null;

  return {
    isVSCode: detected.includes('vscode'),
    isCursor: detected.includes('cursor'),
    isClaudeCode: detected.includes('claude-code'),
    isWindsurf: detected.includes('windsurf'),
    detectedIDEs: detected,
    primaryIDE,
  };
}

/**
 * Helper: Check if file exists (silently handles missing files).
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect if running under Claude Code hooks (when hook env vars are set).
 */
export function isRunningUnderClaudeCodeHooks(): boolean {
  return !!(
    process.env.TOOL_USE_ID ||
    process.env.TRANSCRIPT_PATH ||
    process.env.TOOL ||
    process.env.FILE
  );
}
