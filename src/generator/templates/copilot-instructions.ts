/**
 * @module copilot-instructions
 * @description Template for .github/copilot-instructions.md.
 *   Renders tech stack, package manager, test/build/dev commands,
 *   and detected patterns into a markdown file that GitHub Copilot
 *   reads for project-specific context.
 * @inputs ProjectModel
 * @outputs GeneratedSection[] for copilot-instructions.md
 * @depends-on types.ts (ProjectModel)
 * @depended-on-by file-generator.ts
 */

import * as path from 'node:path';
import type { ProjectModel } from '../../types';
import type { GeneratedSection } from '../section-manager';
import { renderConventionsString } from './template-utils';

export const COPILOT_INSTRUCTIONS_PATH = '.roadie/instructions.md';

/**
 * Generates the primary project instruction file (ToC).
 * Enforces the < 60 lines constraint by using pointers to modular files.
 */
export function generateCopilotInstructions(model: ProjectModel): GeneratedSection[] {
  const sections: GeneratedSection[] = [];

  sections.push({
    id: 'roadie-toc',
    content: `# Project Instructions (ToC)\n\n` +
             `This file is the primary entry point for AI agents. To maintain reasoning quality, \n` +
             `it follows the **Roadie 2026 Hierarchy**. Modular rules are linked below:\n\n` +
             `- [Technology Stack](./tech-stack.md)\n` +
             `- [Repository Structure](./structure.md)\n` +
             `- [Architectural Patterns](./patterns.md)\n` +
             `- [Operating Rules](./operating-rules.md)\n\n` +
             `## High-Level Objective\n` +
             `Maintain a high-quality ${model.getTechStack().find(e => e.category === 'language')?.name || 'TypeScript'} codebase following the WISC framework.\n`,
  });

  const commands = model.getCommands();
  if (commands.length > 0) {
    const lines = commands.map((c) => `- **${c.name}**: \`${c.command}\``);
    sections.push({
      id: 'core-commands',
      content: `## Core Commands\n\n${lines.join('\n')}`,
    });
  }

  return sections;
}
