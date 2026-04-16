/**
 * @module schemas
 * @description Runtime validation counterpart to types.ts.
 *   Every interface that crosses a trust boundary (LLM output, file I/O, IPC,
 *   user configuration) has a paired Zod schema here.
 *   Canonical rule: if data originates from an LLM response, a file read, or
 *   a VS Code configuration value, it MUST pass through the corresponding
 *   Zod schema before being consumed by any typed module.
 * @inputs Raw data from external sources
 * @outputs Validated, typed data
 * @depends-on zod
 * @depended-on-by Every module that handles external data
 */

import { z } from 'zod';

// =====================================================================
// Intent Classification Schemas
// =====================================================================

export const IntentTypeSchema = z.enum([
  'bug_fix',
  'feature',
  'refactor',
  'review',
  'document',
  'dependency',
  'onboard',
  'general_chat',
]);

export const ClassificationResultSchema = z.object({
  intent: IntentTypeSchema,
  confidence: z.number().min(0).max(1),
  signals: z.array(z.string()),
  requiresLLM: z.boolean(),
});

// For parsing raw LLM JSON output
export const LLMClassificationResponseSchema = z.object({
  intent: IntentTypeSchema,
  reasoning: z.string().optional(),
});

// =====================================================================
// Workflow Engine Schemas
// =====================================================================

export const ModelTierSchema = z.enum(['free', 'standard', 'premium']);
export const ToolScopeSchema = z.enum(['research', 'implementation', 'review', 'documentation']);
export const AgentRoleSchema = z.enum([
  'diagnostician',
  'fixer',
  'planner',
  'database_agent',
  'backend_agent',
  'frontend_agent',
  'refactorer',
  'security_reviewer',
  'performance_reviewer',
  'quality_reviewer',
  'test_reviewer',
  'standards_reviewer',
  'documentarian',
  'project_analyzer',
]);

// Validates the context passed to WorkflowEngine.execute()
export const WorkflowContextSchema = z.object({
  prompt: z.string().min(1).max(10_000),
  intent: ClassificationResultSchema,
  // projectModel and chatResponseStream are VS Code API objects — not Zod-validated
  // (they are trusted internal runtime objects)
});

export const StepResultSchema = z.object({
  stepId: z.string().min(1),
  status: z.enum(['success', 'failed', 'skipped', 'cancelled']),
  output: z.string(),
  toolResults: z
    .array(
      z.object({
        tool: z.string(),
        input: z.unknown(),
        output: z.unknown(),
        success: z.boolean(),
        error: z.string().optional(),
      }),
    )
    .optional(),
  tokenUsage: z.object({
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
  }),
  attempts: z.number().int().min(1),
  modelUsed: z.string().min(1),
  error: z.string().optional(),
});

// =====================================================================
// Workflow Structure Schemas
// =====================================================================

export const WorkflowStepSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/),
  type: z.enum(['llm', 'tool', 'hitl', 'shell', 'parallel']),
  agentRole: AgentRoleSchema.optional(),
  toolScope: ToolScopeSchema.optional(),
  // hitl steps must declare their button labels explicitly
  buttons: z
    .array(
      z.object({
        label: z.string().min(1).max(80),
        command: z.string().regex(/^roadie\./), // must be a registered VS Code command
        style: z.enum(['primary', 'secondary', 'destructive']).default('secondary'),
      }),
    )
    .optional(),
  retries: z.number().int().min(0).max(3).default(0),
  timeoutMs: z.number().int().positive().max(300_000).optional(),
  dependsOn: z.array(z.string()).default([]), // step IDs that must succeed first
});

export const WorkflowDefinitionSchema = z.object({
  id: z.string().regex(/^[a-z_]+$/, 'Workflow IDs must be lowercase with underscores'),
  intent: IntentTypeSchema,
  displayName: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  steps: z.array(WorkflowStepSchema).min(1),
  estimatedMinutes: z.number().positive().optional(),
  // Workflows that modify the filesystem must declare their output paths
  outputPaths: z.array(z.string().startsWith('.github/')).optional(),
});

// =====================================================================
// Project Model Schemas
// =====================================================================

export const TechStackEntrySchema = z.object({
  category: z.enum([
    'language',
    'framework',
    'runtime',
    'orm',
    'test_tool',
    'build_tool',
    'package_manager',
  ]),
  name: z.string().min(1).max(100),
  version: z.string().max(30).optional(),
  sourceFile: z.string().min(1),
});

export const ProjectCommandSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1).max(500),
  sourceFile: z.string().min(1),
  type: z.enum(['build', 'test', 'dev', 'lint', 'format', 'other']),
});

export const DetectedPatternSchema = z.object({
  category: z.string().min(1),
  description: z.string().min(1).max(500),
  evidence: z.object({
    files: z.array(z.string()),
    matchCount: z.number().int().nonnegative(),
    confidence: z.number().min(0).max(1),
  }),
  confidence: z.number().min(0).max(1),
});

export const DeveloperPreferencesSchema = z.object({
  testCommand: z.string().max(500).optional(),
  modelPreference: z.enum(['economy', 'balanced', 'quality']).optional(),
  telemetryEnabled: z.boolean().default(false),
  autoCommit: z.boolean().default(false),
});

export const DirectoryEntrySchema = z.object({
  path: z.string().min(1),
  role: z.enum(['source', 'test', 'config', 'docs', 'build', 'unknown']),
  fileCount: z.number().int().nonnegative(),
});

export const ProjectModelSchema = z.object({
  workspaceRoot: z.string().min(1),
  techStack: z.array(TechStackEntrySchema),
  directories: z.array(DirectoryEntrySchema),
  commands: z.array(ProjectCommandSchema),
  patterns: z.array(DetectedPatternSchema),
  // ISO 8601 timestamp of last full rescan
  lastScannedAt: z.string().datetime({ offset: true }),
  schemaVersion: z.number().int().positive(),
});

// =====================================================================
// File Generation Schemas
// =====================================================================

export const GeneratedSectionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, 'Section IDs must be lowercase alphanumeric with hyphens'),
  content: z.string().max(500_000), // 500KB max per section
  priority: z.enum(['required', 'recommended', 'optional']),
});

export const MergeConflictSchema = z.object({
  sectionId: z.string().min(1),
  reason: z.enum(['user-edited', 'marker-deleted', 'content-changed']),
  userVersion: z.string(),
  newVersion: z.string(),
  resolution: z.enum(['append-below', 'auto-merged']), // Append Below is the only strategy
});

// =====================================================================
// Error Schemas
// =====================================================================

export const RoadieErrorSchema = z.object({
  code: z.string().min(1),
  category: z.enum(['validation', 'timeout', 'cancelled', 'escalation', 'external']),
  userFacing: z.boolean(),
  message: z.string().min(1).max(500),
  context: z.record(z.unknown()).optional(),
});

// =====================================================================
// SQLite Schema Validation
// =====================================================================

// Used in PersistentProjectModel.loadFromDb()
export const TechStackRowSchema = z.object({
  category: z.string(),
  name: z.string(),
  version: z.string().nullable(),
  source_file: z.string(),
});

export const DirectoryRowSchema = z.object({
  path: z.string(),
  type: z.enum(['directory', 'file']),
  language: z.string().nullable(),
  last_scanned: z.string(), // ISO timestamp string from SQLite
});

export const PatternRowSchema = z.object({
  category: z.string(),
  description: z.string(),
  evidence: z.string(), // JSON string in SQLite, must be parsed
  confidence: z.number(),
});

// =====================================================================
// Edit Tracking Schemas
// =====================================================================

export const FileChangeSchema = z.object({
  filePath: z.string().min(1),
  // Unified diff string
  diffText: z.string().min(1),
  changeType: z.enum(['created', 'modified', 'deleted']),
  // ISO 8601 timestamp
  changedAt: z.string().datetime({ offset: true }),
  // Which workflow step produced this change
  workflowId: z.string().min(1),
  stepId: z.string().min(1),
});

export const EditRecordSchema = z.object({
  id: z.number().int().positive(),
  filePath: z.string().min(1),
  workflowId: z.string().min(1),
  // Stored as raw diff string in SQLite; parse into FileChange separately
  diffText: z.string().min(1),
  recordedAt: z.string().datetime({ offset: true }),
});

// =====================================================================
// PHASE 2 — NOT YET IMPLEMENTED
// =====================================================================
// Everything below this line is the schema contract for the Phase 2 MCP
// server (roadie-mcp). The MCP server binary does not yet exist. These
// schemas are defined here so that the Phase 2 build can start from a
// validated contract, not a blank slate.
//
// DO NOT import from this section for Phase 1 / Phase 1.5 code.
// Use src/types.ts for all runtime types used by the extension today.
//
// Note: The WorkflowStepSchema and WorkflowDefinitionSchema below describe
// a DIFFERENT structure from the types.ts WorkflowStep/WorkflowDefinition
// interfaces. The schemas.ts versions are the Phase 2 redesign (hitl steps,
// llm/tool/shell step types, dependsOn graph). The types.ts versions are
// what the current workflow engine actually uses (sequential/parallel/
// conditional, promptTemplate, modelTier, maxRetries).
// =====================================================================

// =====================================================================
// MCP Tool Input / Output Schemas
// =====================================================================

// 1. roadie/analyze_project
export const AnalyzeProjectInputSchema = z.object({
  scope: z.enum(['full', 'dependencies', 'patterns', 'structure']).default('full'),
  force: z.boolean().default(false),
});
export type AnalyzeProjectInput = z.infer<typeof AnalyzeProjectInputSchema>;

export const AnalyzeProjectOutputSchema = z.object({
  techStack: z.array(TechStackEntrySchema),
  directories: z.array(
    z.object({
      path: z.string().min(1),
      type: z.enum(['source', 'test', 'config', 'docs', 'build', 'unknown']),
      language: z.string().optional(),
    }),
  ),
  commands: z.array(ProjectCommandSchema),
  patterns: z.array(DetectedPatternSchema),
  analyzedAt: z.string().datetime({ offset: true }),
});
export type AnalyzeProjectOutput = z.infer<typeof AnalyzeProjectOutputSchema>;

// 2. roadie/get_project_context
export const GetProjectContextInputSchema = z.object({
  maxTokens: z.number().int().min(100).max(50_000).optional(),
  scope: z.enum(['full', 'stack', 'structure', 'commands', 'patterns']).default('full'),
  relevantPaths: z.array(z.string()).optional(),
});
export type GetProjectContextInput = z.infer<typeof GetProjectContextInputSchema>;

export const GetProjectContextOutputSchema = z.object({
  context: z.string(),
  tokenEstimate: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
export type GetProjectContextOutput = z.infer<typeof GetProjectContextOutputSchema>;

// 3. roadie/rescan_project
export const RescanProjectInputSchema = z.object({}).strict();
export type RescanProjectInput = z.infer<typeof RescanProjectInputSchema>;

export const RescanProjectOutputSchema = z.object({
  status: z.enum(['completed', 'failed']),
  durationMs: z.number().int().nonnegative(),
  techStackEntries: z.number().int().nonnegative(),
  directoriesScanned: z.number().int().nonnegative(),
  patternsDetected: z.number().int().nonnegative(),
});
export type RescanProjectOutput = z.infer<typeof RescanProjectOutputSchema>;

// 4. roadie/run_workflow
export const RunWorkflowInputSchema = z.object({
  workflow: z.enum([
    'bug_fix',
    'feature',
    'refactor',
    'review',
    'document',
    'dependency',
    'onboard',
  ]),
  prompt: z.string().min(1).max(10_000),
  options: z
    .object({
      modelPreference: z.enum(['economy', 'balanced', 'quality']).default('balanced'),
      testTimeout: z.number().int().min(10).max(3600).default(300),
      testCommand: z.string().max(500).optional(),
      autoApprove: z.boolean().default(true),
    })
    .optional(),
});
export type RunWorkflowInput = z.infer<typeof RunWorkflowInputSchema>;

export const RunWorkflowOutputSchema = z.object({
  executionId: z.string().regex(/^wf_[a-zA-Z0-9]+$/),
  workflow: z.enum([
    'bug_fix',
    'feature',
    'refactor',
    'review',
    'document',
    'dependency',
    'onboard',
  ]),
  status: z.enum(['completed', 'failed', 'paused']),
  stepsCompleted: z.number().int().nonnegative(),
  stepsTotal: z.number().int().positive(),
  durationMs: z.number().int().nonnegative(),
  result: z
    .object({
      summary: z.string(),
      filesModified: z.array(z.string()),
      testsRun: z.boolean(),
      testsPassed: z.boolean().optional(),
    })
    .optional(),
  errorSummary: z.string().optional(),
});
export type RunWorkflowOutput = z.infer<typeof RunWorkflowOutputSchema>;

// 5. roadie/get_workflow_status
export const GetWorkflowStatusInputSchema = z.object({
  executionId: z.string().regex(/^wf_[a-zA-Z0-9]+$/),
});
export type GetWorkflowStatusInput = z.infer<typeof GetWorkflowStatusInputSchema>;

export const GetWorkflowStatusOutputSchema = z.object({
  executionId: z.string().regex(/^wf_[a-zA-Z0-9]+$/),
  workflow: z.enum([
    'bug_fix',
    'feature',
    'refactor',
    'review',
    'document',
    'dependency',
    'onboard',
  ]),
  status: z.enum(['running', 'completed', 'failed', 'paused', 'cancelled']),
  currentStep: z.string().optional(),
  stepsCompleted: z.number().int().nonnegative(),
  stepsTotal: z.number().int().positive(),
  elapsedMs: z.number().int().nonnegative(),
});
export type GetWorkflowStatusOutput = z.infer<typeof GetWorkflowStatusOutputSchema>;

// 6. roadie/generate_file
export const GeneratedFileTypeSchema = z.enum([
  'copilot-instructions',
  'agents-md',
  'typescript-instructions',
  'react-instructions',
  'python-instructions',
  'debugger-agent',
  'reviewer-agent',
  'hooks',
  'pr-template',
  'issue-templates',
  'mcp-config',
  'codebase-dictionary',
]);

export const GenerateFileInputSchema = z.object({
  fileType: GeneratedFileTypeSchema,
  force: z.boolean().default(false),
});
export type GenerateFileInput = z.infer<typeof GenerateFileInputSchema>;

export const GenerateFileOutputSchema = z.object({
  filePath: z.string().startsWith('.github/').or(z.literal('AGENTS.md')),
  status: z.enum(['created', 'updated', 'unchanged', 'skipped']),
  humanEditsPreserved: z.boolean(),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{8,64}$/),
});
export type GenerateFileOutput = z.infer<typeof GenerateFileOutputSchema>;

// 7. roadie/generate_all_files
export const GenerateAllFilesInputSchema = z.object({
  force: z.boolean().default(false),
});
export type GenerateAllFilesInput = z.infer<typeof GenerateAllFilesInputSchema>;

export const GenerateAllFilesOutputSchema = z.object({
  files: z.array(
    z.object({
      filePath: z.string(),
      status: z.enum(['created', 'updated', 'unchanged', 'skipped']),
    }),
  ),
  totalGenerated: z.number().int().nonnegative(),
  totalUpdated: z.number().int().nonnegative(),
  totalUnchanged: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
});
export type GenerateAllFilesOutput = z.infer<typeof GenerateAllFilesOutputSchema>;

// 8. roadie/query_patterns
export const QueryPatternsInputSchema = z.object({
  category: z
    .enum([
      'export_style',
      'test_convention',
      'error_handling',
      'import_ordering',
      'commit_convention',
      'async_patterns',
      'all',
    ])
    .default('all'),
  minConfidence: z.number().min(0).max(1).default(0.5),
});
export type QueryPatternsInput = z.infer<typeof QueryPatternsInputSchema>;

export const QueryPatternsOutputSchema = z.object({
  patterns: z.array(
    z.object({
      category: z.string().min(1),
      description: z.string().min(1),
      confidence: z.number().min(0).max(1),
      evidence: z.array(z.string()),
      detectedAt: z.string().datetime({ offset: true }),
    }),
  ),
});
export type QueryPatternsOutput = z.infer<typeof QueryPatternsOutputSchema>;

// 9. roadie/query_workflow_history
export const QueryWorkflowHistoryInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  workflowType: z
    .enum(['bug_fix', 'feature', 'refactor', 'review', 'document', 'dependency', 'onboard'])
    .optional(),
  status: z.enum(['completed', 'failed', 'cancelled']).optional(),
});
export type QueryWorkflowHistoryInput = z.infer<typeof QueryWorkflowHistoryInputSchema>;

export const QueryWorkflowHistoryOutputSchema = z.object({
  entries: z.array(
    z.object({
      workflowType: z.enum([
        'bug_fix',
        'feature',
        'refactor',
        'review',
        'document',
        'dependency',
        'onboard',
      ]),
      status: z.enum(['completed', 'failed', 'cancelled']),
      durationMs: z.number().int().nonnegative(),
      createdAt: z.string().datetime({ offset: true }),
    }),
  ),
  totalCount: z.number().int().nonnegative(),
  historyEnabled: z.boolean(),
  message: z.string().optional(),
});
export type QueryWorkflowHistoryOutput = z.infer<typeof QueryWorkflowHistoryOutputSchema>;

// 10. roadie/get_recommendations
export const GetRecommendationsInputSchema = z.object({}).strict();
export type GetRecommendationsInput = z.infer<typeof GetRecommendationsInputSchema>;

export const GetRecommendationsOutputSchema = z.object({
  recommendations: z.array(
    z.object({
      priority: z.enum(['high', 'medium', 'low']),
      category: z.enum([
        'missing_config',
        'stale_model',
        'incomplete_patterns',
        'unused_features',
        'configuration_suggestion',
        'dev_environment',
      ]),
      title: z.string().min(1),
      description: z.string().min(1),
      action: z.string().regex(/^roadie\//),
      actionArgs: z.record(z.unknown()).optional(),
    }),
  ),
});
export type GetRecommendationsOutput = z.infer<typeof GetRecommendationsOutputSchema>;

// Common error envelope (every tool's error path validates against this)
export const ToolErrorSchema = z.object({
  error: z.string().min(1),
  code: z.enum([
    'PROJECT_NOT_FOUND',
    'MODEL_EMPTY',
    'MODEL_STALE',
    'MODEL_UNAVAILABLE',
    'LLM_UNAVAILABLE',
    'WORKFLOW_NOT_FOUND',
    'WORKFLOW_FAILED',
    'EXECUTION_NOT_FOUND',
    'FILE_PERMISSION_ERROR',
    'DATABASE_ERROR',
    'INVALID_INPUT',
    'HISTORY_DISABLED',
    'ANALYSIS_TIMEOUT',
  ]),
  details: z.record(z.unknown()).optional(),
});
export type ToolError = z.infer<typeof ToolErrorSchema>;

// =====================================================================
// Codebase Dictionary Schemas
// =====================================================================

export const CodeEntitySchema = z.object({
  name: z.string().min(1),
  kind: z.enum([
    'function',
    'class',
    'interface',
    'type',
    'enum',
    'constant',
    'route',
    'model',
    'component',
  ]),
  filePath: z.string().min(1),
  lineNumber: z.number().int().nonnegative(),
  signature: z.string(),
  purpose: z.string(),
  isExported: z.boolean(),
  createdByWorkflow: z.string(),
  createdAt: z.string().datetime({ offset: true }),
});

export const EntityRelationshipSchema = z.object({
  sourceEntityName: z.string().min(1),
  sourceFilePath: z.string().min(1),
  targetEntityName: z.string().min(1),
  targetFilePath: z.string().min(1),
  relationship: z.string().min(1),
});

export const RecordEntitiesParamsSchema = z.object({
  filePath: z.string().min(1),
  fileContent: z.string().min(1),
  workflowType: z.string().min(1),
  stepId: z.string().min(1),
  originalPrompt: z.string().min(1),
});

export const DictionaryContextOptionsSchema = z.object({
  relevantPaths: z.array(z.string()).optional(),
  maxChars: z.number().int().positive().optional(),
  includeKinds: z
    .array(
      z.enum([
        'function',
        'class',
        'interface',
        'type',
        'enum',
        'constant',
        'route',
        'model',
        'component',
      ]),
    )
    .optional(),
});

export const DictionaryContextSchema = z.object({
  summary: z.string(),
  entityCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
});

// =====================================================================
// z.infer Canonical Type Exports
// =====================================================================
//
// Phase 1 / Phase 1.5 types — these match types.ts exactly (same shape).
// Safe to import from either file; prefer types.ts for non-validation code.
//
export type ClassificationResult = z.infer<typeof ClassificationResultSchema>;
export type LLMClassificationResponse = z.infer<typeof LLMClassificationResponseSchema>;
export type ModelTier = z.infer<typeof ModelTierSchema>;
export type ToolScope = z.infer<typeof ToolScopeSchema>;
export type AgentRole = z.infer<typeof AgentRoleSchema>;
export type TechStackEntry = z.infer<typeof TechStackEntrySchema>;
export type ProjectCommand = z.infer<typeof ProjectCommandSchema>;
export type DetectedPattern = z.infer<typeof DetectedPatternSchema>;
export type DeveloperPreferences = z.infer<typeof DeveloperPreferencesSchema>;
export type GeneratedSection = z.infer<typeof GeneratedSectionSchema>;
export type MergeConflict = z.infer<typeof MergeConflictSchema>;
export type RoadieError = z.infer<typeof RoadieErrorSchema>;
export type FileChange = z.infer<typeof FileChangeSchema>;
export type EditRecord = z.infer<typeof EditRecordSchema>;
export type CodeEntity = z.infer<typeof CodeEntitySchema>;
export type EntityRelationship = z.infer<typeof EntityRelationshipSchema>;
export type RecordEntitiesParams = z.infer<typeof RecordEntitiesParamsSchema>;
export type DictionaryContextOptions = z.infer<typeof DictionaryContextOptionsSchema>;
export type DictionaryContext = z.infer<typeof DictionaryContextSchema>;

// Phase 1 validation-only types — subset shapes used at trust boundaries.
// These are NOT the same as the types.ts interfaces of the same name.
// WorkflowContextSchema only validates { prompt, intent } (VS Code objects
// are not Zod-serialisable). StepResultSchema matches types.ts StepResult.
export type StepResult = z.infer<typeof StepResultSchema>;
export type WorkflowContextInput = z.infer<typeof WorkflowContextSchema>; // renamed: avoids shadowing types.ts WorkflowContext

// Phase 2 redesign types — different structure from types.ts equivalents.
// WorkflowStep2 and WorkflowDefinition2 describe the Phase 2 step graph
// (hitl, llm, tool, shell step types; dependsOn DAG; intent field).
// Do NOT use these in Phase 1/1.5 code — use types.ts WorkflowStep instead.
export type WorkflowStep2 = z.infer<typeof WorkflowStepSchema>;
export type WorkflowDefinition2 = z.infer<typeof WorkflowDefinitionSchema>;
export type ProjectModel2 = z.infer<typeof ProjectModelSchema>; // flattened object; types.ts ProjectModel is method-based
export type GeneratedFileType = z.infer<typeof GeneratedFileTypeSchema>; // Phase 2 extended set (mcp-config, hooks, etc.)

// =====================================================================
// Validation Utilities
// =====================================================================

/**
 * Parse-or-throw helper. Use when invalid data should halt execution.
 * Wraps Zod's safeParse to produce a structured error on failure.
 */
export function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown, context: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`[${context}] Validation failed: ${issues}`);
  }
  return result.data;
}

/**
 * Parse-or-default helper. Use when invalid data should produce a safe fallback.
 * Returns null on failure and logs a warning.
 */
export function parseOrNull<T>(schema: z.ZodType<T>, data: unknown, context: string): T | null {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    console.warn(`[${context}] Validation failed (using fallback): ${issues}`); // eslint-disable-line no-console
    return null;
  }
  return result.data;
}

/**
 * Parse a PatternRow from SQLite into a DetectedPattern.
 * The evidence column stores a JSON string that must be parsed separately.
 */
export function parsePatternRow(row: z.infer<typeof PatternRowSchema>): DetectedPattern {
  const evidenceParsed = z
    .object({
      files: z.array(z.string()),
      matchCount: z.number(),
      confidence: z.number(),
    })
    .parse(JSON.parse(row.evidence));

  return {
    category: row.category,
    description: row.description,
    evidence: evidenceParsed,
    confidence: row.confidence,
  };
}
