# v0.7.8 — CodeLens: Inline Documentation Hints

**Target version:** `0.7.8`
**Theme:** Register a `CodeLensProvider` that surfaces "📝 Roadie: Document this" hints above every undocumented export. Clicking fires `@roadie /document <symbol>` in the Chat panel. Lenses hide once JSDoc is added; re-scan is triggered by `FileWatcherManager` on file save.
**Test floor:** maintain ≥674 unit tests (baseline 2026-04-15); add ≥12 new tests for the provider.

---

## 1. Problem

Developers have no in-editor signal that an exported symbol is missing documentation. They must manually scan code and type `@roadie /document MyFunction` in the chat panel. VS Code's CodeLens row — the grey annotation line above a declaration — is the idiomatic place to surface this hint without adding new UI. Roadie currently registers no CodeLensProvider, so the discoverability gap remains even after v0.7.4 added `Ctrl+.` actions.

---

## 2. Root cause

### 2A. No `CodeLensProvider` registered

`roadie/src/extension.ts` (lines 305–322) registers `RoadieCodeActionProvider` and `roadie._openChat`, but never calls `vscode.languages.registerCodeLensProvider`. No provider implementation exists in `roadie/src/shell/`.

### 2B. No per-file JSDoc detection logic

`roadie/src/analyzer/project-analyzer.ts` walks the whole project for entity extraction but has no fast, single-file pass that identifies export declarations and checks whether the immediately preceding line contains a JSDoc block comment (`/** … */`). The `extractEntities` method (lines 110–155) processes full file content but does not return a list of undocumented symbols per file.

### 2C. No save-triggered, file-scoped rescan for CodeLens

`FileWatcherManager` (lines 90–136 of `file-watcher-manager.ts`) debounces all workspace events into batched `FileChangeEvent[]`. It does not have a hook specifically for "file saved, re-provide CodeLens for this URI". VS Code CodeLens refresh is driven by `EventEmitter<void>` — the provider must fire it when a relevant save occurs. Currently nothing does that.

---

## 3. Fix plan

### Step 1 — Create `roadie/src/shell/code-lens-provider.ts` (~120 lines)

New file. Exports:

1. **`detectUndocumentedExports(text: string): Array<{ line: number; symbol: string }>`** — pure function, no VS Code dependency, easily unit-tested.

   Detection algorithm (regex, no AST dependency — accepted limitation for v0.7.8):
   - Split `text` into lines.
   - For each line, test against `EXPORT_RE`:
     ```
     /^export\s+(?:default\s+)?(?:async\s+)?(?:function\*?\s+|class\s+|interface\s+|(?:const|let|var)\s+|type\s+)(\w+)/
     ```
   - If matched, look at the line immediately above (and optionally two lines above for blank-line tolerance). If neither line starts with `*` or `/**`, the symbol is undocumented.
   - Return `{ line: <0-based index of the export line>, symbol: <capture group 1> }`.
   - **Filter:** only return symbols where the export line itself starts with `export` (not re-exports like `export { foo } from`). Skip `export default <expression>` when no identifier follows immediately (e.g. `export default 42`).
   - **Cap:** if more than 30 undocumented symbols are found in one file, return the first 30 only. This prevents a 200-export barrel file from flooding the editor with lenses. The cap is a named constant `MAX_LENSES_PER_FILE = 30`.

2. **`RoadieCodeLensProvider` class** implementing `vscode.CodeLensProvider`:
   - Constructor takes no arguments; internally holds `private _onDidChangeCodeLenses = new vscode.EventEmitter<void>()` and exposes `onDidChangeCodeLenses = this._onDidChangeCodeLenses.event`.
   - `provideCodeLenses(document)`: calls `detectUndocumentedExports(document.getText())`, maps each result to one `vscode.CodeLens` at `new vscode.Range(item.line, 0, item.line, 0)` with command `roadie._openChat` and argument `@roadie /document ${item.symbol}`.
   - `refresh()`: fires `this._onDidChangeCodeLenses.fire()`. Called from extension.ts when a TS/JS file is saved.
   - `dispose()`: calls `this._onDidChangeCodeLenses.dispose()`.

   Language guard: if `document.languageId` is not in `['typescript', 'typescriptreact', 'javascript', 'javascriptreact']`, return `[]` immediately.

### Step 2 — Create `roadie/src/shell/code-lens-provider.test.ts` (~110 lines)

New test file. Mock `vscode` following the pattern in `roadie/src/shell/code-action-provider.test.ts`.

Test suites:

1. `describe('detectUndocumentedExports')` — 7 cases:
   - `export function foo()` with no JSDoc above → returns `[{ line: 0, symbol: 'foo' }]`.
   - `export function foo()` preceded by `/** JSDoc */` → returns `[]`.
   - `export class Bar` with JSDoc two lines above and a blank in between → returns `[]` (blank-line tolerance).
   - `export interface Baz` preceded by a regular `// comment` (not JSDoc) → returns `[{ line, symbol: 'Baz' }]`.
   - `export const compute = ` with no JSDoc → returns `[{ line, symbol: 'compute' }]`.
   - `export { foo } from './other'` (re-export) → returns `[]` (filtered out).
   - File with 35 undocumented exports → returns exactly 30 (cap enforced).

2. `describe('RoadieCodeLensProvider.provideCodeLenses')` — 5 cases:
   - TS file with 2 undocumented exports → returns 2 CodeLens instances.
   - TS file with all exports documented → returns `[]`.
   - Non-TS file (languageId `'python'`) → returns `[]`.
   - Verifies each CodeLens command is `roadie._openChat` and argument contains `@roadie /document`.
   - Calls `refresh()` → `onDidChangeCodeLenses` event fires once.

Total new tests: **12** (7 + 5). New floor: **≥686** (674 + 12).

### Step 3 — Register in `roadie/src/extension.ts`

Add import at the top with other shell imports (~line 29):

```ts
import { RoadieCodeLensProvider } from './shell/code-lens-provider';
```

After the existing Code Action Provider block (after line 322), insert:

```ts
// ── CodeLens Provider ────────────────────────────────────────────────────
const codeLensProvider = new RoadieCodeLensProvider();
container.register(
  vscode.languages.registerCodeLensProvider(
    ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'].map(
      (language) => ({ language }),
    ),
    codeLensProvider,
  ),
);
container.register(codeLensProvider);

// Re-provide lenses when a TS/JS file is saved
container.register(
  vscode.workspace.onDidSaveTextDocument((doc) => {
    const langs = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'];
    if (langs.includes(doc.languageId)) {
      codeLensProvider.refresh();
    }
  }),
);
```

`container.register(codeLensProvider)` ensures `codeLensProvider.dispose()` is called on deactivation, which disposes the internal `EventEmitter`.

Note: `roadie._openChat` is already registered (Step 3 of v0.7.4). No new bridge command needed — CodeLens reuses the existing command.

### Step 4 — `roadie/package.json`: declare `onLanguage` activation events and bump version

Add two activation events so the extension wakes up the moment a TS/JS file is opened (without waiting for a chat):

```json
"onLanguage:typescript",
"onLanguage:javascript"
```

These join the existing `"onChat:roadie"` and `"workspaceContains:..."` entries.

Change `"version"` from `"0.7.7"` to `"0.7.8"`.

Why: without these events, CodeLens may not appear in the first file opened if the extension hasn't activated yet.

### Step 5 — `roadie/CHANGELOG.md`: prepend dated entry

See Section 6.

---

## 4. Acceptance tests

```bash
# Run from /c/dev/Roadie/roadie/

# 1. Unit tests — must pass with new floor
npm test
# Expected: ≥686 tests pass (674 existing + ≥12 new), 0 fail.
# New suites: detectUndocumentedExports (7 tests), RoadieCodeLensProvider (5 tests).

# 2. Lint
npm run lint
# Expected: 0 errors, exit 0.

# 3. Build
npm run build
# Expected: out/extension.js produced, 0 TypeScript errors.

# 4. Package
npx @vscode/vsce package --allow-missing-repository
# Expected: roadie-0.7.8.vsix produced, no errors.

# 5. Manual smoke test (install VSIX, open roadie-test-calculator workspace)
# a. Open src/calculator.ts — any exported function without JSDoc.
#    Expected: grey "📝 Roadie: Document this" CodeLens line appears above declaration.
# b. Add a JSDoc block above the function, save the file.
#    Expected: CodeLens disappears from that line within <1 second (debounce flush).
# c. Open a barrel file with >30 undocumented exports.
#    Expected: exactly 30 lenses shown (cap enforced; check Output > Roadie for log).
# d. Open a .py file — Expected: no Roadie lenses appear.
# e. Click one lens — Expected: Copilot Chat opens with "@roadie /document <SymbolName>" pre-filled.
```

---

## 5. Risks / rollback

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Regex misses multi-line export declarations (`export\nfunction foo`) | Medium | Accepted for v0.7.8; multi-line exports are rare in practice; AST deferred |
| 30-lens cap silently hides symbols in large barrel files | Low | Log a `warn` when cap is applied so the user can see it in Output panel |
| `onDidSaveTextDocument` fires for every save across the workspace, not just the open file | Low | Handler is a single `codeLensProvider.refresh()` call — O(1), negligible cost; CodeLens re-scan itself is lazy (VS Code calls `provideCodeLenses` per-file on demand) |
| `onLanguage` activation events increase extension startup frequency | Low | Extension was already activating on `onChat:roadie`; TS/JS devs who never use chat would now activate earlier — acceptable for a DX-focused extension |
| `EventEmitter` leak if dispose not called | Very low | `container.register(codeLensProvider)` ensures dispose on deactivation |
| Regex false-positive on `export type Foo = ...` (type alias without body) | Low | `type\s+` branch matches `Foo`; type aliases also benefit from JSDoc — accepted |

**Rollback:** delete `code-lens-provider.ts` and `code-lens-provider.test.ts`, remove the CodeLens registration block and `onDidSaveTextDocument` handler from `extension.ts`, remove the two `onLanguage` activation events from `package.json`, revert `package.json` version to `0.7.7`. All changes are in three files plus two new files — a single `git revert` of the implementation commit suffices.

---

## 6. Version bump

**Target version:** `0.7.7` → `0.7.8` (patch — new provider, no breaking change)

**CHANGELOG entry:**

```
[0.7.8] — 2026-04-15 — CodeLens: Inline Documentation Hints

Added
- RoadieCodeLensProvider: shows "📝 Roadie: Document this" CodeLens above every
  exported function, class, interface, const, or type that lacks a JSDoc block
  comment in .ts/.tsx/.js/.jsx files.
- detectUndocumentedExports(): pure function that scans file text with a regex,
  with blank-line tolerance and a MAX_LENSES_PER_FILE = 30 cap.
- Clicking a lens fires roadie._openChat (existing v0.7.4 command) with
  "@roadie /document <Symbol>" pre-filled — no new bridge command needed.
- Lenses auto-hide on file save once JSDoc is added (onDidSaveTextDocument
  triggers codeLensProvider.refresh()).
- Added "onLanguage:typescript" and "onLanguage:javascript" activation events
  so lenses appear before the user opens the chat panel.
- 12 new unit tests (detectUndocumentedExports: 7, RoadieCodeLensProvider: 5).
  New test floor: ≥686.

Known limitations (v0.7.8)
- Regex does not handle multi-line export declarations; AST-based detection
  deferred to a future release.
- Cap of 30 lenses per file — barrel files with more exports will show a
  warning in the Roadie Output channel.
```
