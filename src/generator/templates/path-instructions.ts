/**
 * @module path-instructions
 * @description Template for .github/instructions/{dir}.instructions.md files.
 *   Generates per-directory GitHub Copilot path-scoped instruction files.
 *
 *   Gates:
 *   - Only directories with role === 'source' or role === 'test'
 *   - Directory must have ≥ 3 source files
 *   - Maximum 6 output files (to avoid overwhelming Copilot)
 *
 * @inputs ProjectModel
 * @outputs GeneratedSection[] array (one entry per qualifying directory),
 *          each with a filePath in the section metadata.
 * @depends-on types.ts (ProjectModel, DirectoryNode)
 * @depended-on-by file-generator.ts
 */

import * as path from 'node:path';
import type { ProjectModel, DirectoryNode } from '../../types';
import type { GeneratedSection } from '../section-manager';

export const PATH_INSTRUCTIONS_DIR = '.github/instructions';

/** Minimum source-file count for a directory to qualify for an instruction file. */
const MIN_SOURCE_FILES = 3;

/** Maximum number of path-instruction files emitted per workspace. */
const MAX_FILES = 6;

const SOURCE_EXTENSIONS = new Set(['.ts', '.js', '.tsx', '.jsx', '.py', '.go', '.rs', '.rb', '.java', '.cs']);

export interface PathInstructionFile {
  /** Relative path (from workspace root) for this file, e.g. .github/instructions/src.instructions.md */
  filePath: string;
  /** Section content */
  sections: GeneratedSection[];
}

/**
 * Generate per-directory path-instruction files.
 * Returns an array of { filePath, sections } for each qualifying directory.
 */
export function generatePathInstructions(model: ProjectModel, options?: { simplified?: boolean }): PathInstructionFile[] {
  const dirTree = model.getDirectoryStructure();
  if (!dirTree?.children) return [];

  const patterns = model.getPatterns().filter((p) => p.confidence >= 0.7);
  const commands = model.getCommands();

  const qualifying = collectQualifyingDirs(dirTree);
  const results: PathInstructionFile[] = [];

  for (const dir of qualifying.slice(0, MAX_FILES)) {
    const dirName = path.basename(dir.path);
    const filePath = `${PATH_INSTRUCTIONS_DIR}/${dirName}.instructions.md`;
    const roleDesc = dir.role === 'test' ? 'test files' : 'source files';
    const fileCount = countSourceFiles(dir);

    const contentLines: string[] = [
      `## ${dirName}/ — ${roleDesc}`,
      '',
      `This directory contains ${roleDesc} (${fileCount} files detected).`,
      '',
    ];

    // Role-specific guidance
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

    // Relevant patterns — omitted in simplified mode
    if (!options?.simplified && patterns.length > 0) {
      contentLines.push('');
      contentLines.push('**Project conventions:**');
      for (const p of patterns.slice(0, 5)) {
        contentLines.push(`- ${p.description}`);
      }
    }

    results.push({
      filePath,
      sections: [
        {
          id: 'path-instructions',
          content: contentLines.join('\n'),
        },
      ],
    });
  }

  return results;
}

/**
 * Collect directories that qualify for path-instruction generation.
 * Only direct children of the root with role 'source' or 'test'
 * and ≥ MIN_SOURCE_FILES source files.
 */
function collectQualifyingDirs(root: DirectoryNode): DirectoryNode[] {
  if (!root.children) return [];
  return root.children.filter(
    (child) =>
      child.type === 'directory' &&
      (child.role === 'source' || child.role === 'test') &&
      countSourceFiles(child) >= MIN_SOURCE_FILES,
  );
}

function countSourceFiles(node: DirectoryNode): number {
  if (node.type === 'file') {
    const ext = path.extname(node.path);
    return SOURCE_EXTENSIONS.has(ext) ? 1 : 0;
  }
  return (node.children ?? []).reduce((acc, child) => acc + countSourceFiles(child), 0);
}

/**
 * Flat helper: returns all path-instruction sections that file-generator.ts
 * can use in its FILE_SPECS generate() callback.
 * Each item maps to a distinct output file via the section id convention
 * "path-instructions:{dirName}".
 */
export function generatePathInstructionSections(model: ProjectModel): GeneratedSection[] {
  const files = generatePathInstructions(model);
  return files.map((f) => ({
    id: `path-instructions:${path.basename(f.filePath).replace(/\.instructions\.md$/, '')}`,
    content: f.sections.map((s) => s.content).join('\n'),
  }));
}
