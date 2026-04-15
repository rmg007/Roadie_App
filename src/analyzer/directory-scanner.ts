/**
 * @module directory-scanner
 * @description Uses fast-glob to scan workspace directories and build
 *   a DirectoryNode tree. Assigns roles (source, test, config, output)
 *   based on directory names. Ignores node_modules, .git, dist, build,
 *   coverage, out, .next.
 * @inputs Workspace root path
 * @outputs DirectoryNode tree
 * @depends-on fast-glob, types.ts
 * @depended-on-by project-analyzer.ts
 */

import fg from 'fast-glob';
import * as path from 'node:path';
import type { DirectoryNode } from '../types';

const IGNORED_DIRS = [
  'node_modules', '.git', 'dist', 'build', 'coverage', 'out', '.next',
  '.cache', '.parcel-cache', 'target', 'bin', 'obj', 'vendor', 'venv', '.venv',
];

const MAX_DEPTH = 10;

/** Map directory name to role. */
function assignRole(dirName: string): string | undefined {
  const lower = dirName.toLowerCase();
  if (['src', 'lib', 'app', 'pages', 'components'].includes(lower)) return 'source';
  if (['test', 'tests', '__tests__', 'spec', 'specs'].includes(lower)) return 'test';
  if (['.vscode', '.github', '.husky', 'config'].includes(lower)) return 'config';
  if (['dist', 'build', 'out', 'target'].includes(lower)) return 'output';
  if (['public', 'static', 'assets'].includes(lower)) return 'static';
  return undefined;
}

export async function scanDirectories(workspaceRoot: string): Promise<DirectoryNode> {
  const entries = await fg(['**'], {
    cwd: workspaceRoot,
    onlyDirectories: true,
    ignore: IGNORED_DIRS.map((d) => `**/${d}`),
    deep: MAX_DEPTH,
  });

  // Build flat list of directory nodes
  const root: DirectoryNode = {
    path: workspaceRoot,
    type: 'directory',
    role: 'source',
    children: [],
  };

  // Sort entries so parents appear before children
  entries.sort();

  for (const entry of entries) {
    const dirName = path.basename(entry);
    root.children!.push({
      path: path.join(workspaceRoot, entry),
      type: 'directory',
      role: assignRole(dirName),
    });
  }

  // Apply role inheritance: subdirectories that have no explicit role inherit
  // from their closest named ancestor (e.g. src/operations → source via src/).
  // Only propagate 'source' and 'test' roles — not 'config', 'output', or 'static'.
  const inheritableRoles = new Set(['source', 'test']);
  for (const node of root.children!) {
    if (node.role !== undefined) continue;
    const parentPath = path.dirname(node.path);
    // Walk up: check direct parent first, then root children (flat structure)
    const parentNode = root.children!.find((n) => n.path === parentPath);
    if (parentNode?.role && inheritableRoles.has(parentNode.role)) {
      node.role = parentNode.role;
      continue;
    }
    // Also check root itself (top-level children of the workspace root get
    // roles from assignRole only; skip root inheritance to avoid false positives)
  }

  return root;
}
