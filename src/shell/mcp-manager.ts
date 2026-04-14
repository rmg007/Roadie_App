/**
 * @module shell/mcp-manager
 * @description Extension-side MCP process manager.
 *   Spawns and monitors the roadie-mcp CLI process.
 *   Implements 3-retry exponential backoff crash recovery.
 *   All communication with the child process is via stdio JSON-RPC.
 * @inputs VS Code extension context, workspace root
 * @outputs Managed child process with start/stop/restart lifecycle
 * @depends-on vscode, node:child_process, node:path
 * @depended-on-by extension.ts
 */

import * as vscode from 'vscode';
import * as cp from 'node:child_process';
import * as path from 'node:path';

// =====================================================================
// Types
// =====================================================================

export interface MCPManagerConfig {
  /** Absolute path to the roadie-mcp CLI script or binary */
  binPath: string;
  /** The workspace root to pass as --project */
  projectRoot: string;
  /** Optional SQLite DB path (defaults to .github/.roadie/project-model.db) */
  dbPath?: string;
  /** Log level for the child process */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

type ManagerState = 'stopped' | 'starting' | 'running' | 'crashed' | 'disposed';

// =====================================================================
// MCPProcessManager
// =====================================================================

export class MCPProcessManager implements vscode.Disposable {
  private state: ManagerState = 'stopped';
  private process: cp.ChildProcess | null = null;
  private retryCount = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly MAX_RETRIES = 3;
  private readonly BASE_BACKOFF_MS = 1_000; // 1s, 2s, 4s

  private readonly outputChannel: vscode.OutputChannel;
  private readonly config: MCPManagerConfig;

  constructor(config: MCPManagerConfig, outputChannel?: vscode.OutputChannel) {
    this.config = config;
    this.outputChannel = outputChannel ?? vscode.window.createOutputChannel('Roadie MCP');
  }

  // =====================================================================
  // Public API
  // =====================================================================

  /**
   * Start the MCP server process.
   * No-op if already running.
   */
  async start(): Promise<void> {
    if (this.state === 'running' || this.state === 'starting') {
      return;
    }
    if (this.state === 'disposed') {
      throw new Error('MCPProcessManager has been disposed');
    }
    this.retryCount = 0;
    await this.spawnProcess();
  }

  /**
   * Stop the MCP server process.
   * No-op if already stopped.
   */
  stop(): void {
    this.clearRetryTimer();
    this.killProcess();
    this.state = 'stopped';
  }

  /**
   * Restart the process immediately (resets retry counter).
   */
  async restart(): Promise<void> {
    this.stop();
    this.retryCount = 0;
    await this.spawnProcess();
  }

  /**
   * True if the child process is currently running.
   */
  get isRunning(): boolean {
    return this.state === 'running';
  }

  /**
   * Dispose — stop child process and release resources.
   */
  dispose(): void {
    this.clearRetryTimer();
    this.killProcess();
    this.state = 'disposed';
    this.outputChannel.dispose();
  }

  // =====================================================================
  // Private
  // =====================================================================

  private async spawnProcess(): Promise<void> {
    this.state = 'starting';
    this.log(`[MCPManager] spawning roadie-mcp (attempt ${this.retryCount + 1})…`);

    const args: string[] = ['--project', this.config.projectRoot];
    if (this.config.dbPath) {
      args.push('--db', this.config.dbPath);
    }
    if (this.config.logLevel) {
      args.push('--log-level', this.config.logLevel);
    }

    const proc = cp.spawn(
      process.execPath,   // same Node.js binary that's running the extension host
      [this.config.binPath, ...args],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: this.config.projectRoot,
        env: {
          ...process.env,
          ROADIE_PROJECT_ROOT: this.config.projectRoot,
        },
      },
    );

    this.process = proc;

    // Log stderr to output channel (stdout is MCP protocol — don't touch)
    proc.stderr?.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n');
      for (const line of lines) {
        if (line.trim()) this.log(line);
      }
    });

    proc.on('spawn', () => {
      this.state = 'running';
      this.retryCount = 0;
      this.log('[MCPManager] process running');
    });

    proc.on('error', (err: Error) => {
      this.log(`[MCPManager] process error: ${err.message}`);
      this.handleCrash();
    });

    proc.on('close', (code: number | null) => {
      if (this.state === 'disposed' || this.state === 'stopped') return;
      this.log(`[MCPManager] process exited (code ${code ?? 'null'})`);
      this.handleCrash();
    });
  }

  private handleCrash(): void {
    if (this.state === 'disposed' || this.state === 'stopped') return;

    this.state = 'crashed';
    this.process = null;

    if (this.retryCount >= this.MAX_RETRIES) {
      this.log(
        `[MCPManager] max retries (${this.MAX_RETRIES}) exceeded — MCP server disabled. ` +
        'Run "Roadie: Restart MCP Server" to retry manually.',
      );
      void vscode.window.showWarningMessage(
        'Roadie MCP server failed to start after 3 attempts. Check the "Roadie MCP" output channel.',
        'Open Output',
      ).then((action) => {
        if (action === 'Open Output') {
          this.outputChannel.show();
        }
      });
      return;
    }

    const delay = this.BASE_BACKOFF_MS * Math.pow(2, this.retryCount);
    this.retryCount++;
    this.log(`[MCPManager] retrying in ${delay}ms (attempt ${this.retryCount}/${this.MAX_RETRIES})`);

    this.retryTimer = setTimeout(() => {
      if (this.state !== 'disposed') {
        void this.spawnProcess();
      }
    }, delay);
  }

  private killProcess(): void {
    if (this.process && !this.process.killed) {
      try {
        this.process.kill('SIGTERM');
      } catch {
        // Best-effort
      }
    }
    this.process = null;
  }

  private clearRetryTimer(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private log(message: string): void {
    this.outputChannel.appendLine(message);
  }
}

// =====================================================================
// Factory helper
// =====================================================================

/**
 * Create a configured MCPProcessManager from a VS Code extension context.
 * Uses the bundled roadie-mcp binary at out/bin/roadie-mcp.js.
 */
export function createMCPManager(
  context: vscode.ExtensionContext,
  projectRoot: string,
): MCPProcessManager {
  const binPath = path.join(context.extensionPath, 'out', 'bin', 'roadie-mcp.js');
  const dbPath  = path.join(projectRoot, '.github', '.roadie', 'project-model.db');
  const channel = vscode.window.createOutputChannel('Roadie MCP');

  const manager = new MCPProcessManager(
    { binPath, projectRoot, dbPath, logLevel: 'info' },
    channel,
  );
  context.subscriptions.push(manager);
  return manager;
}
