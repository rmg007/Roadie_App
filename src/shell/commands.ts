/**
 * @module commands
 * @description Command palette registrations and configuration reader.
 *   Reads roadie.* settings from vscode.workspace.getConfiguration().
 *   Registers roadie.init, roadie.rescan, roadie.reset commands.
 * @inputs vscode.workspace configuration API
 * @outputs RoadieConfig, command disposables
 * @depends-on types.ts (DeveloperPreferences), vscode
 * @depended-on-by extension.ts
 */

import * as vscode from 'vscode';
import type { DeveloperPreferences } from '../types';

/**
 * Full Roadie configuration (extends DeveloperPreferences with all settings).
 */
export interface RoadieConfig extends DeveloperPreferences {
  testTimeout: number;
  editTracking: boolean;
  workflowHistory: boolean;
}

const DEFAULTS: RoadieConfig = {
  testCommand: undefined,
  modelPreference: 'balanced',
  telemetryEnabled: false,
  autoCommit: false,
  testTimeout: 300,
  editTracking: false,
  workflowHistory: false,
};

/**
 * Read roadie.* configuration from VS Code settings.
 * Returns validated config with defaults applied.
 */
export function readConfiguration(): RoadieConfig {
  const raw = vscode.workspace.getConfiguration('roadie');
  return {
    testCommand: raw.get<string>('testCommand') || undefined,
    modelPreference: raw.get<'economy' | 'balanced' | 'quality'>('modelPreference', DEFAULTS.modelPreference!),
    telemetryEnabled: raw.get<boolean>('telemetry', DEFAULTS.telemetryEnabled),
    autoCommit: raw.get<boolean>('autoCommit', DEFAULTS.autoCommit),
    testTimeout: raw.get<number>('testTimeout', DEFAULTS.testTimeout),
    editTracking: raw.get<boolean>('editTracking', DEFAULTS.editTracking),
    workflowHistory: raw.get<boolean>('workflowHistory', DEFAULTS.workflowHistory),
  };
}

/**
 * Register roadie.* command palette commands.
 * Returns disposables for cleanup.
 */
export function registerCommands(callbacks: {
  onInit: () => void | Promise<void>;
  onRescan: () => void | Promise<void>;
  onReset: () => void | Promise<void>;
}): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('roadie.init', async () => {
      await callbacks.onInit();
      void vscode.window.showInformationMessage('Roadie: Initialized');
    }),
    vscode.commands.registerCommand('roadie.rescan', async () => {
      await callbacks.onRescan();
      void vscode.window.showInformationMessage('Roadie: Project rescanned');
    }),
    vscode.commands.registerCommand('roadie.reset', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Roadie: This will delete the local database and reset all state. Continue?',
        'Reset',
        'Cancel',
      );
      if (confirm === 'Reset') {
        await callbacks.onReset();
        void vscode.window.showInformationMessage('Roadie: Reset complete');
      }
    }),
  ];
}
