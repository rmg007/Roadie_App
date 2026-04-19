import type { ProjectModel } from '../../types';
import type { GeneratedSection } from '../section-manager';
import { renderConventionsString } from './template-utils';

export function generatePatterns(model: ProjectModel): GeneratedSection[] {
  const sections: GeneratedSection[] = [];

  sections.push({
    id: 'intro',
    content: `# Architectural Patterns\n\nCodified conventions and detected patterns for this repository.\n`,
  });

  const conventions = model.getConventions();
  const convString = renderConventionsString(conventions);
  if (convString) {
    sections.push({
      id: 'custom-conventions',
      content: `## Project Conventions\n\n${convString}`,
    });
  }

  const patterns = model.getPatterns();
  if (patterns.length > 0) {
    const lines = patterns
      .filter((p) => p.confidence >= 0.7)
      .map((p) => `- ${p.description}`);
    if (lines.length > 0) {
      sections.push({
        id: 'detected-patterns',
        content: `## Code Conventions\n\n${lines.join('\n')}`,
      });
    }
  }

  return sections;
}
