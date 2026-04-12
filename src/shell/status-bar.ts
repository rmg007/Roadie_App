/**
 * @module status-bar
 * @description Creates and manages the Roadie status bar item.
 *   Shows current extension state (active, running workflow, etc.).
 *   Step 2: Static "Roadie active" text.
 *   Later steps update the status bar dynamically during workflow execution.
 * @inputs None (static display in Step 2)
 * @outputs StatusBarItem visible in VS Code bottom bar
 * @depends-on vscode (StatusBarItem API)
 * @depended-on-by extension.ts (creation at activation)
 */

import * as vscode from 'vscode';

/**
 * Create the Roadie status bar item and show it.
 * Returns the item as a disposable — caller adds it to context.subscriptions.
 */
export function createStatusBar(): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  item.text = '$(zap) Roadie active';
  item.tooltip = 'Roadie — The Invisible AI Workflow Engine';
  item.command = 'roadie.init';
  item.show();
  return item;
}
