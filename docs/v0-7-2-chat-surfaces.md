# v0.7.2 — Chat Surfaces: Slash Subcommands + `#roadie` Variable

**Target version:** `0.7.2`
**Theme:** Expose Roadie's workflow engine through two new VS Code chat surfaces — named slash subcommands under `@roadie` and a `#roadie` context variable usable in any participant.
**Test floor:** maintain ≥508 unit tests; add routing tests for the command branch.
**Code budget:** ~80 production lines, ~60 test lines. No new files.

---

## 1. Problem

Users must phrase every request carefully so that `IntentClassifier` picks the right workflow. There is no deterministic shortcut when the user already knows what they want. Additionally, Roadie's project context (`ProjectModel.toContext()`) is siloed — other participants (Copilot, custom agents) cannot benefit from it without re-implementing the scan. Both gaps increase friction for experienced users.

---

## 2. Root cause

### 2A. No slash subcommands registered

`roadie/package.json` — `contributes.chatParticipants[0]` (lines 31–38) declares `id`, `name`, `description`, and `isSticky` but has no `slashCommands` array. Without that array VS Code never presents the `/` dropdown under `@roadie`, and `request.command` is always `undefined`.

`roadie/src/shell/chat-participant.ts` — the handler (lines 77–220) calls `classifier.classify(request.prompt)` unconditionally on line 93. There is no early-exit branch that reads `request.command`.

### 2B. No chat variable resolver registered

`roadie/src/extension.ts` — the activation function (lines 45–547) registers the chat participant, status bar, and commands, but never calls any `vscode.chat.register*` API to expose a variable. Users cannot reference `#roadie` from other participants.

The correct VS Code 1.93+ API for a chat variable is
`vscode.chat.registerChatVariableResolver(id, name, userDescription, modelDescription, isSlow, resolver)`.
The resolver receives a `(context, token)` signature and returns
`vscode.ChatVariableValue[]` — each value has `level: vscode.ChatVariableLevel` and `value: string`.
The `@types/vscode` version pinned in `package.json` is `^1.84.0`; the correct minimum for chat variables is **1.93**. The `vscode.engines` field already requires `^1.93.0`, but the devDependency type stubs lag behind. Verify at implementation time whether `vscode.chat.registerChatVariableResolver` is present in the installed stubs; if not, cast as `any` and add a `// TODO: upgrade @types/vscode to >=1.93` comment.

---

## 3. Fix plan

### Step 1 — `package.json`: add `slashCommands` array
**File:** `roadie/package.json`, inside `contributes.chatParticipants[0]` (after line 37, before the closing `}`).

Add:
```json
"slashCommands": [
  { "name": "fix",        "description": "Run the bug-fix workflow directly" },
  { "name": "document",   "description": "Run the document workflow directly" },
  { "name": "review",     "description": "Run the code-review workflow directly" },
  { "name": "refactor",   "description": "Run the refactor workflow directly" },
  { "name": "onboard",    "description": "Run the onboard workflow directly" },
  { "name": "dependency", "description": "Run the dependency workflow directly" }
]
```

Why: VS Code reads this manifest to populate the `/` autocomplete dropdown and to set `request.command` when the user picks a subcommand. Without this entry `request.command` is never set.

### Step 2 — `chat-participant.ts`: add command-routing branch
**File:** `roadie/src/shell/chat-participant.ts`, handler function (lines 77–220).

After line 92 (the `const preview = …` block) and before line 93 (`let classification = classifier.classify(request.prompt)`), insert a command-routing guard:

```ts
// Slash subcommand: skip classification, route directly to workflow
const COMMAND_WORKFLOW_MAP: Record<string, string> = {
  fix:        'bug_fix',
  document:   'document',
  review:     'review',
  refactor:   'refactor',
  onboard:    'onboard',
  dependency: 'dependency',
};

if (request.command && COMMAND_WORKFLOW_MAP[request.command]) {
  const intentKey = COMMAND_WORKFLOW_MAP[request.command];
  log.info(`Slash command /${request.command} → intent: ${intentKey} (no classification)`);
  const workflow = WORKFLOW_MAP[intentKey];
  // Build a synthetic classification result so the rest of the handler is unchanged
  const classification: ClassificationResult = {
    intent:     intentKey,
    confidence: 1.0,
    signals:    [`slash:/${request.command}`],
    requiresLLM: false,
  };
  // Fall through to step 3 (workflow context build) using this classification
  // Implementation: extract steps 3–6 into a shared helper or duplicate minimally
}
```

The cleanest implementation is to extract the existing "build context → execute → stream" block (lines 133–219) into an inner function `runWorkflow(classification, request, response, token)` and call it from both the slash branch and the normal classification branch. This avoids duplicating 80 lines.

Why: `request.command` is set by VS Code when the user selects a `/fix` etc. subcommand. Reading it before classification lets us hard-code confidence 1.0 and skip the LLM round-trip.

### Step 3 — `extension.ts`: register `#roadie` chat variable
**File:** `roadie/src/extension.ts`, inside `activate()`, after the chat participant registration block (after line 288).

Add:
```ts
// #roadie chat variable — exposes ProjectModel.toContext() to any participant
const chatVariableDisposable = (vscode.chat as any).registerChatVariableResolver(
  'roadie',
  'roadie',
  'Inject Roadie project context (tech stack, patterns, commands) into any chat.',
  'Roadie project context: tech stack, directory structure, patterns, and detected commands.',
  false,
  async (_chatContext: unknown, _token: vscode.CancellationToken) => {
    await ensureProjectReady().catch(() => undefined);
    const ctx = projectModel.toContext({ maxTokens: 2_000, scope: 'full' });
    return [
      {
        level: vscode.ChatVariableLevel.Full,
        value: ctx.serialized,
      },
    ];
  },
);
container.register(chatVariableDisposable);
```

Why: This registers `#roadie` globally so any participant can embed it. `ensureProjectReady()` is already defined in the same closure scope (line 123). Casting `vscode.chat` as `any` isolates the type stub gap without changing runtime behavior.

Note: if `@types/vscode` is upgraded to `>=1.93` in a future release, remove the `as any` cast.

### Step 4 — `chat-participant.ts`: export `ClassificationResult` type for tests
**File:** `roadie/src/shell/chat-participant.ts`.

The synthetic `ClassificationResult` object created in Step 2 must satisfy the type. Verify that `ClassificationResult` is already importable from `../classifier/intent-classifier` (it is, as of 0.7.0). No new export needed; just ensure the import is present at the top of the file.

### Step 5 — Test file: add command-routing unit tests
**File:** `roadie/src/shell/__tests__/chat-participant.test.ts` (or whichever test file covers `chat-participant.ts`).

Add a test suite `describe('slash command routing')` with the following cases:

1. `request.command = 'fix'` → handler must call `WORKFLOW_MAP['bug_fix']`, not `classifier.classify()`.
2. `request.command = 'review'` → `WORKFLOW_MAP['review']` selected, confidence is `1.0`.
3. `request.command = undefined` → normal classification path taken (regression guard).
4. `request.command = 'unknown'` → falls through to classification path (no crash).

Mock `vscode.chat.createChatParticipant` and capture the handler; invoke it with a fabricated `ChatRequest`.

### Step 6 — Version + CHANGELOG
**File:** `roadie/package.json` — bump `"version"` from `"0.7.0"` to `"0.7.2"`.
**File:** `roadie/CHANGELOG.md` — prepend entry (see Section 6 below).

---

## 4. Acceptance tests

```bash
# 1. Unit tests must pass (from roadie/ directory)
npm test
# Expected: ≥508 tests pass, 0 fail.
# New routing tests for slash commands appear in the summary.

# 2. Build must succeed
npm run build
# Expected: roadie/out/extension.js produced, no TypeScript errors.

# 3. Package
npm run package
# Expected: roadie-0.7.2.vsix produced.

# 4. Manual smoke test (after installing VSIX in a VS Code window with a workspace open)
# a. Type "@roadie " in chat — verify "/" triggers dropdown showing:
#    fix, document, review, refactor, onboard, dependency
# b. Select "@roadie /fix describe bug" — verify Roadie streams the bug_fix
#    workflow response WITHOUT an "Intent:" classification log line for that
#    request (classification skipped).
# c. Type "@workspace what is the auth flow? #roadie" — verify the chat input
#    shows #roadie is resolved and the Copilot response includes tech-stack
#    context from Roadie's project model.
# d. Type "@roadie what is a linked list?" — verify normal classification path
#    still runs (general_chat or low-confidence fallback, not a workflow).
```

---

## 5. Risks / rollback

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| `vscode.chat.registerChatVariableResolver` not present in `@types/vscode@1.84` stubs | High | Use `as any` cast as specified; runtime target is 1.93+ per `engines.vscode` |
| `request.command` field absent in older type stubs | Medium | Cast `request as any` inside the guard; field exists at runtime on 1.93+ |
| Slash subcommand names collide with future VS Code builtins | Low | Names are specific to Roadie workflows; no known conflicts as of 2026-04 |
| `#roadie` variable resolver fails silently if `ensureProjectReady` rejects | Low | `.catch(() => undefined)` in the resolver returns an empty context string rather than throwing |
| extracting the `runWorkflow` helper breaks existing tests | Medium | Run full test suite after extraction; no API surface changes, only refactor |

**Rollback:** revert `package.json` `slashCommands` array (removes dropdown), revert the command-routing guard in `chat-participant.ts` (restores previous linear flow), remove the `registerChatVariableResolver` call from `extension.ts`. Three isolated hunks — independent of each other.

---

## 6. Version bump

**Target version:** `0.7.2` (skipping `0.7.1` — already used for the hardening plan)

**CHANGELOG entry:**

```
[0.7.2] — 2026-04-15 — Chat Surfaces: Slash Subcommands + #roadie Variable

Added
- @roadie /fix, /document, /review, /refactor, /onboard, /dependency slash
  subcommands: bypass intent classification and route directly to the named
  workflow. VS Code shows a dropdown when the user types "/" after "@roadie".
- #roadie chat variable: users can now type "#roadie" in any participant
  (including default Copilot) to inject the full Roadie project context
  (tech stack, patterns, commands) into the conversation.

Changed
- chat-participant.ts: command-routing branch added before classification;
  extracts runWorkflow() helper to eliminate code duplication.
- extension.ts: registers the #roadie variable resolver on activation.
- package.json: slashCommands array added to chatParticipants[0] manifest entry.
```
