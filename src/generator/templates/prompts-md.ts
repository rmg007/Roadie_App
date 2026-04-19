import type { ProjectModel } from '../../types';
import type { GeneratedSection } from '../section-manager';

export const PROMPTS_MD_PATH = '.github/roadie/PROMPTS.md';

/**
 * Generate a centralized PROMPTS.md index.
 * This file contains a library of copy-pasteable prompts for different agent roles.
 */
export function generatePromptsMd(model: ProjectModel): GeneratedSection[] {
  const agents = [
    { id: 'diagnostician', name: 'Diagnostician', goal: 'Root cause analysis' },
    { id: 'fixer', name: 'Fixer', goal: 'Bug implementation' },
    { id: 'planner', name: 'Planner', goal: 'Architecture & Planning' },
    { id: 'reviewer', name: 'Reviewer', goal: 'Code Quality & Security' },
    { id: 'documentarian', name: 'Documentarian', goal: 'Technical Writing' }
  ];

  const lines = agents.map(a => 
    `### 🤖 ${a.name}\n` +
    `**Goal:** ${a.goal}\n` +
    `**Load Instructions:** \`Read .github/agents/${a.id}.agent.md\`\n` +
    `**Initial Prompt:**\n` +
    `> "You are the ${a.name} Specialist. Read your instructions in .github/agents/${a.id}.agent.md and then analyze the current task."`
  );

  return [
    {
      id: 'prompts-index',
      content: 
        `# Roadie Prompt Library\n\n` +
        `This index provides a quick lookup for specialized agent prompts. Use these blocks to 'summon' the right capability into your chat.\n\n` +
        lines.join('\n\n')
    }
  ];
}
