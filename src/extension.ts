/**
 * @module extension
 * @description VS Code extension entry point. Bootstrap stub — real activation
 *   logic is introduced in Step 2 (Scaffolding) of the Module Build Order.
 *   This file exists so `npm run build` produces a valid bundle during the
 *   environment bootstrap (Phase 0), before any modules are implemented.
 * @inputs vscode.ExtensionContext (provided by VS Code at activation time)
 * @outputs void (side effects: registers chat participant, commands, etc. — to be added)
 * @depends-on vscode
 */

import * as vscode from 'vscode';

/**
 * Called by VS Code when the extension is activated.
 * Activation triggers are declared in package.json under `activationEvents`.
 */
export function activate(_context: vscode.ExtensionContext): void {
  // Intentionally empty. Real activation logic is added in Step 2.
}

/**
 * Called by VS Code when the extension is deactivated.
 * Use this to dispose of any long-lived resources.
 */
export function deactivate(): void {
  // Intentionally empty.
}
