/**
 * @module dependency-scanner
 * @description Reads package.json and lock files to detect tech stack.
 *   Identifies package manager, languages, frameworks, test tools, build
 *   tools, ORMs, and runtimes. Returns TechStackEntry[] for the model.
 * @inputs Workspace root path
 * @outputs TechStackEntry[]
 * @depends-on types.ts, node:fs
 * @depended-on-by project-analyzer.ts
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getLogger } from '../shell/logger';
import type { TechStackEntry, ProjectCommand } from '../types';

/** Detect package manager from lock file presence. */
async function detectPackageManager(root: string): Promise<string> {
  if (await exists(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await exists(path.join(root, 'yarn.lock'))) return 'yarn';
  if (await exists(path.join(root, 'bun.lockb'))) return 'bun';
  return 'npm';
}

/** Known framework-to-category mappings from dependency names. */
const FRAMEWORK_MAP: Record<string, { category: string; name: string }> = {
  react: { category: 'framework', name: 'React' },
  next: { category: 'framework', name: 'Next.js' },
  vue: { category: 'framework', name: 'Vue' },
  express: { category: 'framework', name: 'Express' },
  fastify: { category: 'framework', name: 'Fastify' },
  '@nestjs/core': { category: 'framework', name: 'NestJS' },
  prisma: { category: 'orm', name: 'Prisma' },
  '@prisma/client': { category: 'orm', name: 'Prisma' },
  typeorm: { category: 'orm', name: 'TypeORM' },
  vitest: { category: 'test_tool', name: 'Vitest' },
  jest: { category: 'test_tool', name: 'Jest' },
  mocha: { category: 'test_tool', name: 'Mocha' },
  tsup: { category: 'build_tool', name: 'tsup' },
  webpack: { category: 'build_tool', name: 'Webpack' },
  vite: { category: 'build_tool', name: 'Vite' },
  esbuild: { category: 'build_tool', name: 'esbuild' },
};

export interface DependencyScanResult {
  techStack: TechStackEntry[];
  commands: ProjectCommand[];
}

export async function scanDependencies(workspaceRoot: string): Promise<DependencyScanResult> {
  const entries: TechStackEntry[] = [];
  const commands: ProjectCommand[] = [];
  const pkgPath = path.join(workspaceRoot, 'package.json');

  if (!(await exists(pkgPath))) {
    return { techStack: entries, commands };
  }

  const raw = await fs.readFile(pkgPath, 'utf8');
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(raw) as Record<string, unknown>;
  } catch (err: unknown) {
    getLogger().warn(
      `dependency-scanner: malformed package.json at ${pkgPath} — skipping dependency scan`,
      err,
    );
    return { techStack: entries, commands };
  }

  // Package manager
  const pm = await detectPackageManager(workspaceRoot);
  entries.push({ category: 'package_manager', name: pm, sourceFile: 'package.json' });

  const safeStringMap = (value: unknown): Record<string, string> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const record: Record<string, string> = {};
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'string') record[key] = item;
    }
    return record;
  };

  // TypeScript detection
  const allDeps = {
    ...safeStringMap(pkg.dependencies),
    ...safeStringMap(pkg.devDependencies),
  };

  if (allDeps.typescript || (await exists(path.join(workspaceRoot, 'tsconfig.json')))) {
    entries.push({
      category: 'language',
      name: 'TypeScript',
      version: allDeps.typescript?.replace(/^[\^~]/, ''),
      sourceFile: 'package.json',
    });
  }

  // Node.js runtime
  entries.push({ category: 'runtime', name: 'Node.js', sourceFile: 'package.json' });

  // Frameworks, ORMs, test tools, build tools
  for (const [depName, mapping] of Object.entries(FRAMEWORK_MAP)) {
    if (allDeps[depName]) {
      const version = allDeps[depName]?.replace(/[\^~]/, '');
      // Avoid duplicates
      if (!entries.some((e) => e.name === mapping.name)) {
        entries.push({
          category: mapping.category,
          name: mapping.name,
          version,
          sourceFile: 'package.json',
        });
      }
    }
  }

  // Commands from scripts
  const scripts = safeStringMap(pkg.scripts);
  if (Object.keys(scripts).length > 0) {
    const scriptMap: Record<string, ProjectCommand['type']> = {
      build: 'build', test: 'test', dev: 'dev', start: 'dev',
      lint: 'lint', format: 'format',
    };
    for (const [name, cmd] of Object.entries(scripts)) {
      const type = scriptMap[name] ?? 'other';
      commands.push({ name, command: `${pm} run ${name}`, sourceFile: 'package.json', type });
    }
  }

  return { techStack: entries, commands };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
