/**
 * @module mcp/tools/query-tools
 * @description MCP tool handlers for querying patterns, workflow history,
 *   and getting recommendations.
 *   Implements: query_patterns, query_workflow_history, get_recommendations.
 * @inputs Record<string, unknown> (validated input args), ContainerServices
 * @outputs CallToolResult (MCP SDK type)
 * @depends-on container.ts, model/project-model.ts, learning/learning-database.ts
 * @depended-on-by mcp/server.ts
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ContainerServices } from '../../container';

// =====================================================================
// query_patterns
// =====================================================================

/**
 * Return discovered coding patterns, optionally filtered by category and confidence.
 */
export async function handleQueryPatterns(
  input: Record<string, unknown>,
  services: ContainerServices,
): Promise<CallToolResult> {
  const { projectModel } = services;

  const category      = (input['category'] as string | undefined) ?? 'all';
  const minConfidence = (input['minConfidence'] as number | undefined) ?? 0.5;

  const patterns = projectModel.getPatterns().filter((p) => {
    if (category !== 'all' && p.category !== category) return false;
    if (p.confidence < minConfidence) return false;
    return true;
  });

  return textResult(
    JSON.stringify({
      category,
      minConfidence,
      count:    patterns.length,
      patterns: patterns.map((p) => ({
        category:    p.category,
        description: p.description,
        confidence:  p.confidence,
        evidence: {
          files:      p.evidence.files,
          matchCount: p.evidence.matchCount,
        },
      })),
    }),
  );
}

// =====================================================================
// query_workflow_history
// =====================================================================

/**
 * Return past workflow outcomes from the learning database.
 */
export async function handleQueryWorkflowHistory(
  input: Record<string, unknown>,
  _services: ContainerServices,
): Promise<CallToolResult> {
  // LearningDatabase is not exposed on ContainerServices in Phase 2.
  // This returns an empty result with a helpful message.
  // Phase 3 will wire learningDb into ContainerServices.
  const limit        = (input['limit']        as number | undefined) ?? 20;
  const workflowType = (input['workflowType'] as string | undefined);
  const status       = (input['status']       as string | undefined);

  return textResult(
    JSON.stringify({
      limit,
      workflowType: workflowType ?? 'all',
      status:       status ?? 'all',
      count:        0,
      entries:      [],
      note:         'Workflow history persistence is enabled in Phase 3. No entries recorded yet.',
    }),
  );
}

// =====================================================================
// get_recommendations
// =====================================================================

/**
 * Get actionable recommendations for improving AI configuration.
 */
export async function handleGetRecommendations(
  _input: Record<string, unknown>,
  services: ContainerServices,
): Promise<CallToolResult> {
  const { projectModel } = services;

  const recommendations: Array<{ priority: string; action: string; reason: string }> = [];

  const techStack = projectModel.getTechStack();
  const patterns  = projectModel.getPatterns();
  const commands  = projectModel.getCommands();

  // Recommendation: run analysis first if model is empty
  if (techStack.length === 0) {
    recommendations.push({
      priority: 'high',
      action:   'Run roadie/analyze_project to populate the project model',
      reason:   'No tech stack data found. AI context will be minimal until the project is analyzed.',
    });
    return textResult(JSON.stringify({ count: recommendations.length, recommendations }));
  }

  // Recommendation: test command missing
  const hasTest = commands.some((c) => c.type === 'test');
  if (!hasTest) {
    recommendations.push({
      priority: 'medium',
      action:   'Add a test script to package.json (e.g., "test": "vitest run")',
      reason:   'No test command detected. Roadie workflows rely on test commands for verification steps.',
    });
  }

  // Recommendation: low pattern confidence
  const highConfPatterns = patterns.filter((p) => p.confidence >= 0.7);
  if (patterns.length > 0 && highConfPatterns.length === 0) {
    recommendations.push({
      priority: 'low',
      action:   'Add more source files to improve pattern detection confidence',
      reason:   'Pattern confidence is below 0.7 for all categories. More code samples improve accuracy.',
    });
  }

  // Recommendation: TypeScript without strict mode mention
  const hasTS = techStack.some((e) => e.name.toLowerCase().includes('typescript'));
  if (hasTS) {
    recommendations.push({
      priority: 'low',
      action:   'Ensure tsconfig.json has "strict": true for best AI code generation',
      reason:   'TypeScript strict mode gives AI coding agents better type information.',
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      priority: 'info',
      action:   'No immediate improvements detected',
      reason:   `Project model is healthy: ${techStack.length} tech entries, ${commands.length} commands, ${patterns.length} patterns.`,
    });
  }

  return textResult(JSON.stringify({ count: recommendations.length, recommendations }));
}

// =====================================================================
// Helpers
// =====================================================================

function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}
