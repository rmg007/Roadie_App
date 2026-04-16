/**
 * @module change-classifier
 * @description Pure classification logic for file system events.
 *   Maps file paths and event types to classified change categories
 *   with priority and trigger information. No VS Code dependencies.
 * @inputs File path string, event type
 * @outputs ClassifiedChange with type, priority, and triggers
 * @depends-on None (pure logic)
 * @depended-on-by file-watcher-manager
 */

import type { ChangeType } from '../types';

export interface ClassifiedChange {
  type: ChangeType;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  triggers: string[];
}

// ---------------------------------------------------------------------------
// Ignored path patterns (directory prefixes that should be skipped entirely)
// ---------------------------------------------------------------------------

const IGNORED_PREFIXES = [
  'node_modules/',
  '.git/',
  'dist/',
  'build/',
  'out/',
  '.next/',
  '.cache/',
  '.vscode/',
  '.idea/',
  'vendor/',
  'venv/',
  '.venv/',
  '.cursor/',      // Roadie-generated cursor rules
];

/** Generated file paths that must be ignored to prevent self-regeneration loops. */
const IGNORED_EXACT_PATHS = new Set([
  'AGENTS.md',
  'CLAUDE.md',
  '.github/copilot-instructions.md',
]);

/** Path prefixes for generated files (instructions/, etc.) */
const IGNORED_GENERATED_PREFIXES = [
  '.github/instructions/',
  '.cursor/rules/',
];

/**
 * Returns true if the file path falls under an ignored directory.
 * Paths are normalized to forward slashes before matching.
 */
export function isIgnoredPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  // Strip leading drive/absolute prefix to get workspace-relative path
  const _relative = normalized.replace(/^.*\/(AGENTS\.md|CLAUDE\.md|\.github\/|\.cursor\/)/, (_, p1) => p1)
    .replace(/^[^/]+\/[^/]+\/[^/]+\//, '') // trim deep absolute prefixes
    || normalized;

  if (IGNORED_PREFIXES.some(
    (prefix) => normalized.includes(`/${prefix}`) || normalized.startsWith(prefix),
  )) {
    return true;
  }

  // Exact generated-file paths (basename check + suffix check)
  const basename = normalized.split('/').pop() ?? '';
  for (const exact of IGNORED_EXACT_PATHS) {
    if (normalized.endsWith(exact) || basename === exact) return true;
  }

  // Generated directory prefixes
  for (const prefix of IGNORED_GENERATED_PREFIXES) {
    if (normalized.includes(prefix)) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Dependency file patterns
// ---------------------------------------------------------------------------

const DEPENDENCY_FILES = new Set([
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'go.mod',
  'go.sum',
  'Cargo.toml',
  'Cargo.lock',
  'requirements.txt',
  'Pipfile',
  'Pipfile.lock',
  'poetry.lock',
  'pyproject.toml',
  'Gemfile',
  'Gemfile.lock',
  'composer.json',
  'composer.lock',
]);

// ---------------------------------------------------------------------------
// Config file patterns (basename or regex)
// ---------------------------------------------------------------------------

const CONFIG_PATTERNS: RegExp[] = [
  /^tsconfig(\..+)?\.json$/,
  /^jest\.config\..+$/,
  /^vitest\.config\..+$/,
  /^eslint\.config\..+$/,
  /^webpack\.config\..+$/,
  /^vite\.config\..+$/,
  /^\.babelrc/,
  /^\.eslintrc/,
  /^\.prettierrc/,
  /^rollup\.config\..+$/,
];

// ---------------------------------------------------------------------------
// Source file extensions
// ---------------------------------------------------------------------------

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.js', '.tsx', '.jsx', '.py', '.go', '.rs',
]);

// ---------------------------------------------------------------------------
// GitHub / Copilot generated file patterns
// ---------------------------------------------------------------------------

function isGitHubGeneratedPath(normalized: string): boolean {
  return (
    normalized.includes('.github/copilot-') ||
    normalized.includes('.github/agents/') ||
    normalized.includes('.github/skills/')
  );
}

// ---------------------------------------------------------------------------
// Main classification function
// ---------------------------------------------------------------------------

/**
 * Classify a file change event based on its path and event type.
 */
export function classifyChange(
  filePath: string,
  eventType: 'create' | 'change' | 'delete',
): ClassifiedChange {
  const normalized = filePath.replace(/\\/g, '/');
  const basename = normalized.split('/').pop() ?? '';
  const ext = basename.includes('.') ? '.' + basename.split('.').pop() : '';

  // 1. Dependency files
  if (DEPENDENCY_FILES.has(basename)) {
    return {
      type: 'DEPENDENCY_CHANGE',
      priority: 'HIGH',
      triggers: ['dependency-updater'],
    };
  }

  // 2. Config files
  if (CONFIG_PATTERNS.some((pattern) => pattern.test(basename))) {
    return {
      type: 'CONFIG_CHANGE',
      priority: 'MEDIUM',
      triggers: ['config-updater'],
    };
  }

  // 3. GitHub / Copilot generated files
  if (isGitHubGeneratedPath(normalized)) {
    return {
      type: 'USER_EDIT',
      priority: 'MEDIUM',
      triggers: ['copilot-instructions-updater'],
    };
  }

  // 4. New source files (only on create)
  if (eventType === 'create' && SOURCE_EXTENSIONS.has(ext)) {
    return {
      type: 'SOURCE_ADDITION',
      priority: 'LOW',
      triggers: ['structure-updater'],
    };
  }

  // 5. Everything else
  return {
    type: 'OTHER',
    priority: 'LOW',
    triggers: [],
  };
}
