/**
 * @module document
 * @description Documentation Workflow — 4 steps.
 *   (1) Identify documentation target, (2) Read source code,
 *   (3) Generate documentation, (4) Write documentation file.
 */

import type { WorkflowDefinition } from '../../types';

export const DOCUMENT_WORKFLOW: WorkflowDefinition = {
  id: 'document',
  name: 'Documentation',
  steps: [
    {
      id: 'identify-target',
      name: 'Identifying documentation target',
      type: 'sequential',
      agentRole: 'documentarian',
      modelTier: 'free',
      toolScope: 'research',
      contextScope: 'structure',
      promptTemplate: `Identify the documentation target from this request:\n{user_request}\n\nReturn:\n1. File(s) or module to document (exact paths)\n2. Documentation type: README | JSDoc | API spec | inline comments\n3. Scope: single function | entire module | public API`,
      timeoutMs: 30_000,
      maxRetries: 1,
    },
    {
      id: 'read-source',
      name: 'Reading source code',
      type: 'sequential',
      agentRole: 'documentarian',
      modelTier: 'free',
      toolScope: 'research',
      contextScope: 'structure',
      promptTemplate: `Read the source code for the identified files.\n\nTarget files:\n{previous_output}\n\nRead and return the full source code for documentation.`,
      timeoutMs: 30_000,
      maxRetries: 0,
    },
    {
      id: 'generate-docs',
      name: 'Generating documentation',
      type: 'sequential',
      agentRole: 'documentarian',
      modelTier: 'free',
      toolScope: 'documentation',
      contextScope: 'patterns',
      promptTemplate: `You are a technical writer. Write documentation for the following code.\n\nSource Code:\n{previous_output}\n\nProject Context:\n{project_context}\n\nRequirements:\n1. Accurate — reflects actual code behavior\n2. Complete — covers all public methods/properties\n3. Follows project documentation style\n4. Include code examples if type is README or API spec`,
      timeoutMs: 45_000,
      maxRetries: 1,
    },
    {
      id: 'write-docs',
      name: 'Writing documentation file',
      type: 'sequential',
      agentRole: 'documentarian',
      modelTier: 'free',
      toolScope: 'documentation',
      contextScope: 'commands',
      promptTemplate: `Write the generated documentation to the appropriate file.\n\nDocumentation:\n{previous_output}\n\nIf JSDoc: edit source file in-place.\nIf README: write new .md file.`,
      timeoutMs: 30_000,
      maxRetries: 0,
    },
  ],
};
