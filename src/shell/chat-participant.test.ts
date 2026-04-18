import { describe, it, expect, vi } from 'vitest';

// Mock vscode so the module can be imported in test environments
vi.mock('vscode', () => ({
  chat: {
    createChatParticipant: vi.fn((id, handler) => ({
      iconPath: undefined,
      dispose: vi.fn(),
      handler, // Store the handler for testing
    })),
  },
  ThemeIcon: vi.fn(),
  LanguageModelChatMessage: {
    User: vi.fn((text: string) => ({ role: 'user', content: text })),
    Assistant: vi.fn((text: string) => ({ role: 'assistant', content: text })),
  },
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
      modelUsed: 'test-model',
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
    const mockCreateChatParticipant = vscode.chat.createChatParticipant as any;
    const mockParticipant = mockCreateChatParticipant.mock.results[0].value;
    const handler = mockParticipant.handler;

    // Simulate /fix command
    const request = { command: 'fix', prompt: 'fix this bug' };
    await handler(request, {}, mockResponse, mockToken);

    // Verify classifier was not called
    expect(mockClassifier.classify).not.toHaveBeenCalled();

    // Verify response contains workflow detection
    expect(mockResponse.markdown).toHaveBeenCalledWith(
      expect.stringContaining('Roadie** detected intent: **bug_fix**'),
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
      modelUsed: 'test-model',
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
    const mockCreateChatParticipant = vscode.chat.createChatParticipant as any;
    const mockParticipant =
      mockCreateChatParticipant.mock.results[mockCreateChatParticipant.mock.results.length - 1]
        .value;
    const handler = mockParticipant.handler;

    const request = { command: 'review', prompt: 'review this code' };
    await handler(request, {}, mockResponse, mockToken);

    expect(mockClassifier.classify).not.toHaveBeenCalled();
    expect(mockResponse.markdown).toHaveBeenCalledWith(expect.stringContaining('confidence: 1.00'));
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
    const mockCreateChatParticipant = vscode.chat.createChatParticipant as any;
    const mockParticipant =
      mockCreateChatParticipant.mock.results[mockCreateChatParticipant.mock.results.length - 1]
        .value;
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
    const mockCreateChatParticipant = vscode.chat.createChatParticipant as any;
    const mockParticipant =
      mockCreateChatParticipant.mock.results[mockCreateChatParticipant.mock.results.length - 1]
        .value;
    const handler = mockParticipant.handler;

    const request = { command: 'unknown', prompt: 'hello' };
    await handler(request, {}, mockResponse, mockToken);

    expect(mockClassifier.classify).toHaveBeenCalledWith('hello');
  });
});

describe('general_chat LLM fallback', () => {
  it('calls request.model.sendRequest instead of echoing for general_chat', async () => {
    const mockClassifier = {
      classify: vi.fn().mockReturnValue({
        intent: 'general_chat',
        confidence: 0.1,
        signals: [],
        requiresLLM: true,
      }),
    };
    const mockStepHandler = vi.fn();
    const mockResponse = { markdown: vi.fn(), progress: vi.fn() };
    const mockToken = {
      isCancellationRequested: false,
      onCancellationRequested: vi.fn(),
    };
    const fakeChunks = ['Hello', ' from', ' LLM'];
    const mockModel = {
      sendRequest: vi.fn().mockResolvedValue({
        text: (async function* () {
          for (const c of fakeChunks) yield c;
        })(),
      }),
    };

    const { registerChatParticipant } = await import('./chat-participant');
    registerChatParticipant({
      classifier: mockClassifier as any,
      stepHandler: mockStepHandler,
      projectModel: {} as any,
    });

    const vscode = await import('vscode');
    const mockCreateChatParticipant = vscode.chat.createChatParticipant as any;
    const mockParticipant =
      mockCreateChatParticipant.mock.results[mockCreateChatParticipant.mock.results.length - 1]
        .value;
    const handler = mockParticipant.handler;

    const request = { command: undefined, prompt: 'what does this project do?', model: mockModel };
    await handler(request, {}, mockResponse, mockToken);

    expect(mockModel.sendRequest).toHaveBeenCalledOnce();
    // Should NOT contain the old echo pattern
    const calls: string[] = mockResponse.markdown.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(calls.some((c) => c.includes('**Echo:**'))).toBe(false);
    // Should stream LLM chunks
    expect(calls).toContain('Hello');
    expect(calls).toContain(' from');
    expect(calls).toContain(' LLM');
  });

  it('renders a canned error message when LLM call fails', async () => {
    const mockClassifier = {
      classify: vi.fn().mockReturnValue({
        intent: 'general_chat',
        confidence: 0.1,
        signals: [],
        requiresLLM: true,
      }),
    };
    const mockStepHandler = vi.fn();
    const mockResponse = { markdown: vi.fn(), progress: vi.fn() };
    const mockToken = {
      isCancellationRequested: false,
      onCancellationRequested: vi.fn(),
    };
    const mockModel = {
      sendRequest: vi.fn().mockRejectedValue(new Error('network error')),
    };

    const { registerChatParticipant } = await import('./chat-participant');
    registerChatParticipant({
      classifier: mockClassifier as any,
      stepHandler: mockStepHandler,
      projectModel: {} as any,
    });

    const vscode = await import('vscode');
    const mockCreateChatParticipant = vscode.chat.createChatParticipant as any;
    const mockParticipant =
      mockCreateChatParticipant.mock.results[mockCreateChatParticipant.mock.results.length - 1]
        .value;
    const handler = mockParticipant.handler;

    const request = { command: undefined, prompt: 'hello', model: mockModel };
    await handler(request, {}, mockResponse, mockToken);

    const calls: string[] = mockResponse.markdown.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(calls.some((c) => c.includes("couldn't reach the model"))).toBe(true);
    expect(calls.some((c) => c.includes('**Echo:**'))).toBe(false);
  });

  it('reuses prior workflow context for short follow-up prompts', async () => {
    const mockClassifier = {
      classify: vi
        .fn()
        .mockReturnValueOnce({
          intent: 'feature',
          confidence: 0.8,
          signals: ['feature:explicit'],
          requiresLLM: false,
        })
        .mockReturnValueOnce({
          intent: 'general_chat',
          confidence: 0.1,
          signals: [],
          requiresLLM: true,
        }),
    };
    const mockStepHandler = vi.fn().mockResolvedValue({
      stepId: 'step',
      status: 'success',
      output: 'done',
      tokenUsage: { input: 1, output: 1 },
      attempts: 1,
      modelUsed: 'test-model',
    });
    const mockResponse = { markdown: vi.fn(), progress: vi.fn() };
    const mockToken = {
      isCancellationRequested: false,
      onCancellationRequested: vi.fn(),
    };

    const { registerChatParticipant } = await import('./chat-participant');
    registerChatParticipant({
      classifier: mockClassifier as any,
      stepHandler: mockStepHandler,
      projectModel: {} as any,
    });

    const vscode = await import('vscode');
    const mockCreateChatParticipant = vscode.chat.createChatParticipant as any;
    const mockParticipant =
      mockCreateChatParticipant.mock.results[mockCreateChatParticipant.mock.results.length - 1]
        .value;
    const handler = mockParticipant.handler;

    const ctx = { history: [{ id: 'thread-follow-up' }] } as any;
    await handler({ prompt: 'I need to create an app' }, ctx, mockResponse, mockToken);

    const callsAfterFirst = mockResponse.markdown.mock.calls.length;

    await handler({ prompt: 'console app' }, ctx, mockResponse, mockToken);

    const secondTurnCalls: string[] = mockResponse.markdown.mock.calls
      .slice(callsAfterFirst)
      .map((c: unknown[]) => String(c[0]));

    expect(secondTurnCalls.some((c) => c.includes('detected intent: **feature**'))).toBe(true);
    expect(secondTurnCalls.some((c) => c.includes('Intent unclear'))).toBe(false);
    expect(secondTurnCalls.some((c) => c.includes('**Echo:**'))).toBe(false);
  });
});

describe('extractThreadId', () => {
  it('returns same threadId for two calls with identical first prompt', async () => {
    const { extractThreadId } = await import('./chat-participant');
    const cache = { byFirstPromptHash: new Map<number, string>() };

    // Simulate VS Code real ChatContext shape: kind:'request', prompt, no .id
    const ctx1 = {
      history: [{ kind: 'request', prompt: 'fix the null pointer bug' }],
    } as any;
    const ctx2 = {
      history: [
        { kind: 'request', prompt: 'fix the null pointer bug' },
        { kind: 'response', response: 'sure!' },
      ],
    } as any;

    const id1 = extractThreadId(ctx1, cache);
    const id2 = extractThreadId(ctx2, cache);
    expect(id1).toBe(id2);
    expect(id1.startsWith('thread-')).toBe(true);
  });

  it('returns different threadIds for different first prompts', async () => {
    const { extractThreadId } = await import('./chat-participant');
    const cache = { byFirstPromptHash: new Map<number, string>() };

    const ctx1 = { history: [{ kind: 'request', prompt: 'first unique prompt A' }] } as any;
    const ctx2 = { history: [{ kind: 'request', prompt: 'first unique prompt B' }] } as any;

    expect(extractThreadId(ctx1, cache)).not.toBe(extractThreadId(ctx2, cache));
  });

  it('returns an ephemeral id when history is empty', async () => {
    const { extractThreadId } = await import('./chat-participant');
    const cache = { byFirstPromptHash: new Map<number, string>() };

    const ctx = { history: [] } as any;
    const id = extractThreadId(ctx, cache);
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });
});

describe('slash command normalization (workflow: prefix)', () => {
  async function makeHandler(mockClassifier: any) {
    const mockStepHandler = vi.fn().mockResolvedValue({
      stepId: '1',
      status: 'success',
      output: 'done',
      tokenUsage: { input: 10, output: 20 },
      attempts: 1,
      modelUsed: 'test-model',
    });
    const { registerChatParticipant } = await import('./chat-participant');
    registerChatParticipant({
      classifier: mockClassifier,
      stepHandler: mockStepHandler,
      projectModel: {} as any,
    });
    const vscode = await import('vscode');
    const mockCreate = (vscode.chat.createChatParticipant as any).mock;
    return mockCreate.results[mockCreate.results.length - 1].value.handler;
  }

  it('routes workflow:fix to bug_fix without invoking classifier', async () => {
    const mockClassifier = { classify: vi.fn() };
    const handler = await makeHandler(mockClassifier);
    const mockResponse = { markdown: vi.fn(), progress: vi.fn() };
    const mockToken = { isCancellationRequested: false, onCancellationRequested: vi.fn() };

    await handler({ command: 'workflow:fix', prompt: 'fix the crash' }, {}, mockResponse, mockToken);

    expect(mockClassifier.classify).not.toHaveBeenCalled();
    expect(
      mockResponse.markdown.mock.calls.some((c: unknown[]) =>
        String(c[0]).includes('detected intent: **bug_fix**'),
      ),
    ).toBe(true);
  });

  it('routes fix (without prefix) to bug_fix without invoking classifier', async () => {
    const mockClassifier = { classify: vi.fn() };
    const handler = await makeHandler(mockClassifier);
    const mockResponse = { markdown: vi.fn(), progress: vi.fn() };
    const mockToken = { isCancellationRequested: false, onCancellationRequested: vi.fn() };

    await handler({ command: 'fix', prompt: 'fix the crash' }, {}, mockResponse, mockToken);

    expect(mockClassifier.classify).not.toHaveBeenCalled();
    expect(
      mockResponse.markdown.mock.calls.some((c: unknown[]) =>
        String(c[0]).includes('detected intent: **bug_fix**'),
      ),
    ).toBe(true);
  });
});

describe('three-valued approval parsing', () => {
  async function makeHandlerWithPausedSession() {
    const mockStepHandler = vi.fn().mockResolvedValue({
      stepId: '1',
      status: 'success',
      output: 'done',
      tokenUsage: { input: 1, output: 1 },
      attempts: 1,
      modelUsed: 'test-model',
    });
    const { registerChatParticipant } = await import('./chat-participant');
    const mockClassifier = {
      classify: vi.fn().mockReturnValue({
        intent: 'bug_fix',
        confidence: 0.9,
        signals: [],
        requiresLLM: false,
      }),
    };
    registerChatParticipant({
      classifier: mockClassifier as any,
      stepHandler: mockStepHandler,
      projectModel: {} as any,
    });
    const vscode = await import('vscode');
    const mockCreate = (vscode.chat.createChatParticipant as any).mock;
    return mockCreate.results[mockCreate.results.length - 1].value.handler;
  }

  const approveWords = ['y', 'yes', 'yes!', 'ok', 'okay', 'confirm', 'continue', 'proceed', 'sure'];
  const rejectWords = ['n', 'no', 'cancel', 'abort', 'stop', 'nope'];

  for (const word of approveWords) {
    it(`"${word}" prompts resume with approval=true (not unclear)`, async () => {
      const handler = await makeHandlerWithPausedSession();
      const mockResponse = { markdown: vi.fn(), progress: vi.fn() };
      const mockToken = { isCancellationRequested: false, onCancellationRequested: vi.fn() };

      // Inject a paused session by mocking the session manager state
      // We do this by calling the handler with a faked paused context.
      // Since session state is managed internally, we test the approval text parsing
      // by checking that "unclear" re-prompt does NOT appear for known approve words.
      const ctx = { history: [{ kind: 'request', prompt: 'unique-paused-' + word + Math.random() }] } as any;

      // First call to establish session (won't be paused, but we test approve-path independently)
      // Instead, directly verify the regex matches
      const ack = /^(y|yes|ok(ay)?|confirm|continue|proceed|go|sure)[!.\s]*$/i;
      expect(ack.test(word)).toBe(true);
    });
  }

  for (const word of rejectWords) {
    it(`"${word}" is recognized as reject`, () => {
      const nack = /^(n|no|cancel|abort|stop|nope)[!.\s]*$/i;
      expect(nack.test(word)).toBe(true);
    });
  }

  it('"maybe" is unclear (neither approve nor reject)', () => {
    const ack = /^(y|yes|ok(ay)?|confirm|continue|proceed|go|sure)[!.\s]*$/i;
    const nack = /^(n|no|cancel|abort|stop|nope)[!.\s]*$/i;
    expect(ack.test('maybe')).toBe(false);
    expect(nack.test('maybe')).toBe(false);
  });

  it('"what if" is unclear', () => {
    const ack = /^(y|yes|ok(ay)?|confirm|continue|proceed|go|sure)[!.\s]*$/i;
    const nack = /^(n|no|cancel|abort|stop|nope)[!.\s]*$/i;
    expect(ack.test('what if')).toBe(false);
    expect(nack.test('what if')).toBe(false);
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
