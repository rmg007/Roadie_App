/**
 * @module prompt-builder
 * @description Constructs three-layer prompts for subagents:
 *   Layer 1: Role prompt (agent identity and constraints)
 *   Layer 2: Context injection (tech stack, patterns, project state)
 *   Layer 3: Task prompt (step-specific instructions + variable substitution)
 * @inputs AgentConfig, WorkflowContext
 * @outputs Assembled prompt string
 * @depends-on types.ts
 * @depended-on-by agent-spawner.ts
 */

import type { AgentConfig, AgentRole } from '../types';

/** Role-specific system prompts. Each role gets a focused identity. */
const ROLE_PROMPTS: Record<AgentRole, string> = {
  diagnostician: 'You are a diagnostic expert. Your job is to LOCATE and DIAGNOSE errors. Be precise, cite line numbers, and reference the code directly.',
  fixer: 'You are a code fixer. Generate and apply minimal, correct fixes. Follow project patterns. Explain your changes clearly.',
  planner: 'You are a technical planner. Create detailed, actionable plans. Include time estimates, dependencies, and risks.',
  database_agent: 'You are a database specialist. Handle schema changes, migrations, and queries. Prioritize data integrity.',
  backend_agent: 'You are a backend engineer. Implement API endpoints, business logic, and server-side features.',
  frontend_agent: 'You are a frontend engineer. Build UI components, manage state, and handle user interactions.',
  refactorer: 'You are a refactoring expert. Restructure code without changing behavior. Preserve public APIs. Keep changes small and safe.',
  security_reviewer: 'You are a security expert. Review code for OWASP Top 10, injection, auth flaws, secrets exposure, XSS, CSRF. Be specific.',
  performance_reviewer: 'You are a performance expert. Find N+1 queries, memory leaks, unnecessary re-renders, algorithmic complexity issues.',
  quality_reviewer: 'You are a code quality reviewer. Check naming, duplication, complexity, style violations. Reference project conventions.',
  test_reviewer: 'You are a test expert. Find untested code paths, missing edge cases, weak assertions.',
  standards_reviewer: 'You are a standards reviewer. Check adherence to project conventions and detected patterns.',
  documentarian: 'You are a technical writer. Write clear, accurate documentation from source code. Never document behavior that is not in the code.',
  project_analyzer: 'You are a project analyzer. Scan the codebase to detect tech stack, patterns, directory structure, and commands.',
};

export class PromptBuilder {
  /**
   * Build a complete prompt from the three layers.
   *
   * Layer 1: Role identity (from ROLE_PROMPTS)
   * Layer 2: Project context (serialized from config.context)
   * Layer 3: Task instructions (template with {variable} substitution)
   */
  build(config: AgentConfig): string {
    const layers: string[] = [];

    // Layer 1: Role prompt
    layers.push(ROLE_PROMPTS[config.role]);

    // Layer 2: Context injection
    const contextBlock = this.serializeContext(config.context);
    if (contextBlock) {
      layers.push(contextBlock);
    }

    // Layer 3: Task prompt (with variable substitution)
    const taskPrompt = this.substituteVariables(config.promptTemplate, config.context);
    layers.push(taskPrompt);

    return layers.join('\n\n');
  }

  /** Serialize the context record into a readable block for the LLM. */
  private serializeContext(context: Record<string, unknown>): string {
    if (Object.keys(context).length === 0) return '';

    const parts: string[] = ['Project Context:'];
    for (const [key, value] of Object.entries(context)) {
      if (value === undefined || value === null) continue;
      const formatted = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      parts.push(`${key}: ${formatted}`);
    }
    return parts.join('\n');
  }

  /** Replace {variable} placeholders in the template with context values. */
  private substituteVariables(template: string, context: Record<string, unknown>): string {
    return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
      const value = context[key];
      if (value === undefined || value === null) return `{${key}}`;
      return typeof value === 'string' ? value : JSON.stringify(value);
    });
  }
}
