// smoke-test-bundle.js — sanity-checks the bundled extension.js without a full VS Code process.
// Stubs both 'vscode' and 'node:sqlite' so the module can be required in plain Node.js.
// Verifies that the bundle exports the required activate / deactivate functions.
'use strict';

const Module = require('module');
const fs = require('fs');
const path = require('path');

const outFile = path.resolve('out/extension.js');

if (!fs.existsSync(outFile)) {
  console.error('[smoke-test] ERROR: out/extension.js not found — run npm run build first');
  process.exit(1);
}

// ──────────────────────────────────────────────────────────────────────────────
// Stub vscode so the bundle can be require()-d outside VS Code
// ──────────────────────────────────────────────────────────────────────────────
const vscodeStub = {
  chat: { registerChatParticipant: () => ({ dispose() {} }), createChatResponseStream: () => ({}) },
  window: {
    createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} }),
    showErrorMessage: () => {},
    showInformationMessage: () => {},
    createStatusBarItem: () => ({ show() {}, dispose() {}, text: '', command: '' }),
  },
  commands: { registerCommand: () => ({ dispose() {} }), executeCommand: () => {} },
  languages: { registerCodeActionsProvider: () => ({ dispose() {} }) },
  workspace: {
    workspaceFolders: undefined,
    createFileSystemWatcher: () => ({
      onDidChange: () => ({ dispose() {} }),
      onDidCreate: () => ({ dispose() {} }),
      onDidDelete: () => ({ dispose() {} }),
      dispose() {},
    }),
    getConfiguration: () => ({ get: (_k, d) => d }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
  },
  lm: { selectChatModels: async () => [] },
  EventEmitter: class { event = () => {}; fire() {} dispose() {} },
  CodeActionKind: { QuickFix: 'quickfix', RefactorRewrite: 'refactor.rewrite' },
  Range: class { constructor() {} },
  CodeAction: class { constructor() {} },
  Uri: { file: (p) => ({ fsPath: p }) },
  ChatVariableLevel: { Full: 'full' },
  DiagnosticSeverity: { Error: 0, Warning: 1 },
  extensions: { getExtension: () => undefined },
};

// ──────────────────────────────────────────────────────────────────────────────
// Stub node:sqlite
// ──────────────────────────────────────────────────────────────────────────────
const sqliteStub = {
  DatabaseSync: class {
    exec() {}
    prepare() { return { run: () => ({ changes: 0, lastInsertRowid: 0 }), get: () => undefined, all: () => [] }; }
    close() {}
  },
};

// Intercept require calls for stub modules
const _resolveFilename = Module._resolveFilename.bind(Module);
Module._resolveFilename = function (request, ...args) {
  if (request === 'vscode') return request;
  if (request === 'node:sqlite') return request;
  return _resolveFilename(request, ...args);
};

const _load = Module._load.bind(Module);
Module._load = function (request, ...args) {
  if (request === 'vscode') return vscodeStub;
  if (request === 'node:sqlite') return sqliteStub;
  return _load(request, ...args);
};

// ──────────────────────────────────────────────────────────────────────────────
// Load and validate the bundle
// ──────────────────────────────────────────────────────────────────────────────
let ext;
try {
  ext = require(outFile);
} catch (err) {
  console.error('[smoke-test] ERROR: require(out/extension.js) threw:', err.message);
  process.exit(1);
}

if (typeof ext.activate !== 'function') {
  console.error('[smoke-test] ERROR: export "activate" is not a function (got:', typeof ext.activate, ')');
  process.exit(1);
}

if (typeof ext.deactivate !== 'function') {
  console.error('[smoke-test] ERROR: export "deactivate" is not a function (got:', typeof ext.deactivate, ')');
  process.exit(1);
}

console.log('[smoke-test] OK — activate and deactivate exports verified');
