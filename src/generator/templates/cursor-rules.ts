/**
 * @module cursor-rules
 * @description Template for .cursor/rules/project.mdc (Cursor editor).
 *   Uses MDC frontmatter with alwaysApply: true.
 *   Output is capped at 80 lines.
 *
 *   Content contract:
 *   - MDC frontmatter: alwaysApply: true
 *   - tech-stack section: detected technologies
 *   - commands section: top build/test/dev commands
 *   - coding-standards section: high-confidence patterns
 *
 * @inputs ProjectModel
 * @outputs GeneratedSection[] for .cursor/rules/project.mdc
 * @depends-on types.ts (ProjectModel)
 * @depended-on-by file-generator.ts
 */

import type { ProjectModel } from '../../types';
import type { GeneratedSection } from '../section-manager';
import { renderConventionsString } from './template-utils';

export const CURSOR_RULES_PATH = '.cursor/rules/project.mdc';

/** Hard line-count budget to stay within Cursor's rule file size guidelines. */
const MAX_LINES = 80;

export function generateCursorRules(model: ProjectModel, options?: { simplified?: boolean }): GeneratedSection[] {
  const sections: GeneratedSection[] = [];

  const conventions = model.getConventions();
  const convString = renderConventionsString(conventions);
  if (convString) {
    sections.push({
      id: 'conventions',
      content: `## Project Conventions\n\n${convString}`,
    });
  }

  // ── tech-stack ─────────────────────────────────────────────────────────────
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

  // ── commands ───────────────────────────────────────────────────────────────
  const commands = model.getCommands();
  if (commands.length > 0) {
    const lines = commands.map((c) => `- **${c.name}**: \`${c.command}\``);
    sections.push({
      id: 'commands',
      content: `## Commands\n\n${lines.join('\n')}`,
    });
  }

  // Simplified mode: drop coding-standards
  if (options?.simplified) {
    if (sections.length === 0) {
      sections.push({
        id: 'status',
        content: '## Status\n\nProject analysis is pending. This rule file will be populated after Roadie completes an initial scan.',
      });
    }
    return sections;
  }

  // ── coding-standards ───────────────────────────────────────────────────────
  const patterns = model.getPatterns().filter((p) => p.confidence >= 0.7);
  if (patterns.length > 0) {
    const lines = patterns.map((p) => `- ${p.description}`);
    sections.push({
      id: 'coding-standards',
      content: `## Coding Standards\n\n${lines.join('\n')}`,
    });
  }

  return enforceBudget(sections, MAX_LINES);
}

/**
 * Build the full MDC file content (frontmatter + sections).
 * Used by file-generator.ts to prepend MDC frontmatter before the marker block.
 */
export function buildCursorRulesPreamble(): string {
  return `---\nalwaysApply: true\n---\n\n`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function enforceBudget(sections: GeneratedSection[], maxLines: number): GeneratedSection[] {
  // Count lines across all sections + 4 lines for preamble
  const preambleLines = 4;
  const totalLines =
    preambleLines +
    sections.reduce((acc, s) => acc + s.content.split('\n').length + 1, 0);

  if (totalLines <= maxLines) return sections;

  // Drop optional sections (coding-standards) until we fit
  while (sections.length > 1) {
    const last = sections[sections.length - 1]!;
    if (last.id === 'coding-standards') {
      sections.pop();
      const newTotal =
        preambleLines +
        sections.reduce((acc, s) => acc + s.content.split('\n').length + 1, 0);
      if (newTotal <= maxLines) return sections;
    } else {
      break;
    }
  }

  return sections;
}
