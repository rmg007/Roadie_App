/**
 * @module workflow-engine
 * @description Finite state machine that executes multi-step workflows.
 *   Accepts a WorkflowDefinition and WorkflowContext, traverses steps
 *   sequentially, streams progress, manages state transitions, and
 *   respects CancellationToken at every step boundary.
 *   Parallel steps (via Promise.allSettled) are supported for step
 *   type 'parallel' with branches.
 * @inputs WorkflowDefinition, WorkflowContext
 * @outputs WorkflowResult
 * @depends-on step-executor.ts, types.ts, shell/logger.ts
 * @depended-on-by shell/chat-participant.ts (workflow dispatch)
 */

import { execSync } from 'node:child_process';
import type {
  WorkflowDefinition,
  WorkflowContext,
  WorkflowResult,
  WorkflowStep,
  StepResult,
  ModelTier,
  PausedWorkflowSession,
  QuestionStepConfig,
  SerializableWorkflowContext,
  WorkflowSnapshot,
  ProjectModel,
} from '../types';
import { WorkflowState } from '../types';
import { StepExecutor } from './step-executor';
import { InterviewerAgent } from '../spawner/interviewer-agent';
import { DatabaseAgent } from '../spawner/database-agent';
import { BackendAgent } from '../spawner/backend-agent';
import { FrontendAgent } from '../spawner/frontend-agent';
import type { Logger } from '../platform-adapters';
import { STUB_LOGGER } from '../platform-adapters';
import type { LearningDatabase } from '../learning/learning-database';

// H4: Definition registry for snapshot deserialization
const WORKFLOW_DEFINITION_REGISTRY: Record<string, WorkflowDefinition> = {};

/**
 * Register a workflow definition for later lookup during snapshot resumption.
 */
export function registerWorkflowDefinition(definition: WorkflowDefinition): void {
  WORKFLOW_DEFINITION_REGISTRY[definition.id] = definition;
}

/**
 * Look up a workflow definition by ID (H4: Function Serialization).
 */
function getWorkflowDefinitionById(id: string): WorkflowDefinition | null {
  return WORKFLOW_DEFINITION_REGISTRY[id] || null;
}

/**
 * Create a git checkpoint before executing a workflow.
 * Returns the commit SHA if successful, null if git is unavailable or an error occurs.
 */
function createGitCheckpoint(workflowId: string, log: Logger): string | null {
  try {
    // Check if we're in a git repo
    execSync('git rev-parse --git-dir', { encoding: 'utf-8', stdio: 'pipe' });

    const message = `Roadie checkpoint before ${workflowId}`;
    const sha = execSync(`git commit --allow-empty -m "${message}"`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    })
      .trim()
      .match(/\[[\w\s]*\s([a-f0-9]+)\]/)?.[1];

    if (sha) {
      log.debug(`[GIT] Checkpoint created: ${sha.substring(0, 7)} — ${message}`);
      return sha;
    }
    return null;
  } catch {
    // Not a git repo or git command failed — silently skip checkpointing
    log.debug('[GIT] Checkpoint skipped (not a git repo or git unavailable)');
    return null;
  }
}

export class WorkflowEngine {
  private stepExecutor: StepExecutor;
  /** Session storage for paused workflows keyed by sessionId */
  private pausedSessions: Map<string, PausedWorkflowSession> = new Map();
  /** Learning database for P4 snapshot persistence (optional) */
  private learningDb?: LearningDatabase;
  // H9: Track state per workflow execution (not instance-level)
  private executionState: Map<string, WorkflowState> = new Map();
  private log: Logger;

  constructor(stepExecutor: StepExecutor, learningDb?: LearningDatabase, log: Logger = STUB_LOGGER) {
    this.stepExecutor = stepExecutor;
    this.learningDb = learningDb;
    this.log = log;
  }

  /** Get current workflow state for a specific workflow (H9: Engine State Isolation).
   * For backward compatibility with tests, if no workflowId is provided, returns the last recorded state.
   */
  getState(workflowId?: string): WorkflowState {
    if (workflowId) {
      return this.executionState.get(workflowId) || WorkflowState.PENDING;
    }
    // Backward compatibility: return the most recent state if no workflowId specified
    // This is used by tests that don't track workflowId
    let lastState = WorkflowState.PENDING;
    for (const state of this.executionState.values()) {
      lastState = state; // Get the last value (iteration order is insertion order in Map)
    }
    return lastState;
  }

  /**
   * Execute a complete workflow.
   *
   * State transitions:
   *   PENDING -> RUNNING -> [RETRYING | WAITING_PARALLEL]
   *   -> COMPLETED | PAUSED | FAILED | CANCELLED
   *
   * Creates a git checkpoint before execution for rollback capability on failure.
   */
  async execute(
    definition: WorkflowDefinition,
    context: WorkflowContext,
  ): Promise<WorkflowResult> {
    // use this.log
    if (!definition.steps || definition.steps.length === 0) {
      throw new Error(`Workflow '${definition.id}' has no steps defined.`);
    }
    const totalSteps = definition.steps.length;

    // H9: Use local state variable for this execution
    let state = WorkflowState.PENDING;
    this.executionState.set(definition.id, state);

    // Phase 3: Create git checkpoint for rollback capability
    const checkpointSha = createGitCheckpoint(definition.id, this.log);

    this.transition(definition.id, state, WorkflowState.RUNNING);
    state = WorkflowState.RUNNING;

    const stepResults: StepResult[] = [];
    const tiersUsed = new Set<ModelTier>();
    const startTime = Date.now();

    for (let i = 0; i < definition.steps.length; i++) {
      const step = definition.steps[i];
      if (step === undefined) continue;

      // Check cancellation at step boundary
      if (context.cancellation.isCancelled) {
        this.transition(definition.id, state, WorkflowState.CANCELLED);
        state = WorkflowState.CANCELLED;
        this.log.info(`[${definition.id}] Cancelled before step ${i + 1}/${totalSteps}: "${step.name}"`);
        break;
      }

      this.log.info(`[${definition.id}] Step ${i + 1}/${totalSteps}: "${step.name}" — starting`);

      // 1. Token Hygiene Check (WISC Framework)
      // If estimated context > 80% of model limit, trigger Isolate/Compress advice
      const contextSaturation = this.estimateContextSaturation(context);
      if (contextSaturation > 0.8) {
        this.log.warn(`[${definition.id}] Context saturation high (${(contextSaturation * 100).toFixed(0)}%). Applying WISC: Isolate & Compress.`);
        context.progress.report('⚠️ Context saturation high. Pruning unrelated files to maintain reasoning quality.');
        await this.performWISCCompression(context);
      }

      // Pre-execution approval gate: pause BEFORE running the step body
      if (step.requiresApproval === true && !context.isAutonomous) {


        const sessionId = `${definition.id}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        this.transition(definition.id, state, WorkflowState.WAITING_FOR_APPROVAL);
        state = WorkflowState.WAITING_FOR_APPROVAL;

        this.pausedSessions.set(sessionId, {
          sessionId,
          workflowId: definition.id,
          currentStepIndex: i,
          definition,
          context,
          stepResults: [...stepResults],
          modelTiersUsed: [...tiersUsed],
          timestamp: new Date(),
        });

        if (this.learningDb) {
          const threadId = context.threadId || 'unknown';
          const snapshot: WorkflowSnapshot = {
            id: sessionId,
            workflowId: definition.id,
            currentStepIndex: i,
            definition: definition.id,
            context: this.serializeContext(context),
            stepResults: [...stepResults],
            completedStepIds: stepResults.map((r) => r.stepId),
            modelTiersUsed: [...tiersUsed],
            status: 'paused',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            threadId,
          };
          await this.learningDb.saveWorkflowSnapshot(snapshot);
          this.log.debug(`Workflow snapshot saved for approval: ${definition.id} at step ${i + 1}`);
        }

        this.log.info(
          `[${definition.id}] Step ${i + 1}/${totalSteps} paused — ` +
          `requires approval. Session ID: ${sessionId}`,
        );

        context.progress.report(
          `**Proceed with "${step.name}"?** Reply \`yes\` to continue or \`no\` to abort. (Session: ${sessionId})`,
        );

        this.executionState.set(definition.id, state);
        return {
          workflowId: definition.id,
          state,
          stepResults,
          duration: Date.now() - startTime,
          modelTiersUsed: [...tiersUsed],
          summary: `Workflow '${definition.name}': ${stepResults.length}/${totalSteps} steps completed, awaiting approval on "${step.name}". Session: ${sessionId}`,
          pausedSessionId: sessionId,
          pauseReason: 'approval',
          lastStepName: step.name,
        };
      }

      // Stream progress to chat
      context.progress.report(`Running: ${step.name}…`);

      // Execute step (sequential, parallel, question, or interviewer agent)
      let result: StepResult;
      const stepStart = Date.now();

      if (step.type === 'question') {
        result = await this.executeQuestionStep(step, context);
      } else if (step.agentRole === 'interviewer') {
        result = await this.executeInterviewerAgent(step, context);
      } else if (step.type === 'parallel' && step.branches && step.branches.length > 0) {
        this.transition(definition.id, state, WorkflowState.WAITING_PARALLEL);
        this.log.info(`[${definition.id}] Parallel branches: ${step.branches.length}`);
        result = await this.executeParallelBranches(step, context, tiersUsed);
      } else {
        result = await this.stepExecutor.executeStep(step, context);
      }

      const stepMs = Date.now() - stepStart;
      stepResults.push(result);

      // Track model tier
      if (result.modelUsed) {
        tiersUsed.add(step.modelTier);
      }

      // Thread results to next step
      context.previousStepResults = [...stepResults];

      // Handle step failure (Self-Healing Escalation)
      if (result.status === 'failed') {
        if ((step.maxRetries ?? 0) > 0 && step.agentRole !== 'strategist') {
          this.log.info(`[${definition.id}] Step failed after max retries. Escalating to Strategist for Self-Healing/Plan Refinement.`);
          context.progress.report('🔄 Step failed consistently. Escalating to Strategist to refine the plan...');
          await this.escalateToStrategist(step, context, result.error);
          // Retry the step ONE last time with the refined plan
          result = await this.stepExecutor.executeStep(step, context);
        }

        if (result.status === 'failed') {
          this.transition(definition.id, state, WorkflowState.PAUSED);
          state = WorkflowState.PAUSED;
          this.log.warn(
            `[${definition.id}] Step ${i + 1}/${totalSteps}: "${step.name}" — ` +
            `FAILED after ${result.attempts} attempt(s), ${stepMs}ms` +
            (result.error ? ` — ${result.error}` : ''),
          );
          break;
        }
      }

      this.log.info(
        `[${definition.id}] Step ${i + 1}/${totalSteps}: "${step.name}" — ` +
        `done (${result.status}, ${result.attempts} attempt(s), ` +
        `model: ${result.modelUsed || 'n/a'}, ${stepMs}ms)`,
      );

      // Back to RUNNING for next step
      state = WorkflowState.RUNNING;
    }

    // Final state
    if (state === WorkflowState.RUNNING) {
      this.transition(definition.id, state, WorkflowState.COMPLETED);
      state = WorkflowState.COMPLETED;
    }

    const totalMs = Date.now() - startTime;
    const succeeded = stepResults.filter((r) => r.status === 'success').length;
    this.log.info(
      `[${definition.id}] Final state: ${state} — ` +
      `${succeeded}/${stepResults.length} steps, ${totalMs}ms`,
    );

    this.executionState.set(definition.id, state);
    const workflowResult: WorkflowResult = {
      workflowId:      definition.id,
      state,
      stepResults,
      duration:        totalMs,
      modelTiersUsed:  [...tiersUsed],
      summary:         this.buildSummary(definition, stepResults, state),
    };

    // Phase 3: Add rollback info if workflow failed and checkpoint exists
    if ((state === WorkflowState.PAUSED || state === WorkflowState.FAILED) && checkpointSha) {
      workflowResult.rollbackAvailable = true;
      workflowResult.rollbackSha = checkpointSha;
      workflowResult.rollbackCommand = `git reset --hard ${checkpointSha.substring(0, 7)}`;
      this.log.info(
        `[${definition.id}] Workflow failed. Rollback available: ${workflowResult.rollbackCommand}`,
      );
    }

    // Call onComplete hook if defined and workflow completed
    if (state === WorkflowState.COMPLETED && definition.onComplete) {
      try {
        return await definition.onComplete(stepResults);
      } catch (err: unknown) {
        const error = err instanceof Error ? err.message : String(err);
        this.log.warn(`Workflow onComplete hook failed: ${error}`, err);
        return workflowResult;
      }
    }

    return workflowResult;
  }

  /** Execute parallel branches via Promise.allSettled. */
  private async executeParallelBranches(
    step: WorkflowStep,
    context: WorkflowContext,
    tiersUsed: Set<ModelTier>,
  ): Promise<StepResult> {
    // use this.log
    const branches = step.branches!;

    this.log.debug(`[parallel] Spawning ${branches.length} branches: [${branches.map((b) => b.id).join(', ')}]`);

    const results = await Promise.allSettled(
      branches.map((branch) => {
        const branchContext = { ...context };
        if (context.previousStepResults) {
          branchContext.previousStepResults = [...context.previousStepResults];
        } else {
          delete branchContext.previousStepResults;
        }
        return this.executeLayerAgent(branch, branchContext);
      }),
    );

    const branchResults: StepResult[] = [];
    let anyFailed = false;

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r === undefined) continue;
      const branch = branches[i];
      if (branch === undefined) continue;
      if (r.status === 'fulfilled') {
        branchResults.push(r.value);
        if (r.value.modelUsed) tiersUsed.add(branch.modelTier);
        if (r.value.status === 'failed') {
          anyFailed = true;
          this.log.warn(`[parallel] Branch "${branch.id}" failed: ${r.value.error ?? '(no detail)'}`);
        } else {
          this.log.debug(`[parallel] Branch "${branch.id}" succeeded`);
        }
      } else {
        anyFailed = true;
        const errMsg = r.reason instanceof Error ? r.reason.message : String(r.reason);
        this.log.warn(`[parallel] Branch "${branch.id}" rejected: ${errMsg}`);
        branchResults.push({
          stepId:     branch.id,
          status:     'failed',
          output:     '',
          tokenUsage: { input: 0, output: 0 },
          attempts:   1,
          modelUsed:  '',
          error:      errMsg,
        });
      }
    }

    const passed = branchResults.filter((r) => r.status === 'success').length;
    this.log.info(`[parallel] ${passed}/${branches.length} branches succeeded`);

    // Aggregate into a single StepResult for the parent parallel step
    return {
      stepId:     step.id,
      status:     anyFailed ? 'failed' : 'success',
      output:     branchResults.map((r) => r.output).join('\n---\n'),
      toolResults: branchResults.flatMap((r) => r.toolResults ?? []),
      tokenUsage: {
        input:  branchResults.reduce((sum, r) => sum + r.tokenUsage.input, 0),
        output: branchResults.reduce((sum, r) => sum + r.tokenUsage.output, 0),
      },
      attempts:  1,
      modelUsed: branchResults.map((r) => r.modelUsed).join(', '),
    };
  }

  /**
   * Execute a layer agent step (database, backend, or frontend).
   * Routes to the appropriate agent based on agentRole.
   */
  private async executeLayerAgent(
    step: WorkflowStep,
    context: WorkflowContext,
  ): Promise<StepResult> {
    // use this.log
    const agentRole = step.agentRole as string;

    this.log.debug(`[layer-agent] Executing ${agentRole} agent for step "${step.id}"`);

    try {
      if (agentRole === 'database') {
        const agent = new DatabaseAgent(
          (context.projectModel as any).modelProvider || { sendRequest: async () => ({ text: '' }) },
          context.progress,
        );
        // H2: Forward conventions as final arg
        const result = await agent.generate(
          context.requirementsBrief || '',
          context.interviewTranscript || [],
          context.conventions,
        );
        context.databaseSchema = result.schemaPrisma;
        context.databaseTypes = result.typesTS;
        return {
          stepId: step.id,
          status: 'success',
          output: result.schemaPrisma,
          tokenUsage: { input: 0, output: 0 },
          attempts: 1,
          modelUsed: 'claude',
        };
      } else if (agentRole === 'backend') {
        const agent = new BackendAgent(
          (context.projectModel as any).modelProvider || { sendRequest: async () => ({ text: '' }) },
          context.progress,
        );
        // H2: Forward conventions as final arg
        const result = await agent.generate(
          context.requirementsBrief || '',
          (context as any).apiSpec || '',
          (context as any).databaseSchema || '',
          context.conventions,
        );
        context.backendRoutes = result.routesTS;
        context.backendAuth = result.authTS;
        context.backendErrors = result.errorsTS;
        return {
          stepId: step.id,
          status: 'success',
          output: result.routesTS,
          tokenUsage: { input: 0, output: 0 },
          attempts: 1,
          modelUsed: 'claude',
        };
      } else if (agentRole === 'frontend') {
        const agent = new FrontendAgent(
          (context.projectModel as any).modelProvider || { sendRequest: async () => ({ text: '' }) },
          context.progress,
        );
        // H2: Forward conventions as final arg
        const result = await agent.generate(
          context.requirementsBrief || '',
          (context as any).apiSpec || '',
          context.conventions,
        );
        context.frontendPages = result.pagesTSX;
        context.frontendForms = result.formsTSX;
        context.frontendHooks = result.useApiTS;
        context.frontendTypes = result.typesTS;
        return {
          stepId: step.id,
          status: 'success',
          output: result.pagesTSX,
          tokenUsage: { input: 0, output: 0 },
          attempts: 1,
          modelUsed: 'claude',
        };
      } else {
        // Fallback to StepExecutor for unknown agent roles
        return await this.stepExecutor.executeStep(step, context);
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      this.log.error(`[layer-agent] ${agentRole} agent failed: ${error}`);
      return {
        stepId: step.id,
        status: 'failed',
        output: '',
        tokenUsage: { input: 0, output: 0 },
        attempts: 1,
        modelUsed: 'claude',
        error,
      };
    }
  }

  /**
   * Execute a question step that prompts for user input.
   * Stores the response in context[responseField] for later steps to use.
   */
  private async executeQuestionStep(
    step: any,
    context: WorkflowContext,
  ): Promise<StepResult> {
    // use this.log
    const config = step as QuestionStepConfig & { id: string; name: string };

    this.log.info(`[question] Step "${config.id}": prompting for "${config.responseField}"`);

    // For now, return a placeholder result indicating the question was asked
    // In production, this would integrate with the chat UI to capture user input
    const placeholderResponse = `[Question posed: ${config.prompt}]`;
    context[config.responseField] = placeholderResponse;

    return {
      stepId: config.id,
      status: 'success',
      output: `Question asked and awaiting response: ${config.prompt}`,
      tokenUsage: { input: 0, output: 0 },
      attempts: 1,
      modelUsed: 'question-input',
    };
  }

  /**
   * Execute an interviewer agent step that conducts a requirements interview.
   * Stores interview results in context for downstream steps to use.
   */
  private async executeInterviewerAgent(
    step: WorkflowStep,
    context: WorkflowContext,
  ): Promise<StepResult> {
    // use this.log
    const modelProvider = (context.projectModel as any)?.modelProvider;
    if (!modelProvider) {
      this.log.warn('[interview] ModelProvider not available — falling back to stepExecutor');
      return this.stepExecutor.executeStep(step, context);
    }
    const interviewer = new InterviewerAgent(modelProvider, context.progress);
    const result = await interviewer.conduct(context, step.modelTier || 'standard');

    // Store interview results in context for downstream steps
    context.interviewTranscript = result.transcript;
    context.requirementsBrief = result.requirementsBrief;
    context.interviewConfidence = result.finalConfidence;

    this.log.info(
      `[${context.intent.type}] Interview complete: ${result.totalQuestions} questions, ` +
      `${result.finalConfidence}% confidence, stopped by: ${result.stoppedBy}`,
    );

    return {
      stepId: step.id,
      status: 'success',
      output: result.requirementsBrief,
      toolResults: [],
      tokenUsage: { input: 0, output: 0 },
      attempts: 1,
      modelUsed: 'claude',
    };
  }

  private buildSummary(definition: WorkflowDefinition, results: StepResult[], state?: WorkflowState): string {
    const succeeded = results.filter((r) => r.status === 'success').length;
    const total = results.length;
    return `Workflow '${definition.name}': ${succeeded}/${total} steps completed. State: ${state || 'COMPLETED'}`;
  }

  /**
   * Resume a paused workflow from a previous approval checkpoint.
   *
   * @param sessionId The session ID returned when workflow paused
   * @param userApproval true to continue, false to cancel
   * @returns Updated WorkflowResult (either COMPLETED, CANCELLED, or WAITING_FOR_APPROVAL again)
   */

  /**
   * Returns true if the given sessionId corresponds to a workflow currently
   * paused and awaiting approval. Used by roadie_chat to route resume vs. new execution.
   */
  hasPausedSession(sessionId: string): boolean {
    return this.pausedSessions.has(sessionId);
  }

  /**
   * Replace stale cancellation/progress handles from a previous chat turn
   * with the current turn's handles. Must be called before resume().
   */
  rebindTurnHandles(
    sessionId: string,
    handles: Pick<WorkflowContext, 'cancellation' | 'progress'>,
  ): void {
    const session = this.pausedSessions.get(sessionId);
    if (!session) return;
    session.context.cancellation = handles.cancellation;
    session.context.progress = handles.progress;
  }

  async resume(
    sessionId: string,
    userApproval: boolean,
  ): Promise<WorkflowResult> {
    // use this.log
    const session = this.pausedSessions.get(sessionId);

    if (!session) {
      const error = `Session not found: ${sessionId}`;
      this.log.error(error);
      throw new Error(error);
    }

    const {
      workflowId,
      definition,
      context,
      currentStepIndex,
      stepResults,
      modelTiersUsed,
    } = session;

    this.log.info(`[${workflowId}] Resuming from session ${sessionId}, approval: ${userApproval}`);

    // Clean up the paused session
    this.pausedSessions.delete(sessionId);

    // H9: Use local state variable for this execution
    let state = this.executionState.get(workflowId) || WorkflowState.PENDING;

    // If user rejected, cancel workflow
    if (!userApproval) {
      this.transition(workflowId, state, WorkflowState.CANCELLED);
      state = WorkflowState.CANCELLED;
      this.executionState.set(workflowId, state);
      this.log.info(`[${workflowId}] Workflow cancelled by user at step ${currentStepIndex + 1}`);

      return {
        workflowId,
        state,
        stepResults,
        duration: Date.now() - (session.timestamp?.getTime() || 0),
        modelTiersUsed: [...modelTiersUsed],
        summary: `Workflow '${definition.name}' cancelled by user after step ${currentStepIndex + 1}`,
      };
    }

    // User approved, continue from next step
    this.transition(workflowId, state, WorkflowState.RUNNING);
    state = WorkflowState.RUNNING;
    const totalSteps = definition.steps.length;
    const tiersUsed = new Set<ModelTier>(modelTiersUsed);
    const resumeStartTime = Date.now();

    for (let i = currentStepIndex + 1; i < definition.steps.length; i++) {
      const step = definition.steps[i];
      if (step === undefined) continue;

      // Check cancellation at step boundary
      if (context.cancellation.isCancelled) {
        this.transition(workflowId, state, WorkflowState.CANCELLED);
        state = WorkflowState.CANCELLED;
        this.log.info(
          `[${workflowId}] Cancelled during resume at step ${i + 1}/${totalSteps}: "${step.name}"`,
        );
        break;
      }

      this.log.info(
        `[${workflowId}] Step ${i + 1}/${totalSteps}: "${step.name}" — starting (resumed)`,
      );

      // Pre-execution approval gate
      if (step.requiresApproval === true) {
        const newSessionId = `${workflowId}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        this.transition(workflowId, state, WorkflowState.WAITING_FOR_APPROVAL);
        state = WorkflowState.WAITING_FOR_APPROVAL;

        this.pausedSessions.set(newSessionId, {
          sessionId: newSessionId,
          workflowId,
          currentStepIndex: i,
          definition,
          context,
          stepResults: [...stepResults],
          modelTiersUsed: [...tiersUsed],
          timestamp: new Date(),
        });

        this.log.info(
          `[${workflowId}] Step ${i + 1}/${totalSteps} paused — ` +
          `requires approval. Session ID: ${newSessionId}`,
        );

        context.progress.report(
          `**Proceed with "${step.name}"?** Reply \`yes\` to continue or \`no\` to abort. (Session: ${newSessionId})`,
        );

        this.executionState.set(workflowId, state);
        return {
          workflowId,
          state,
          stepResults,
          duration: Date.now() - resumeStartTime,
          modelTiersUsed: [...tiersUsed],
          summary: `Workflow '${definition.name}': ${stepResults.length}/${totalSteps} steps completed, awaiting approval on "${step.name}". Session: ${newSessionId}`,
          pausedSessionId: newSessionId,
          pauseReason: 'approval',
          lastStepName: step.name,
        };
      }

      // Stream progress to chat
      context.progress.report(`Running: ${step.name}…`);

      // Execute step (sequential, parallel, question, or interviewer agent)
      let result: StepResult;
      const stepStart = Date.now();

      if (step.type === 'question') {
        result = await this.executeQuestionStep(step, context);
      } else if (step.agentRole === 'interviewer') {
        result = await this.executeInterviewerAgent(step, context);
      } else if (step.type === 'parallel' && step.branches && step.branches.length > 0) {
        this.transition(workflowId, state, WorkflowState.WAITING_PARALLEL);
        state = WorkflowState.WAITING_PARALLEL;
        this.log.info(`[${workflowId}] Parallel branches: ${step.branches.length}`);
        result = await this.executeParallelBranches(step, context, tiersUsed);
      } else {
        result = await this.stepExecutor.executeStep(step, context);
      }

      const stepMs = Date.now() - stepStart;
      stepResults.push(result);

      // Track model tier
      if (result.modelUsed) {
        tiersUsed.add(step.modelTier);
      }

      // Thread results to next step
      context.previousStepResults = [...stepResults];

      // Handle step failure
      if (result.status === 'failed') {
        this.transition(workflowId, state, WorkflowState.PAUSED);
        state = WorkflowState.PAUSED;
        this.log.warn(
          `[${workflowId}] Step ${i + 1}/${totalSteps}: "${step.name}" — ` +
          `FAILED after ${result.attempts} attempt(s), ${stepMs}ms` +
          (result.error ? ` — ${result.error}` : ''),
        );
        break;
      }

      this.log.info(
        `[${workflowId}] Step ${i + 1}/${totalSteps}: "${step.name}" — ` +
        `done (${result.status}, ${result.attempts} attempt(s), ` +
        `model: ${result.modelUsed || 'n/a'}, ${stepMs}ms)`,
      );

      // Back to RUNNING for next step
      state = WorkflowState.RUNNING;
    }

    // Final state
    if (state === WorkflowState.RUNNING) {
      this.transition(workflowId, state, WorkflowState.COMPLETED);
      state = WorkflowState.COMPLETED;
    }

    const totalMs = Date.now() - resumeStartTime;
    const succeeded = stepResults.filter((r) => r.status === 'success').length;
    this.log.info(
      `[${workflowId}] Final state (resumed): ${state} — ` +
      `${succeeded}/${stepResults.length} steps, ${totalMs}ms`,
    );

    this.executionState.set(workflowId, state);
    const workflowResult: WorkflowResult = {
      workflowId,
      state,
      stepResults,
      duration: totalMs,
      modelTiersUsed: [...tiersUsed],
      summary: this.buildSummary(definition, stepResults, state),
    };

    // Call onComplete hook if defined and workflow completed
    if (state === WorkflowState.COMPLETED && definition.onComplete) {
      try {
        return await definition.onComplete(stepResults);
      } catch (err: unknown) {
        const error = err instanceof Error ? err.message : String(err);
        this.log.warn(`Workflow onComplete hook failed: ${error}`, err);
        return workflowResult;
      }
    }

    return workflowResult;
  }

  /**
   * P4 Engine: Serialize workflow context to storable format.
   * Extracts safe, serializable fields only — no function refs or provider objects.
   */
  private serializeContext(context: WorkflowContext): SerializableWorkflowContext {
    return {
      prompt: context.prompt,
      intent: context.intent,
      projectModel: { tech: 'unknown' }, // Minimal projection
      interviewTranscript: context.interviewTranscript,
      requirementsBrief: context.requirementsBrief,
      interviewConfidence: context.interviewConfidence,
      databaseSchema: (context as any).databaseSchema,
      backendRoutes: (context as any).backendRoutes,
      backendAuth: (context as any).backendAuth,
      frontendPages: (context as any).frontendPages,
    };
  }

  /**
   * P4 Engine: Reconstruct workflow context from serialized snapshot.
   * Re-attaches progress reporter, cancellation handle, and projectModel (H3).
   */
  private deserializeContext(
    json: SerializableWorkflowContext,
    progress: ReturnType<typeof getLogger> extends any ? any : never,
    projectModel?: ProjectModel,
  ): WorkflowContext {
    // For typing simplicity: accept progress as any since it's a ProgressReporter mock
    return {
      prompt: json.prompt,
      intent: json.intent,
      projectModel: projectModel || ({} as ProjectModel), // H3: Use passed projectModel
      progress,
      cancellation: { isCancelled: false },
      interviewTranscript: json.interviewTranscript,
      requirementsBrief: json.requirementsBrief,
      interviewConfidence: json.interviewConfidence,
      databaseSchema: json.databaseSchema,
      backendRoutes: json.backendRoutes,
      backendAuth: json.backendAuth,
      frontendPages: json.frontendPages,
    };
  }

  /**
   * P4 Engine: Resume workflow from a persisted snapshot.
   * Loads snapshot from learning database and continues from currentStepIndex + 1.
   *
   * @param snapshotId ID of snapshot to resume from
   * @param progress Progress reporter for streaming updates
   * @param projectModel Fresh ProjectModel instance (H3: Broken projectModel Reconstruction)
   * @returns Final WorkflowResult after resumption
   */
  async resumeFromSnapshot(
    snapshotId: string,
    progress: any, // ProgressReporter type
    projectModel?: ProjectModel,
  ): Promise<WorkflowResult> {
    // use this.log

    if (!this.learningDb) {
      throw new Error('Learning database not configured for snapshot resumption');
    }

    const snapshot = await this.learningDb.loadWorkflowSnapshot(snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    const {
      workflowId,
      definition: definitionId,
      context: serialized,
      currentStepIndex,
      stepResults,
      status,
      completedStepIds,
      modelTiersUsed,
    } = snapshot;

    // H4: Look up full definition from registry using the ID
    const definition = typeof definitionId === 'string'
      ? getWorkflowDefinitionById(definitionId)
      : (definitionId as any); // Fallback for legacy snapshots with full definition

    if (!definition) {
      throw new Error(`Workflow definition not found for ID: ${definitionId}`);
    }

    this.log.info(`[${workflowId}] Resuming from snapshot ${snapshotId} at step ${currentStepIndex + 1}`);

    // Reconstruct context with fresh progress/cancellation and proper projectModel (H3)
    const context = this.deserializeContext(serialized, progress, projectModel);
    context.previousStepResults = [...stepResults];

    // Continue execution loop from next step
    const totalSteps = definition.steps.length;
    // H10: Initialize tiersUsed from snapshot
    const tiersUsed = new Set<ModelTier>(modelTiersUsed || []);
    const resumeStartTime = Date.now();
    // H6: Capture timestamp for snapshot ID uniqueness
    const runStartTs = Date.now();
    // H9: Use local state variable for this execution
    let state = WorkflowState.RUNNING;
    this.executionState.set(workflowId, state);

    for (let i = currentStepIndex + 1; i < definition.steps.length; i++) {
      const step = definition.steps[i];
      if (step === undefined) continue;

      // Check cancellation at step boundary
      if (context.cancellation.isCancelled) {
        this.transition(workflowId, state, WorkflowState.CANCELLED);
        state = WorkflowState.CANCELLED;
        this.log.info(`[${workflowId}] Cancelled during snapshot resumption at step ${i + 1}/${totalSteps}`);
        break;
      }

      this.log.info(`[${workflowId}] Step ${i + 1}/${totalSteps}: "${step.name}" — starting (snapshot resume)`);

      // Pre-execution approval gate
      if (step.requiresApproval === true) {
        const newSessionId = `${workflowId}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        this.transition(workflowId, state, WorkflowState.WAITING_FOR_APPROVAL);
        state = WorkflowState.WAITING_FOR_APPROVAL;
        this.pausedSessions.set(newSessionId, {
          sessionId: newSessionId,
          workflowId,
          currentStepIndex: i,
          definition,
          context,
          stepResults: [...stepResults],
          modelTiersUsed: [...tiersUsed],
          timestamp: new Date(),
        });

        this.log.info(`[${workflowId}] Approval required at step ${i + 1}. Session: ${newSessionId}`);
        context.progress.report(
          `**Proceed with "${step.name}"?** Reply \`yes\` to continue or \`no\` to abort. (Session: ${newSessionId})`,
        );

        this.executionState.set(workflowId, state);
        return {
          workflowId,
          state,
          stepResults,
          duration: Date.now() - resumeStartTime,
          modelTiersUsed: [...tiersUsed],
          summary: `Snapshot resumed: ${stepResults.length}/${totalSteps} steps completed, awaiting approval. Session: ${newSessionId}`,
          pausedSessionId: newSessionId,
          pauseReason: 'approval',
          lastStepName: step.name,
        };
      }

      context.progress.report(`Running: ${step.name}…`);

      let result: StepResult;
      const stepStart = Date.now();

      if (step.type === 'question') {
        result = await this.executeQuestionStep(step, context);
      } else if (step.agentRole === 'interviewer') {
        result = await this.executeInterviewerAgent(step, context);
      } else if (step.type === 'parallel' && step.branches && step.branches.length > 0) {
        this.transition(workflowId, state, WorkflowState.WAITING_PARALLEL);
        state = WorkflowState.WAITING_PARALLEL;
        result = await this.executeParallelBranches(step, context, tiersUsed);
      } else {
        result = await this.stepExecutor.executeStep(step, context);
      }

      const stepMs = Date.now() - stepStart;
      stepResults.push(result);

      if (result.modelUsed) {
        tiersUsed.add(step.modelTier);
      }

      context.previousStepResults = [...stepResults];

      // Handle step failure
      if (result.status === 'failed') {
        this.transition(workflowId, state, WorkflowState.PAUSED);
        state = WorkflowState.PAUSED;
        this.log.warn(
          `[${workflowId}] Step ${i + 1}/${totalSteps}: "${step.name}" FAILED — ${result.error ?? 'unknown'}`,
        );
        break;
      }

      this.log.info(`[${workflowId}] Step ${i + 1}/${totalSteps}: "${step.name}" done (${stepMs}ms)`);

      // H5: Idempotency — skip steps already completed
      const currentCompletedIds = new Set(completedStepIds || []);
      currentCompletedIds.add(step.id);

      // Save intermediate snapshot after successful step
      if (this.learningDb) {
        // H6: Snapshot ID Collision — use timestamp for uniqueness
        const intermediateSnapshot: WorkflowSnapshot = {
          id: `${snapshotId}-${runStartTs}-step${i}`,
          workflowId,
          currentStepIndex: i,
          definition: workflowId, // H4: Store definition ID, not full object
          context: this.serializeContext(context),
          stepResults: [...stepResults],
          completedStepIds: Array.from(currentCompletedIds),
          modelTiersUsed: Array.from(tiersUsed),
          status: 'saved',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          threadId: (snapshot as any).threadId || 'unknown',
        };
        await this.learningDb.saveWorkflowSnapshot(intermediateSnapshot);
        this.log.debug(`Workflow snapshot saved: ${workflowId} at step ${i + 1}`);
      }

      // Check approval requirement (now handled by pre-execution gate above)

      state = WorkflowState.RUNNING;
    }

    // Final completion
    if (state === WorkflowState.RUNNING) {
      this.transition(workflowId, state, WorkflowState.COMPLETED);
      state = WorkflowState.COMPLETED;
    }

    const totalMs = Date.now() - resumeStartTime;
    const succeeded = stepResults.filter((r) => r.status === 'success').length;
    this.log.info(`[${workflowId}] Final state (snapshot resume): ${state} — ${succeeded}/${stepResults.length} steps`);

    this.executionState.set(workflowId, state);
    return {
      workflowId,
      state,
      stepResults,
      duration: totalMs,
      modelTiersUsed: [...tiersUsed],
      summary: `Snapshot resumed: ${succeeded}/${totalSteps} steps completed.`,
    };
  }

  /** Estimate context saturation relative to model's typical context window. */
  private estimateContextSaturation(context: WorkflowContext): number {
    // Phase 1: Simple estimation based on previous results and project model size
    const contextStr = JSON.stringify(this.serializeContext(context));
    const tokenEstimate = contextStr.length / 4; // Rough tokens
    const modelLimit = 200_000; // Typical 2026 model standard
    return tokenEstimate / modelLimit;
  }

  /** Apply WISC: Compress/Prune context to stay within token hygiene limits. */
  private async performWISCCompression(context: WorkflowContext): Promise<void> {
    // Prune old step outputs or large file dumps from context
    if (context.previousStepResults && context.previousStepResults.length > 5) {
      context.previousStepResults = context.previousStepResults.slice(-3);
    }
  }

  /** Self-Healing: Call a Strategist agent to explain the failure and refine the plan. */
  private async escalateToStrategist(step: WorkflowStep, context: WorkflowContext, error?: string): Promise<void> {
    const strategistStep: WorkflowStep = {
      id: `healing-${step.id}`,
      name: `Self-Healing for ${step.name}`,
      type: 'sequential',
      agentRole: 'strategist' as any,
      modelTier: 'premium',
      toolScope: 'research',
      contextScope: 'full',
      promptTemplate: `<role>You are a Principal Strategist.</role>\n<task>\nAnalyze why the previous step failed and refine the plan.\n</task>\n<context>\nFailed Step: {failed_step}\nError: {error}\n</context>`,
    };

    // Use a simplified handler for the strategist recovery
    const healingResult = await this.stepExecutor.executeStep(strategistStep, {
      ...context,
      failed_step: step.name,
      error,
    } as any);

    if (healingResult.status === 'success') {
      context.refinedPlan = healingResult.output;
      context.progress.report('✅ Strategist refined the plan. Retrying step...');
    }
  }

  private transition(
    workflowId: string,
    from: WorkflowState,
    to: WorkflowState,
  ): void {
    const state = this.executionState.get(workflowId) ?? 'UNKNOWN';
    this.log.debug(`[${workflowId}] ${state} → ${to}`);
    // H9: Update execution state map instead of instance field
    this.executionState.set(workflowId, to);
  }
}
