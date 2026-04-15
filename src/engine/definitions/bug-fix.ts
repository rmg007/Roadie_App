/**
 * @module bug-fix
 * @description Bug Fix Workflow Definition — 8-step sequential workflow.
 *   (1) Locate error source, (2) Diagnose root cause, (3) Generate fix,
 *   (4) Verify with tests, (5) Scan siblings, (6) Fix siblings,
 *   (7) Add regression guard, (8) Generate summary.
 *   Step 3 escalates on test failure. Step 4 runs shell test command.
 * @inputs WorkflowContext with developer's error description
 * @outputs WorkflowResult with fix details + summary
 * @depends-on types.ts (WorkflowDefinition, WorkflowStep)
 * @depended-on-by workflow-engine.ts, chat-participant.ts
 */

import type { WorkflowDefinition, WorkflowStep } from '../../types';

const STEP_1_LOCATE: WorkflowStep = {
  id: 'locate-error',
  name: 'Locating error source',
  type: 'sequential',
  agentRole: 'diagnostician',
  modelTier: 'free',
  toolScope: 'research',
  contextScope: 'structure',
  promptTemplate: `You are a diagnostic agent. Your job is to LOCATE the source of this error.
Do not diagnose the root cause yet—just find where it occurs.

Error Report:
{error_description}

Project Context:
{project_context}

Return ONLY:
1. File path (exact)
2. Line number(s)
3. Code snippet (5 lines context)
4. Confidence (0.0-1.0)

If you cannot locate the error, report what you tried and why it failed.`,
  timeoutMs: 30_000,
  maxRetries: 1,
};

const STEP_2_DIAGNOSE: WorkflowStep = {
  id: 'diagnose-root-cause',
  name: 'Diagnosing root cause',
  type: 'sequential',
  agentRole: 'diagnostician',
  modelTier: 'standard',
  toolScope: 'research',
  contextScope: 'full',
  promptTemplate: `You are a diagnostic expert. Diagnose the ROOT CAUSE.

Error Location (from Step 1):
{previous_output}

Error Message:
{error_description}

Project Patterns:
{project_context}

Return ONLY:
1. Root Cause (2-3 sentences)
2. Contributing Factors (list)
3. Severity (critical/high/medium/low)
4. Fix Difficulty (easy/medium/hard)
5. Similar Patterns in Codebase (if any)

Do not suggest fixes—diagnose only.`,
  timeoutMs: 45_000,
  maxRetries: 1,
};

const STEP_3_FIX: WorkflowStep = {
  id: 'generate-fix',
  name: 'Generating fix',
  type: 'sequential',
  agentRole: 'fixer',
  modelTier: 'free',
  toolScope: 'implementation',
  contextScope: 'patterns',
  promptTemplate: `You are a fixer. Generate and apply a fix.

Diagnosis (from Step 2):
{previous_output}

Project Patterns:
{project_context}

Requirements:
1. Fix the root cause
2. Follow project code style/patterns
3. No public API changes
4. Keep change minimal

Return:
1. EXPLANATION (1-2 sentences)
2. BEFORE (original code)
3. AFTER (fixed code with comments)
4. FILES TO EDIT`,
  timeoutMs: 60_000,
  maxRetries: 5, // Escalation: Tier 0 -> 0 -> 1 -> 1 -> 2 -> report
};

const STEP_4_VERIFY: WorkflowStep = {
  id: 'verify-tests',
  name: 'Running tests to verify fix',
  type: 'sequential',
  agentRole: 'fixer',
  modelTier: 'free',
  toolScope: 'implementation',
  contextScope: 'commands',
  promptTemplate: `Run the project test suite to verify the fix.

Test command: {test_command}

If tests pass: report success.
If tests fail: include the full test output for the next fix attempt.`,
  timeoutMs: 300_000, // roadie.testTimeout default
  maxRetries: 0, // Test failures escalate Step 3 instead
};

const STEP_5_SCAN_SIBLINGS: WorkflowStep = {
  id: 'scan-siblings',
  name: 'Scanning for similar bugs',
  type: 'sequential',
  agentRole: 'diagnostician',
  modelTier: 'free',
  toolScope: 'research',
  contextScope: 'structure',
  promptTemplate: `Search the codebase for similar patterns that might have the same bug.

Original bug:
{previous_output}

Search for:
1. Same code pattern in other files
2. Similar anti-patterns
3. Copy-paste code that might have the same issue

Return: list of files and line numbers, or "No similar patterns found".`,
  timeoutMs: 30_000,
  maxRetries: 0,
};

const STEP_6_FIX_SIBLINGS: WorkflowStep = {
  id: 'fix-siblings',
  name: 'Fixing similar bugs',
  type: 'sequential',
  agentRole: 'fixer',
  modelTier: 'free',
  toolScope: 'implementation',
  contextScope: 'patterns',
  promptTemplate: `Apply the same fix pattern to similar bugs found in the codebase.

Original fix:
{previous_output}

Apply the same approach to each file. Keep changes minimal and consistent.`,
  timeoutMs: 60_000,
  maxRetries: 2,
};

const STEP_7_REGRESSION_GUARD: WorkflowStep = {
  id: 'add-regression-test',
  name: 'Adding regression test',
  type: 'sequential',
  agentRole: 'fixer',
  modelTier: 'free',
  toolScope: 'implementation',
  contextScope: 'patterns',
  promptTemplate: `Write a test that would catch this bug if it were reintroduced.

Bug description:
{error_description}

Fix applied:
{previous_output}

Project test conventions:
{project_context}

Write a focused test that:
1. Reproduces the original error condition
2. Verifies the fix works
3. Follows project test conventions`,
  timeoutMs: 45_000,
  maxRetries: 1,
};

const STEP_8_SUMMARY: WorkflowStep = {
  id: 'generate-summary',
  name: 'Generating summary',
  type: 'sequential',
  agentRole: 'documentarian',
  modelTier: 'free',
  toolScope: 'research',
  contextScope: 'full',
  promptTemplate: `Summarize the bug fix workflow results.

Include:
1. What was the bug (root cause)
2. How it was fixed
3. Files modified
4. Tests added
5. Similar bugs found and fixed (if any)
6. Recommendations to prevent similar bugs

Be concise. Use markdown formatting.`,
  timeoutMs: 15_000,
  maxRetries: 0,
};

export const BUG_FIX_WORKFLOW: WorkflowDefinition = {
  id: 'bug_fix',
  name: 'Bug Fix',
  steps: [
    STEP_1_LOCATE,
    STEP_2_DIAGNOSE,
    STEP_3_FIX,
    STEP_4_VERIFY,
    STEP_5_SCAN_SIBLINGS,
    STEP_6_FIX_SIBLINGS,
    STEP_7_REGRESSION_GUARD,
    STEP_8_SUMMARY,
  ],
};
