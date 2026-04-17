/**
 * @test diagnostics.test.ts (E1)
 * @description Unit tests for the Export Diagnostics command helper.
 *   Uses a mocked vscode API and temporary filesystem fixtures.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// ── vscode mock ───────────────────────────────────────────────────────────────

let _savedPath: string | null = null;

vi.mock('vscode', () => ({
  version: '1.93.0',
  Uri: {
    file: (p: string) => ({ fsPath: p }),
  },
  workspace: {
    workspaceFolders: undefined,
    getConfiguration: () => ({ get: () => false }),
  },
  window: {
    showSaveDialog: vi.fn(async () => ({ fsPath: _savedPath })),
    showInformationMessage: vi.fn(async () => undefined),
    showErrorMessage: vi.fn(async () => undefined),
  },
  commands: {
    registerCommand: vi.fn(
      (id: string, handler: (...args: unknown[]) => unknown) => ({ id, handler, dispose: vi.fn() }),
    ),
  },
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('diagnostics helpers', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'roadie-diag-test-'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('readLastLines returns [] when file does not exist', async () => {
    // Access the private helper through the module by testing through the exported command.
    // We verify indirectly: if the log file is absent the bundle must still have logLines: [].
    const { registerDiagnosticsCommand } = await import('../diagnostics');

    const outputFile = path.join(tmpDir, 'out.json');
    _savedPath = outputFile;

    const vscode = await import('vscode');
    const mockContext = {
      globalStorageUri: { fsPath: path.join(tmpDir, 'storage') },
      extension: { packageJSON: { version: '0.14.0' } },
    } as unknown as typeof vscode;

    (vscode.workspace as unknown as { workspaceFolders: undefined }).workspaceFolders = undefined;

    const disposable = registerDiagnosticsCommand(mockContext as never);
    // Execute the registered handler
    const registered = vscode.commands.registerCommand as ReturnType<typeof vi.fn>;
    const lastCall = registered.mock.calls[registered.mock.calls.length - 1];
    const handler = lastCall[1] as () => Promise<void>;
    await handler();

    // The file should have been written
    expect(fs.existsSync(outputFile)).toBe(true);
    const bundle = JSON.parse(fs.readFileSync(outputFile, 'utf8'));

    expect(bundle).toMatchObject({
      extension:   { version: '0.14.0' },
      environment: {
        vscodeVersion: '1.93.0',
        nodeVersion:   process.version,
      },
      logLines: [],
      dbSchema: [],
    });
    expect(typeof bundle.exportedAt).toBe('string');
    disposable.dispose();
  });

  it('readLastLines caps at 1000 lines when log is large', async () => {
    const storageDir = path.join(tmpDir, 'storage');
    fs.mkdirSync(storageDir, { recursive: true });
    const logFile = path.join(storageDir, 'roadie.log');
    // Write 1500 JSON lines
    const lines = Array.from({ length: 1500 }, (_, i) =>
      JSON.stringify({ ts: new Date().toISOString(), level: 'INFO', msg: `line ${i}` }),
    );
    fs.writeFileSync(logFile, lines.join('\n') + '\n', 'utf8');

    const outputFile = path.join(tmpDir, 'out2.json');
    _savedPath = outputFile;

    const vscode = await import('vscode');
    (vscode.workspace as unknown as { workspaceFolders: undefined }).workspaceFolders = undefined;
    const mockContext = {
      globalStorageUri: { fsPath: storageDir },
      extension: { packageJSON: { version: '0.14.0' } },
    };

    const { registerDiagnosticsCommand } = await import('../diagnostics');
    const registered = vscode.commands.registerCommand as ReturnType<typeof vi.fn>;
    const callsBefore = registered.mock.calls.length;

    registerDiagnosticsCommand(mockContext as never);

    const lastCall = registered.mock.calls[registered.mock.calls.length - 1];
    const handler = lastCall[1] as () => Promise<void>;
    await handler();

    const bundle = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
    expect(bundle.logLines.length).toBe(1000);
    void callsBefore;
  });

  it('bundle environment fields are populated', async () => {
    const outputFile = path.join(tmpDir, 'out3.json');
    _savedPath = outputFile;

    const vscode = await import('vscode');
    (vscode.workspace as unknown as { workspaceFolders: undefined }).workspaceFolders = undefined;

    const mockContext = {
      globalStorageUri: { fsPath: path.join(tmpDir, 'storage2') },
      extension: { packageJSON: { version: '0.14.0' } },
    };

    const { registerDiagnosticsCommand } = await import('../diagnostics');
    registerDiagnosticsCommand(mockContext as never);

    const registered = vscode.commands.registerCommand as ReturnType<typeof vi.fn>;
    const lastCall = registered.mock.calls[registered.mock.calls.length - 1];
    const handler = lastCall[1] as () => Promise<void>;
    await handler();

    const bundle = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
    expect(bundle.environment.os).toBe(os.platform());
    expect(bundle.environment.arch).toBe(os.arch());
  });
});
