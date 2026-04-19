/**
 * @module dependency-watcher
 * @description Watches package.json and lock files for changes.
 *   On change, scans for new deps and auto-loads skills from skill registry.
 *
 * @outputs watchDependencies(): { newDeps: Dep[], newSkills: Skill[] }
 * @depends-on fs, LearningDatabase
 * @depended-on-by autonomy-loop
 */

import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import type { Logger } from '../platform-adapters';
import { STUB_LOGGER } from '../platform-adapters';

// ---- Types ----

export interface Dep {
  name: string;
  version: string;
  isDev: boolean;
}

export interface Skill {
  id: string;
  name: string;
  forDep: string; // Which dependency this skill is for
  description: string;
  triggers?: string[]; // When to auto-invoke
}

export interface DependencyWatchResult {
  newDeps: Dep[];
  newSkills: Skill[];
  removedDeps: Dep[];
}

// ---- Mock skill registry (would be replaced with actual registry) ----

const SKILL_REGISTRY: Record<string, Skill[]> = {
  '@anthropic-ai/sdk': [
    {
      id: 'anthropic-sdk-setup',
      name: 'Anthropic SDK Setup',
      forDep: '@anthropic-ai/sdk',
      description: 'Initializes Anthropic SDK integration and sets up API clients',
      triggers: ['import @anthropic-ai', 'Anthropic()'],
    },
  ],
  'vitest': [
    {
      id: 'vitest-config',
      name: 'Vitest Configuration',
      forDep: 'vitest',
      description: 'Configures vitest with recommended settings for the project',
      triggers: ['vitest.config', 'defineConfig'],
    },
  ],
  'typescript': [
    {
      id: 'typescript-setup',
      name: 'TypeScript Setup',
      forDep: 'typescript',
      description: 'Ensures TypeScript configuration is properly initialized',
      triggers: ['tsconfig.json'],
    },
  ],
  'next': [
    {
      id: 'nextjs-integration',
      name: 'Next.js Integration',
      forDep: 'next',
      description: 'Integrates Next.js framework features and optimizations',
      triggers: ['next.config', 'pages/', 'app/'],
    },
  ],
  'prisma': [
    {
      id: 'prisma-schema',
      name: 'Prisma Schema Setup',
      forDep: 'prisma',
      description: 'Initializes Prisma schema and database configuration',
      triggers: ['schema.prisma', 'PrismaClient'],
    },
  ],
  'jest': [
    {
      id: 'jest-config',
      name: 'Jest Configuration',
      forDep: 'jest',
      description: 'Configures Jest testing framework with recommended settings',
      triggers: ['jest.config', 'setupTests'],
    },
  ],
};

// ---- DependencyWatcher ----

export class DependencyWatcher {
  private logger: Logger = STUB_LOGGER;
  private projectRoot: string;
  private lastDeps: Map<string, string> = new Map();
  private lastDevDeps: Map<string, string> = new Map();

  constructor(projectRoot: string, logger?: Logger) {
    this.projectRoot = projectRoot;
    if (logger) this.logger = logger;
  }

  /**
   * Watch for dependency changes and auto-load skills.
   */
  watchDependencies(): DependencyWatchResult {
    const packageJsonPath = nodePath.join(this.projectRoot, 'package.json');

    if (!fs.existsSync(packageJsonPath)) {
      return {
        newDeps: [],
        newSkills: [],
        removedDeps: [],
      };
    }

    try {
      const content = fs.readFileSync(packageJsonPath, 'utf-8');
      const pkg = JSON.parse(content);

      const currentDeps = new Map<string, string>(
        Object.entries((pkg.dependencies as Record<string, string>) ?? {}),
      );
      const currentDevDeps = new Map<string, string>(
        Object.entries((pkg.devDependencies as Record<string, string>) ?? {}),
      );

      // Detect new dependencies
      const newDeps: Dep[] = [];
      for (const [name, version] of currentDeps) {
        if (!this.lastDeps.has(name)) {
          newDeps.push({ name, version, isDev: false });
        }
      }

      for (const [name, version] of currentDevDeps) {
        if (!this.lastDevDeps.has(name)) {
          newDeps.push({ name, version, isDev: true });
        }
      }

      // Detect removed dependencies
      const removedDeps: Dep[] = [];
      for (const [name, version] of this.lastDeps) {
        if (!currentDeps.has(name)) {
          removedDeps.push({ name, version, isDev: false });
        }
      }

      for (const [name, version] of this.lastDevDeps) {
        if (!currentDevDeps.has(name)) {
          removedDeps.push({ name, version, isDev: true });
        }
      }

      // Update cache
      this.lastDeps = currentDeps;
      this.lastDevDeps = currentDevDeps;

      // Auto-load skills for new deps
      const newSkills = this.autoLoadSkills(newDeps);

      this.logger.info(
        `[DependencyWatcher] Found ${newDeps.length} new deps, loaded ${newSkills.length} skills`,
      );

      return {
        newDeps,
        newSkills,
        removedDeps,
      };
    } catch (err) {
      this.logger.warn('[DependencyWatcher] Failed to parse package.json:', err);
      return {
        newDeps: [],
        newSkills: [],
        removedDeps: [],
      };
    }
  }

  /**
   * Auto-load skills from registry for new dependencies.
   */
  private autoLoadSkills(newDeps: Dep[]): Skill[] {
    const skills: Skill[] = [];

    for (const dep of newDeps) {
      const registrySkills = SKILL_REGISTRY[dep.name];
      if (registrySkills) {
        skills.push(...registrySkills);
        this.logger.info(`[DependencyWatcher] Auto-loaded ${registrySkills.length} skills for ${dep.name}`);
      }
    }

    return skills;
  }

  /**
   * Check if package.json or lock files have changed.
   */
  hasChanged(): boolean {
    const packageJsonPath = nodePath.join(this.projectRoot, 'package.json');
    const lockfiles = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];

    const allFiles = [packageJsonPath, ...lockfiles.map((f) => nodePath.join(this.projectRoot, f))];

    // Simple check: if lastDeps is empty, we haven't initialized yet
    if (this.lastDeps.size === 0 && this.lastDevDeps.size === 0) {
      return false; // First run, initialize
    }

    // Could be extended to track mtimes for better efficiency
    return false;
  }
}

export function createDependencyWatcher(projectRoot: string, logger?: Logger): DependencyWatcher {
  return new DependencyWatcher(projectRoot, logger);
}
