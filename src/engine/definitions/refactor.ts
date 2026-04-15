/**
 * @module refactor
 * @description Refactoring Workflow — 5 steps with incremental approach.
 *   (1) Analyze structure, (2) Write characterization tests,
 *   (3) Refactor incrementally, (4) Verify tests still pass,
 *   (5) Generate summary. Public API invariant enforced.
 */

import type { WorkflowDefinition } from '../../types';

export const REFACTOR_WORKFLOW: WorkflowDefinition = {
  id: 'refactor',
  name: 'Refactoring',
  steps: [
    {
      id: 'analyze-structure',
      name: 'Analyzing code structure',
      type: 'sequential',
      agentRole: 'refactorer',
      modelTier: 'free',
      toolScope: 'research',
      contextScope: 'structure',
      promptTemplate: `Analyze the code structure for refactoring opportunities.\n\nTarget:\n{user_request}\n\nProject Context:\n{project_context}\n\nIdentify:\n1. Current structure and pain points\n2. Specific refactoring opportunities (extract, rename, simplify)\n3. Public API surface that MUST NOT change\n4. Risk areas`,
      timeoutMs: 30_000,
      maxRetries: 1,
    },
    {
      id: 'characterization-tests',
      name: 'Writing characterization tests',
      type: 'sequential',
      agentRole: 'refactorer',
      modelTier: 'standard',
      toolScope: 'implementation',
      contextScope: 'patterns',
      promptTemplate: `Write characterization tests that capture CURRENT behavior.\nThese tests serve as safety nets for refactoring.\n\nCode to test:\n{previous_output}\n\nProject test conventions:\n{project_context}\n\nWrite tests that PASS right now — documenting imperfect behavior is OK.`,
      timeoutMs: 60_000,
      maxRetries: 2,
    },
    {
      id: 'refactor-incrementally',
      name: 'Applying incremental refactoring',
      type: 'sequential',
      agentRole: 'refactorer',
      modelTier: 'free',
      toolScope: 'implementation',
      contextScope: 'patterns',
      promptTemplate: `Apply ONE small, safe refactoring at a time.\n\nAnalysis:\n{previous_output}\n\nRules:\n1. One change per iteration (extract function, rename, simplify conditional)\n2. Public API MUST NOT change\n3. All characterization tests must still pass\n4. Keep changes minimal and reversible\n\nReturn: REFACTORING name, BEFORE code, AFTER code, PUBLIC API IMPACT.`,
      timeoutMs: 60_000,
      maxRetries: 3,
    },
    {
      id: 'verify-refactor',
      name: 'Verifying tests pass after refactoring',
      type: 'sequential',
      agentRole: 'fixer',
      modelTier: 'free',
      toolScope: 'implementation',
      contextScope: 'commands',
      promptTemplate: 'Run the test suite to verify refactoring preserved behavior.\n\nTest command: {test_command}',
      timeoutMs: 300_000,
      maxRetries: 0,
    },
    {
      id: 'refactor-summary',
      name: 'Generating refactoring summary',
      type: 'sequential',
      agentRole: 'documentarian',
      modelTier: 'free',
      toolScope: 'research',
      contextScope: 'stack',
      promptTemplate: `Summarize the refactoring results.\n\nInclude:\n1. What was refactored and why\n2. Changes made (list each refactoring)\n3. Public API impact (should be "none")\n4. Test status\n5. Recommendations for future refactoring`,
      timeoutMs: 15_000,
      maxRetries: 0,
    },
  ],
};
