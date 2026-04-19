import * as fs from 'node:fs/promises';
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

  constructor(basePath: string) {
    // basePath should be the project root
    this.skillsPath = path.join(basePath, 'assets', 'skills');
  }

  /**
   * List all available skills grouped by category.
   */
  async getAllSkills(): Promise<SkillMetadata[]> {
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
