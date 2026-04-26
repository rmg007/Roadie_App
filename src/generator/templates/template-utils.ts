import type { ProjectConventions } from '../../types';
import type { GeneratedSection } from '../section-manager';

/**
 * Render ProjectConventions into Markdown sections.
 */
export function renderConventions(conventions?: ProjectConventions): GeneratedSection[] {
  if (!conventions) return [];

  const sections: GeneratedSection[] = [];

  if (conventions.techStack && conventions.techStack.length > 0) {
    sections.push({
      id: 'conventions-tech',
      content: `### Tech Stack\n${conventions.techStack.map(item => `- ${item}`).join('\n')}`
    });
  }

  if (conventions.namingConventions && conventions.namingConventions.length > 0) {
    sections.push({
      id: 'conventions-naming',
      content: `### Naming Conventions\n${conventions.namingConventions.map(item => `- ${item}`).join('\n')}`
    });
  }

  if (conventions.codingStyle && conventions.codingStyle.length > 0) {
    sections.push({
      id: 'conventions-style',
      content: `### Coding Style\n${conventions.codingStyle.map(item => `- ${item}`).join('\n')}`
    });
  }

  if (conventions.forbidden && conventions.forbidden.length > 0) {
    sections.push({
      id: 'conventions-forbidden',
      content: `### Forbidden Patterns\n${conventions.forbidden.map(item => `- ${item}`).join('\n')}`
    });
  }

  if (conventions.constraints && conventions.constraints.length > 0) {
    sections.push({
      id: 'conventions-constraints',
      content: `### Constraints\n${conventions.constraints.map(item => `- ${item}`).join('\n')}`
    });
  }

  return sections;
}

/**
 * Render ProjectConventions as a single Markdown string.
 */
export function renderConventionsString(conventions?: ProjectConventions): string {
  const sections = renderConventions(conventions);
  return sections.map(s => s.content).join('\n\n');
}
