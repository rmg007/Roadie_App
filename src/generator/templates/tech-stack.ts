import type { ProjectModel } from '../../types';
import type { GeneratedSection } from '../section-manager';

export function generateTechStack(model: ProjectModel): GeneratedSection[] {
  const techStack = model.getTechStack();
  const sections: GeneratedSection[] = [];

  sections.push({
    id: 'intro',
    content: `# Technology Stack\n\nIdentified technologies for this project. Use these to choose compatible libraries and syntax.\n`,
  });

  if (techStack.length > 0) {
    const lines = techStack.map((e) => {
      const ver = e.version ? ` ${e.version}` : '';
      return `- **${e.name}**${ver} (${e.category})`;
    });
    sections.push({
      id: 'stack-list',
      content: lines.join('\n'),
    });
  }

  return sections;
}
