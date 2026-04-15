import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => {
  const configValues: Record<string, unknown> = {};
  return {
    workspace: {
      getConfiguration: () => ({
        get: <T>(key: string, defaultValue?: T): T => {
          return (configValues[key] as T) ?? defaultValue!;
        },
      }),
    },
    window: {
      showInformationMessage: vi.fn().mockResolvedValue(undefined),
      showWarningMessage: vi.fn().mockResolvedValue('Reset'),
      showErrorMessage: vi.fn().mockResolvedValue(undefined),
    },
    commands: {
      registerCommand: vi.fn().mockImplementation((id: string, handler: Function) => ({
        id,
        handler,
        dispose: vi.fn(),
      })),
    },
    ConfigurationTarget: { Global: 1 },
  };
});

import { readConfiguration, registerCommands } from './commands';
import * as vscode from 'vscode';

describe('readConfiguration', () => {
  it('returns defaults when no settings are configured', () => {
    const config = readConfiguration();
    expect(config.modelPreference).toBe('balanced');
    expect(config.telemetryEnabled).toBe(false);
    expect(config.autoCommit).toBe(false);
    expect(config.testTimeout).toBe(300);
    expect(config.editTracking).toBe(false);
    expect(config.workflowHistory).toBe(false);
  });

  it('testCommand defaults to undefined', () => {
    const config = readConfiguration();
    expect(config.testCommand).toBeUndefined();
  });
});

describe('registerCommands', () => {
  const mockCallbacks = {
    onInit: vi.fn(),
    onRescan: vi.fn(),
    onReset: vi.fn(),
    onStats: vi.fn(),
    onEnableWorkflowHistory: vi.fn(),
    onDisableWorkflowHistory: vi.fn(),
    onGetScanSummary: vi.fn(),
    onRunWorkflow: vi.fn(),
    onDoctor: vi.fn(),
    onShowLastContext: vi.fn(),
    onShowMyStats: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers 11 commands', () => {
    const disposables = registerCommands(mockCallbacks);
    expect(disposables).toHaveLength(11);

    const register = vi.mocked(vscode.commands.registerCommand);
    expect(register).toHaveBeenCalledWith('roadie.init', expect.any(Function));
    expect(register).toHaveBeenCalledWith('roadie.rescan', expect.any(Function));
    expect(register).toHaveBeenCalledWith('roadie.reset', expect.any(Function));
    expect(register).toHaveBeenCalledWith('roadie.stats', expect.any(Function));
    expect(register).toHaveBeenCalledWith('roadie.enableWorkflowHistory', expect.any(Function));
    expect(register).toHaveBeenCalledWith('roadie.disableWorkflowHistory', expect.any(Function));
    expect(register).toHaveBeenCalledWith('roadie.getScanSummary', expect.any(Function));
    expect(register).toHaveBeenCalledWith('roadie.runWorkflow', expect.any(Function));
    expect(register).toHaveBeenCalledWith('roadie.doctor', expect.any(Function));
    expect(register).toHaveBeenCalledWith('roadie.showLastContext', expect.any(Function));
    expect(register).toHaveBeenCalledWith('roadie.showMyStats', expect.any(Function));
  });

  it('roadie.init calls onInit callback', async () => {
    registerCommands(mockCallbacks);
    const register = vi.mocked(vscode.commands.registerCommand);
    const handler = register.mock.calls.find((c) => c[0] === 'roadie.init')![1] as () => Promise<void>;
    await handler();
    expect(mockCallbacks.onInit).toHaveBeenCalledTimes(1);
  });

  it('roadie.rescan calls onRescan callback', async () => {
    registerCommands(mockCallbacks);
    const register = vi.mocked(vscode.commands.registerCommand);
    const handler = register.mock.calls.find((c) => c[0] === 'roadie.rescan')![1] as () => Promise<void>;
    await handler();
    expect(mockCallbacks.onRescan).toHaveBeenCalledTimes(1);
  });

  it('roadie.reset calls onReset callback after confirmation', async () => {
    registerCommands(mockCallbacks);
    const register = vi.mocked(vscode.commands.registerCommand);
    const handler = register.mock.calls.find((c) => c[0] === 'roadie.reset')![1] as () => Promise<void>;
    await handler();
    expect(mockCallbacks.onReset).toHaveBeenCalledTimes(1);
  });

  it('roadie.reset does NOT call onReset if user cancels', async () => {
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce('Cancel' as never);
    registerCommands(mockCallbacks);
    const register = vi.mocked(vscode.commands.registerCommand);
    const handler = register.mock.calls.find((c) => c[0] === 'roadie.reset')![1] as () => Promise<void>;
    await handler();
    expect(mockCallbacks.onReset).not.toHaveBeenCalled();
  });

  it('roadie.getScanSummary calls onGetScanSummary callback', async () => {
    registerCommands(mockCallbacks);
    const register = vi.mocked(vscode.commands.registerCommand);
    const handler = register.mock.calls.find((c) => c[0] === 'roadie.getScanSummary')![1] as () => Promise<void>;
    await handler();
    expect(mockCallbacks.onGetScanSummary).toHaveBeenCalledTimes(1);
  });

  it('roadie.runWorkflow calls onRunWorkflow callback', async () => {
    registerCommands(mockCallbacks);
    const register = vi.mocked(vscode.commands.registerCommand);
    const handler = register.mock.calls.find((c) => c[0] === 'roadie.runWorkflow')![1] as () => Promise<void>;
    await handler();
    expect(mockCallbacks.onRunWorkflow).toHaveBeenCalledTimes(1);
  });

  it('roadie.doctor calls onDoctor callback', async () => {
    registerCommands(mockCallbacks);
    const register = vi.mocked(vscode.commands.registerCommand);
    const handler = register.mock.calls.find((c) => c[0] === 'roadie.doctor')![1] as () => Promise<void>;
    await handler();
    expect(mockCallbacks.onDoctor).toHaveBeenCalledTimes(1);
  });

  it('roadie.showMyStats calls onShowMyStats callback', async () => {
    registerCommands(mockCallbacks);
    const register = vi.mocked(vscode.commands.registerCommand);
    const handler = register.mock.calls.find((c) => c[0] === 'roadie.showMyStats')![1] as () => Promise<void>;
    await handler();
    expect(mockCallbacks.onShowMyStats).toHaveBeenCalledTimes(1);
  });

  it('shows an error message when a command callback throws', async () => {
    const errorCallback = vi.fn().mockRejectedValueOnce(new Error('boom'));
    const callbacks = { ...mockCallbacks, onStats: errorCallback };
    registerCommands(callbacks);
    const register = vi.mocked(vscode.commands.registerCommand);
    const handler = register.mock.calls.find((c) => c[0] === 'roadie.stats')![1] as () => Promise<void>;

    await handler();

    expect(errorCallback).toHaveBeenCalledTimes(1);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Roadie command failed — boom');
  });
});

describe('readConfiguration contextLensLevel', () => {
  it('defaults to summary', () => {
    const config = readConfiguration();
    expect(config.contextLensLevel).toBe('summary');
  });
});
