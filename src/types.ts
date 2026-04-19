/**
 * @module types
 * @description Single source of truth for all module boundary contracts.
 *   Every module in Phase 1 imports types from this file.
 *   Types flow outward — no circular imports.
 * @inputs None (type-only module)
 * @outputs All shared TypeScript interfaces and types
 * @depends-on providers (for ProgressReporter, CancellationHandle)
 * @depended-on-by Every module in the project
 */

import type { ProgressReporter, CancellationHandle } from './providers';
// Keep vscode import for wrapper types at bottom of file
import * as vscode from 'vscode';

// =====================================================================
// Intent Classification Types
// =====================================================================

/**
 * The 9 intent types that the classifier can produce.
 * Each maps to a workflow or to passthrough enrichment.
 *
 * NEW: 'clarify' intent signals that the user is correcting/refining
 * a PREVIOUS intent (not starting a new task). Routed back to
 * SessionManager to resume paused workflow or ask for clarification.
 */
export type IntentType =
  | 'bug_fix'
  | 'feature'
  | 'refactor'
  | 'review'
  | 'document'
  | 'dependency'
  | 'onboard'
  | 'clarify'
  | 'resume'
  | 'command'
  | 'general_chat';

/**
 * Result of intent classification.
 * Produced by IntentClassifier, consumed by ChatParticipantHandler.
 *
 * @property intent The classified intent type
 * @property confidence Score 0.0-1.0 indicating classifier certainty
 * @property signals List of keywords/patterns matched (for debugging)
 * @property requiresLLM True if local classifier confidence < 0.7, indicating LLM fallback needed
 */
export interface ClassificationResult {
  intent: IntentType;
  confidence: number; // 0.0 to 1.0
  signals: string[]; // Matched keywords, e.g. ["fix", "error", "login"]
  requiresLLM: boolean;
}

// =====================================================================
// Intent Classifier Interface
// =====================================================================

/**
 * Two-tier intent classifier.
 * Tier 1: Local keyword/regex (instant, zero cost).
 * Tier 2: LLM classification piggybacked on the first response (double-duty call).
 *
 * The ChatParticipantHandler uses this interface:
 * 1. Call classify(prompt) for local classification
 * 2. If requiresLLM is true, prepend getClassificationPromptPrefix() to the system prompt
 * 3. After receiving the LLM response, call parseClassification(responseText)
 * 4. If parseClassification returns null, fall back to general_chat
 */
export interface IntentClassifier {
  /** Local classification (instant, zero cost) */
  classify(prompt: string): ClassificationResult;
  /** Parse LLM classification from a response that includes structured output */
  parseClassification(responseText: string): ClassificationResult | null;
  /** Generate the structured-output prefix to prepend to the system prompt */
  getClassificationPromptPrefix(): string;
}

// =====================================================================
// Workflow Engine Types
// =====================================================================

/**
 * Workflow execution states.
 * Transitions: PENDING -> RUNNING -> [WAITING_PARALLEL | RETRYING | WAITING_FOR_APPROVAL] -> COMPLETED | PAUSED | FAILED | CANCELLED
 */
export enum WorkflowState {
  PENDING = 'PENDING', // Created, not yet started
  RUNNING = 'RUNNING', // Currently executing a step
  WAITING_PARALLEL = 'WAITING_PARALLEL', // Waiting for parallel branches
  RETRYING = 'RETRYING', // Step failed, retrying with escalation
  WAITING_FOR_APPROVAL = 'WAITING_FOR_APPROVAL', // Step requires user approval before continuing
  PAUSED = 'PAUSED', // Step failed 3x, awaiting developer intervention
  COMPLETED = 'COMPLETED', // All steps succeeded
  FAILED = 'FAILED', // Workflow aborted (only on cancellation)
  CANCELLED = 'CANCELLED', // Developer cancelled
}

/**
 * Declarative definition of a workflow.
 * The workflow engine interprets this and executes it.
 */
export interface WorkflowDefinition {
  /** Unique ID for this workflow: 'bug_fix', 'feature', 'refactor', etc. */
  id: string;
  /** Human-readable name for logging/UI */
  name: string;
  /** Sequential list of steps to execute */
  steps: WorkflowStep[];
  /** Optional: hook called after all steps complete */
  onComplete?: (results: StepResult[]) => Promise<WorkflowResult>;
}

/**
 * Single step in a workflow.
 */
export interface WorkflowStep {
  /** Unique ID within the workflow */
  id: string;
  /** Human-readable name for progress updates */
  name: string;
  /** 'sequential': execute after previous step completes.
   *  'parallel': execute concurrently with siblings (via Promise.allSettled()).
   *  'conditional': execute based on predicate from previous step result. */
  type: 'sequential' | 'parallel' | 'conditional';
  /** The role the subagent plays (diagnostician, fixer, planner, etc.) */
  agentRole: AgentRole;
  /** Starting model tier for this step (free/standard/premium) */
  modelTier: ModelTier;
  /** Which tools the subagent can invoke */
  toolScope: ToolScope;
  /** System prompt template (may contain {variable} placeholders) */
  promptTemplate: string;
  /** Maximum time to wait for step to complete (milliseconds) */
  timeoutMs: number;
  /** Maximum retries with escalation before reporting failure */
  maxRetries: number;
  /** For parallel steps: list of sub-steps to run concurrently */
  branches?: WorkflowStep[];
  /** For conditional steps: predicate that returns next step ID or null */
  condition?: (previousResult: StepResult) => string | null;
  /** Optional context scope override for this step. When set, toContext() is called
   *  with this scope instead of 'full', reducing prompt token usage.
   *  Defaults to 'full' if omitted. */
  contextScope?: 'full' | 'stack' | 'structure' | 'commands' | 'patterns';
  /** If true, pause workflow after this step completes successfully and wait for user approval */
  requiresApproval?: boolean;
}

/**
 * Context passed to workflow engine and threaded through each step.
 * Phase 2: uses provider abstractions instead of direct VS Code API types.
 */
export interface WorkflowContext {
  /** The developer's original prompt */
  prompt: string;
  /** Classification result from IntentClassifier */
  intent: ClassificationResult;
  /** Project model (for context injection) */
  projectModel: ProjectModel;
  /** Stream for sending progress updates to chat UI */
  progress: ProgressReporter;
  /** Handle for cancelling the workflow */
  cancellation: CancellationHandle;
  /** If true, bypasses all human-in-the-loop approval gates (Turbo Mode) */
  isAutonomous: boolean;
  /** Results from previous step (if any) */
  previousStepResults?: StepResult[];
  /** Full transcript from interviewer agent (if conducted) */
  interviewTranscript?: ConversationTurn[];
  /** Requirements brief generated by interviewer agent (if conducted) */
  requirementsBrief?: string;
  /** Final confidence score from interviewer agent (if conducted) */
  interviewConfidence?: number;
  /** Project conventions from CLAUDE.md (H2: P7 conventions injection) */
  conventions?: ProjectConventions;
  /** Thread ID for chat continuity and snapshot lookups (Bug 4: P3) */
  threadId?: string;
  /** Dynamic fields for storing question responses and custom data */
  [key: string]: unknown;
}

/**
 * Result of executing a single workflow step.
 */
export interface StepResult {
  /** Step ID */
  stepId: string;
  /** Success, failure, skipped, or cancelled. 
   * Mapping: 'success' -> 'ok', 'failed' -> 'error'. */
  status: 'success' | 'failed' | 'skipped' | 'cancelled' | 'ok' | 'error';
  /** Text output from the subagent */
  output: string;
  /** Results from any tools the subagent invoked */
  toolResults?: ToolCallResult[];
  /** Token usage for this step */
  tokenUsage: { input: number; output: number };
  /** Number of attempts before success (or max attempts if failed) */
  attempts: number;
  /** Which model was used for the successful attempt (e.g., 'gpt-4.1') */
  modelUsed: string;
  /** Human-readable error message if status === 'failed' */
  error?: string;
}

/**
 * Final result of a complete workflow execution.
 */
export interface WorkflowResult {
  /** Workflow ID */
  workflowId: string;
  /** Final state */
  state: WorkflowState;
  /** Results from all steps */
  stepResults: StepResult[];
  /** Total execution time in milliseconds */
  duration: number;
  /** Which model tiers were used (for cost tracking) */
  modelTiersUsed: ModelTier[];
  /** Human-readable summary for chat display */
  summary: string;
  /** Session ID when workflow is paused (for resume) */
  pausedSessionId?: string;
  /** Reason the workflow was paused */
  pauseReason?: 'approval' | 'step-failure';
  /** Name of the last step that triggered the pause */
  lastStepName?: string;
}

/**
 * Snapshot of a paused workflow waiting for user approval.
 * Stored in WorkflowEngine's session map and keyed by session ID.
 */
export interface PausedWorkflowSession {
  /** Unique session ID */
  sessionId: string;
  /** Workflow ID */
  workflowId: string;
  /** Current step index that just completed and requires approval */
  currentStepIndex: number;
  /** Workflow definition for later resumption */
  definition: WorkflowDefinition;
  /** Workflow context threaded through steps */
  context: WorkflowContext;
  /** Results from all completed steps so far */
  stepResults: StepResult[];
  /** Model tiers used so far */
  modelTiersUsed: ModelTier[];
  /** Timestamp when paused */
  timestamp: Date;
}

// =====================================================================
// Agent Spawner Types
// =====================================================================

/**
 * Role-specific prompt configurations (not separate Chat Participants).
 * Each role has its own system prompt, tool scope, and model preference.
 */
export type AgentRole =
  | 'diagnostician' // Locate and diagnose errors
  | 'fixer' // Generate and apply fixes
  | 'planner' // Plan feature implementation
  | 'database_agent' // Schema changes, migrations, queries
  | 'backend_agent' // API endpoints, business logic
  | 'frontend_agent' // UI components, state, styling
  | 'refactorer' // Incremental code restructuring
  | 'security_reviewer' // Security analysis (OWASP, injection, secrets)
  | 'performance_reviewer' // Performance analysis (N+1, memory leaks)
  | 'quality_reviewer' // Code quality (duplication, naming, patterns)
  | 'test_reviewer' // Test coverage and edge cases
  | 'standards_reviewer' // Project convention compliance
  | 'documentarian' // Generate and update documentation
  | 'project_analyzer'; // Build and maintain project model

/**
 * Cost tier for LLM calls.
 */
export type ModelTier = 'free' | 'standard' | 'premium';

/**
 * Tool scoping per step type.
 */
export type ToolScope = 'research' | 'implementation' | 'review' | 'documentation';

/**
 * Step type union including interactive question steps.
 */
export type StepType = 'sequential' | 'parallel' | 'conditional' | 'question';

/**
 * Configuration for question/interactive steps.
 * Pauses workflow and prompts user for input.
 */
export interface QuestionStepConfig {
  type: 'question';
  prompt: string;
  responseField: string;
}

/**
 * Configuration passed to AgentSpawner to create a subagent.
 */
export interface AgentConfig {
  /** Agent role (determines system prompt) */
  role: AgentRole;
  /** Starting model tier */
  modelTier: ModelTier;
  /** Tool scope (research/implementation/review/documentation) */
  tools: ToolScope;
  /** System prompt template (may contain {variable} placeholders) */
  promptTemplate: string;
  /** Context injected into prompt (tech stack, patterns, etc.) */
  context: Record<string, unknown>;
  /** Signal used to cancel the underlying model request */
  cancellation?: AbortSignal;
  /** Maximum time to wait for agent response (milliseconds) */
  timeoutMs: number;
}

/**
 * Result from spawning and executing an agent.
 */
export interface AgentResult {
  /** Text output from the agent */
  output: string;
  /** Results from any tool calls */
  toolResults: ToolCallResult[];
  /** Token usage */
  tokenUsage: { input: number; output: number };
  /** 'success', 'failed', or 'timeout' */
  status: 'success' | 'failed' | 'timeout';
  /** Which model was used (e.g., 'gpt-4.1', 'claude-sonnet-4.6') */
  model: string;
  /** Error message if status !== 'success' */
  error?: string;
}

/**
 * Result from a tool invocation within an agent.
 */
export interface ToolCallResult {
  /** Name of the tool called (e.g., 'readFile', 'searchWorkspace') */
  tool: string;
  /** Input to the tool */
  input: unknown;
  /** Output from the tool */
  output: unknown;
  /** Whether the tool call succeeded */
  success: boolean;
  /** Error message if success === false */
  error?: string;
}

// =====================================================================
// Project Model Types
// =====================================================================

/**
 * Main interface for the project model.
 * Provides typed access to all project information.
 */
export interface ProjectModel {
  /** Serialized context string for LLM prompts. */
  getTechStack(): TechStackEntry[];
  getDirectoryStructure(): DirectoryNode;
  getDirectoryTree(): DirectoryNode | undefined;
  getPatterns(): DetectedPattern[];
  getPreferences(): DeveloperPreferences;
  getCommands(): ProjectCommand[];
  getConventions(): ProjectConventions | undefined;
  getOverview(): string;
  /**
   * Accepts optional parameters for token budgeting and scope filtering.
   * @param options.maxTokens - Token budget for the serialized output
   * @param options.scope - Filter to specific context categories
   * @param options.relevantPaths - Only include context relevant to these paths
   */
  toContext(options?: {
    maxTokens?: number;
    scope?: 'full' | 'stack' | 'structure' | 'commands' | 'patterns';
    relevantPaths?: string[];
  }): ProjectContext;
  /** Apply a delta update to the model */
  update(delta: ProjectModelDelta): void;
}

/**
 * Single tech stack entry (language, framework, runtime, etc.).
 */
export interface TechStackEntry {
  /** 'language', 'framework', 'runtime', 'orm', 'test_tool', 'build_tool', 'package_manager' */
  category: string;
  /** Name of the tech (TypeScript, React, Vitest) */
  name: string;
  /** Semver version if detectable */
  version?: string;
  /** File where this was detected (package.json, tsconfig.json) */
  sourceFile: string;
}

/**
 * Represents the directory tree structure.
 */
export interface DirectoryNode {
  /** Absolute path */
  path: string;
  /** 'directory' or 'file' */
  type: 'directory' | 'file';
  /** 'source', 'test', 'config', 'output', 'static' (if applicable) */
  role?: string;
  /** Detected language for code files (typescript, javascript, python, etc.) */
  language?: string;
  /** Child nodes if type === 'directory' */
  children?: DirectoryNode[];
}

/**
 * A detected coding pattern or convention.
 */
export interface DetectedPattern {
  /** Category: 'export_style', 'test_convention', 'error_handling', etc. */
  category: string;
  /** Human-readable description (e.g., "Uses named exports only") */
  description: string;
  /** Evidence: files sampled, match count, confidence */
  evidence: {
    files: string[];
    matchCount: number;
    confidence: number;
  };
  /** Overall confidence 0.0-1.0 */
  confidence: number;
}

/**
 * A command detected in the project (build, test, dev, lint, format).
 */
export interface ProjectCommand {
  /** Name: 'build', 'test', 'dev', 'lint', 'format' */
  name: string;
  /** Full command string (e.g., 'npm run test') */
  command: string;
  /** Where it came from (package.json, Makefile, etc.) */
  sourceFile: string;
  /** Type of command */
  type: 'build' | 'test' | 'dev' | 'lint' | 'format' | 'other';
}

/**
 * Developer preferences (from configuration and detected patterns).
 */
export interface DeveloperPreferences {
  testCommand?: string; // Custom test runner override
  modelPreference?: 'economy' | 'balanced' | 'quality';
  telemetryEnabled: boolean;
  autoCommit: boolean;
}

/**
 * Serialized context for LLM prompts.
 * Produced by ProjectModel.toContext().
 */
export interface ProjectContext {
  techStack: TechStackEntry[];
  directoryStructure: DirectoryNode;
  patterns: DetectedPattern[];
  commands: ProjectCommand[];
  /** The full serialized string ready for prompt injection */
  serialized: string;
}

/**
 * Delta update for partial model changes.
 */
export interface ProjectModelDelta {
  techStack?: TechStackEntry[];
  directories?: DirectoryNode[];
  patterns?: DetectedPattern[];
  commands?: ProjectCommand[];
  conventions?: ProjectConventions;
}

// =====================================================================
// Phase 1.5: Persistent Project Model Extension
// =====================================================================

/**
 * Classified file change from the File Watcher.
 */
export interface ClassifiedFileChange {
  filePath: string;
  eventType: 'create' | 'change' | 'delete';
  classifiedAs: ChangeType;
  timestamp: Date;
}

export type ChangeType =
  | 'DEPENDENCY_CHANGE'
  | 'CONFIG_CHANGE'
  | 'STRUCTURE_CHANGE'
  | 'SOURCE_ADDITION'
  | 'USER_EDIT'
  | 'OTHER';

/**
 * Result of model reconciliation with the file system at startup.
 */
export interface ReconciliationResult {
  status: 'in-sync' | 'reconciled' | 'rebuilt';
  changesDetected: number;
  categoriesUpdated: string[];
  durationMs: number;
}

/**
 * Phase 1.5 extension of ProjectModel with SQLite persistence,
 * incremental updates, and change event subscriptions.
 * Extends (does not modify) the Phase 1 ProjectModel interface.
 */
export interface PersistentProjectModel extends ProjectModel {
  /** Load model state from SQLite. Called at activation. */
  loadFromDb(): Promise<void>;
  /** Flush pending changes to SQLite. Called at deactivation and periodically. */
  saveToDb(): Promise<void>;
  /** Compare model state against current file system. Fix discrepancies. */
  reconcileWithFileSystem(): Promise<ReconciliationResult>;
  /** Apply incremental update from file watcher event. */
  applyFileChange(change: ClassifiedFileChange): Promise<void>;
  /** Check if the model has been populated (vs empty/first-run). */
  isPopulated(): boolean;
  /** Get timestamp of last successful analysis. */
  getLastAnalyzedAt(): Date | null;
  /** Subscribe to model change events (used by generators). */
  onModelChanged(listener: (delta: ProjectModelDelta) => void): Disposable;
  /** Deactivate: flush and cleanup. */
  deactivate(): Promise<void>;
}

/**
 * Disposable subscription handle.
 */
export interface Disposable {
  dispose(): void;
}

/**
 * Type guard: checks if a ProjectModel is a PersistentProjectModel.
 */
export function isPhase15Active(model: ProjectModel): model is PersistentProjectModel {
  return 'loadFromDb' in model && (model as PersistentProjectModel).isPopulated();
}

// =====================================================================
// File Generation Types
// =====================================================================

/**
 * Types of files Roadie generates in Phase 1.
 */
export type GeneratedFileType =
  | 'copilot_instructions'  // .github/copilot-instructions.md
  | 'agents_md'             // AGENTS.md at project root
  | 'agent_operating_rules'  // .github/AGENT_OPERATING_RULES.md
  | 'granular_agent'        // .github/agents/*.agent.md
  | 'codebase_dictionary'   // .github/codebase-dictionary.md (M24, Phase 1.5)
  | 'claude_md'             // CLAUDE.md at workspace root (Claude Code)
  | 'cursor_rules'          // .cursor/rules/project.mdc (Cursor)
  | 'cursor_rules_dir'      // .cursor/rules/{dir}.mdc (Cursor per-directory)
  | 'path_instructions';    // .github/instructions/{dir}.instructions.md (Copilot path-scoped)

/**
 * Reason a generated file was written or skipped.
 *  - 'new'       File did not exist — written fresh
 *  - 'updated'   Existing file had different content — overwritten
 *  - 'unchanged' Content hash identical — write skipped
 *  - 'deferred'  File is open in editor — write deferred to avoid conflict
 */
export type WriteReason = 'new' | 'updated' | 'unchanged' | 'deferred' | 'error';

/**
 * Generated file with content and metadata.
 */
export interface GeneratedFile {
  /** File type */
  type: GeneratedFileType;
  /** Full path relative to workspace root */
  path: string;
  /** File content (markdown) */
  content: string;
  /** SHA-256 hash of content for change detection */
  contentHash: string;
  /** Whether the file was actually written (false if identical to existing) */
  written: boolean;
  /** Why the file was written or skipped */
  writeReason: WriteReason;
}

// =====================================================================
// Error Types
// =====================================================================

/**
 * Standard error shape thrown by Roadie modules.
 */
export interface RoadieError extends Error {
  /** Error code for programmatic handling */
  code: string;
  /** 'validation' | 'timeout' | 'cancelled' | 'escalation' | 'external' */
  category: string;
  /** Whether the error should be shown to the developer */
  userFacing: boolean;
  /** Detailed context for debugging */
  context?: Record<string, unknown>;
}

/**
 * Specific error for step execution failures.
 */
export class StepExecutionError extends Error {
  constructor(
    public stepId: string,
    public attempt: number,
    public maxRetries: number,
    message: string,
  ) {
    super(message);
  }
}

// =====================================================================
// VS Code API Wrappers
// =====================================================================

/**
 * Wrapper for VS Code's Language Model API.
 * Returned by vscode.lm.selectChatModels().
 */
export type LanguageModelChat = vscode.LanguageModelChat;

/**
 * Wrapper for VS Code's chat response stream.
 */
export type ChatResponseStream = vscode.ChatResponseStream;

// =====================================================================
// Codebase Dictionary Types
// =====================================================================

export interface CodeEntity {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'enum'
      | 'constant' | 'route' | 'model' | 'component';
  filePath: string;
  lineNumber: number;
  signature: string;
  purpose: string;
  isExported: boolean;
  createdByWorkflow: string;
  createdAt: string;  // ISO 8601
}

export interface EntityRelationship {
  sourceEntityName: string;
  sourceFilePath: string;
  targetEntityName: string;
  targetFilePath: string;
  relationship: string;
}

export interface RecordEntitiesParams {
  filePath: string;
  fileContent: string;
  workflowType: string;
  stepId: string;
  originalPrompt: string;
}

export interface EntityWriter {
  recordEntities(params: RecordEntitiesParams): Promise<void>;
  invalidateFile(filePath: string): Promise<void>;
}

export interface DictionaryContextOptions {
  relevantPaths?: string[];
  maxChars?: number;
  includeKinds?: CodeEntity['kind'][];
}

export interface DictionaryContext {
  summary: string;
  entityCount: number;
  truncated: boolean;
}

export interface DictionaryQuery {
  getEntitiesInFiles(filePaths: string[]): Promise<CodeEntity[]>;
  getDependents(entityName: string, filePath: string): Promise<CodeEntity[]>;
  getDependencies(entityName: string, filePath: string): Promise<CodeEntity[]>;
  search(query: string, limit?: number): Promise<CodeEntity[]>;
  toContext(options?: DictionaryContextOptions): Promise<DictionaryContext>;
  getEntityCount(): Promise<number>;
}

// =====================================================================
// Interviewer Agent Types
// =====================================================================

/**
 * Single turn in a requirements interview conversation.
 */
export interface ConversationTurn {
  /** The question asked by the interviewer */
  question: string;
  /** The user's response to the question */
  answer: string;
  /** Optional: LLM confidence score (0-100) after this answer */
  confidence?: number;
}

/**
 * Result of a complete requirements interview.
 */
export interface InterviewResult {
  /** Full transcript of questions and answers */
  transcript: ConversationTurn[];
  /** Final confidence score (0-100) that requirements are adequately gathered */
  finalConfidence: number;
  /** Markdown-formatted summary of collected requirements */
  requirementsBrief: string;
  /** Total number of questions asked */
  totalQuestions: number;
  /** Reason the interview stopped: confidence threshold met, max questions reached, or user signal */
  stoppedBy: 'confidence' | 'max_questions' | 'user_signal';
}

// =====================================================================
// P4 Engine Types (Workflow Snapshot Persistence)
// =====================================================================

/**
 * Serializable workflow definition (H4: Function Serialization).
 * Contains only data fields, no function closures or callbacks.
 */
export interface SerializableWorkflowDefinition {
  /** Unique ID for this workflow */
  id: string;
  /** Human-readable name */
  name: string;
  /** Sequential list of steps (data only) */
  steps: Array<{
    id: string;
    name: string;
    type: 'sequential' | 'parallel' | 'conditional';
    agentRole: AgentRole;
    modelTier: ModelTier;
    toolScope: ToolScope;
    promptTemplate: string;
    timeoutMs: number;
    maxRetries: number;
    branches?: Array<any>;
    contextScope?: 'full' | 'stack' | 'structure' | 'commands' | 'patterns';
    requiresApproval?: boolean;
  }>;
}

/**
 * Serializable context snapshot for workflow persistence.
 * Contains only safe, serializable fields — no function refs or provider objects.
 */
export interface SerializableWorkflowContext {
  prompt: string;
  intent: ClassificationResult;
  projectModel: { tech?: string }; // Minimal serializable projection
  interviewTranscript?: ConversationTurn[];
  requirementsBrief?: string;
  interviewConfidence?: number;
  databaseSchema?: string;
  backendRoutes?: string;
  backendAuth?: string;
  frontendPages?: string;
  [key: string]: unknown;
}

/**
 * Snapshot of a workflow state for persistence and resumption.
 * Stored in learning database for later recovery.
 */
export interface WorkflowSnapshot {
  /** Unique snapshot ID */
  id: string;
  /** Workflow ID this snapshot belongs to */
  workflowId: string;
  /** Index of the last completed step */
  currentStepIndex: number;
  /** Workflow definition ID (string ref, not full definition) (H4) */
  definition: string;
  /** Serialized context at time of snapshot */
  context: SerializableWorkflowContext;
  /** Results from completed steps */
  stepResults: StepResult[];
  /** IDs of steps that have been completed (H5: Idempotency on Resume) */
  completedStepIds: string[];
  /** Model tiers used so far (H10: Model Tier Tracking) */
  modelTiersUsed: ModelTier[];
  /** Snapshot status: 'paused' | 'failed' | 'saved' | 'completed' */
  status: string;
  /** ISO 8601 timestamp when snapshot was created */
  createdAt: string;
  /** ISO 8601 timestamp of last update */
  updatedAt: string;
  /** Associated thread ID for chat continuity */
  threadId: string;
}

// =====================================================================
// Project Conventions (from CLAUDE.md)
// =====================================================================

/**
 * Extracted project conventions from CLAUDE.md.
 * Used to guide code generation agents to follow project-specific patterns.
 */
export interface ProjectConventions {
  /** Tech stack entries (languages, frameworks, tools) */
  techStack: string[];
  /** Coding style rules (formatting, structure, patterns) */
  codingStyle: string[];
  /** Naming conventions (variables, functions, classes) */
  namingConventions: string[];
  /** Forbidden patterns or practices */
  forbidden: string[];
  /** Project-specific constraints and requirements */
  constraints: string[];
  /** Recent patterns detected in the codebase */
  recentPatterns: string[];
}

// =====================================================================
// Roadie Configuration
// =====================================================================

/**
 * Integrated configuration for Roadie.
 * Mirrored from package.json contributions.
 */
export interface RoadieConfig {
  /** Enable anonymous telemetry */
  telemetry: boolean;
  /** Track edits to generated files */
  editTracking: boolean;
  /** Persist workflow outcomes */
  workflowHistory: boolean;
  /** Model tier preference */
  modelPreference: 'economy' | 'balanced' | 'quality';
  /** Auto-commit generated files */
  autoCommit: boolean;
  /** Custom test command */
  testCommand: string;
  /** Test timeout in seconds */
  testTimeout: number;
  /** Context logging level */
  contextLensLevel: 'off' | 'summary' | 'full';
}
