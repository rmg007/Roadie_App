/**
 * @module mcp/tools/generator-tools
 * @description MCP tool handlers for file generation operations.
 *   Implements: generate_file, generate_all_files.
 * @inputs Record<string, unknown> (validated input args), ContainerServices
 * @outputs CallToolResult (MCP SDK type)
 * @depends-on container.ts, generator/file-generator.ts, types.ts
 * @depended-on-by mcp/server.ts
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ContainerServices } from '../../container';
import type { GeneratedFileType } from '../../types';

// Map from MCP fileType strings to internal GeneratedFileType
const FILE_TYPE_MAP: Record<string, GeneratedFileType> = {
  'copilot-instructions': 'copilot_instructions',
  'agents-md':            'agents_md',
};

// File types that require Phase 3 LLM generation (not yet implemented)
const FUTURE_FILE_TYPES = new Set([
  'typescript-instructions',
  'react-instructions',
  'python-instructions',
  'debugger-agent',
  'reviewer-agent',
  'hooks',
  'pr-template',
  'issue-templates',
  'mcp-config',
  'claude-hooks',
]);

// =====================================================================
// generate_file
// =====================================================================

/**
 * Generate or regenerate a specific .github/ file.
 */
export async function handleGenerateFile(
  input: Record<string, unknown>,
  services: ContainerServices,
): Promise<CallToolResult> {
  const { fileGenerator, projectModel } = services;
  const fileType = input['fileType'] as string;
  const force    = (input['force'] as boolean | undefined) ?? false;

  if (FUTURE_FILE_TYPES.has(fileType)) {
    return textResult(
      JSON.stringify({
        fileType,
        status:  'not_available',
        message: `${fileType} generation requires LLM support (Phase 3). Use roadie/generate_all_files for copilot-instructions and agents-md.`,
      }),
    );
  }

  const internalType = FILE_TYPE_MAP[fileType];
  if (!internalType) {
    return errorResult(`Unknown file type: ${fileType}`, 'UNKNOWN_FILE_TYPE');
  }

  if (projectModel.getTechStack().length === 0) {
    return errorResult(
      'Project has not been analyzed. Call roadie/analyze_project first.',
      'MODEL_EMPTY',
    );
  }

  try {
    // Force: generate with a temporary model clone that always writes
    // For now we rely on file-generator's internal force logic via re-generation
    const result = await fileGenerator.generate(internalType, projectModel);
    return textResult(
      JSON.stringify({
        fileType,
        path:        result.path,
        written:     result.written,
        contentHash: result.contentHash,
        sizeBytes:   Buffer.byteLength(result.content, 'utf8'),
      }),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResult(`Generation failed: ${msg}`, 'GENERATION_FAILED');
  }
}

// =====================================================================
// generate_all_files
// =====================================================================

/**
 * Regenerate all .github/ files from current project model.
 */
export async function handleGenerateAllFiles(
  input: Record<string, unknown>,
  services: ContainerServices,
): Promise<CallToolResult> {
  const { fileGenerator, projectModel } = services;
  const _force  = (input['force'] as boolean | undefined) ?? false;

  if (projectModel.getTechStack().length === 0) {
    return errorResult(
      'Project has not been analyzed. Call roadie/analyze_project first.',
      'MODEL_EMPTY',
    );
  }

  try {
    const results = await fileGenerator.generateAll(projectModel);
    const summary = results.map((r) => ({
      type:    r.type,
      path:    r.path,
      written: r.written,
      hash:    r.contentHash,
    }));

    const writtenCount = results.filter((r) => r.written).length;

    return textResult(
      JSON.stringify({
        status:       'ok',
        filesTotal:   results.length,
        filesWritten: writtenCount,
        filesSkipped: results.length - writtenCount,
        files:        summary,
      }),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResult(`Generation failed: ${msg}`, 'GENERATION_FAILED');
  }
}

// =====================================================================
// Helpers
// =====================================================================

function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

function errorResult(message: string, code: string): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message, code }) }],
    isError: true,
  };
}
