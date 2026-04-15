# v0.7.4 — Code Action Provider (`Ctrl+.` lightbulb)

**Target version:** `0.7.4`
**Theme:** Register a native `CodeActionProvider` so pressing `Ctrl+.` on a TypeScript/JavaScript symbol offers Roadie workflow actions in the standard quick-fix menu — no new UI, fully VS Code-native.
**Test floor:** maintain ≥646 unit tests (actual baseline as of 2026-04-15); add ≥9 new unit tests for symbol extraction and action generation.

---

## 1. Problem

Users must open the chat panel and type `@roadie /document MyFunction` by hand every time they want to invoke a Roadie workflow on a specific symbol. There is no in-editor shortcut. VS Code's standard `Ctrl+.` lightbulb/quick-fix menu is already familiar to every developer but Roadie contributes nothing to it, creating a discoverability gap and extra friction compared to first-party tools.

---

## 2. Root cause

### 2A. No `CodeActionProvider` registered

`roadie/src/extension.ts` (lines 45–566) calls `registerChatParticipant`, `createStatusBar`, `registerCommands`, and a `registerChatVariableResolver`, but never calls `vscode.languages.registerCodeActionsProvider`. No provider is wired into the DI container.

### 2B. No provider implementation exists

`roadie/src/shell/` contains `chat-participant.ts`, `commands.ts`, `status-bar.ts`, `logger.ts`, and `vscode-providers.ts`, but no `code-action-provider.ts`. There is nowhere to put the `RoadieCodeActionProvider` class.

### 2C. No `package.json` activation event for code actions

`roadie/package.json` declares `activationEvents` and `contributes`, but `contributes.commands` does not include the internal command used to open the chat with a prefilled query. VS Code dispatches code actions only when the provider is registered for the active language; the registration call in Step 3 covers this at runtime, but the activation event must also fire early enough.

---

## 3. Fix plan

### Step 1 — Create `roadie/src/shell/code-action-provider.ts`

New file. Exports one class: `RoadieCodeActionProvider implements vscode.CodeActionProvider`.

**Symbol extraction** (pure function, easily unit-tested — no AST):

```ts
export function extractSymbolName(document: vscode.TextDocument, range: vscode.Range): string | null {
  // Scan backwards up to 5 lines from cursor for a declaration keyword,
  // then capture the next identifier after it.
  const DECL_RE = /(?:function\*?\s+|class\s+|interface\s+|(?:const|let|var)\s+|async\s+function\s+)(\w+)/;
  const startLine = range.start.line;
  for (let i = startLine; i >= Math.max(0, startLine - 5); i--) {
    const text = document.lineAt(i).text;
    const m = DECL_RE.exec(text);
    if (m) return m[1];
  }
  return null;
}
```

#### Known limitations of this regex (accepted for v0.7.4)

The backward-scanning regex does **not** handle these patterns. When the cursor is on any of them, the extractor falls back to the nearest matching declaration above, which may return a wrong symbol name:

- **Exported arrow function declarations:** `export default (x) => ...` — no leading keyword with an identifier.
- **Destructured const:** `const { foo } = bar()` — the regex captures `foo` only if `{` is absent; with braces, the capture group fails to match a plain identifier.
- **Class method shorthand:** `computeTotal() { ... }` — no `function` keyword, no `class`/`const`; the regex finds nothing on that line.
- **TypeScript function overload signatures:** `function process(x: string): void;` — the regex does match `process`, but if multiple overload lines appear the scanner may return the first (highest) one rather than the implementation.

These are **accepted limitations for v0.7.4**. An AST-based extractor (e.g. using the TypeScript compiler API or `vscode.executeDocumentSymbolProvider`) is deferred to a future release to avoid a new compile-time dependency in this patch.

**`provideCodeActions` method:**

- Return `[]` if the file language is not in `['typescript', 'typescriptreact', 'javascript', 'javascriptreact']`.
- Call `extractSymbolName(document, range)`. If `null`, return `[]`.
- Build up to three `vscode.CodeAction` objects:
  - "Roadie: Document this" — `CodeActionKind.RefactorRewrite` — always offered.
  - "Roadie: Review this" — `CodeActionKind.RefactorRewrite` — always offered.
  - "Roadie: Fix this" — `CodeActionKind.QuickFix` — only when `context.diagnostics.length > 0`.
- Each action sets `action.command = { command: 'roadie._openChat', arguments: [query], title: '...' }` where `query` is the prefilled string (e.g. `'@roadie /document MyFunction'`).
- Mark `action.isPreferred = false` for all three (they are supplementary, not the default fix).

**`executeCommand` bridge** — `roadie._openChat` is an internal command registered in Step 3 that calls:

```ts
vscode.commands.executeCommand(
  'workbench.action.chat.open',
  { query } as any, // TODO(types): remove cast when @types/vscode >= 1.93 lands
);
```

Keeping the bridge command internal avoids exposing it in the command palette.

### Step 2 — Create `roadie/src/shell/code-action-provider.test.ts`

New test file. Mock `vscode` following the pattern in `roadie/src/shell/chat-participant.test.ts` (lines 3–13).

Test suites:

1. `describe('extractSymbolName')` — 5 cases:
   - `function foo()` on cursor line → returns `'foo'`.
   - `async function handleRequest()` → returns `'handleRequest'`.
   - `class MyService {` → returns `'MyService'`.
   - `const computeTotal = ` → returns `'computeTotal'`.
   - Line with no keyword → returns `null`.

2. `describe('RoadieCodeActionProvider.provideCodeActions')` — 4 cases:
   - No diagnostics → returns Document and Review actions only (2 items).
   - With diagnostics → returns Document, Review, and Fix actions (3 items).
   - Unknown symbol (no keyword found) → returns empty array.
   - Verifies query strings contain `'@roadie /document'`, `'@roadie /review'`, `'@roadie /fix'`.

Total new tests: **9** (5 + 4). New floor: **≥655** (646 + 9).

### Step 3 — Register in `roadie/src/extension.ts`

After the `registerChatParticipant` block (line 288) and before the `registerChatVariableResolver` block (line 291), insert:

```ts
// ── Code Action Provider ─────────────────────────────────────────────────
import { RoadieCodeActionProvider } from './shell/code-action-provider';

// Internal bridge command: opens Copilot Chat with a prefilled @roadie query
const openChatCmd = vscode.commands.registerCommand('roadie._openChat', (query: string) => {
  void vscode.commands.executeCommand(
    'workbench.action.chat.open',
    { query } as any, // TODO(types): remove cast when @types/vscode >= 1.93 lands
  );
});
container.register(openChatCmd);

const codeActionProvider = new RoadieCodeActionProvider();
container.register(
  vscode.languages.registerCodeActionsProvider(
    ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'].map((language) => ({ language })),
    codeActionProvider,
    { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.RefactorRewrite] },
  ),
);
```

Place the `import` at the top of `extension.ts` with the other shell imports (around line 28).

#### Decision: `as any` cast for `chat.open` argument

`roadie/package.json` pins `@types/vscode` at `^1.84.0`. The `{ query }` argument shape for `workbench.action.chat.open` was typed in `@types/vscode` beginning around `1.93`. Rather than bumping the types package (which could expose unrelated type errors across the codebase), cast the argument with `as any` at the two call sites and annotate with a `// TODO(types): remove cast when @types/vscode >= 1.93 lands` comment. This matches the existing pattern in `extension.ts:291` where `registerChatVariableResolver` is also cast with `as any` to handle API additions newer than the pinned types.

### Step 4 — `roadie/package.json`: declare the internal command

Inside `contributes.commands`, add:

```json
{
  "command": "roadie._openChat",
  "title": "Roadie: Open Chat (internal)",
  "enablement": "false"
}
```

`"enablement": "false"` hides it from the command palette while keeping it callable by the code action.

### Step 5 — Version + CHANGELOG

`roadie/package.json`: bump `"version"` from `"0.7.3"` to `"0.7.4"`.
`roadie/CHANGELOG.md`: prepend entry (see Section 6).

---

## 4. Acceptance tests

```bash
# Run from C:/dev/Roadie/roadie/

# 1. Unit tests
npm test
# Expected: ≥655 tests pass (646 existing + ≥9 new), 0 fail.
# New suites: extractSymbolName (5 tests), RoadieCodeActionProvider (4+ tests).

# 2. Build
npm run build
# Expected: roadie/out/extension.js produced, 0 TypeScript errors.

# 3. Package
npx @vscode/vsce package --allow-missing-repository
# Expected: roadie-0.7.4.vsix produced.

# 4. Manual smoke test (install VSIX, open roadie-test-calculator workspace)
# a. Open src/calculator.ts, place cursor on a function name.
# b. Press Ctrl+. — verify the quick-fix menu shows:
#    "Roadie: Document this"
#    "Roadie: Review this"
# c. Introduce a TypeScript error on the same line (e.g. bad type).
#    Press Ctrl+. — verify "Roadie: Fix this" also appears.
# d. Select "Roadie: Document this" — verify Copilot Chat panel opens
#    with query pre-filled as "@roadie /document <SymbolName>".
# e. Open a .py file — verify Roadie actions do NOT appear in Ctrl+. menu.
```

---

## 5. Risks / rollback

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| `workbench.action.chat.open` command signature changes in a future VS Code release | Low | The `{ query }` argument form is stable since VS Code 1.85; pin engines minimum if needed |
| `CodeActionKind.RefactorRewrite` not present in `@types/vscode@1.84` stubs | Medium | Fall back to `vscode.CodeActionKind.Refactor`; both appear at the same menu position |
| Symbol extraction regex misses arrow-function patterns (`const foo = () =>`) | Low | The `const` branch already captures `foo`; arrow body is irrelevant for the name |
| Four language registrations increase activation overhead | Very low | Each registration is a single in-process listener, negligible cost |
| Internal command `roadie._openChat` exposed to users via keybinding | Low | `"enablement": "false"` in `package.json` hides it from the palette |
| `as any` cast on `chat.open` argument masks future type errors | Low | The TODO comment and this plan document the debt; remove when @types/vscode bumps past 1.93 |
| Three Roadie actions will appear in the `Ctrl+.` menu mixed with real quick-fixes. Ordering within the menu is VS Code-controlled and not asserted by tests. | Low | Accepted; VS Code sorts by `CodeActionKind` category and then registration order, but this is not contractual |

**Rollback:** remove `code-action-provider.ts`, remove the three registration blocks from `extension.ts` (openChatCmd, codeActionProvider registration), remove the `roadie._openChat` entry from `package.json` contributes.commands, revert version to `0.7.3`. All changes are in two files plus one new file — one `git revert` or manual delete suffices.

---

## 6. Version bump

**Target version:** `0.7.4`

**CHANGELOG entry:**

```
[0.7.4] — 2026-04-15 — Code Action Provider (Ctrl+. lightbulb)

Added
- RoadieCodeActionProvider: pressing Ctrl+. on a function, class, interface,
  or const declaration in .ts/.tsx/.js/.jsx files now shows:
    • "Roadie: Document this" — pre-fills @roadie /document <Symbol> in chat
    • "Roadie: Review this"   — pre-fills @roadie /review <Symbol> in chat
    • "Roadie: Fix this"      — shown only when VS Code diagnostics are present;
                                pre-fills @roadie /fix <Symbol> in chat
- roadie._openChat internal command bridges code actions to the Chat panel.
- Symbol name extracted by backward keyword scan (no AST dependency).

Changed
- extension.ts: registers RoadieCodeActionProvider for typescript, typescriptreact,
  javascript, and javascriptreact via vscode.languages.registerCodeActionsProvider,
  disposed through the existing container.
- package.json: roadie._openChat declared in contributes.commands with
  enablement: false (hidden from command palette).

Known limitations (v0.7.4)
- Regex extractor does not handle exported arrow functions, destructured consts,
  class method shorthand, or TypeScript overload signatures; falls back to the
  nearest declaration above the cursor. AST-based extraction deferred to a future
  release.
- Action ordering in the Ctrl+. menu is VS Code-controlled and untested.
```
