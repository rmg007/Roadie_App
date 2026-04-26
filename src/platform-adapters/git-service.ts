import { execSync } from 'child_process';
import { MCP_LOGGER } from '../platform-adapters';
import type { RuntimeMode } from '../config-loader';

export type GitCheckpointStatus = 'created' | 'skipped_not_git' | 'skipped_no_head' | 'skipped_runtime_mode' | 'failed';

export interface GitCommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface GitCheckpointResult {
  status: GitCheckpointStatus;
  tagName?: string;
  reason?: string;
}

export class GitService {
  private readonly projectRoot: string;
  private readonly mode: RuntimeMode;

  private toTrimmedString(value: unknown): string {
    if (typeof value === 'string') {
      return value.trim();
    }
    if (value && typeof value === 'object' && 'toString' in value) {
      const toStringFn = (value as { toString?: unknown }).toString;
      if (typeof toStringFn === 'function') {
        return String(toStringFn.call(value)).trim();
      }
    }
    return '';
  }

  constructor(projectRoot: string, mode: RuntimeMode = { dryRun: false, safeMode: false }) {
    this.projectRoot = projectRoot;
    this.mode = mode;
  }

  private run(command: string): GitCommandResult {
    try {
      return {
        ok: true,
        stdout: execSync(command, { cwd: this.projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(),
        stderr: '',
        exitCode: 0,
      };
    } catch (err: unknown) {
      MCP_LOGGER.error(`Git Error: ${command}`, err);
      const errorLike = err && typeof err === 'object' ? (err as Record<string, unknown>) : {};
      return {
        ok: false,
        stdout: this.toTrimmedString(errorLike.stdout),
        stderr: this.toTrimmedString(errorLike.stderr),
        exitCode: typeof errorLike.status === 'number' ? errorLike.status : null,
      };
    }
  }

  private hasValidHead(): boolean {
    return this.run('git rev-parse --verify HEAD').ok;
  }

  private isGitRepository(): boolean {
    return this.run('git rev-parse --is-inside-work-tree').ok;
  }

  /**
   * Creates a safety checkpoint tag.
   */
  async createCheckpoint(): Promise<GitCheckpointResult> {
    if (this.mode.dryRun || this.mode.safeMode) {
      return {
        status: 'skipped_runtime_mode',
        reason: `Checkpoint creation disabled in ${this.mode.dryRun ? 'dry-run' : 'safe-mode'}.`,
      };
    }

    if (!this.isGitRepository()) {
      return { status: 'skipped_not_git', reason: 'Target root is not a git repository.' };
    }

    if (!this.hasValidHead()) {
      return { status: 'skipped_no_head', reason: 'Git repository has no valid HEAD yet.' };
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const tagName = `roadie/checkpoint-${timestamp}`;
    
    // Check if repo is clean
    const status = this.run('git status --porcelain');
    const hasDirtyFiles = Boolean(status.stdout);
    let stashPushed = false;

    if (!status.ok) {
      return { status: 'failed', reason: 'Failed to inspect git status before checkpoint.' };
    }

    if (hasDirtyFiles) {
      // If dirty, we'll stash first or just create a commit on a temp branch?
      // For simplicity, we'll just tag the current HEAD and name it as a checkpoint.
      // If dirty, the checkpoint represents the state + dirty changes if we use stash.
      const stashResult = this.run('git stash push -m "Roadie Auto-Checkpoint"');
      if (!stashResult.ok) {
        return { status: 'failed', reason: stashResult.stderr || 'git stash push failed' };
      }
      stashPushed = true;
    }

    const tagResult = this.run(`git tag ${tagName}`);
    if (!tagResult.ok) {
      if (stashPushed) {
        this.run('git stash pop');
      }
      return { status: 'failed', reason: tagResult.stderr || 'git tag failed' };
    }
    
    if (stashPushed) {
      const stashPopResult = this.run('git stash pop');
      if (!stashPopResult.ok) {
        return { status: 'failed', tagName, reason: stashPopResult.stderr || 'git stash pop failed' };
      }
    }

    return { status: 'created', tagName };
  }

  /**
   * Rolls back to a specific checkpoint.
   */
  async rollback(checkpoint: string): Promise<boolean> {
    if (this.mode.dryRun || this.mode.safeMode) {
      return false;
    }
    this.run(`git reset --hard ${checkpoint}`);
    return true;
  }

  /**
   * Lists recent checkpoints.
   */
  async listCheckpoints(): Promise<string[]> {
    const tags = this.run('git tag --list "roadie/checkpoint-*"');
    return tags.ok && tags.stdout ? tags.stdout.split('\n').reverse() : [];
  }
}
