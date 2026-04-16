import { beforeEach, describe, expect, it, vi } from 'vitest';

const registerChatVariableResolver = vi.fn(() => ({ dispose: vi.fn() }));

vi.mock('vscode', () => ({
  chat: {
    registerChatVariableResolver,
  },
  CodeActionKind: {
    QuickFix: 'quickfix',
    RefactorRewrite: 'refactor.rewrite',
  },
  ChatVariableLevel: {
    Full: 'full',
  },
  window: {
    createOutputChannel: vi.fn(() => ({
      appendLine: vi.fn(),
      show: vi.fn(),
      dispose: vi.fn(),
    })),
  },
  commands: {
    registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
    executeCommand: vi.fn(),
  },
  languages: {
    registerCodeActionsProvider: vi.fn(() => ({ dispose: vi.fn() })),
  },
  workspace: {
    workspaceFolders: undefined,
    createFileSystemWatcher: vi.fn(() => ({
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
      onDidCreate: vi.fn(() => ({ dispose: vi.fn() })),
      onDidDelete: vi.fn(() => ({ dispose: vi.fn() })),
      dispose: vi.fn(),
    })),
  },
}));

vi.mock('./shell/chat-participant', () => ({
  registerChatParticipant: vi.fn(() => ({ dispose: vi.fn() })),
  getChatLastContext: vi.fn(() => ''),
}));

vi.mock('./shell/status-bar', () => ({
  createStatusBar: vi.fn(() => ({ dispose: vi.fn() })),
}));

vi.mock('./shell/commands', () => ({
  registerCommands: vi.fn(() => []),
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

vi.mock('./shell/logger', () => ({
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
  })),
  RoadieLogger: class {},
}));

vi.mock('./spawner/agent-spawner', () => ({
  AgentSpawner: class {
    async spawn() {
      return {
        status: 'success',
        output: '',
        toolResults: [],
        tokenUsage: { input: 0, output: 0 },
        model: 'mock-model',
      };
    }
  },
}));

vi.mock('./engine/model-resolver', () => ({
  // Provide a mock that accepts the same constructor signature to avoid
  // runtime wiring mismatches when the real code calls `new ModelResolver(provider)`.
  ModelResolver: class {
    constructor(_provider?: any) {
      // no-op
    }
  },
}));

vi.mock('./model/project-model', () => ({
  InMemoryProjectModel: class {
    toContext() {
      return {
        serialized: '## Most-Edited Files\n\n- src/foo.ts (3 edits)',
      };
    }
  },
}));

vi.mock('./model/database', () => ({
  RoadieDatabase: class {
    constructor(_dbPath: string) {}
    getRawDb() {
      return {};
    }
    close() {}
  },
}));

vi.mock('./learning/learning-database', () => ({
  LearningDatabase: class {
    initialize() {}
    getDatabaseSize() {
      return 0;
    }
    close() {}
  },
}));

describe('#roadie variable resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers resolver and returns ProjectModel.toContext output', async () => {
    const { activate } = await import('./extension');
    const vscode = await import('vscode');

    await activate({
      extension: { packageJSON: { version: '0.7.2-test' } },
      subscriptions: [],
    } as any);

    expect(registerChatVariableResolver).toHaveBeenCalledWith(
      'roadie',
      'roadie',
      expect.any(String),
      expect.any(String),
      false,
      expect.any(Function),
    );

    const callback = registerChatVariableResolver.mock.calls[0][5] as (
      chatContext: unknown,
      token: unknown,
    ) => Promise<Array<{ level: unknown; value: string }>>;

    const values = await callback({}, { isCancellationRequested: false } as any);

    expect(values).toHaveLength(1);
    expect(values[0].level).toBe(vscode.ChatVariableLevel.Full);
    expect(values[0].value).toContain('## Most-Edited Files');
  });
});
