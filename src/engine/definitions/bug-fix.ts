/**
 * @module bug-fix
 * @description Bug Fix Workflow (EPIC-TDD) — 8 steps.
 *   (1) Locate, (2) Diagnose, (3) TDD (Reproduction Test), (4) Fix,
 *   (5) Verify & Integration, (6) Scan siblings, (7) Fix siblings, (8) Summary.
 */

import type { WorkflowDefinition, WorkflowStep } from '../../types';

const STEP_1_LOCATE: WorkflowStep = {
  id: 'locate-error',
  name: 'Locating error source (Explore)',
  type: 'sequential',
  agentRole: 'diagnostician',
  modelTier: 'standard',
  toolScope: 'research',
  contextScope: 'structure',
  readOnly: true,
  promptTemplate: `<role>You are a diagnostic agent.</role>\n<context>\nError Report: {error_description}\nProject Context: {project_context}\n</context>\n<task>\nLocate the source file and lines where this error occurs.\n</task>\n<instructions>\nDo not diagnose yet—just find the file path and line number.\nReturn:\n1. File path\n2. Line number(s)\n3. Code snippet (5 lines context)\n</instructions>`,
  timeoutMs: 30_000,
  maxRetries: 1,
};

const STEP_2_DIAGNOSE: WorkflowStep = {
  id: 'diagnose-root-cause',
  name: 'Diagnosing root cause (Explore)',
  type: 'sequential',
  agentRole: 'diagnostician',
  modelTier: 'premium',
  toolScope: 'research',
  contextScope: 'full',
  readOnly: true,
  promptTemplate: `<role>You are a root cause analyst.</role>\n<context>\nLocation: {previous_output}\nError Message: {error_description}\n</context>\n<task>\nDiagnose the ROOT CAUSE and suggest a TDD reproduction strategy.\n</task>\n<instructions>\nDo not suggest the fix code yet. Identify why it is failing architecturaly.\n</instructions>`,
  timeoutMs: 45_000,
  maxRetries: 1,
};

const STEP_3_TDD_REPRODUCTION: WorkflowStep = {
  id: 'write-reproduction-test',
  name: 'Committing reproduction test (TDD)',
  type: 'sequential',
  agentRole: 'tester' as any,
  modelTier: 'standard',
  toolScope: 'implementation',
  contextScope: 'patterns',
  tdd: true,
  promptTemplate: `<task>\nWrite and commit a failing test that reproduces the bug described in the diagnosis.\n</task>\n<documents>\nDiagnosis:\n{previous_output}\n</documents>\n<instructions>\nThe test must fail on the current codebase. Follow project testing conventions.\n</instructions>`,
  timeoutMs: 120_000,
  maxRetries: 1,
};

const STEP_4_FIX: WorkflowStep = {
  id: 'generate-fix',
  name: 'Generating fix (Implement)',
  type: 'sequential',
  agentRole: 'fixer',
  modelTier: 'standard',
  toolScope: 'implementation',
  contextScope: 'patterns',
  promptTemplate: `<task>\nGenerate and apply a fix that passes the reproduction test.\n</task>\n<instructions>\nYou are forbidden from modifying the test file created in the previous step.\nFix the underlying implementation to satisfy the test.\n</instructions>`,
  timeoutMs: 60_000,
  maxRetries: 3,
};

const STEP_5_VERIFY_INTEGRATION: WorkflowStep = {
  id: 'verify-fix',
  name: 'Verifying with full suite',
  type: 'sequential',
  agentRole: 'fixer',
  modelTier: 'free',
  toolScope: 'implementation',
  contextScope: 'commands',
  promptTemplate: `<task>\nRun the full test suite to ensure no regressions.\n</task>\n<instructions>\nTest command: {test_command}\n</instructions>`,
  timeoutMs: 300_000,
  maxRetries: 0,
};

const STEP_6_SCAN_SIBLINGS: WorkflowStep = {
  id: 'scan-siblings',
  name: 'Scanning for similar anti-patterns',
  type: 'sequential',
  agentRole: 'diagnostician',
  modelTier: 'free',
  toolScope: 'research',
  contextScope: 'structure',
  readOnly: true,
  promptTemplate: `<task>\nSearch the codebase for similar patterns that might have the same bug.\n</task>\n<documents>\nOriginal fix: {previous_output}\n</documents>`,
  timeoutMs: 30_000,
  maxRetries: 0,
};

const STEP_7_FIX_SIBLINGS: WorkflowStep = {
  id: 'fix-siblings',
  name: 'Fixing sibling instances',
  type: 'sequential',
  agentRole: 'fixer',
  modelTier: 'free',
  toolScope: 'implementation',
  contextScope: 'patterns',
  promptTemplate: `Apply the same fix approach to the sibling instances found.`,
  timeoutMs: 60_000,
  maxRetries: 1,
};

const STEP_8_SUMMARY: WorkflowStep = {
  id: 'generate-summary',
  name: 'Generating final audit (Commit)',
  type: 'sequential',
  agentRole: 'documentarian',
  modelTier: 'free',
  toolScope: 'research',
  contextScope: 'full',
  promptTemplate: `<task>\nSummarize the bug fix workflow and generate commit messages.\n</task>`,
  timeoutMs: 15_000,
  maxRetries: 0,
};

export const BUG_FIX_WORKFLOW: WorkflowDefinition = {
  id: 'bug_fix',
  name: 'Bug Fix (EPIC-TDD)',
  steps: [
    STEP_1_LOCATE,
    STEP_2_DIAGNOSE,
    STEP_3_TDD_REPRODUCTION,
    STEP_4_FIX,
    STEP_5_VERIFY_INTEGRATION,
    STEP_6_SCAN_SIBLINGS,
    STEP_7_FIX_SIBLINGS,
    STEP_8_SUMMARY,
  ],
};

