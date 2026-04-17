/**
 * @module claude-md
 * @description Template for CLAUDE.md at the workspace root.
 *   Provides workspace context for manual reference by any Claude-based tool.
 *   This file can be manually referenced or used by Claude Code through MCP.
 *   Output is capped at 120 lines for readability.
 *
 *   Content contract:
 *   - Global Rules: commands + high-confidence patterns (≤ 60 lines)
 *   - repo-map:     top-level directory tree with file counts
 *   - forbidden:    static stub the user can fill (preserved by merge markers)
 *
 * @inputs ProjectModel
 * @outputs GeneratedSection[] for CLAUDE.md
 * @depends-on types.ts (ProjectModel)
 * @depended-on-by file-generator.ts
 */

import * as path from 'node:path';
import type { ProjectModel } from '../../types';
import type { GeneratedSection } from '../section-manager';

export const CLAUDE_MD_PATH = 'CLAUDE.md';

/** Hard line-count budget to stay within Claude Code's auto-read window. */
const MAX_LINES = 120;

export function generateClaudeMd(model: ProjectModel, options?: { simplified?: boolean }): GeneratedSection[] {
  const sections: GeneratedSection[] = [];

  // ── workspace-rules ────────────────────────────────────────────────────────
  const lines: string[] = [];

  // Tech stack (compact, one line each)
  const techStack = model.getTechStack();
  if (techStack.length > 0) {
    lines.push('## Tech Stack');
    for (const e of techStack) {
      const ver = e.version ? ` ${e.version}` : '';
      lines.push(`- **${e.name}**${ver} (${e.category})`);
    }
    lines.push('');
  }

  // Commands
  const commands = model.getCommands();
  if (commands.length > 0) {
    lines.push('## Commands');
    for (const c of commands) {
      lines.push(`- **${c.name}**: \`${c.command}\``);
    }
    lines.push('');
  }

  // High-confidence patterns
  const patterns = model.getPatterns().filter((p) => p.confidence >= 0.7);
  if (patterns.length > 0) {
    lines.push('## Code Conventions');
    for (const p of patterns) {
      lines.push(`- ${p.description}`);
    }
    lines.push('');
  }

  sections.push({
    id: 'workspace-rules',
    content: `# Global Rules — Apply in Every Workspace\n\n${lines.join('\n').trimEnd()}`,
  });

  // Simplified mode: return only workspace-rules (drop repo-map and forbidden)
  if (options?.simplified) {
    return sections;
  }

  // ── repo-map ───────────────────────────────────────────────────────────────
  const dirTree = model.getDirectoryStructure();
  const mapLines: string[] = [];

  if (dirTree?.children) {
    for (const child of dirTree.children) {
      if (child.type !== 'directory') continue;
      const name = path.basename(child.path);
      const fileCount = countFiles(child);
      const role = child.role ? ` (${child.role})` : '';
      mapLines.push(`- **${name}/**${role}${fileCount > 0 ? ` — ${fileCount} files` : ''}`);
    }
  }

  sections.push({
    id: 'repo-map',
    content:
      `## Repository Map\n\n` +
      (mapLines.length > 0
        ? mapLines.join('\n')
        : '_Run `roadie.init` to populate the directory map._'),
  });

  // ── forbidden ──────────────────────────────────────────────────────────────
  sections.push({
    id: 'forbidden',
    content:
      `## Forbidden\n\n` +
      `_Add project-specific forbidden patterns here. This section is preserved across regenerations._`,
  });

  // Enforce line-count budget: trim workspace-rules if total would exceed MAX_LINES
  return enforceBudget(sections, MAX_LINES);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countFiles(node: { type: string; children?: typeof node[] }): number {
  if (node.type === 'file') return 1;
  return (node.children ?? []).reduce((acc, child) => acc + countFiles(child), 0);
}

function enforceBudget(sections: GeneratedSection[], maxLines: number): GeneratedSection[] {
  const totalLines = sections.reduce((acc, s) => acc + s.content.split('\n').length, 0);
  if (totalLines <= maxLines) return sections;

  // Trim workspace-rules content (the largest section) to fit
  const overhead = sections
    .slice(1)
    .reduce((acc, s) => acc + s.content.split('\n').length, 0);
  const allowedForFirst = Math.max(10, maxLines - overhead);
  const firstSection = sections[0];
  if (firstSection !== undefined) {
    const firstLines = firstSection.content.split('\n');
    if (firstLines.length > allowedForFirst) {
      sections[0] = {
        ...firstSection,
        content: firstLines.slice(0, allowedForFirst).join('\n') + '\n[truncated]',
      };
    }
  }
  return sections;
}
