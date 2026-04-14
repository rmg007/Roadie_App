/**
 * @module mcp/tools/workflow-tools
 * @description MCP tool handlers for workflow execution and status.
 *   Implements: run_workflow, get_workflow_status.
 *   Phase 2: run_workflow executes synchronously (no background jobs).
 *   Phase 3 will add async execution with real-time status polling.
 * @inputs Record<string, unknown> (validated input args), ContainerServices
 * @outputs CallToolResult (MCP SDK type)
 * @depends-on container.ts, engine/workflow-engine.ts, engine/step-executor.ts,
 *   engine/definitions/*.ts, spawner/agent-spawner.ts, types.ts
 * @depended-on-by mcp/server.ts
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ContainerServices } from '../../container';
import { WorkflowEngine } from '../../engine/workflow-engine';
import { StepExecutor } from '../../engine/step-executor';
import { AgentSpawner } from '../../spawner/agent-spawner';
import { BUG_FIX_WORKFLOW } from '../../engine/definitions/bug-fix';
import { FEATURE_WORKFLOW } from '../../engine/definitions/feature';
import { REFACTOR_WORKFLOW } from '../../engine/definitions/refactor';
import { REVIEW_WORKFLOW } from '../../engine/definitions/review';
import { DOCUMENT_WORKFLOW } from '../../engine/definitions/document';
import { DEPENDENCY_WORKFLOW } from '../../engine/definitions/dependency';
import { ONBOARD_WORKFLOW } from '../../engine/definitions/onboard';
import type { WorkflowDefinition, WorkflowContext, WorkflowResult, ClassificationResult } from '../../types';
import { StderrProgressReporter, NullCancellationHandle } from '../standalone-providers';

// =====================================================================
// Workflow registry
// =====================================================================

const WORKFLOW_REGISTRY: Record<string, WorkflowDefinition> = {
  bug_fix:    BUG_FIX_WORKFLOW,
  feature:    FEATURE_WORKFLOW,
  refactor:   REFACTOR_WORKFLOW,
  review:     REVIEW_WORKFLOW,
  document:   DOCUMENT_WORKFLOW,
  dependency: DEPENDENCY_WORKFLOW,
  onboard:    ONBOARD_WORKFLOW,
};

// =====================================================================
// In-memory execution store (Phase 2: single-process only)
// Phase 3: replace with SQLite-backed execution table
// =====================================================================

interface ExecutionRecord {
  id:        string;
  workflow:  string;
  status:    'running' | 'completed' | 'failed';
  startedAt: number;
  result?:   WorkflowResult;
  error?:    string;
}

const executions = new Map<string, ExecutionRecord>();

function generateExecutionId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `wf_${Date.now().toString(36)}${rand}`;
}

// =====================================================================
// run_workflow
// =====================================================================

/**
 * Trigger a named workflow. Returns the complete result when finished.
 * Phase 2: synchronous execution (blocking until complete).
 */
export async function handleRunWorkflow(
  input: Record<string, unknown>,
  services: ContainerServices,
): Promise<CallToolResult> {
  const workflow = input['workflow'] as string;
  const prompt   = input['prompt']   as string;
  const options  = (input['options'] as Record<string, unknown> | undefined) ?? {};

  const definition = WORKFLOW_REGISTRY[workflow];
  if (!definition) {
    return errorResult(`Unknown workflow: ${workflow}`, 'UNKNOWN_WORKFLOW');
  }

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return errorResult('prompt is required and must be a non-empty string', 'INVALID_PROMPT');
  }

  const executionId = generateExecutionId();
  const record: ExecutionRecord = {
    id:        executionId,
    workflow,
    status:    'running',
    startedAt: Date.now(),
  };
  executions.set(executionId, record);

  const intent: ClassificationResult = {
    intent:     workflow as ClassificationResult['intent'],
    confidence: 1.0,
    signals:    ['mcp_trigger'],
    requiresLLM: false,
  };

  const spawner  = new AgentSpawner(services.modelProvider);
  const executor = new StepExecutor(
    async (step, ctx, attemptInfo) => {
      const agentResult = await spawner.spawn({
        role:           step.agentRole,
        modelTier:      attemptInfo.tier,
        tools:          step.toolScope,
        promptTemplate: step.promptTemplate,
        context:        { prompt: ctx.prompt, projectContext: '' },
        timeoutMs:      step.timeoutMs,
      });
      return {
        stepId:     step.id,
        status:     agentResult.status === 'success' ? 'success' : 'failed',
        output:     agentResult.output,
        tokenUsage: agentResult.tokenUsage,
        attempts:   attemptInfo.attempt,
        modelUsed:  agentResult.model,
        error:      agentResult.error,
      };
    },
  );
  const engine = new WorkflowEngine(executor);

  const context: WorkflowContext = {
    prompt,
    intent,
    projectModel:    services.projectModel,
    progress:        new StderrProgressReporter(),
    cancellation:    new NullCancellationHandle(),
  };

  // Check model preference and timeout from options
  const _modelPreference = (options['modelPreference'] as string | undefined) ?? 'balanced';
  const _testTimeout     = (options['testTimeout']     as number | undefined) ?? 300;
  const _autoApprove     = (options['autoApprove']     as boolean | undefined) ?? true;

  try {
    const result = await engine.execute(definition, context);
    record.status = result.state === 'COMPLETED' ? 'completed' : 'failed';
    record.result = result;

    return textResult(
      JSON.stringify({
        executionId,
        workflow,
        state:       result.state,
        durationMs:  result.duration,
        stepsTotal:  result.stepResults.length,
        stepsOk:     result.stepResults.filter((s) => s.status === 'success').length,
        summary:     result.summary,
        stepResults: result.stepResults.map((s) => ({
          stepId:   s.stepId,
          status:   s.status,
          model:    s.modelUsed,
          tokens:   s.tokenUsage,
          attempts: s.attempts,
          error:    s.error,
        })),
      }),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    record.status = 'failed';
    record.error  = msg;
    return errorResult(`Workflow failed: ${msg}`, 'WORKFLOW_ERROR');
  }
}

// =====================================================================
// get_workflow_status
// =====================================================================

/**
 * Check progress of a running workflow.
 * Phase 2: workflows are synchronous, so this returns post-hoc status.
 */
export async function handleGetWorkflowStatus(
  input: Record<string, unknown>,
  _services: ContainerServices,
): Promise<CallToolResult> {
  const executionId = input['executionId'] as string;

  const record = executions.get(executionId);
  if (!record) {
    return errorResult(`Execution not found: ${executionId}`, 'NOT_FOUND');
  }

  const elapsed = Date.now() - record.startedAt;

  if (record.status === 'running') {
    return textResult(
      JSON.stringify({
        executionId,
        workflow:  record.workflow,
        status:    'running',
        elapsedMs: elapsed,
      }),
    );
  }

  if (record.status === 'failed') {
    return textResult(
      JSON.stringify({
        executionId,
        workflow:  record.workflow,
        status:    'failed',
        elapsedMs: elapsed,
        error:     record.error,
      }),
    );
  }

  if (!record.result) {
    return errorResult('Execution result unavailable', 'NO_RESULT');
  }

  const result = record.result;
  return textResult(
    JSON.stringify({
      executionId,
      workflow:    record.workflow,
      status:      'completed',
      elapsedMs:   elapsed,
      durationMs:  result.duration,
      state:       result.state,
      stepsTotal:  result.stepResults.length,
      stepsOk:     result.stepResults.filter((s) => s.status === 'success').length,
      summary:     result.summary,
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
