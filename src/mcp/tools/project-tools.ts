/**
 * @module mcp/tools/project-tools
 * @description MCP tool handlers for project analysis and context operations.
 *   Implements: analyze_project, get_project_context, rescan_project.
 * @inputs Record<string, unknown> (validated input args), ContainerServices
 * @outputs CallToolResult (MCP SDK type)
 * @depends-on container.ts, analyzer/project-analyzer.ts, model/project-model.ts
 * @depended-on-by mcp/server.ts
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ContainerServices } from '../../container';

// =====================================================================
// analyze_project
// =====================================================================

/**
 * Scan the project structure and return tech stack, patterns, directory
 * structure, and commands.
 */
export async function handleAnalyzeProject(
  input: Record<string, unknown>,
  services: ContainerServices,
): Promise<CallToolResult> {
  const { projectAnalyzer, projectModel, projectRoot } = services;

  const scope  = (input['scope'] as string | undefined) ?? 'full';
  const force  = (input['force'] as boolean | undefined) ?? false;

  // Check if we need to re-analyze (force flag or empty model)
  const alreadyAnalyzed = projectModel.getTechStack().length > 0;
  if (alreadyAnalyzed && !force) {
    return buildProjectSummary(projectModel, scope);
  }

  try {
    await projectAnalyzer.analyze(projectRoot);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResult(`Analysis failed: ${msg}`, 'ANALYSIS_FAILED');
  }

  return buildProjectSummary(projectModel, scope);
}

function buildProjectSummary(
  projectModel: ContainerServices['projectModel'],
  scope: string,
): CallToolResult {
  const techStack = projectModel.getTechStack();
  const commands  = projectModel.getCommands();
  const patterns  = projectModel.getPatterns();

  const result: Record<string, unknown> = { scope };

  if (scope === 'full' || scope === 'dependencies') {
    result['techStack'] = techStack;
  }
  if (scope === 'full' || scope === 'patterns') {
    result['patterns'] = patterns.map((p) => ({
      category:   p.category,
      description: p.description,
      confidence:  p.confidence,
    }));
  }
  if (scope === 'full' || scope === 'commands') {
    result['commands'] = commands;
  }
  if (scope === 'full' || scope === 'structure') {
    result['directoryStructure'] = projectModel.getDirectoryStructure();
  }

  result['summary'] = {
    techStackCount: techStack.length,
    commandCount:   commands.length,
    patternCount:   patterns.length,
  };

  return textResult(JSON.stringify(result, null, 2));
}

// =====================================================================
// get_project_context
// =====================================================================

/**
 * Return the serialized project model as text suitable for LLM prompt injection.
 */
export async function handleGetProjectContext(
  input: Record<string, unknown>,
  services: ContainerServices,
): Promise<CallToolResult> {
  const { projectModel } = services;

  const maxTokens    = (input['maxTokens'] as number | undefined);
  const scope        = (input['scope']     as 'full' | 'stack' | 'structure' | 'commands' | 'patterns' | undefined) ?? 'full';
  const relevantPaths = (input['relevantPaths'] as string[] | undefined);

  // If model is empty return a helpful message
  if (projectModel.getTechStack().length === 0) {
    return textResult(
      JSON.stringify({
        context:  '',
        warning:  'Project has not been analyzed yet. Call roadie/analyze_project first.',
        techStack: [],
        commands:  [],
        patterns:  [],
      }),
    );
  }

  const projectContext = projectModel.toContext({
    maxTokens,
    scope,
    relevantPaths,
  });

  return textResult(
    JSON.stringify({
      serialized:         projectContext.serialized,
      techStack:          projectContext.techStack,
      commands:           projectContext.commands,
      patternCount:       projectContext.patterns.length,
    }),
  );
}

// =====================================================================
// rescan_project
// =====================================================================

/**
 * Force a full re-scan of the project.
 */
export async function handleRescanProject(
  _input: Record<string, unknown>,
  services: ContainerServices,
): Promise<CallToolResult> {
  const { projectAnalyzer, projectModel, projectRoot } = services;

  const startMs = Date.now();
  try {
    await projectAnalyzer.analyze(projectRoot);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResult(`Rescan failed: ${msg}`, 'RESCAN_FAILED');
  }

  const durationMs    = Date.now() - startMs;
  const techStackCount = projectModel.getTechStack().length;
  const commandCount   = projectModel.getCommands().length;

  return textResult(
    JSON.stringify({
      status:         'ok',
      durationMs,
      techStackCount,
      commandCount,
    }),
  );
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
