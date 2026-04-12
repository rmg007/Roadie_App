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

import type { ProjectModel } from '../../types';
import type { GeneratedSection } from '../section-manager';

export const COPILOT_INSTRUCTIONS_PATH = '.github/copilot-instructions.md';

export function generateCopilotInstructions(model: ProjectModel): GeneratedSection[] {
  const sections: GeneratedSection[] = [];

  // Tech stack section
  const techStack = model.getTechStack();
  if (techStack.length > 0) {
    const lines = techStack.map((e) => {
      const ver = e.version ? ` ${e.version}` : '';
      return `- **${e.name}**${ver} (${e.category})`;
    });
    sections.push({
      id: 'tech-stack',
      content: `## Tech Stack\n\n${lines.join('\n')}`,
    });
  }

  // Commands section
  const commands = model.getCommands();
  if (commands.length > 0) {
    const lines = commands.map((c) => `- **${c.name}**: \`${c.command}\``);
    sections.push({
      id: 'commands',
      content: `## Project Commands\n\n${lines.join('\n')}`,
    });
  }

  // Patterns section
  const patterns = model.getPatterns();
  if (patterns.length > 0) {
    const lines = patterns
      .filter((p) => p.confidence >= 0.7)
      .map((p) => `- ${p.description}`);
    if (lines.length > 0) {
      sections.push({
        id: 'patterns',
        content: `## Code Conventions\n\n${lines.join('\n')}`,
      });
    }
  }

  return sections;
}
