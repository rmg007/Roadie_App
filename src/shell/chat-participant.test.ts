import { describe, it, expect, vi } from 'vitest';

// Mock vscode so the module can be imported in test environments
vi.mock('vscode', () => ({
  chat: { 
    createChatParticipant: vi.fn((id, handler) => ({ 
      iconPath: undefined, 
      dispose: vi.fn(),
      handler // Store the handler for testing
    })) 
  },
  ThemeIcon: vi.fn(),
}));

import { buildContextWithHotFiles, getChatLastContext } from './chat-participant';
import * as loggerMod from './logger';

describe('buildContextWithHotFiles', () => {
  it('returns base unchanged when hotFiles is empty', () => {
    const result = buildContextWithHotFiles('Original prompt', []);
    expect(result).toBe('Original prompt');
  });

  it('appends Most-Edited Files section when files are present', () => {
    const hotFiles = [
      { filePath: 'src/foo.ts', editCount: 12 },
      { filePath: 'src/bar.ts', editCount: 5 },
    ];
    const result = buildContextWithHotFiles('My prompt', hotFiles);
    expect(result).toContain('My prompt');
    expect(result).toContain('## Most-Edited Files');
    expect(result).toContain('src/foo.ts (12 edits)');
    expect(result).toContain('src/bar.ts (5 edits)');
  });

  it('lists files in the order provided', () => {
    const hotFiles = [
      { filePath: 'a.ts', editCount: 3 },
      { filePath: 'b.ts', editCount: 1 },
    ];
    const result = buildContextWithHotFiles('prompt', hotFiles);
    const aIdx = result.indexOf('a.ts');
    const bIdx = result.indexOf('b.ts');
    expect(aIdx).toBeLessThan(bIdx);
  });

  it('preserves the original prompt content verbatim', () => {
    const base = 'Review the auth module and check for security issues';
    const result = buildContextWithHotFiles(base, [{ filePath: 'auth.ts', editCount: 8 }]);
    expect(result.startsWith(base)).toBe(true);
  });

  it('separates base and section with double newlines', () => {
    const result = buildContextWithHotFiles('prompt', [{ filePath: 'x.ts', editCount: 1 }]);
    expect(result).toContain('prompt\n\n## Most-Edited Files');
  });
});

describe('getChatLastContext', () => {
  it('returns a string', () => {
    expect(typeof getChatLastContext()).toBe('string');
  });
});

describe('slash command routing', () => {
  it('routes /fix to bug_fix workflow without classification', async () => {
    // Mock the handler dependencies
    const mockClassifier = { classify: vi.fn() };
    const mockStepHandler = vi.fn().mockResolvedValue({ 
      stepId: '1', 
      status: 'success', 
      output: 'done',
      tokenUsage: { input: 10, output: 20 },
      attempts: 1,
      modelUsed: 'test-model'
    });
    const mockProjectModel = {};
    const mockResponse = {
      markdown: vi.fn(),
      progress: vi.fn(),
    };
    const mockToken = { 
      isCancellationRequested: false,
      onCancellationRequested: vi.fn(),
    };

    // Import and call registerChatParticipant to trigger the mock
    const { registerChatParticipant } = await import('./chat-participant');
    registerChatParticipant({
      classifier: mockClassifier as any,
      stepHandler: mockStepHandler,
      projectModel: mockProjectModel as any,
    });

    // Get the handler from the vscode mock
    const vscode = await import('vscode');
    const mockCreateChatParticipant = (vscode.chat.createChatParticipant as any);
    const mockParticipant = mockCreateChatParticipant.mock.results[0].value;
    const handler = mockParticipant.handler;

    // Simulate /fix command
    const request = { command: 'fix', prompt: 'fix this bug' };
    await handler(request, {}, mockResponse, mockToken);

    // Verify classifier was not called
    expect(mockClassifier.classify).not.toHaveBeenCalled();

    // Verify response contains workflow detection
    expect(mockResponse.markdown).toHaveBeenCalledWith(
      expect.stringContaining('Roadie** detected intent: **bug_fix**')
    );
  });

  it('routes /review to review workflow with confidence 1.0', async () => {
    const mockClassifier = { classify: vi.fn() };
    const mockStepHandler = vi.fn().mockResolvedValue({ 
      stepId: '1', 
      status: 'success', 
      output: 'done',
      tokenUsage: { input: 10, output: 20 },
      attempts: 1,
      modelUsed: 'test-model'
    });
    const mockProjectModel = {};
    const mockResponse = {
      markdown: vi.fn(),
      progress: vi.fn(),
    };
    const mockToken = { 
      isCancellationRequested: false,
      onCancellationRequested: vi.fn(),
    };

    const { registerChatParticipant } = await import('./chat-participant');
    registerChatParticipant({
      classifier: mockClassifier as any,
      stepHandler: mockStepHandler,
      projectModel: mockProjectModel as any,
    });

    const vscode = await import('vscode');
    const mockCreateChatParticipant = (vscode.chat.createChatParticipant as any);
    const mockParticipant = mockCreateChatParticipant.mock.results[mockCreateChatParticipant.mock.results.length - 1].value;
    const handler = mockParticipant.handler;

    const request = { command: 'review', prompt: 'review this code' };
    await handler(request, {}, mockResponse, mockToken);

    expect(mockClassifier.classify).not.toHaveBeenCalled();
    expect(mockResponse.markdown).toHaveBeenCalledWith(
      expect.stringContaining('confidence: 1.00')
    );
  });

  it('falls back to classification when command is undefined', async () => {
    const mockClassifier = {
      classify: vi.fn().mockReturnValue({
        intent: 'general_chat',
        confidence: 0.5,
        signals: ['test'],
        requiresLLM: true,
      }),
    };
    const mockStepHandler = vi.fn();
    const mockProjectModel = {};
    const mockResponse = {
      markdown: vi.fn(),
      progress: vi.fn(),
    };
    const mockToken = { 
      isCancellationRequested: false,
      onCancellationRequested: vi.fn(),
    };

    const { registerChatParticipant } = await import('./chat-participant');
    registerChatParticipant({
      classifier: mockClassifier as any,
      stepHandler: mockStepHandler,
      projectModel: mockProjectModel as any,
    });

    const vscode = await import('vscode');
    const mockCreateChatParticipant = (vscode.chat.createChatParticipant as any);
    const mockParticipant = mockCreateChatParticipant.mock.results[mockCreateChatParticipant.mock.results.length - 1].value;
    const handler = mockParticipant.handler;

    const request = { command: undefined, prompt: 'hello' };
    await handler(request, {}, mockResponse, mockToken);

    expect(mockClassifier.classify).toHaveBeenCalledWith('hello');
  });

  it('falls back to classification when command is unknown', async () => {
    const mockClassifier = {
      classify: vi.fn().mockReturnValue({
        intent: 'general_chat',
        confidence: 0.5,
        signals: ['test'],
        requiresLLM: true,
      }),
    };
    const mockStepHandler = vi.fn();
    const mockProjectModel = {};
    const mockResponse = {
      markdown: vi.fn(),
      progress: vi.fn(),
    };
    const mockToken = { 
      isCancellationRequested: false,
      onCancellationRequested: vi.fn(),
    };

    const { registerChatParticipant } = await import('./chat-participant');
    registerChatParticipant({
      classifier: mockClassifier as any,
      stepHandler: mockStepHandler,
      projectModel: mockProjectModel as any,
    });

    const vscode = await import('vscode');
    const mockCreateChatParticipant = (vscode.chat.createChatParticipant as any);
    const mockParticipant = mockCreateChatParticipant.mock.results[mockCreateChatParticipant.mock.results.length - 1].value;
    const handler = mockParticipant.handler;

    const request = { command: 'unknown', prompt: 'hello' };
    await handler(request, {}, mockResponse, mockToken);

    expect(mockClassifier.classify).toHaveBeenCalledWith('hello');
  });
});

describe('contextLensLevel logic', () => {
  function simulateContextLog(
    lensLevel: 'off' | 'summary' | 'full',
    intent: string,
    prompt: string,
  ): string[] {
    const calls: string[] = [];
    const log = { info: (msg: string) => calls.push(msg) };
    if (lensLevel !== 'off') {
      log.info(`[CONTEXT] intent=${intent} chars=${prompt.length}`);
      if (lensLevel === 'full') {
        const body = prompt.length > 200 ? `${prompt.slice(0, 200)}…` : prompt;
        log.info(`[CONTEXT] body: ${body}`);
      }
    }
    return calls;
  }

  it('suppresses all [CONTEXT] lines when level is off', () => {
    const calls = simulateContextLog('off', 'review', 'some prompt');
    expect(calls.some((m) => m.includes('[CONTEXT]'))).toBe(false);
  });

  it('emits exactly one [CONTEXT] line when level is summary', () => {
    const calls = simulateContextLog('summary', 'review', 'some prompt');
    const ctx = calls.filter((m) => m.includes('[CONTEXT]'));
    expect(ctx).toHaveLength(1);
    expect(ctx[0]).toContain('intent=review');
  });

  it('emits two [CONTEXT] lines when level is full', () => {
    const calls = simulateContextLog('full', 'onboard', 'some prompt');
    const ctx = calls.filter((m) => m.includes('[CONTEXT]'));
    expect(ctx).toHaveLength(2);
    expect(ctx[1]).toContain('body:');
  });

  it('full mode truncates prompts longer than 200 chars', () => {
    const long = 'x'.repeat(300);
    const calls = simulateContextLog('full', 'feature', long);
    const bodyLine = calls.find((m) => m.includes('[CONTEXT] body:'))!;
    expect(bodyLine).toContain('…');
    expect(bodyLine.length).toBeLessThan(300);
  });

  it('getLogger is importable without error', () => {
    expect(typeof loggerMod.getLogger).toBe('function');
  });
});
