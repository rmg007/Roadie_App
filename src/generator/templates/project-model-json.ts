import type { ProjectModel } from '../../types';
import type { GeneratedSection } from '../section-manager';

export const PROJECT_MODEL_JSON_PATH = '.github/roadie/project-model.json';

/**
 * Generate a machine-readable JSON summary of the project model.
 * This is used by AI agents for high-confidence architectural context.
 */
export function generateProjectModelJson(model: ProjectModel): GeneratedSection[] {
  const data = {
    tech_stack: model.getTechStack(),
    patterns: model.getPatterns(),
    commands: model.getCommands(),
    conventions: model.getConventions(),
    overview: model.getOverview(),
  };

  return [
    {
      id: 'project-model-json',
      content: JSON.stringify(data, null, 2)
    }
  ];
}
