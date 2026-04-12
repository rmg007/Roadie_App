/**
 * @module extension
 * @description VS Code extension entry point. Creates the DI container,
 *   registers the @roadie Chat Participant, status bar, configuration
 *   reader, and command palette commands. Routes deactivation through
 *   the container's dispose().
 * @inputs vscode.ExtensionContext (provided by VS Code at activation time)
 * @outputs Side effects: registered chat participant, status bar, commands
 * @depends-on container.ts, shell/chat-participant.ts, shell/status-bar.ts, shell/commands.ts
 * @depended-on-by VS Code (activation/deactivation lifecycle)
 */

import * as vscode from 'vscode';
import { Container } from './container';
import { registerChatParticipant } from './shell/chat-participant';
import { createStatusBar } from './shell/status-bar';
import { registerCommands, readConfiguration } from './shell/commands';

let container: Container | undefined;

/**
 * Called by VS Code when the extension is activated.
 * Activation triggers: onChat:roadie, workspaceContains:.github/.roadie/project-model.db,
 * onStartupFinished.
 */
export function activate(context: vscode.ExtensionContext): void {
  container = new Container();

  // Read configuration
  const _config = readConfiguration();

  // Chat Participant — classifies intent and routes to workflows
  container.register(registerChatParticipant());

  // Status bar — shows "Roadie active"
  container.register(createStatusBar());

  // Command palette commands (roadie.init, roadie.rescan, roadie.reset)
  const commands = registerCommands({
    onInit: () => {
      // Phase 1: no-op (project model initializes lazily)
    },
    onRescan: () => {
      // Phase 1: no-op (project analyzer will be wired here)
    },
    onReset: () => {
      // Phase 1: no-op (database reset will be wired here)
    },
  });
  for (const cmd of commands) {
    container.register(cmd);
  }

  // Container itself is disposed on deactivation
  context.subscriptions.push(container);
}

/**
 * Called by VS Code when the extension is deactivated.
 * Container.dispose() handles all cleanup.
 */
export function deactivate(): void {
  container?.dispose();
  container = undefined;
}
