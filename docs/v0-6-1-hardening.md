# v0.6.1 — Hardening & Context Lens

**Target version:** 0.6.1
**Base version:** 0.6.0
**Date drafted:** 2026-04-15

---

## 1. Problem

v0.6.0 shipped four new generated files, watcher→generator wiring, self-healing retry
logic, and per-step context scoping. Under real use, seven concrete edge cases will
surface before a typical developer workday is done: three commands registered in
`package.json` but missing callbacks in `extension.ts` (crash on invocation), the
self-healing retry silently swallowing `simplified` flag that no template actually
reads, a `priorityTrim` panic path when `maxTokens=0`, the `path-instructions`
generator using an inconsistent section-id convention that breaks the path-instructions
skip test, the doctor script still reporting "4 context files" instead of 5, and all
watcher event log calls sitting at `info` level flooding the Output channel on busy
repos. The one new feature added is **Context Lens** — log the serialized `toContext()`
output, token count, and scope to the Roadie Output channel before every LLM call,
plus a `Roadie: Show Last Context` command that focuses the channel and offers a
clipboard copy.

---

## 2. Hardening Items

| # | Area | Risk | File + Lines | Fix | ~Lines |
|---|------|------|-------------|-----|--------|
| H1 | `extension.ts` commands | `roadie.getScanSummary`, `roadie.runWorkflow`, `roadie.doctor` crash with TypeError at runtime — callbacks required by `registerCommands` signature but never passed | `src/extension.ts` line 254 — `registerCommands({...})` object missing three keys | Add stub implementations for all three missing callbacks | +12 |
| H2 | Self-healing `simplified` flag | `FileGeneratorManager` retries with `{ simplified: true }` but no template receives or honours that option — retry produces identical (possibly broken) output, masking real errors | `src/generator/file-generator-manager.ts` line 96 — `generator.generate(model)` signature; `FileTypeGenerator.generate` in same file line 38 | Add `options?: { simplified?: boolean }` to `FileTypeGenerator.generate` interface; pass through in manager | +6 |
| H3 | `priorityTrim` with `maxTokens=0` | `budget = 0 * 4 = 0`; loop enters `remaining > header.length + 20` branch (0 > N) is always false so it falls through silently returning empty string — causes blank `serialized` that looks like success | `src/model/project-model.ts` line 214 — `const budget = maxTokens * 4` | Guard: `if (maxTokens <= 0) return ''` before computing budget | +3 |
| H4 | `priorityTrim` single-entry model | When only one section type is non-empty and its length > budget, the `remaining > header.length + 20` guard (`remaining=budget`, `header.length` ~14, `+20` = 34) may cut content mid-word without appending `[truncated]` correctly | `src/model/project-model.ts` lines 233–235 — partial-include branch | Cover with unit test; no logic change needed (existing logic is correct — test gap only) | +8 (test only) |
| H5 | `path-instructions` section id | `generatePathInstructionSections` at line 135 builds id as `path-instructions:${path.basename(path.dirname(f.filePath + '/x'))}` — the `+ '/x'` trick yields the wrong basename for flat paths | `src/generator/templates/path-instructions.ts` line 135 | Replace with `path.basename(f.filePath, path.extname(f.filePath))` stripping `.instructions.md` | +3 |
| H6 | Doctor: 4 not 5 files | `scripts/doctor.js` line 102 prints "All 4 context files present" and checks only 4 paths; the fifth generated family (`.github/instructions/*.instructions.md`) is unchecked | `scripts/doctor.js` lines 87–102 | Add a `.github/instructions/` directory-exists check; update count string | +8 |
| H7 | Noisy watcher log level | Every watcher batch logs at `info` in `extension.ts` lines 131 and 135 (`'FileGenerator: HIGH/DEPENDENCY_CHANGE event…'`), producing spam on active repos; should be `debug` | `src/extension.ts` lines 131, 135 | Change `logger.debug` calls (already named `debug`) — they are correct; the `logger.warn` at line 133 (inner `.catch`) should remain `warn`. No change needed (already `debug`). | 0 — confirmed no action |
| H8 | Missing `showLastContext` command | No `Roadie: Show Last Context` command exists in `commands.ts` or `package.json` | `src/shell/commands.ts`, `src/extension.ts`, `package.json` | Add command registration + last-context store (see §3) | +30 |

---

## 3. Context Lens Feature

### What it does

Before every LLM call in `chat-participant.ts`, log one structured line to the Roadie
Output channel:

```
[CONTEXT] scope=full tokens≈342 chars=1370
## Tech Stack
- TypeScript@5.2 (language, from package.json)
…
[END CONTEXT]
```

Store the last log entry text in a module-level variable. A new command
`roadie: showLastContext` focuses the Output channel and offers to copy to clipboard.

### Code sketch

**`src/shell/logger.ts`** — expose `showChannel()` and `appendRaw()`:
```typescript
// RoadieLogger already has show(); add:
appendRaw(text: string): void {
  this.channel.appendLine(text);
}
```

**`src/shell/chat-participant.ts`** — before `request.model.sendRequest`:
```typescript
const ctxChars = ctx?.serialized?.length ?? 0;
const approxTokens = Math.round(ctxChars / 4);
const log = getLogger();
log.info(`[CONTEXT] scope=${contextScope ?? 'full'} tokens≈${approxTokens} chars=${ctxChars}`);
if (ctx?.serialized) log.appendRaw(ctx.serialized);
log.info('[END CONTEXT]');
_lastContextSnapshot = ctx?.serialized ?? '';
```

`_lastContextSnapshot` is a module-level `let` initialised to `''`.

**`src/shell/commands.ts`** — add `onShowLastContext` callback:
```typescript
vscode.commands.registerCommand('roadie.showLastContext', async () => {
  await callbacks.onShowLastContext();
});
```

**`src/extension.ts`** — wire `onShowLastContext`:
```typescript
onShowLastContext: async () => {
  (getLogger() as RoadieLogger).show();
  const snap = getChatLastContext();           // imported from chat-participant
  if (snap) {
    const choice = await vscode.window.showInformationMessage(
      'Roadie: Last context shown in Output. Copy to clipboard?', 'Copy', 'Dismiss',
    );
    if (choice === 'Copy') await vscode.env.clipboard.writeText(snap);
  }
},
```

**`package.json`** — add command entry (no new setting):
```json
{
  "command": "roadie.showLastContext",
  "title": "Roadie: Show Last Context",
  "description": "Focus the Roadie Output channel and show the last LLM context snapshot"
}
```

---

## 4. Files Touched

```
src/shell/logger.ts                     — add appendRaw() to RoadieLogger (+4 lines)
src/shell/chat-participant.ts           — log context before LLM call; export getter (+12 lines)
src/shell/commands.ts                   — add onShowLastContext callback (+6 lines)
src/extension.ts                        — H1 (3 missing callbacks) + wire onShowLastContext (+18 lines)
src/model/project-model.ts             — H3: guard maxTokens<=0 (+3 lines)
src/generator/file-generator-manager.ts — H2: pass simplified to FileTypeGenerator.generate (+6 lines)
src/generator/templates/path-instructions.ts — H5: fix section id (+3 lines)
scripts/doctor.js                       — H6: check .github/instructions/ dir; fix count (+8 lines)
package.json                            — version bump to 0.6.1; add showLastContext command entry
CHANGELOG.md                            — dated entry
```

**Tests added/modified:**
```
src/model/project-model.test.ts              — H3: maxTokens=0 case; H4: single-section trim
src/generator/file-generator-manager.test.ts — H2: verify simplified propagates to generator
src/generator/templates/path-instructions.test.ts — H5: section id convention
src/shell/chat-participant.test.ts (new)     — Context Lens: lastContextSnapshot populated
```

Estimated new/changed production lines: **~60**. Test lines: **~35** (net ≥ 555 tests).

---

## 5. Acceptance Tests

```bash
# A. Missing command callbacks — no crash
# In VS Code: run "Roadie: Get Scan Summary" from Command Palette
# Expected: stub notification shown, no uncaught TypeError in Extension Host log

# B. priorityTrim(maxTokens=0) — unit test
cd /c/dev/Roadie/roadie
npm test -- --reporter=verbose src/model/project-model.test.ts
# Expected: new test "toContext() with maxTokens=0 returns empty serialized" passes

# C. Self-healing simplified propagation — unit test
npm test -- --reporter=verbose src/generator/file-generator-manager.test.ts
# Expected: new test "retry passes simplified=true to generator.generate" passes

# D. path-instructions section id — unit test
npm test -- --reporter=verbose src/generator/templates/path-instructions.test.ts
# Expected: new test "section id does not contain trailing slash artifact" passes

# E. Doctor covers instructions dir
node scripts/doctor.js
# Expected: "4. Generated context files" section checks .github/instructions/
# and prints "All 5 context file families present" (or warns if absent)

# F. Context Lens end-to-end (manual)
# Send any message to @roadie in VS Code chat
# Open Output > Roadie
# Expected: lines [CONTEXT] scope=… tokens≈… chars=… then context body then [END CONTEXT]
# Run "Roadie: Show Last Context" from Command Palette
# Expected: Output channel focused; clipboard-copy dialog appears

# G. Full suite — baseline preserved
npm test
# Expected: ≥ 555 tests, 0 failures
```

---

## 6. Risks / Rollback

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| `appendRaw` exposes private channel method to tests | Low | NullLogger stub gets a no-op appendRaw — no test setup needed |
| `_lastContextSnapshot` module variable leaks between tests | Low | Tests import fresh module per suite; or reset in beforeEach |
| Doctor `.github/instructions/` check triggers failure on fresh workspaces | Low | Use `warn` (not `fail`) — consistent with existing file warnings |
| H2 simplified flag breaks generators that don't expect the param | None | Param is optional on interface; existing generators ignore it |

**Rollback:** revert `package.json` to `0.6.0`; remove the four `+` hunks to
`chat-participant.ts`, `commands.ts`, `extension.ts`, and `logger.ts`. All hardening
changes are purely additive or guard-clause insertions.

---

## 7. Deferred to v0.7.0

- Templates actually honouring `simplified: true` (dropping optional sections) — requires
  updating all four template `generate()` signatures; scoped to v0.7.0 template API
  cleanup.
- Per-directory Cursor `.mdc` files (spec item, explicitly deferred in v0.6.0 plan).
- Context Lens: configurable verbosity (`roadie.contextLensLevel: off | summary | full`) —
  deferred to avoid adding a new setting in this patch.
- `isIgnoredPath` regex cleanup — the `replace` chain at lines 60–62 of
  `change-classifier.ts` is hard to reason about; a targeted rewrite is safe but not
  urgent (all 5 generated file families are already correctly blocked by the test suite).

---

## 8. Version Bump

**Target:** `0.6.1`

**CHANGELOG entry:**

```
[0.6.1] — 2026-04-15 — Hardening & Context Lens

### Fixed
- roadie.getScanSummary, roadie.runWorkflow, roadie.doctor commands no longer crash
  with TypeError on invocation (missing callbacks now stubbed in extension.ts).
- priorityTrim no longer returns an empty string when maxTokens=0; now returns '' fast.
- path-instructions section id no longer contains a trailing-slash artifact from the
  dirname+'/x' trick; uses basename(filePath, extname) instead.
- doctor.js now checks .github/instructions/ directory existence (5th generated family)
  and reports the correct count.
- Self-healing retry in FileGeneratorManager now passes simplified=true through the
  FileTypeGenerator.generate interface (was silently ignored before).

### Added
- Context Lens: the Roadie Output channel now logs the serialized toContext() snapshot
  (scope, approximate token count, full body) before every LLM call in chat-participant.
- New command "Roadie: Show Last Context" (roadie.showLastContext) focuses the Output
  channel and offers to copy the last context snapshot to clipboard.
```
