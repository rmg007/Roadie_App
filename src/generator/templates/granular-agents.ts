/**
 * @module granular-agents
 * @description Template for granular agent definitions in .github/agents/*.agent.md.
 *   Produces specialized persona files inspired by the PayVerify pattern.
 */

import type { ProjectModel } from '../../types';
import type { GeneratedSection } from '../section-manager';

import * as path from 'node:path';
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
      id: 'strategist',
      name: 'Strategist',
      description: 'Orchestration, Product Strategy, and Systems Architecture.',
      strategy: [
        'Translate requirements into structured PRDs with explicit modular rules.',
        'Design the structural bridge between backend logic and UI state.',
        'Manage context budgets and enforce WISC token hygiene across the pipeline.',
        'Orchestrate parallel agent loops for complex, high-stakes implementation.'
      ]
    },
    {
      id: 'builder',
      name: 'Builder',
      description: 'Core Application Development (Backend, Frontend, and Database).',
      strategy: [
        'Execute implementation via the EPIC loop (Explore, Plan, Implement, Commit).',
        'Follow strict TDD: commit failing tests before authoring implementation code.',
        'Optimize application logic and author lightweight data migrations.',
        'Document implementation status and blockers periodically for token hygiene.'
      ]
    },
    {
      id: 'critic',
      name: 'Critic',
      description: 'Quality Assurance, Validation, and Security Auditing.',
      strategy: [
        'Scan for architectural anti-patterns and code-style violations.',
        'Audit local data encryption and validate secure network requests.',
        'Author unit tests and integration scripts for all new logic.',
        'Simulate end-user flows to validate against original acceptance criteria.'
      ]
    },
    {
      id: 'diagnostician',
      name: 'Diagnostician',
      description: 'Bug location, root cause analysis, and experimental debugging.',
      strategy: [
        'Analyze stack traces and production logs to locate failure points.',
        'Spawn multiple agents on separate worktrees to test competing hypotheses for systemic bugs.',
        'Use live reasoning and deep analytical depth for root cause analysis of obscure race conditions.',
        'Provide compressed diagnostic summaries to the Builder agent.'
      ]
    },
    {
      id: 'reviewer',
      name: 'Reviewer',
      description: 'Security auditing, performance review, and code quality enforcement.',
      strategy: [
        'Audit every implementation in real-time as an isolated agent (Writer-Reviewer pattern).',
        'Scan for security vulnerabilities and performance bottlenecks.',
        'Verify compliance with architectural guardrails and coding standards.',
        'Enforce strict adherence to TDD protocols and validation criteria.'
      ]
    },
    {
      id: 'delivery',
      name: 'Delivery',
      description: 'Release Management, Technical Writing, and Automated Routines.',
      strategy: [
        'Automate the build pipeline and manage asset bundling.',
        'Design deterministic automated routines for recurring tasks (e.g., daily summaries).',
        'Synthesize codebase details into modular, high-fidelity developer documentation.',
        'Configure external parameters and package the final portable executable.'
      ]
    },
    {
      id: 'frontend-design',
      name: 'Frontend Designer',
      description: 'Creative Director and Lead Frontend Engineer (Production-Grade UI).',
      strategy: [
        'Commit to a BOLD, non-generic aesthetic direction (Minimalist, Brutalist, Luxury, etc.) before coding.',
        'Use distinctive typography and aggressive color signatures; strictly avoid system fonts (Arial/Inter).',
        'Implement "Anti-Slop" UI: Grid-breaking layouts, textured backgrounds (noise/grain), and sophisticated motion.',
        'Ensure every component is production-grade, functional, and visually unforgettable.'
      ]
    }
  ];

  // --- Domain-Specific Agent Extraction ---
  const structure = model.getDirectoryTree();
  if (structure && structure.children) {
    // Look for significant folders: src/*, lib/*, packages/*
    const appDir = structure.children.find(c => ['src', 'lib', 'packages'].includes(path.basename(c.path)) && c.type === 'directory');
    if (appDir && appDir.children) {
      for (const module of appDir.children) {
        if (module.type === 'directory') {
          const moduleName = path.basename(module.path);
          // Skip common non-module folders
          if (['__tests__', '__snapshots__', 'node_modules', 'dist', 'out'].includes(moduleName)) continue;

          const capitalized = moduleName.charAt(0).toUpperCase() + moduleName.slice(1);
          agents.push({
            id: `${moduleName}-specialist`,
            name: `${capitalized} Specialist`,
            description: `Domain expert for the ${moduleName} subsystem.`,
            strategy: [
              `Focus edits and research within the ${module.path} directory.`,
              `Ensure changes respect the internal encapsulation of the ${moduleName} module.`,
              `Verify integration points with other subsystems when modifying public exports.`
            ]
          });
        }
      }
    }
  }

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
