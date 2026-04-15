/**
 * @module review
 * @description Code Review Workflow — 5 parallel review passes + consolidation.
 *   Passes: (1) Security [Tier 1], (2) Performance [Tier 0],
 *   (3) Code Quality [Tier 0], (4) Test Coverage [Tier 0],
 *   (5) Standards [Tier 0]. All run in parallel via Promise.allSettled.
 *   Final step consolidates findings by severity.
 */

import type { WorkflowDefinition } from '../../types';

export const REVIEW_WORKFLOW: WorkflowDefinition = {
  id: 'review',
  name: 'Code Review',
  steps: [
    {
      id: 'parallel-review',
      name: 'Running 5-pass code review',
      type: 'parallel',
      agentRole: 'security_reviewer',
      modelTier: 'free',
      toolScope: 'review',
      contextScope: 'patterns',
      promptTemplate: 'Review code changes.',
      timeoutMs: 120_000,
      maxRetries: 1,
      branches: [
        { id: 'security-review', name: 'Security review', type: 'sequential', agentRole: 'security_reviewer', modelTier: 'standard', toolScope: 'review', promptTemplate: 'You are a security expert. Review code for OWASP Top 10, injection, auth, secrets, XSS, CSRF.\n\nCode to review:\n{user_request}\n\nReturn findings with severity (CRITICAL/WARNING) and line numbers.', timeoutMs: 60_000, maxRetries: 1 },
        { id: 'performance-review', name: 'Performance review', type: 'sequential', agentRole: 'performance_reviewer', modelTier: 'free', toolScope: 'review', promptTemplate: 'You are a performance expert. Find N+1 queries, memory leaks, re-render issues, complexity problems.\n\nCode to review:\n{user_request}\n\nReturn findings with severity.', timeoutMs: 45_000, maxRetries: 0 },
        { id: 'quality-review', name: 'Code quality review', type: 'sequential', agentRole: 'quality_reviewer', modelTier: 'free', toolScope: 'review', promptTemplate: 'You are a code quality reviewer. Check naming, duplication, complexity, style violations.\n\nCode to review:\n{user_request}\n\nReturn findings with suggestions.', timeoutMs: 45_000, maxRetries: 0 },
        { id: 'coverage-review', name: 'Test coverage review', type: 'sequential', agentRole: 'test_reviewer', modelTier: 'free', toolScope: 'review', promptTemplate: 'You are a test expert. Find untested code paths, missing edge cases, weak assertions.\n\nCode to review:\n{user_request}\n\nReturn findings with example test pseudocode.', timeoutMs: 45_000, maxRetries: 0 },
        { id: 'standards-review', name: 'Standards review', type: 'sequential', agentRole: 'standards_reviewer', modelTier: 'free', toolScope: 'review', promptTemplate: 'You are a standards reviewer. Check adherence to project conventions.\n\nCode to review:\n{user_request}\n\nProject standards:\n{project_context}\n\nReturn inconsistencies found.', timeoutMs: 45_000, maxRetries: 0 },
      ],
    },
    {
      id: 'consolidate-findings',
      name: 'Consolidating review findings',
      type: 'sequential',
      agentRole: 'quality_reviewer',
      modelTier: 'free',
      toolScope: 'research',
      contextScope: 'stack',
      promptTemplate: `Consolidate all review findings into a single report.\n\nReview outputs:\n{previous_output}\n\nGroup by severity:\n- CRITICAL (must fix before merge)\n- WARNING (should fix)\n- SUGGESTION (nice to have)\n\nProvide an overall assessment: approve, request changes, or block.`,
      timeoutMs: 30_000,
      maxRetries: 0,
    },
  ],
};
