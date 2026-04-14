/**
 * @module providers
 * @description Abstract provider interfaces that replace direct VS Code API usage.
 *   Each interface has two implementations: one for VS Code (extension shell),
 *   one for standalone (MCP server).
 *   This file is interface-only — no implementation code.
 * @inputs None (type-only module)
 * @outputs Provider interface definitions
 * @depends-on None
 * @depended-on-by model-resolver, agent-spawner, workflow-engine, step-executor,
 *   file-generator, shell/vscode-providers, mcp/standalone-providers, container
 */

// =====================================================================
// ModelProvider — abstracts vscode.lm.selectChatModels() + sendChatRequest()
// =====================================================================

export interface ModelSelector {
  vendor?: string;
  family?: string;
  id?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  vendor: string;
  family: string;
  maxInputTokens: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCallResult {
  toolName: string;
  input: Record<string, unknown>;
  result: string;
}

export interface ModelRequestOptions {
  tools?: ToolDefinition[];
  cancellation?: AbortSignal;
  modelOptions?: Record<string, unknown>;
}

export interface ModelResponse {
  text: string;
  toolCalls: ToolCallResult[];
  usage: { inputTokens: number; outputTokens: number };
}

export interface ModelProvider {
  selectModels(selector: ModelSelector): Promise<ModelInfo[]>;
  sendRequest(
    modelId: string,
    messages: ChatMessage[],
    options: ModelRequestOptions,
  ): Promise<ModelResponse>;
}

// =====================================================================
// ProgressReporter — abstracts vscode.ChatResponseStream
// =====================================================================

export interface ProgressReporter {
  report(message: string): void;
  reportMarkdown(markdown: string): void;
}

// =====================================================================
// CancellationHandle — abstracts vscode.CancellationToken
// =====================================================================

export interface CancellationHandle {
  readonly isCancelled: boolean;
  onCancelled(callback: () => void): void;
}

// =====================================================================
// FileSystemProvider — abstracts file system operations
// =====================================================================

export interface FileSystemProvider {
  isFileOpenInEditor(filePath: string): boolean;
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<void>;
  fileExists(filePath: string): Promise<boolean>;
}

// =====================================================================
// ConfigProvider — abstracts VS Code configuration
// =====================================================================

export interface ConfigProvider {
  get<T>(key: string, defaultValue: T): T;
}
