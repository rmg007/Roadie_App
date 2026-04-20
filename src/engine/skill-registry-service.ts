import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';

export interface SkillMetadata {
  name: string;
  category: string;
  uri: string;
  description?: string;
  summary?: string;
}

export class SkillRegistryService {
  private skillsPath: string;
  /** Cache invalidated on file-system changes */
  private cache: SkillMetadata[] | null = null;
  private watcher: fsSync.FSWatcher | null = null;

  constructor(basePath: string) {
    // basePath should be the project root
    this.skillsPath = path.join(basePath, 'assets', 'skills');
    this.startWatcher();
  }

  /**
   * Start a file-system watcher on the skills directory.
   * Whenever a .md file is added/changed/removed, invalidate the skill cache
   * so the next call to listSkills() / getAllSkills() re-reads from disk.
   * listSkills() will reflect the change within ≤1 second.
   */
  private startWatcher(): void {
    // Only watch if the directory already exists
    if (!fsSync.existsSync(this.skillsPath)) return;

    try {
      this.watcher = fsSync.watch(this.skillsPath, { recursive: true }, (event, filename) => {
        if (filename && filename.endsWith('.md')) {
          this.cache = null; // invalidate
        }
      });
      this.watcher.on('error', () => {
        // Silently stop watching on error — non-critical
        this.watcher?.close();
        this.watcher = null;
      });
    } catch {
      // fs.watch may not be available in all environments; skip gracefully
    }
  }

  /**
   * Stop the file-system watcher (call on shutdown).
   */
  stopWatcher(): void {
    this.watcher?.close();
    this.watcher = null;
  }

  /**
   * Alias used by existing callers (index.ts uses listSkills).
   */
  async listSkills(): Promise<SkillMetadata[]> {
    return this.getAllSkills();
  }

  /**
   * List all available skills grouped by category.
   * Results are cached and invalidated automatically when files change.
   */
  async getAllSkills(): Promise<SkillMetadata[]> {
    if (this.cache !== null) return this.cache;

    const skills: SkillMetadata[] = [];
    try {
      const categories = await fs.readdir(this.skillsPath);
      for (const cat of categories) {
        const catPath = path.join(this.skillsPath, cat);
        const stat = await fs.stat(catPath);
        if (stat.isDirectory()) {
          const files = await fs.readdir(catPath);
          for (const file of files) {
            if (file.endsWith('.md')) {
              const name = file.replace('.md', '');
              const content = await this.getSkillContent(cat, name);
              const summary = content?.split('\n').find(l => l.trim().length > 0 && !l.startsWith('#'))?.trim() || '';
              
              skills.push({
                name,
                category: cat,
                uri: `roadie://skills/${cat}/${name}`,
                summary: summary.length > 100 ? summary.substring(0, 100) + '...' : summary
              });
            }
          }
        }
      }
    } catch {
      // Return empty if directory missing
    }
    this.cache = skills;
    return skills;
  }

  /**
   * Get the content of a specific skill.
   */
  async getSkillContent(category: string, name: string): Promise<string | null> {
    const filePath = path.join(this.skillsPath, category, `${name}.md`);
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch {
      return null;
    }
  }

  /**
   * Find skills relevant to a technology name.
   */
  async findRelevantSkills(techName: string): Promise<SkillMetadata[]> {
    const all = await this.getAllSkills();
    const query = techName.toLowerCase();
    return all.filter(s => 
      s.name.toLowerCase().includes(query) || 
      s.category.toLowerCase().includes(query)
    );
  }

  /**
   * Adds a new skill discovered via live crawling to the persistent store.
   */
  public async addDiscoveredSkill(techName: string, content: string): Promise<void> {
    const discoveredDir = path.join(this.skillsPath, 'discovered');
    
    try {
      // Ensure the discovered directory exists
      await fs.mkdir(discoveredDir, { recursive: true });
      
      const fileName = `${techName.toLowerCase().replace(/\s+/g, '_')}.md`;
      const filePath = path.join(discoveredDir, fileName);
      
      const formattedContent = `# Discovered Skill: ${techName}\n\n> [!NOTE]\n> This skill was autonomously acquired via Firecrawl search and verified by the Roadie Analyzer.\n\n${content}`;
      
      await fs.writeFile(filePath, formattedContent, 'utf-8');
    } catch (err) {
      console.error(`SkillRegistry: Failed to commit discovered skill: ${err}`);
      throw err;
    }
  }
}
