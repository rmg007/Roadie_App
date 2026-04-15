/**
 * @module dependency
 * @description Dependency Management Workflow — 5 steps.
 *   (1) Audit current dependencies, (2) Identify target updates,
 *   (3) Update one dependency, (4) Verify with tests,
 *   (5) Generate summary report.
 */

import type { WorkflowDefinition } from '../../types';

export const DEPENDENCY_WORKFLOW: WorkflowDefinition = {
  id: 'dependency',
  name: 'Dependency Management',
  steps: [
    {
      id: 'audit-deps',
      name: 'Auditing current dependencies',
      type: 'sequential',
      agentRole: 'project_analyzer',
      modelTier: 'free',
      toolScope: 'research',
      contextScope: 'stack',
      promptTemplate: `Audit the current dependency state.\n\nUser request:\n{user_request}\n\nProject Context:\n{project_context}\n\nReturn:\n1. All dependencies with current version\n2. Which are outdated\n3. Any CVE/vulnerability signals\n4. Which have known breaking changes in next major`,
      timeoutMs: 30_000,
      maxRetries: 1,
    },
    {
      id: 'identify-targets',
      name: 'Identifying update targets',
      type: 'sequential',
      agentRole: 'project_analyzer',
      modelTier: 'standard',
      toolScope: 'research',
      contextScope: 'stack',
      promptTemplate: `Given this dependency audit:\n{previous_output}\n\nUser request: {user_request}\n\nIdentify which packages to update. Order from lowest-risk to highest-risk.\nReturn: [{package, from_version, to_version, risk: low|medium|high}]`,
      timeoutMs: 45_000,
      maxRetries: 1,
    },
    {
      id: 'update-dependency',
      name: 'Updating dependency',
      type: 'sequential',
      agentRole: 'fixer',
      modelTier: 'free',
      toolScope: 'implementation',
      contextScope: 'commands',
      promptTemplate: `Update the identified dependency.\n\nUpdate plan:\n{previous_output}\n\nRun the package manager update command for the next package in the list.`,
      timeoutMs: 60_000,
      maxRetries: 2,
    },
    {
      id: 'verify-update',
      name: 'Verifying update with tests',
      type: 'sequential',
      agentRole: 'fixer',
      modelTier: 'free',
      toolScope: 'implementation',
      contextScope: 'commands',
      promptTemplate: 'Run the project test suite to verify the dependency update.\n\nTest command: {test_command}',
      timeoutMs: 300_000,
      maxRetries: 0,
    },
    {
      id: 'dep-summary',
      name: 'Generating dependency report',
      type: 'sequential',
      agentRole: 'documentarian',
      modelTier: 'free',
      toolScope: 'research',
      contextScope: 'stack',
      promptTemplate: `Summarize the dependency update results.\n\nInclude:\n1. Packages updated (version changes)\n2. Packages skipped (and why)\n3. Test results after each update\n4. Any manual action required`,
      timeoutMs: 15_000,
      maxRetries: 0,
    },
  ],
};
