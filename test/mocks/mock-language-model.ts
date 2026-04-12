// test/mocks/mock-language-model.ts

import type * as vscode from 'vscode';

/** Shape of each recorded call — field order is canonical; tests index by field name */
export interface MockCall {
  prompt: string;        // the full text of the user message
  modelFamily: string;   // e.g. 'copilot-gpt-4o', 'copilot-gpt-3.5-turbo'
  tools: string[];       // tool names passed in the request (empty array if none)
  timestamp: number;     // Date.now() at the time send() was called
}

export type MockMode = 'success' | 'throw' | 'timeout' | 'partial';

export interface MockLanguageModelOptions {
  response?: string;       // text returned on 'success' (default: 'Mock LLM response')
  error?: Error;           // error thrown on 'throw' (default: new Error('Mock LLM error'))
  delayMs?: number;        // artificial delay before response (default: 0)
  mode?: MockMode;         // behaviour mode (default: 'success')
}

export class MockLanguageModelChat implements vscode.LanguageModelChat {
  // Public identifier fields required by vscode.LanguageModelChat
  readonly id: string = 'mock-model';
  readonly name: string = 'Mock Language Model';
  readonly vendor: string = 'mock';
  readonly family: string = 'copilot-gpt-4o';
  readonly version: string = '1.0.0';
  readonly maxInputTokens: number = 128_000;

  // Recorded calls — assertions use calls[0].prompt, calls[0].modelFamily, etc.
  calls: MockCall[] = [];

  private response: string;
  private error: Error;
  private delayMs: number;
  private mode: MockMode;

  constructor(opts: MockLanguageModelOptions = {}) {
    this.response = opts.response ?? 'Mock LLM response';
    this.error    = opts.error   ?? new Error('Mock LLM error');
    this.delayMs  = opts.delayMs ?? 0;
    this.mode     = opts.mode    ?? 'success';
  }

  async sendRequest(
    messages: vscode.LanguageModelChatMessage[],
    options: vscode.LanguageModelChatRequestOptions,
    token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelChatResponse> {
    // Record the call
    const userMessage = messages.find(m => m.role === vscode.LanguageModelChatMessageRole.User);
    this.calls.push({
      prompt:      String(userMessage?.content ?? ''),
      modelFamily: this.family,
      tools:       (options.tools ?? []).map(t => t.name),
      timestamp:   Date.now(),
    });

    if (this.delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this.delayMs));
    }

    if (token.isCancellationRequested) {
      throw new Error('Cancelled');
    }

    switch (this.mode) {
      case 'throw':
        throw this.error;

      case 'timeout':
        // Simulate a hung request — never resolves
        await new Promise<never>(() => undefined);
        throw new Error('unreachable'); // TypeScript narrowing

      case 'partial': {
        // Returns a stream that emits half the response then stops
        const half = this.response.slice(0, Math.floor(this.response.length / 2));
        return { stream: MockLanguageModelChat._streamOf(half), text: Promise.resolve(half) };
      }

      default: {
        // 'success'
        const r = this.response;
        return { stream: MockLanguageModelChat._streamOf(r), text: Promise.resolve(r) };
      }
    }
  }

  /** Reset recorded calls between tests */
  reset(): void {
    this.calls = [];
  }

  private static async *_streamOf(text: string): AsyncIterable<vscode.LanguageModelTextPart> {
    yield { value: text } as vscode.LanguageModelTextPart;
  }

  // Satisfy vscode.LanguageModelChat — not used in tests
  countTokens(
    _text: string | vscode.LanguageModelChatMessage,
    _token?: vscode.CancellationToken,
  ): Thenable<number> {
    return Promise.resolve(100);
  }
}
