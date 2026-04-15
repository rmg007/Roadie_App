/**
 * @module vscode-providers
 * @description VS Code implementations of provider interfaces.
 *   Used when RuntimeMode === 'extension'.
 *   Wraps real VS Code APIs for model selection, progress reporting,
 *   cancellation, file system, and configuration.
 * @inputs VS Code API objects (injected)
 * @outputs Provider interface implementations
 * @depends-on vscode, providers.ts
 * @depended-on-by container.ts (extension mode)
 */

import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
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
// VSCodeModelProvider
// =====================================================================

export class VSCodeModelProvider implements ModelProvider {
  async selectModels(selector: ModelSelector): Promise<ModelInfo[]> {
    const models = await vscode.lm.selectChatModels({
      vendor: selector.vendor,
      family: selector.family,
      id: selector.id,
    });
    return models.map((m) => ({
      id: m.id,
      name: m.name,
      vendor: m.vendor,
      family: m.family,
      maxInputTokens: m.maxInputTokens,
    }));
  }

  async sendRequest(
    modelId: string,
    messages: ChatMessage[],
    options: ModelRequestOptions,
  ): Promise<ModelResponse> {
    const [model] = await vscode.lm.selectChatModels({ id: modelId });
    if (!model) {
      throw new Error(`Model not found: ${modelId}`);
    }

    const vsMessages = messages.map((m) => {
      if (m.role === 'user') return vscode.LanguageModelChatMessage.User(m.content);
      if (m.role === 'assistant') return vscode.LanguageModelChatMessage.Assistant(m.content);
      return vscode.LanguageModelChatMessage.System(m.content);
    });

    const cancellationSource = new vscode.CancellationTokenSource();
    if (options.cancellation) {
      options.cancellation.addEventListener('abort', () => cancellationSource.cancel());
    }

    const requestOptions = (options.modelOptions ?? {}) as Record<string, unknown>;
    const response = await model.sendRequest(
      vsMessages,
      requestOptions,
      cancellationSource.token,
    );

    let text = '';
    for await (const chunk of response.text) {
      text += chunk;
    }

    const usage = response.usage ?? { inputTokens: 0, outputTokens: 0 };
    return {
      text,
      toolCalls: [],
      usage: {
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
      },
    };
  }
}

// =====================================================================
// VSCodeProgressReporter
// =====================================================================

export class VSCodeProgressReporter implements ProgressReporter {
  constructor(private stream: vscode.ChatResponseStream) {}

  report(message: string): void {
    this.stream.progress(message);
  }

  reportMarkdown(markdown: string): void {
    this.stream.markdown(markdown);
  }
}

// =====================================================================
// VSCodeCancellationHandle
// =====================================================================

export class VSCodeCancellationHandle implements CancellationHandle {
  private readonly abortController = new AbortController();

  constructor(private token: vscode.CancellationToken) {
    this.token.onCancellationRequested(() => this.abortController.abort());
    if (this.token.isCancellationRequested) {
      this.abortController.abort();
    }
  }

  get isCancelled(): boolean {
    return this.token.isCancellationRequested;
  }

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  onCancelled(callback: () => void): void {
    this.token.onCancellationRequested(callback);
  }
}

// =====================================================================
// VSCodeFileSystemProvider
// =====================================================================

export class VSCodeFileSystemProvider implements FileSystemProvider {
  constructor(private openDocuments: readonly vscode.TextDocument[]) {}

  isFileOpenInEditor(filePath: string): boolean {
    return this.openDocuments.some((doc) => doc.uri.fsPath === filePath);
  }

  async readFile(filePath: string): Promise<string> {
    return fs.readFile(filePath, 'utf8');
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    await fs.writeFile(filePath, content, 'utf8');
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

// =====================================================================
// VSCodeConfigProvider
// =====================================================================

export class VSCodeConfigProvider implements ConfigProvider {
  get<T>(key: string, defaultValue: T): T {
    return vscode.workspace.getConfiguration('roadie').get<T>(key, defaultValue);
  }
}
