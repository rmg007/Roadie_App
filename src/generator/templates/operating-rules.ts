/**
 * @module operating-rules
 * @description Template for .github/AGENT_OPERATING_RULES.md.
 *   Provides global project constraints and technical laws that all agents 
 *   must follow (e.g., naming standards, architectural anti-patterns).
 */

import type { ProjectModel } from '../../types';
import type { GeneratedSection } from '../section-manager';
import { renderConventionsString } from './template-utils';

export const OPERATING_RULES_PATH = '.github/AGENT_OPERATING_RULES.md';

export function generateOperatingRules(model: ProjectModel): GeneratedSection[] {
  const sections: GeneratedSection[] = [];

  const conventions = model.getConventions();
  const convString = renderConventionsString(conventions);

  // ── Project Law ──────────────────────────────────────────────────────────
  const techStack = model.getTechStack().map(e => e.name).join(', ');
  
  sections.push({
    id: 'project-law',
    content: 
      `# AGENT OPERATING RULES\n\n` +
      `These rules are mandatory for all AI agents working on this project. They take precedence over all general instructions.\n\n` +
      `## Technical Stack\n` +
      `- **Primary Stack:** ${techStack}\n` +
      `- **Enforcement:** Do not introduce technologies outside of this stack without explicit instruction.\n\n` +
      `## Global Conventions\n` +
      (convString || `_No global conventions defined. Roadie auto-detects rules from CLAUDE.md._`) + `\n\n` +
      `## Architectural Guardrails\n` +
      `- **Decoupling:** Maintain strict separation between interface and logic layers.\n` +
      `- **Documentation:** Preserve all existing comments and docstrings unless specifically asked to refactor them.\n` +
      `- **Testing:** Every source change requires a corresponding test update. Do not skip validation steps.`
  });

  // ── Framework-Specific Adaptive Rules ───────────────────────────────────────
  const frameworkRules: string[] = [];
  const stack = model.getTechStack();

  if (stack.some(e => ['react', 'next.js', 'remix'].includes(e.name.toLowerCase()))) {
    frameworkRules.push(
      `### UI & Hydration Rules (React)\n` +
      `- Avoid 'use client' unless client-side state or effect hooks are required.\n` +
      `- Ensure all interactive elements have unique IDs for E2E testing.\n` +
      `- Maintain strict prop-type or TypeScript interface definitions for every component.`
    );
  }

  if (stack.some(e => ['tsup', 'vite', 'webpack'].includes(e.name.toLowerCase()))) {
    frameworkRules.push(
      `### Build Integrity (Bundlers)\n` +
      `- Run the production build or dev server to verify bundle integrity after changing imports.\n` +
      `- Ensure 'out' or 'dist' folders are synchronized with source changes immediately.`
    );
  }

  if (stack.some(e => ['.net', 'c#', 'winforms'].includes(e.name.toLowerCase()))) {
    frameworkRules.push(
      `### Binary Safety (.NET)\n` +
      `- Always stop the running application process before building (prevents MSB3026 locked-binary errors).\n` +
      `- Keep designer files (*.Designer.cs) synchronized with code-behind member names.`
    );
  }

  if (frameworkRules.length > 0) {
    sections.push({
      id: 'framework-rules',
      content: `## Framework Safety Rules\n\n${frameworkRules.join('\n\n')}`
    });
  }

  // ── Git & Execution Safety ──────────────────────────────────────────────────
  sections.push({
    id: 'execution-safety',
    content: 
      `## Execution & Git Safety\n` +
      `- **Git Porcelain Rule:** When checking repository status on large repos, always use \`git status --porcelain -uno\` to avoid IDE/Tool hangups.\n` +
      `- **Surgical Edits:** Prefer small, targeted changes over broad architectural rewrites unless explicitly directed.\n` +
      `- **Read-Before-Edit:** Always read the full content of a file and its relevant neighbors before proposing any modification.`
  });

  // ── Validation Rules ──────────────────────────────────────────────────────
  sections.push({
    id: 'validation-rules',
    content: 
      `## Validation Requirements\n` +
      `Before declaring any task \"Done\":\n` +
      `- [ ] Verify build status (zero errors).\n` +
      `- [ ] Run relevant tests and confirm pass status.\n` +
      `- [ ] Verify that no secrets or PII were introduced into source code.\n` +
      `- [ ] Ensure all TODOs created during the task are either resolved or logged.`
  });

  return sections;
}
