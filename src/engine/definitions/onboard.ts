/**
 * @module onboard
 * @description Onboarding Workflow — 4 steps.
 *   (1) Read project model, (2) Generate architecture overview,
 *   (3) Generate getting-started guide, (4) Stream summary.
 */

import type { WorkflowDefinition } from '../../types';

export const ONBOARD_WORKFLOW: WorkflowDefinition = {
  id: 'onboard',
  name: 'Onboarding',
  steps: [
    {
      id: 'read-model',
      name: 'Loading project context',
      type: 'sequential',
      agentRole: 'project_analyzer',
      modelTier: 'free',
      toolScope: 'research',
      contextScope: 'full',
      promptTemplate: `Load the project model and summarize the key facts.\n\nProject Context:\n{project_context}\n\nReturn a structured overview of:\n1. Tech stack\n2. Directory structure\n3. Key commands\n4. Detected patterns`,
      timeoutMs: 15_000,
      maxRetries: 0,
    },
    {
      id: 'architecture-overview',
      name: 'Generating architecture overview',
      type: 'sequential',
      agentRole: 'documentarian',
      modelTier: 'free',
      toolScope: 'research',
      contextScope: 'structure',
      promptTemplate: `You are onboarding a new developer to this project.\n\nProject Context:\n{previous_output}\n\nGenerate:\n## What This Project Does\n(1 paragraph)\n\n## Tech Stack\n(table: technology | purpose)\n\n## Directory Map\n(annotated directory tree)\n\n## Key Data Flow\n(numbered steps)\n\n## Start Here\n(3-5 files to read first, in order, with reason)`,
      timeoutMs: 45_000,
      maxRetries: 1,
    },
    {
      id: 'getting-started',
      name: 'Generating getting-started guide',
      type: 'sequential',
      agentRole: 'documentarian',
      modelTier: 'free',
      toolScope: 'research',
      contextScope: 'commands',
      promptTemplate: `Generate a getting-started guide based on the architecture overview.\n\nArchitecture:\n{previous_output}\n\nInclude:\n## Setup\n(step-by-step)\n\n## Run the project\n(copy-paste commands)\n\n## Run tests\n(command)\n\n## First task recommendation\n(good first contribution)`,
      timeoutMs: 30_000,
      maxRetries: 0,
    },
    {
      id: 'stream-summary',
      name: 'Presenting onboarding summary',
      type: 'sequential',
      agentRole: 'documentarian',
      modelTier: 'free',
      toolScope: 'research',
      contextScope: 'full',
      promptTemplate: `Combine the architecture overview and getting-started guide into a single onboarding summary.\n\nArchitecture:\n{previous_output}\n\nFormat as a friendly, welcoming markdown document.`,
      timeoutMs: 15_000,
      maxRetries: 0,
    },
  ],
};
