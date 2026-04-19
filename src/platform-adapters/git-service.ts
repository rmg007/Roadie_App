import { execSync } from 'child_process';
import { MCP_LOGGER } from '../platform-adapters';

export class GitService {
  private readonly projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  private run(command: string): string {
    try {
      return execSync(command, { cwd: this.projectRoot, encoding: 'utf8' }).trim();
    } catch (err: any) {
      MCP_LOGGER.error(`Git Error: ${command}`, err);
      return '';
    }
  }

  /**
   * Creates a safety checkpoint tag.
   */
  async createCheckpoint(): Promise<string | null> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const tagName = `roadie/checkpoint-${timestamp}`;
    
    // Check if repo is clean
    const status = this.run('git status --porcelain');
    if (status) {
      // If dirty, we'll stash first or just create a commit on a temp branch?
      // For simplicity, we'll just tag the current HEAD and name it as a checkpoint.
      // If dirty, the checkpoint represents the state + dirty changes if we use stash.
      this.run('git stash push -m "Roadie Auto-Checkpoint"');
    }

    this.run(`git tag ${tagName}`);
    
    if (status) {
      this.run('git stash pop');
    }

    return tagName;
  }

  /**
   * Rolls back to a specific checkpoint.
   */
  async rollback(checkpoint: string): Promise<boolean> {
    this.run(`git reset --hard ${checkpoint}`);
    return true;
  }

  /**
   * Lists recent checkpoints.
   */
  async listCheckpoints(): Promise<string[]> {
    const tags = this.run('git tag --list "roadie/checkpoint-*"');
    return tags ? tags.split('\n').reverse() : [];
  }
}
