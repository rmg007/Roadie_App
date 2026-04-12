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
];

/**
 * Returns true if the file path falls under an ignored directory.
 * Paths are normalized to forward slashes before matching.
 */
export function isIgnoredPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return IGNORED_PREFIXES.some(
    (prefix) => normalized.includes(`/${prefix}`) || normalized.startsWith(prefix),
  );
}

// ---------------------------------------------------------------------------
// Dependency file patterns
// ---------------------------------------------------------------------------

const DEPENDENCY_FILES = new Set([
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
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
