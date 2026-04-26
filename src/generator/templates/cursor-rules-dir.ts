/**
 * @module cursor-rules-dir
 * @description Template for .cursor/rules/{dir}.mdc files.
 *   Generates per-directory Cursor MDC rules files with path-scoped globs.
 *
 *   Gates:
 *   - Only directories with role === 'source' or role === 'test'
 *   - Directory must have ≥ 3 source files
 *   - Maximum 6 output files (to avoid overwhelming Cursor)
 *
 * @inputs ProjectModel
 * @outputs CursorRulesDirFile[] (one entry per qualifying directory)
 * @depends-on types.ts (ProjectModel, DirectoryNode)
 * @depended-on-by file-generator.ts
 */

import * as path from 'node:path';
import type { ProjectModel, DirectoryNode } from '../../types';
import type { GeneratedSection } from '../section-manager';
import { renderConventionsString } from './template-utils';

/** Allows tests to override the timestamp generation. */
let getTimestampFn = (): string => new Date().toISOString();

export function setTimestampForTesting(fn: () => string): void {
  getTimestampFn = fn;
}

export function resetTimestamp(): void {
  getTimestampFn = (): string => new Date().toISOString();
}

export const CURSOR_RULES_DIR = '.cursor/rules';

/** Minimum source-file count for a directory to qualify. */
const MIN_SOURCE_FILES = 3;

/** Maximum number of per-directory MDC files emitted per workspace. */
const MAX_FILES = 6;

const SOURCE_EXTENSIONS = new Set(['.ts', '.js', '.tsx', '.jsx', '.py', '.go', '.rs', '.rb', '.java', '.cs']);

export interface CursorRulesDirFile {
  /** Relative path from workspace root, e.g. .cursor/rules/src.mdc */
  filePath: string;
  /** MDC frontmatter preamble */
  preamble: string;
  /** Section content */
  sections: GeneratedSection[];
}

function countSourceFiles(dir: DirectoryNode): number {
  return (dir.children ?? []).filter(
    (c) => c.type === 'file' && SOURCE_EXTENSIONS.has(path.extname(c.path)),
  ).length;
}

function collectQualifyingDirs(root: DirectoryNode): DirectoryNode[] {
  const qualifying: DirectoryNode[] = [];
  for (const child of root.children ?? []) {
    if (child.type !== 'directory') continue;
    if (child.role !== 'source' && child.role !== 'test') continue;
    if (countSourceFiles(child) >= MIN_SOURCE_FILES) {
      qualifying.push(child);
    }
  }
  return qualifying;
}

/**
 * Build the MDC frontmatter preamble for a given directory name.
 */
export function buildCursorRulesDirPreamble(dirName: string): string {
  const generatedAt = getTimestampFn();
  return (
    `---\n` +
    `name: "rules: ${dirName}"\n` +
    `alwaysApply: false\n` +
    `globs: "${dirName}/**"\n` +
    `generated-by: roadie\n` +
    `generated-at: ${generatedAt}\n` +
    `---\n`
  );
}

/**
 * Generate per-directory Cursor MDC rules files.
 * Returns an array of { filePath, preamble, sections } for each qualifying directory.
 */
export function generateCursorRulesDir(model: ProjectModel, options?: { simplified?: boolean }): CursorRulesDirFile[] {
  const dirTree = model.getDirectoryStructure();
  if (!dirTree?.children) return [];

  const patterns = model.getPatterns().filter((p) => p.confidence >= 0.7);
  const commands = model.getCommands();

  const qualifying = collectQualifyingDirs(dirTree);
  const results: CursorRulesDirFile[] = [];

  for (const dir of qualifying.slice(0, MAX_FILES)) {
    const dirName = path.basename(dir.path);
    const filePath = `${CURSOR_RULES_DIR}/${dirName}.mdc`;
    const preamble = buildCursorRulesDirPreamble(dirName);
    const roleDesc = dir.role === 'test' ? 'test files' : 'source files';
    const fileCount = countSourceFiles(dir);

    const contentLines: string[] = [
      `## ${dirName}/ — ${roleDesc}`,
      '',
      `This directory contains ${roleDesc} (${fileCount} files detected).`,
      '',
    ];

    if (dir.role === 'test') {
      contentLines.push('When working in this directory:');
      contentLines.push('- Write tests that cover edge cases and failure paths.');
      contentLines.push('- Follow the project\'s existing test conventions.');
      const testCmd = commands.find((c) => c.type === 'test');
      if (testCmd) {
        contentLines.push(`- Run tests with: \`${testCmd.command}\``);
      }
    } else {
      contentLines.push('When working in this directory:');
      contentLines.push('- Follow existing code patterns and conventions.');
      contentLines.push('- Maintain type safety and avoid `any`.');
    }

    if (!options?.simplified) {
      const conventions = model.getConventions();
      const convString = renderConventionsString(conventions);
      if (convString) {
        contentLines.push('');
        contentLines.push('**Project Conventions:**');
        contentLines.push(convString);
      }

      if (patterns.length > 0) {
        contentLines.push('');
        contentLines.push('**Project Patterns:**');
        for (const p of patterns.slice(0, 5)) {
          contentLines.push(`- ${p.description}`);
        }
      }
    }

    results.push({
      filePath,
      preamble,
      sections: [
        {
          id: `cursor-rules-dir:${dirName}`,
          content: contentLines.join('\n'),
        },
      ],
    });
  }

  return results;
}
