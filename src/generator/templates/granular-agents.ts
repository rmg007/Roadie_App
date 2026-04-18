/**
 * @module granular-agents
 * @description Template for granular agent definitions in .github/agents/*.agent.md.
 *   Produces specialized persona files inspired by the PayVerify pattern.
 */

import type { ProjectModel } from '../../types';
import type { GeneratedSection } from '../section-manager';

import { renderConventionsString } from './template-utils';

export interface GranularAgentFile {
  id: string;
  name: string;
  filePath: string;
  sections: GeneratedSection[];
  preamble: string;
}

export function generateGranularAgents(model: ProjectModel): GranularAgentFile[] {
  const conventions = model.getConventions();
  const convString = renderConventionsString(conventions);
  const agents = [
    {
      id: 'diagnostician',
      name: 'Diagnostician',
      description: 'Specialist in root cause analysis and technical discovery.',
      strategy: [
        'Perform multi-file searches to trace error propagation.',
        'Analyze logs and test outputs to identify the precise failure point.',
        'Map dependencies to determine side effects of potential changes.'
      ]
    },
    {
      id: 'fixer',
      name: 'Fixer',
      description: 'Focused implementer for bug fixes and incremental logic updates.',
      strategy: [
        'Apply minimal, non-breaking changes to resolve the identified issue.',
        'Maintain existing code style and naming conventions strictly.',
        'Run targeted tests immediately after every edit.'
      ]
    },
    {
      id: 'planner',
      name: 'Planner',
      description: 'Architectural specialist for new features and large-scale refactors.',
      strategy: [
        'Draft a comprehensive implementation plan before making any code changes.',
        'Identify all necessary service, model, and UI additions.',
        'Ensure new work follows the project\'s established architectural patterns.'
      ]
    },
    {
      id: 'reviewer',
      name: 'Reviewer',
      description: 'Quality assurance specialist focused on security, performance, and standards.',
      strategy: [
        'Scan for security vulnerabilities (injection, overflow, leaks).',
        'Analyze performance implications of new logic (O(n), DB pressure).',
        'Enforce compliance with AGENT_OPERATING_RULES.md.'
      ]
    },
    {
      id: 'documentarian',
      name: 'Documentarian',
      description: 'Specialist in technical writing and API documentation.',
      strategy: [
        'Generate JSDoc/TSDoc for all new public interfaces.',
        'Update project READMEs and high-level architectural docs.',
        'Ensure comments mirror the actual implementation reality.'
      ]
    }
  ];

  return agents.map(agent => {
    const preamble = 
      `---\n` +
      `name: "${agent.name}"\n` +
      `description: "${agent.description}"\n` +
      `user-invocable: true\n` +
      `---\n\n`;

    const sections: GeneratedSection[] = [{
      id: 'role-definition',
      content: 
        `# ${agent.name} Specialist\n\n` +
        `You are a specialized AI agent focused on **${agent.name}** within this project.\n\n` +
        `## Execution Strategy\n` +
        agent.strategy.map(log => `- ${log}`).join('\n') + `\n\n` +
        `## Context Guidance\n` +
        `- Refer to \`.github/AGENT_OPERATING_RULES.md\` for global constraints.\n` +
        `- When starting a task, read the latest context in \`docs/PLAN.md\` (if present).\n` +
        (convString ? `## Project Conventions\n${convString}\n` : '')
    }];

    return {
      id: agent.id,
      name: agent.name,
      filePath: `.github/agents/${agent.id}.agent.md`,
      sections,
      preamble
    };
  });
}
