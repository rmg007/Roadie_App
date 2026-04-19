import * as path from 'node:path';
import type { ProjectModel } from '../../types';
import type { GeneratedSection } from '../section-manager';

export function generateStructure(model: ProjectModel): GeneratedSection[] {
  const dirTree = model.getDirectoryStructure();
  const sections: GeneratedSection[] = [];

  sections.push({
    id: 'intro',
    content: `# Repository Structure\n\nHigh-level directory layout and role assignments.\n`,
  });

  if (dirTree?.children && dirTree.children.length > 0) {
    const structLines = dirTree.children
      .filter((c) => c.type === 'directory')
      .map((c) => {
        const name = path.basename(c.path);
        const role = c.role ? ` (${c.role})` : '';
        return `- **${name}/**${role}`;
      });
    
    if (structLines.length > 0) {
      sections.push({
        id: 'dir-list',
        content: structLines.join('\n'),
      });
    }
  }

  return sections;
}
