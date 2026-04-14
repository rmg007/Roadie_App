/**
 * @module standalone-providers
 * @description Node.js implementations of provider interfaces for standalone mode.
 *   Used when RuntimeMode === 'standalone' (MCP server without VS Code).
 *   NullModelProvider throws on sendRequest — the MCP client provides the LLM.
 *   DirectAPIModelProvider is interface-only in Phase 2 (throws not-yet-implemented).
 * @inputs Optional API key / provider config
 * @outputs Provider interface implementations
 * @depends-on providers.ts, node:fs/promises
 * @depended-on-by container.ts (standalone mode)
 */

import * as fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
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
// NullModelProvider — used when no API key is configured
// =====================================================================

export class NullModelProvider implements ModelProvider {
  async selectModels(_selector: ModelSelector): Promise<ModelInfo[]> {
    return [];
  }

  async sendRequest(
    _modelId: string,
    _messages: ChatMessage[],
    _options: ModelRequestOptions,
  ): Promise<ModelResponse> {
    throw new Error(
      'Workflow execution requires an LLM. ' +
      'Configure ANTHROPIC_API_KEY or OPENAI_API_KEY, ' +
      'or use an MCP client that provides its own model.',
    );
  }
}

// =====================================================================
// DirectAPIModelProvider — opt-in direct HTTP (Phase 2: interface only)
// =====================================================================

export class DirectAPIModelProvider implements ModelProvider {
  constructor(
    private apiKey: string,
    private apiProvider: 'anthropic' | 'openai',
  ) {}

  async selectModels(_selector: ModelSelector): Promise<ModelInfo[]> {
    const TIER_MODELS: ModelInfo[] = this.apiProvider === 'anthropic'
      ? [
          { id: 'claude-3-5-haiku-20241022', name: 'claude-3-5-haiku', vendor: 'anthropic', family: 'claude', maxInputTokens: 200000 },
          { id: 'claude-sonnet-4-20250514', name: 'claude-sonnet-4', vendor: 'anthropic', family: 'claude', maxInputTokens: 200000 },
          { id: 'claude-opus-4-20250514', name: 'claude-opus-4', vendor: 'anthropic', family: 'claude', maxInputTokens: 200000 },
        ]
      : [
          { id: 'gpt-4o-mini', name: 'gpt-4o-mini', vendor: 'openai', family: 'gpt-4o', maxInputTokens: 128000 },
          { id: 'gpt-4o', name: 'gpt-4o', vendor: 'openai', family: 'gpt-4o', maxInputTokens: 128000 },
        ];
    return TIER_MODELS;
  }

  async sendRequest(
    _modelId: string,
    _messages: ChatMessage[],
    _options: ModelRequestOptions,
  ): Promise<ModelResponse> {
    // Phase 2: Direct API implementation deferred to follow-up.
    // The primary standalone use case (Claude Code providing tools) doesn't need it.
    void this.apiKey;
    void this.apiProvider;
    throw new Error(
      'DirectAPIModelProvider: direct HTTP implementation is not yet available in Phase 2. ' +
      'Use an MCP client (Claude Code, Gemini CLI) that provides its own model.',
    );
  }
}

// =====================================================================
// StderrProgressReporter
// =====================================================================

export class StderrProgressReporter implements ProgressReporter {
  report(message: string): void {
    process.stderr.write(`[roadie] ${message}\n`);
  }

  reportMarkdown(markdown: string): void {
    process.stderr.write(`[roadie] ${markdown}\n`);
  }
}

// =====================================================================
// NullCancellationHandle
// =====================================================================

export class NullCancellationHandle implements CancellationHandle {
  readonly isCancelled = false;

  onCancelled(_callback: () => void): void {
    // Never cancelled in standalone mode — no-op
  }
}

// =====================================================================
// NodeFileSystemProvider
// =====================================================================

export class NodeFileSystemProvider implements FileSystemProvider {
  isFileOpenInEditor(_filePath: string): boolean {
    // No editor in standalone mode — always false (write immediately)
    return false;
  }

  async readFile(filePath: string): Promise<string> {
    return fs.readFile(filePath, 'utf8');
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
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
// FileConfigProvider — reads .vscode/settings.json + env vars
// =====================================================================

export class FileConfigProvider implements ConfigProvider {
  private settings: Record<string, unknown> = {};
  private loaded = false;

  constructor(private projectRoot: string) {}

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    const settingsPath = path.join(this.projectRoot, '.vscode', 'settings.json');
    try {
      const raw = readFileSync(settingsPath, 'utf8');
      this.settings = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      this.settings = {};
    }
  }

  get<T>(key: string, defaultValue: T): T {
    this.load();

    // Env var override: roadie.workflowHistory → ROADIE_WORKFLOWHISTORY
    const envKey = 'ROADIE_' + key.replace(/^roadie\./, '').replace(/[.]/g, '_').toUpperCase();
    const envVal = process.env[envKey];
    if (envVal !== undefined) {
      if (typeof defaultValue === 'boolean') return (envVal === 'true' || envVal === '1') as unknown as T;
      if (typeof defaultValue === 'number') return Number(envVal) as unknown as T;
      return envVal as unknown as T;
    }

    const val = this.settings[key];
    if (val !== undefined) return val as T;
    return defaultValue;
  }
}
