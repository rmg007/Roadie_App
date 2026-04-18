/**
 * @module claude-md-parser
 * @description Parses CLAUDE.md files to extract project conventions and constraints.
 *   Reads workspace root for CLAUDE.md or .CLAUDE.md, extracts tech stack, code quality
 *   rules, naming conventions, forbidden patterns, and constraints via regex.
 *   Returns normalized ProjectConventions object with defaults for missing files.
 * @inputs Workspace root path
 * @outputs ProjectConventions object with tech stack, naming, code quality, forbidden, constraints
 * @depends-on fs/promises, types.ts
 * @depended-on-by project-analyzer.ts (Phase 1.5)
 */

import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { ProjectConventions } from '../types';

export class ClaudeMdParser {
  /**
   * Parse CLAUDE.md from workspace root.
   * Returns normalized ProjectConventions with defaults if file not found.
   */
  async parse(workspaceRoot: string): Promise<ProjectConventions> {
    const conventions: ProjectConventions = {
      techStack: [],
      codingStyle: [],
      namingConventions: [],
      forbidden: [],
      constraints: [],
      recentPatterns: [],
    };

    let content: string;
    try {
      content = await readFile(path.join(workspaceRoot, 'CLAUDE.md'), 'utf-8');
    } catch {
      try {
        content = await readFile(path.join(workspaceRoot, '.CLAUDE.md'), 'utf-8');
      } catch {
        return conventions; // Return defaults if neither file exists
      }
    }

    // Extract Tech Stack (M3: Fix ClaudeMdParser Regex)
    const techStackMatch = content.match(/##\s+Tech\s+Stack\s*\n([\s\S]*?)(?=\n##|$)/i);
    if (techStackMatch) {
      const stack = this.extractList(techStackMatch[1]);
      conventions.techStack = [...new Set(stack)];
    }

    // Extract Code Quality
    const codeQualityMatch = content.match(/##\s+Code\s+Quality\s*\n([\s\S]*?)(?=\n##|$)/i);
    if (codeQualityMatch) {
      const quality = this.extractList(codeQualityMatch[1]);
      conventions.codingStyle = [...new Set(quality)];
    }

    // Extract Naming Conventions
    const namingMatch = content.match(/##\s+Naming\s*(?:Conventions)?\s*\n([\s\S]*?)(?=\n##|$)/i);
    if (namingMatch) {
      const naming = this.extractList(namingMatch[1]);
      conventions.namingConventions = [...new Set(naming)];
    }

    // Extract Forbidden
    const forbiddenMatch = content.match(/##\s+Forbidden\s*\n([\s\S]*?)(?=\n##|$)/i);
    if (forbiddenMatch) {
      const forbidden = this.extractList(forbiddenMatch[1]);
      conventions.forbidden = [...new Set(forbidden)];
    }

    // Extract Global Rules/Constraints
    const globalRulesMatch = content.match(/##\s+(?:Global\s+)?Rules\s*\n([\s\S]*?)(?=\n##|$)/i);
    if (globalRulesMatch) {
      const constraints = this.extractList(globalRulesMatch[1]);
      conventions.constraints = [...new Set(constraints)];
    }

    return conventions;
  }

  /**
   * Extract list items from markdown section text.
   * Matches bullet points, dashes, numbered lists, and inline key-value pairs.
   */
  private extractList(text: string): string[] {
    const items: string[] = [];

    // Match bullet points (- or *)
    const bulletMatches = text.matchAll(/[-*]\s+(.+?)(?=\n[-*]|\n[^-*\s]|\Z)/g);
    for (const match of bulletMatches) {
      const item = match[1].trim();
      if (item) items.push(item);
    }

    // Match numbered lists
    const numberedMatches = text.matchAll(/^\d+\.\s+(.+?)(?=\n\d+\.|\n[^\d]|\Z)/gm);
    for (const match of numberedMatches) {
      const item = match[1].trim();
      if (item) items.push(item);
    }

    // Extract key-value pairs (e.g., "**Key**: Value")
    const kvMatches = text.matchAll(/\*\*(.+?)\*\*:\s*(.+?)(?=\n|,)/g);
    for (const match of kvMatches) {
      const value = match[2].trim();
      if (value && !value.startsWith('- ')) items.push(value);
    }

    // Extract nested list items under ** headers **
    const nestedMatches = text.matchAll(/\*\*(.+?)\*\*[\s\n]+(?:[-*]|\d+\.)\s+(.+?)(?=\n[-*\d*]|\n\*\*|\Z)/g);
    for (const match of nestedMatches) {
      const item = match[2].trim();
      if (item) items.push(item);
    }

    return items.filter((item) => item.length > 0);
  }
}
