# Chat Fallback Fix Plan — v0.5.3

**Status:** Proposed, awaiting review
**Created:** 2026-04-15
**Target version:** 0.5.3

---

## Problem

`@roadie` in Copilot Chat responds with `**Echo:** <prompt>` instead of running
a workflow or producing an LLM answer. Reproduced with:

- `@roadie rescan`
- `@roadie update agents, workflow, instructions`
- Most natural-language project questions

## Root cause

Two independent defects in the chat pipeline:

### 1. Intent classifier misses common phrasings

`src/classifier/intent-patterns.ts` has no patterns for:

| Missing trigger                     | Expected intent |
|-------------------------------------|-----------------|
| `bugs` (plural)                     | `bug_fix`       |
| `how is`, `describe`, `structured`, `responsibilit`, `what is/are/does` | `onboard` |
| `any bugs?`, `edge cases`, `check`, `unhandled` | `review` |
| `update`, `generate`                | `feature`       |
| `rescan`                            | (command, not chat) |

Anything that fails local classification drops to `general_chat`.

### 2. `general_chat` branch echoes instead of calling the LLM

`src/shell/chat-participant.ts` line ~107:

```ts
response.markdown(`**Echo:** ${request.prompt}`);
```

The LLM fallback tier was designed (`getClassificationPromptPrefix()`,
`parseClassification()` exist in `intent-classifier.ts`) but **never wired**.
`general_chat` should invoke `request.model.sendRequest()` with project context
injected from `ProjectModel.toContext()`.

---

## Fix plan

### Step 1 — Expand local classifier patterns

Edit `src/classifier/intent-patterns.ts`. Add to the relevant intent arrays:

- **`bug_fix`**: `/\bbugs?\b/i`, `/\bbroken\b/i`, `/not working/i`
- **`onboard`**: `/how is\b/i`, `/describe\b/i`, `/structured?\b/i`,
  `/responsibilit/i`, `/what (is|are|does)\b/i`, `/getting started/i`
- **`review`**: `/any bugs?/i`, `/edge cases?/i`, `/unhandled/i`, `/\bcheck\b/i`
- **`feature`**: `/\bupdate\b/i`, `/\bgenerate\b/i`, `/\badd\b/i` (if missing)

Update `intent-patterns.test.ts` with one assertion per new trigger.

### Step 2 — Wire LLM fallback in `general_chat`

In `src/shell/chat-participant.ts`, replace the echo branch with:

```ts
const ctx = projectModel.toContext({ maxTokens: 2000 });
const messages = [
  vscode.LanguageModelChatMessage.User(
    `You are Roadie, a project-aware assistant.\n\nProject context:\n${ctx}\n\n` +
    `User question: ${request.prompt}`
  ),
];
const chat = await request.model.sendRequest(messages, {}, token);
for await (const chunk of chat.text) {
  response.markdown(chunk);
}
```

Guard with `try/catch`; on failure fall back to a short canned reply, not an echo.

### Step 3 — Version bump, rebuild, package

1. `package.json` `version` → `0.5.3`
2. Update `CHANGELOG.md` with `[0.5.3] — 2026-04-15 — Chat Fallback Fix`
3. `npm run build && npm test && npm run package`
4. Verify new `roadie-0.5.3.vsix` then `npm run install:all`

## Acceptance tests

Run each in Copilot Chat after install:

- `@roadie rescan` — triggers rescan (command-style) or LLM reply, not echo
- `@roadie how is this project structured?` — classifies as `onboard`, summarizes files
- `@roadie are there any bugs in the advanced operations?` — classifies as `review`
- `@roadie fix the power function` — classifies as `bug_fix`, runs 8-step workflow
- `npm test` — all 508+ tests pass; new pattern tests green

## Files touched

- `src/classifier/intent-patterns.ts`
- `src/classifier/intent-patterns.test.ts` (new assertions)
- `src/shell/chat-participant.ts`
- `package.json`
- `CHANGELOG.md`

No schema changes. No migration. No new settings.
