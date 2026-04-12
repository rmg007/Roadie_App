// test/mocks/mock-chat-response-stream.ts

import type * as vscode from 'vscode';

export interface CapturedOutput {
  type: 'text' | 'button' | 'reference' | 'filepaths';
  content: unknown;
}

export class MockChatResponseStream implements vscode.ChatResponseStream {
  captured: CapturedOutput[] = [];

  markdown(value: string | vscode.MarkdownString): void {
    this.captured.push({ type: 'text', content: typeof value === 'string' ? value : value.value });
  }

  button(command: vscode.Command): void {
    this.captured.push({ type: 'button', content: command });
  }

  reference(value: vscode.Uri | vscode.Location): void {
    this.captured.push({ type: 'reference', content: value });
  }

  filepaths(value: vscode.ChatResponseFileTree[]): void {
    this.captured.push({ type: 'filepaths', content: value });
  }

  // Satisfy remaining vscode.ChatResponseStream interface — unused in tests
  anchor(_value: vscode.Uri | vscode.Location, _title?: string): void { /* noop */ }
  progress(_value: string): void { /* noop */ }
  push(_part: vscode.ChatResponsePart): void { /* noop */ }

  reset(): void {
    this.captured = [];
  }

  /** Convenience: get all text output concatenated */
  get text(): string {
    return this.captured.filter(c => c.type === 'text').map(c => c.content as string).join('');
  }
}
