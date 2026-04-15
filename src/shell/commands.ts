/**
 * @module commands
 * @description Command palette registrations and configuration reader.
 *   Reads roadie.* settings from vscode.workspace.getConfiguration().
 *   Registers:
 *     roadie.init, roadie.rescan, roadie.reset, roadie.stats,
 *     roadie.enableWorkflowHistory, roadie.disableWorkflowHistory,
 *     roadie.getScanSummary, roadie.runWorkflow, roadie.doctor
 * @inputs vscode.workspace configuration API
 * @outputs RoadieConfig, command disposables
 * @depends-on types.ts (DeveloperPreferences), vscode
 * @depended-on-by extension.ts
 */

import * as vscode from 'vscode';
import type { DeveloperPreferences } from '../types';
import { getLogger } from './logger';

/**
 * Full Roadie configuration (extends DeveloperPreferences with all settings).
 */
export interface RoadieConfig extends DeveloperPreferences {
  testTimeout: number;
  editTracking: boolean;
  workflowHistory: boolean;
  contextLensLevel: 'off' | 'summary' | 'full';
}

const DEFAULTS: RoadieConfig = {
  testCommand: undefined,
  modelPreference: 'balanced',
  telemetryEnabled: false,
  autoCommit: false,
  testTimeout: 300,
  editTracking: false,
  workflowHistory: false,
  contextLensLevel: 'summary',
};

function validateModelPreference(value: unknown): 'economy' | 'balanced' | 'quality' {
  if (value === 'economy' || value === 'balanced' || value === 'quality') {
    return value;
  }
  getLogger().warn(`commands: invalid roadie.modelPreference value '${String(value)}' — falling back to balanced`);
  return DEFAULTS.modelPreference;
}

function validateTestTimeout(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  getLogger().warn(`commands: invalid roadie.testTimeout value '${String(value)}' — falling back to ${DEFAULTS.testTimeout}`);
  return DEFAULTS.testTimeout;
}

function validateContextLensLevel(value: unknown): 'off' | 'summary' | 'full' {
  if (value === 'off' || value === 'summary' || value === 'full') return value;
  return DEFAULTS.contextLensLevel;
}

/**
 * Read roadie.* configuration from VS Code settings.
 * Returns validated config with defaults applied.
 */
export function readConfiguration(): RoadieConfig {
  const raw = vscode.workspace.getConfiguration('roadie');
  return {
    testCommand:       raw.get<string>('testCommand') || undefined,
    modelPreference:   validateModelPreference(raw.get('modelPreference', DEFAULTS.modelPreference)),
    telemetryEnabled:  raw.get<boolean>('telemetry', DEFAULTS.telemetryEnabled),
    autoCommit:        raw.get<boolean>('autoCommit', DEFAULTS.autoCommit),
    testTimeout:       validateTestTimeout(raw.get('testTimeout', DEFAULTS.testTimeout)),
    editTracking:      raw.get<boolean>('editTracking', DEFAULTS.editTracking),
    workflowHistory:   raw.get<boolean>('workflowHistory', DEFAULTS.workflowHistory),
    contextLensLevel:  validateContextLensLevel(raw.get('contextLensLevel', DEFAULTS.contextLensLevel)),
  };
}

/**
 * Write a single roadie.* setting to the user's global VS Code settings
 * (ConfigurationTarget.Global = persists across workspaces).
 */
export async function updateSetting(
  key: string,
  value: unknown,
): Promise<void> {
  await vscode.workspace
    .getConfiguration('roadie')
    .update(key, value, vscode.ConfigurationTarget.Global);
}

/**
 * Register roadie.* command palette commands.
 * Returns disposables for cleanup.
 */
function wrapCommand(handler: () => void | Promise<void>, successMessage?: string): () => Promise<void> {
  return async () => {
    try {
      await handler();
      if (successMessage) {
        void vscode.window.showInformationMessage(successMessage);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      getLogger().error(`roadie command failed: ${message}`, err);
      void vscode.window.showErrorMessage(`Roadie command failed — ${message}`);
    }
  };
}

export function registerCommands(callbacks: {
  onInit: () => void | Promise<void>;
  onRescan: () => void | Promise<void>;
  onReset: () => void | Promise<void>;
  onStats: () => void | Promise<void>;
  onEnableWorkflowHistory: () => void | Promise<void>;
  onDisableWorkflowHistory: () => void | Promise<void>;
  onGetScanSummary: () => void | Promise<void>;
  onRunWorkflow: () => void | Promise<void>;
  onDoctor: () => void | Promise<void>;
  onShowLastContext: () => void | Promise<void>;
  onShowMyStats: () => void | Promise<void>;
}): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('roadie.init', wrapCommand(callbacks.onInit, 'Roadie: Initialized')),

    vscode.commands.registerCommand('roadie.rescan', wrapCommand(callbacks.onRescan, 'Roadie: Project rescanned')),

    vscode.commands.registerCommand('roadie.reset', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Roadie: This will delete the local database and reset all state. Continue?',
        'Reset',
        'Cancel',
      );
      if (confirm === 'Reset') {
        try {
          await callbacks.onReset();
          void vscode.window.showInformationMessage('Roadie: Reset complete');
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          getLogger().error(`roadie.reset failed: ${message}`, err);
          void vscode.window.showErrorMessage(`Roadie: Reset failed — ${message}`);
        }
      }
    }),

    vscode.commands.registerCommand('roadie.stats', wrapCommand(callbacks.onStats)),

    vscode.commands.registerCommand('roadie.enableWorkflowHistory', wrapCommand(callbacks.onEnableWorkflowHistory)),

    vscode.commands.registerCommand('roadie.disableWorkflowHistory', wrapCommand(callbacks.onDisableWorkflowHistory)),

    // ── New diagnostic and workflow commands ─────────────────────────────────

    vscode.commands.registerCommand('roadie.getScanSummary', wrapCommand(callbacks.onGetScanSummary)),

    vscode.commands.registerCommand('roadie.runWorkflow', wrapCommand(callbacks.onRunWorkflow)),

    vscode.commands.registerCommand('roadie.doctor', wrapCommand(callbacks.onDoctor)),

    vscode.commands.registerCommand('roadie.showLastContext', wrapCommand(callbacks.onShowLastContext)),

    vscode.commands.registerCommand('roadie.showMyStats', wrapCommand(callbacks.onShowMyStats)),
  ];
}
