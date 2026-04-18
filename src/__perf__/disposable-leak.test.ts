/**
 * @test disposable-leak.test.ts (A7)
 * @description Verifies that activate() / deactivate() cycles do not leak
 *   VS Code event listeners or disposables. Mocks vscode entirely — no real
 *   VS Code instance required.
 *
 *   Strategy:
 *   - Test the Container class directly (it is the disposable tracker used by extension.ts)
 *   - Verify Container.register + Container.dispose clears all registered disposables
 *   - Run 100 cycles to confirm no accumulation
 *   - A separate test imports extension.ts with full mocks to verify the
 *     context.subscriptions.push(container) pattern works end-to-end
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '../container';

// --------------------------------------------------------------------------
// Container-level tests (do not require VS Code)
// --------------------------------------------------------------------------

describe('A7 — Disposable hygiene (Container)', () => {
  it('registered disposables are called during dispose()', () => {
    const container = new Container();
    const d1 = { dispose: vi.fn() };
    const d2 = { dispose: vi.fn() };
    const d3 = { dispose: vi.fn() };

    container.register(d1);
    container.register(d2);
    container.register(d3);

    container.dispose();

    expect(d1.dispose).toHaveBeenCalledTimes(1);
    expect(d2.dispose).toHaveBeenCalledTimes(1);
    expect(d3.dispose).toHaveBeenCalledTimes(1);
  });

  it('dispose() clears the internal list — second dispose() is a no-op', () => {
    const container = new Container();
    const d = { dispose: vi.fn() };
    container.register(d);

    container.dispose();
    container.dispose(); // second call should not throw or call dispose again

    expect(d.dispose).toHaveBeenCalledTimes(1);
  });

  it('100 activate/deactivate cycles — no lingering disposables', () => {
    const CYCLES = 100;
    const allDisposables: Array<{ dispose: ReturnType<typeof vi.fn>; calledCount: () => number }> = [];

    for (let cycle = 0; cycle < CYCLES; cycle++) {
      const container = new Container();

      // Simulate what extension.ts registers:
      // 1. logger
      const logger = { dispose: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      // 2. chat participant
      const chatParticipant = { dispose: vi.fn() };
      // 3. openChatCmd
      const openChatCmd = { dispose: vi.fn() };
      // 4. code action provider
      const codeActionProvider = { dispose: vi.fn() };
      // 5. chat variable
      const chatVar = { dispose: vi.fn() };
      // 6. status bar
      const statusBar = { dispose: vi.fn() };
      // 7. commands (array)
      const cmd1 = { dispose: vi.fn() };
      const cmd2 = { dispose: vi.fn() };

      container.register(logger);
      container.register(chatParticipant);
      container.register(openChatCmd);
      container.register(codeActionProvider);
      container.register(chatVar);
      container.register(statusBar);
      container.register(cmd1);
      container.register(cmd2);

      const cycleDisposables = [logger, chatParticipant, openChatCmd, codeActionProvider, chatVar, statusBar, cmd1, cmd2];
      allDisposables.push(...cycleDisposables.map((d) => ({
        dispose: d.dispose,
        calledCount: () => d.dispose.mock.calls.length,
      })));

      // Simulate deactivate()
      container.dispose();

      // All disposables in this cycle were called exactly once
      for (const d of cycleDisposables) {
        expect(d.dispose).toHaveBeenCalledTimes(1);
      }
    }

    // Every single disposable across all cycles was called exactly once
    const notCalled = allDisposables.filter((d) => d.calledCount() === 0);
    const calledMultiple = allDisposables.filter((d) => d.calledCount() > 1);

    expect(notCalled).toHaveLength(0);
    expect(calledMultiple).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------
// Extension-level test: context.subscriptions integration
// --------------------------------------------------------------------------

// Provide minimal vscode mock needed for extension.ts to load
vi.mock('vscode', () => ({
  chat: {
    createChatParticipant: vi.fn(() => ({ dispose: vi.fn(), iconPath: undefined })),
    registerChatVariableResolver: vi.fn(() => ({ dispose: vi.fn() })),
  },
  ChatVariableLevel: { Full: 'full' },
  CodeActionKind: {
    QuickFix: 'quickfix',
    RefactorRewrite: 'refactor.rewrite',
  },
  commands: {
    registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
    executeCommand: vi.fn(),
  },
  languages: {
    registerCodeActionsProvider: vi.fn(() => ({ dispose: vi.fn() })),
  },
  window: {
    createOutputChannel: vi.fn(() => ({
      appendLine: vi.fn(),
      show: vi.fn(),
      dispose: vi.fn(),
    })),
  },
  workspace: {
    workspaceFolders: undefined,
    getConfiguration: vi.fn(() => ({
      get: vi.fn((_key: string, def: unknown) => def),
      update: vi.fn(),
    })),
    createFileSystemWatcher: vi.fn(() => ({
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
      onDidCreate: vi.fn(() => ({ dispose: vi.fn() })),
      onDidDelete: vi.fn(() => ({ dispose: vi.fn() })),
      dispose: vi.fn(),
    })),
  },
  ExtensionMode: { Development: 1, Production: 2, Test: 3 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  ThemeIcon: class { constructor(public id: string) {} },
}));

vi.mock('../shell/chat-participant', () => ({
  registerChatParticipant: vi.fn(() => ({ dispose: vi.fn() })),
  getChatLastContext: vi.fn(() => ''),
}));

vi.mock('../shell/status-bar', () => ({
  createStatusBar: vi.fn(() => ({ dispose: vi.fn() })),
}));

vi.mock('../shell/commands', () => ({
  registerCommands: vi.fn(() => [{ dispose: vi.fn() }, { dispose: vi.fn() }]),
  readConfiguration: vi.fn(() => ({
    workflowHistory: false,
    contextLensLevel: 'summary',
    modelPreference: 'balanced',
    telemetryEnabled: false,
    autoCommit: false,
    testTimeout: 300,
    editTracking: false,
  })),
  updateSetting: vi.fn(),
}));

vi.mock('../shell/logger', () => ({
  initLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    appendRaw: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn(),
  })),
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    appendRaw: vi.fn(),
    show: vi.fn(),
  })),
  RoadieLogger: class {},
}));

vi.mock('../spawner/agent-spawner', () => ({
  AgentSpawner: class {
    async spawn() {
      return { status: 'success', output: '', toolResults: [], tokenUsage: { input: 0, output: 0 }, model: 'mock' };
    }
  },
}));

vi.mock('../model/project-model', () => ({
  InMemoryProjectModel: class {
    getTechStack() { return []; }
    getCommands() { return []; }
    getDirectories() { return []; }
    getPatterns() { return []; }
    toContext() { return { serialized: '' }; }
    update() {}
    dispose() {}
  },
}));

vi.mock('../model/database', () => ({
  RoadieDatabase: class {
    constructor(_p: string) {}
    getRawDb() { return null; }
    close() {}
  },
}));

vi.mock('../learning/learning-database', () => ({
  LearningDatabase: class {
    initialize() {}
    getDatabaseSize() { return 0; }
    close() {}
    setWorkflowHistory() {}
    getWorkflowStats() {
      return { totalWorkflows: 0, successCount: 0, failureCount: 0, successRate: 0, averageDurationMs: 0, byType: {} };
    }
    getWorkflowCancellationStats() { return []; }
    getMostEditedFiles() { return []; }
  },
}));

vi.mock('../shell/vscode-providers', () => ({
  VSCodeModelProvider: class {},
}));

vi.mock('../engine/model-resolver', () => ({
  ModelResolver: class { constructor(_p?: unknown) {} },
}));

vi.mock('../watcher/file-watcher-manager', () => ({
  FileWatcherManager: class {
    start() {}
    dispose() {}
    onBatch() { return { dispose: vi.fn() }; }
    handleFileEvent() {}
  },
}));

describe('A7 — Extension disposable hygiene (end-to-end mock)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extension.activate() pushes exactly one item into context.subscriptions (the container)', async () => {
    const { activate } = await import('../extension');

    const ctx = {
      extension: { packageJSON: { version: '0.10.0-test' } },
      subscriptions: [] as Array<{ dispose(): void }>,
    };

    await activate(ctx as any);

    // extension.ts only calls context.subscriptions.push(container) once
    expect(ctx.subscriptions).toHaveLength(1);
    expect(typeof ctx.subscriptions[0].dispose).toBe('function');
  });

  it('extension.deactivate() disposes the container registered in context.subscriptions', async () => {
    const { activate, deactivate } = await import('../extension');

    const ctx = {
      extension: { packageJSON: { version: '0.10.0-test' } },
      subscriptions: [] as Array<{ dispose(): void }>,
    };

    await activate(ctx as any);
    expect(ctx.subscriptions).toHaveLength(1);

    const containerDispose = vi.spyOn(ctx.subscriptions[0], 'dispose');
    deactivate();

    // The container was disposed by deactivate()
    expect(containerDispose).toHaveBeenCalled();
  });
});
