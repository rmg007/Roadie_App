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

  // ── Validation Rules ──────────────────────────────────────────────────────
  sections.push({
    id: 'validation-rules',
    content: 
      `## Validation Requirements\n` +
      `Before declaring any task "Done":\n` +
      `- [ ] Verify build status (zero errors).\n` +
      `- [ ] Run relevant tests and confirm pass status.\n` +
      `- [ ] Verify that no secrets or PII were introduced into source code.\n` +
      `- [ ] Ensure all TODOs created during the task are either resolved or logged.`
  });

  return sections;
}
