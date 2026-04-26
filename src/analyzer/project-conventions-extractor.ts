import * as fs from 'node:fs/promises';
import { ProjectConventions } from '../types';

/**
 * Extracts project conventions from CLAUDE.md if present.
 * Looks for specific headers like "Tech Stack", "Naming Conventions", etc.
 */
export class ProjectConventionsExtractor {
  async extract(workspaceRoot: string): Promise<ProjectConventions | null> {
    const claudeMdPath = await this.findClaudeMd(workspaceRoot);
    if (!claudeMdPath) return null;

    try {
      const content = await fs.readFile(claudeMdPath, 'utf8');
      return this.parseClaudeMd(content);
    } catch {
      return null;
    }
  }

  private async findClaudeMd(root: string): Promise<string | null> {
    const commonPaths = ['CLAUDE.md', '.github/CLAUDE.md', 'docs/CLAUDE.md'];
    for (const p of commonPaths) {
      const fullPath = (await import('node:path')).join(root, p);
      try {
        await fs.access(fullPath);
        return fullPath;
      } catch {
        continue;
      }
    }
    return null;
  }

  private parseClaudeMd(content: string): ProjectConventions {
    const conventions: ProjectConventions = {
      techStack: [],
      codingStyle: [],
      namingConventions: [],
      forbidden: [],
      constraints: [],
      recentPatterns: [],
    };
    
    // Simple regex-based extraction for common sections
    conventions.techStack = this.extractList(content, /###?\s*Tech Stack([\s\S]*?)(?=###?|$)/i) ?? [];
    conventions.namingConventions = this.extractList(content, /###?\s*Naming Conventions([\s\S]*?)(?=###?|$)/i) ?? [];
    conventions.codingStyle = this.extractList(content, /###?\s*(?:Coding Style|Code Style)([\s\S]*?)(?=###?|$)/i) ?? [];
    conventions.forbidden = this.extractList(content, /###?\s*(?:Forbidden|Don't|Anti-patterns)([\s\S]*?)(?=###?|$)/i) ?? [];
    conventions.constraints = this.extractList(content, /###?\s*(?:Constraints|Guardrails)([\s\S]*?)(?=###?|$)/i) ?? [];

    return conventions;
  }

  private extractList(content: string, regex: RegExp): string[] | undefined {
    const match = regex.exec(content);
    if (!match) return undefined;

    const section = match[1] ?? '';
    const items = section
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('-') || line.startsWith('*'))
      .map(line => line.replace(/^[-*]\s*/, '').trim())
      .filter(line => line.length > 0);

    return items.length > 0 ? items : undefined;
  }
}
