/**
 * @module fake-providers
 * @description Fake implementations of provider interfaces for testing.
 *   Used only when ROADIE_TEST_MODE=true or in test environments.
 *   Marked with @__PURE__ for tree-shaking so they don't leak into bundles.
 *   All fakes are deterministic and synchronous (wrapped in Promise).
 * @inputs None (self-contained)
 * @outputs FakeModelProvider and supporting fakes
 * @depends-on providers.ts
 * @depended-on-by tests, CI guard (verify-bundle.js)
 */

import type {
  ModelProvider,
  ModelSelector,
  ModelInfo,
  ChatMessage,
  ModelRequestOptions,
  ModelResponse,
  ProgressReporter,
  CancellationHandle,
  FileSystemProvider,
  ConfigProvider,
} from '../providers';

// =====================================================================
// FakeModelProvider
// =====================================================================

/**
 * Fake LLM provider that returns deterministic responses for testing.
 * No real model calls; all responses are script-based.
 *
 * @__PURE__ — tree-shakable marker so FakeModelProvider
 *   disappears from production builds even if imported.
 */
export class FakeModelProvider implements ModelProvider {
  private requestCount = 0;
  private readonly models: ModelInfo[] = [
    {
      id: 'fake-gpt-4',
      name: 'Fake GPT-4',
      vendor: 'openai',
      family: 'gpt-4',
      maxInputTokens: 8192,
    },
    {
      id: 'fake-claude-3',
      name: 'Fake Claude 3',
      vendor: 'anthropic',
      family: 'claude-3-sonnet',
      maxInputTokens: 200000,
    },
  ];

  async selectModels(selector: ModelSelector): Promise<ModelInfo[]> {
    let filtered = this.models;

    if (selector.id) {
      filtered = filtered.filter((m) => m.id === selector.id);
      if (filtered.length === 0) {
        throw new Error(`Model not found: ${selector.id}`);
      }
    }
    if (selector.vendor) {
      filtered = filtered.filter((m) => m.vendor === selector.vendor);
    }
    if (selector.family) {
      filtered = filtered.filter((m) => m.family === selector.family);
    }

    return filtered;
  }

  async sendRequest(
    modelId: string,
    messages: ChatMessage[],
    options: ModelRequestOptions,
  ): Promise<ModelResponse> {
    // Verify model exists
    const [model] = await this.selectModels({ id: modelId }).catch(() => [undefined]);
    if (!model) {
      throw new Error(`Model not found: ${modelId}`);
    }

    // Check cancellation early
    if (options.cancellation?.aborted) {
      throw new Error('Request cancelled');
    }

    this.requestCount++;

    // Script deterministic responses based on user message content
    const userMessages = messages.filter((m) => m.role === 'user').map((m) => m.content);
    const lastUserMessage = userMessages[userMessages.length - 1] || '';

    let text = '';
    if (lastUserMessage.toLowerCase().includes('2+2')) {
      text = '2 + 2 equals 4.';
    } else if (lastUserMessage.toLowerCase().includes('3+3')) {
      text = '3 + 3 equals 6.';
    } else if (lastUserMessage.toLowerCase().includes('hello')) {
      text = 'Hello! How can I help you?';
    } else if (lastUserMessage.toLowerCase().includes('bug')) {
      text = 'I can help you fix that bug. Could you describe what\'s happening?';
    } else if (lastUserMessage.toLowerCase().includes('feature')) {
      text = 'Let\'s plan this feature together.';
    } else {
      text = `Response to: "${lastUserMessage.substring(0, 50)}..."`;
    }

    return {
      text,
      toolCalls: [],
      usage: {
        inputTokens: Math.ceil(messages.join(' ').length / 4),
        outputTokens: Math.ceil(text.length / 4),
      },
    };
  }
}

// =====================================================================
// FakeProgressReporter
// =====================================================================

/**
 * Fake progress reporter that buffers output for test inspection.
 */
export class FakeProgressReporter implements ProgressReporter {
  private buffer: string[] = [];

  report(message: string): void {
    this.buffer.push(`[progress] ${message}`);
  }

  reportMarkdown(markdown: string): void {
    this.buffer.push(`[markdown] ${markdown}`);
  }

  getOutput(): string {
    return this.buffer.join('\n');
  }

  clear(): void {
    this.buffer = [];
  }
}

// =====================================================================
// FakeCancellationHandle
// =====================================================================

/**
 * Fake cancellation handle with manual abort capability.
 */
export class FakeCancellationHandle implements CancellationHandle {
  private _isCancelled = false;
  private callbacks: (() => void)[] = [];
  private abortController = new AbortController();

  get isCancelled(): boolean {
    return this._isCancelled;
  }

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  cancel(): void {
    if (this._isCancelled) return;
    this._isCancelled = true;
    this.abortController.abort();
    this.callbacks.forEach((cb) => cb());
  }

  onCancelled(callback: () => void): void {
    if (this._isCancelled) {
      callback();
    } else {
      this.callbacks.push(callback);
    }
  }
}

// =====================================================================
// FakeFileSystemProvider
// =====================================================================

/**
 * Fake file system with in-memory state for testing.
 */
export class FakeFileSystemProvider implements FileSystemProvider {
  private files = new Map<string, string>();
  private openFiles = new Set<string>();

  setFile(path: string, content: string): void {
    this.files.set(path, content);
  }

  setOpenFile(path: string): void {
    this.openFiles.add(path);
  }

  isFileOpenInEditor(filePath: string): boolean {
    return this.openFiles.has(filePath);
  }

  async readFile(filePath: string): Promise<string> {
    const content = this.files.get(filePath);
    if (content === undefined) {
      throw new Error(`File not found: ${filePath}`);
    }
    return content;
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    this.files.set(filePath, content);
  }

  async fileExists(filePath: string): Promise<boolean> {
    return this.files.has(filePath);
  }

  clear(): void {
    this.files.clear();
    this.openFiles.clear();
  }
}

// =====================================================================
// FakeConfigProvider
// =====================================================================

/**
 * Fake config provider with in-memory state.
 */
export class FakeConfigProvider implements ConfigProvider {
  private config = new Map<string, unknown>();

  set<T>(key: string, value: T): void {
    this.config.set(key, value);
  }

  get<T>(key: string, defaultValue: T): T {
    return (this.config.get(key) as T) ?? defaultValue;
  }

  clear(): void {
    this.config.clear();
  }
}
