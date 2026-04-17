/**
 * @module diagnostics
 * @description E1 — "Roadie: Export Diagnostics" command.
 *   Collects VS Code version, extension version, OS/arch/Node, the last 1000
 *   lines of the structured log, and sanitised DB schema (table/column names
 *   only — no row data), then saves the bundle as a JSON file via a save
 *   dialog.
 *
 * @depends-on vscode, node:fs, node:os, node:path
 * @depended-on-by extension.ts (registered via registerDiagnosticsCommand)
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface DiagnosticsBundle {
  exportedAt: string;
  extension: {
    version: string;
  };
  environment: {
    vscodeVersion: string;
    os: string;
    arch: string;
    nodeVersion: string;
  };
  logLines: string[];
  dbSchema: DbSchemaEntry[];
}

export interface DbSchemaEntry {
  table: string;
  columns: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Log tail helper
// ─────────────────────────────────────────────────────────────────────────────

const MAX_LOG_LINES = 1000;

function readLastLines(filePath: string): string[] {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines   = content.split('\n').filter((l) => l.trim().length > 0);
    return lines.slice(-MAX_LOG_LINES);
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DB schema helper (table/column names only — no row data)
// ─────────────────────────────────────────────────────────────────────────────

function collectDbSchema(dbPath: string): DbSchemaEntry[] {
  if (!fs.existsSync(dbPath)) return [];
  try {
    // Lazy-require to avoid a hard dependency on better-sqlite3 in test environments.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3') as typeof import('better-sqlite3');
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const tables = (
        db.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        ).all() as Array<{ name: string }>
      ).map((r) => r.name);

      return tables.map((table) => {
        const cols = (
          db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>
        ).map((c) => c.name);
        return { table, columns: cols };
      });
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Command registration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Register the `roadie.exportDiagnostics` command.
 * Call once from `extension.activate()` and push the returned Disposable onto
 * `context.subscriptions`.
 */
export function registerDiagnosticsCommand(
  context: vscode.ExtensionContext,
): vscode.Disposable {
  return vscode.commands.registerCommand('roadie.exportDiagnostics', async () => {
    const logDir  = context.globalStorageUri.fsPath;
    const logFile = path.join(logDir, 'roadie.log');

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const dbPath = workspaceRoot
      ? path.join(workspaceRoot, '.github', '.roadie', 'project-model.db')
      : '';

    const { version: extVersion } = context.extension.packageJSON as { version: string };

    const bundle: DiagnosticsBundle = {
      exportedAt: new Date().toISOString(),
      extension: {
        version: extVersion,
      },
      environment: {
        vscodeVersion: vscode.version,
        os:   os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
      },
      logLines:  readLastLines(logFile),
      dbSchema:  dbPath ? collectDbSchema(dbPath) : [],
    };

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const defaultUri = vscode.Uri.file(
      path.join(os.tmpdir(), `roadie-diagnostics-${timestamp}.json`),
    );

    const saveUri = await vscode.window.showSaveDialog({
      defaultUri,
      filters: { JSON: ['json'] },
      title: 'Save Roadie Diagnostics',
    });

    if (!saveUri) return; // user cancelled

    try {
      fs.writeFileSync(saveUri.fsPath, JSON.stringify(bundle, null, 2), 'utf8');
      void vscode.window.showInformationMessage(
        `Roadie: Diagnostics exported to ${saveUri.fsPath}`,
      );
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Roadie: Failed to export diagnostics — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });
}
