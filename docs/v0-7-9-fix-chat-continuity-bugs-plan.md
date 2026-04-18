# Plan: Fix Chat-Continuity Bugs (revised)

Root bug: short follow-up prompts after a completed workflow fall back to general chat or lose workflow context. Fixed in previous turn (carry-over intent). Critical blockers + six related bugs remain below.

---

## Phase 0 — Critical Blockers (P0-α, P0-β, P0-γ)

**P0-α: Engine instantiated without `learningDb`**  
`chat-participant.ts:388` is `new WorkflowEngine(new StepExecutor(stepHandler))` — no second argument. Snapshots are never written because every `if (this.learningDb)` guard short-circuits.  
**Fix:** `new WorkflowEngine(new StepExecutor(stepHandler), deps?.learningDb)` (one line).  
**Test:** After `execute()` with `requiresApproval: true`, assert a row exists in `workflow_snapshots` table.

**P0-β: `registerWorkflowDefinition()` is never called**  
Exported at `workflow-engine.ts:43` but has **zero call sites**. `WORKFLOW_DEFINITION_REGISTRY` is permanently `{}`. `resumeFromSnapshot()` immediately throws `"Workflow definition not found"`.  
**Fix:** At activation (bottom of `extension.ts` or top of `engine/definitions/index.ts`), call:
```ts
for (const def of [BUG_FIX_WORKFLOW, FEATURE_WORKFLOW, REFACTOR_WORKFLOW, REVIEW_WORKFLOW,
                   DOCUMENT_WORKFLOW, DEPENDENCY_WORKFLOW, ONBOARD_WORKFLOW]) {
  registerWorkflowDefinition(def);
}
```
**Test:** Register each workflow and assert it round-trips via `getWorkflowDefinitionById(id)`.

**P0-γ: Stale cancellation token in paused sessions**  
`WorkflowContext.cancellation` is a `VSCodeCancellationHandle` bound to the **original turn's** token. It is captured into `pausedSessions.get(...).context` and reused during `resume()`. The old token is already disposed by then.  
**Fix:** Add `engine.rebindTurnHandles(sessionId, { cancellation, progress })` that replaces the stale handles with the current turn's token. Call it in chat-participant immediately before `engine.resume(...)`.  
**Test:** Use a `FakeCancellationToken` that flips `isCancellationRequested` AFTER pause; assert `engine.resume(...)` observes it.

---

## Phase 1 — Thread Identity (Bug 1)

**Bug 1:** `threadId` is extracted from `context.history[last].id`, which is `undefined` in the real VS Code API.  
The fallback `generateThreadId()` fires every turn, creating a fresh session and losing all carry-over.

**Fix:** Extract a stable thread identifier from the **first user prompt** using a content hash:
```ts
export function extractThreadId(context: vscode.ChatContext, cache = threadIdCache): string {
  const firstRequest = context.history?.find(
    (t): t is vscode.ChatRequestTurn => (t as any).prompt !== undefined,
  );
  if (!firstRequest) {
    const id = generateThreadId();
    cache.newestEphemeralId = id;
    return id;
  }
  const key = fnv1a(firstRequest.prompt.trim().toLowerCase());
  let id = cache.byFirstPromptHash.get(key);
  if (!id) {
    id = `thread-${key}`;
    cache.byFirstPromptHash.set(key, id);
  }
  return id;
}
```

This is the only content stable across all turns of one conversation. Two conversations starting with identical prompts will collide, but that is correct behavior (same-prompt same-session carry-over is intended).

**File:** `src/shell/chat-participant.ts` — `extractThreadId(context)` helper, called at line ~105.  
Add `extractThreadId` as a named exported function. Replace the old extraction at line ~105.

**Critical test:** Use a `ChatContext` with `history` shaped like real VS Code (`[{ kind: 'request', prompt: '...' }]` with **no** `.id` field anywhere). Assert `extractThreadId` returns the same value across two calls with different history lengths.

---

## Phase 2a — Slash Command Routing (Bug 6 — P1 Regression)

**Bug 6 — Confirmed regression:** `package.json` contributes slash commands as `workflow:fix`, `workflow:review`, etc., but `COMMAND_WORKFLOW_MAP` in chat-participant.ts maps only `fix`, `review`, etc. VS Code passes the declared `name` verbatim as `request.command`. Every slash command is broken in production — they all miss the map and fall through to classification.

**Why missed:** The existing test at `chat-participant.test.ts:106` sends `command: 'fix'` (wrong shape), not `'workflow:fix'` (real VS Code value). CI is green but production is broken.

**Fix:** 
1. Normalize the command lookup:
```ts
const normalizedCmd = (request.command ?? '').replace(/^workflow:/, '');
if (COMMAND_WORKFLOW_MAP[normalizedCmd]) { ... }
```
2. Add unit tests for both `workflow:fix` AND `fix` as `request.command` values; assert exactly one takes the slash path and the classifier is NOT called.

**File:** `src/shell/chat-participant.ts` line ~161, `src/shell/chat-participant.test.ts`.

---

## Phase 2b — Pause/Resume Wiring (Bugs 2 & 3)

**Bug 2:** After `engine.execute()` returns `PAUSED` or `WAITING_FOR_APPROVAL`, the session is never marked paused. Follow-up from the user creates a new classification instead of routing to resume.

**Bug 3:** The paused-workflow resumption branch and resume-intent handler both return placeholder markdown without calling `engine.resume()`.

**Fix (H1 + H2 + H3 approach):**

1. **Extend `WorkflowResult`** in `src/engine/workflow-engine.ts`:
```ts
interface WorkflowResult {
  // ... existing fields ...
  pausedSessionId?: string;      // set iff state ∈ {PAUSED, WAITING_FOR_APPROVAL}
  pauseReason?: 'approval' | 'step-failure';
  lastStepName?: string;         // for UX: "paused at 'Run tests'"
}
```

2. **Engine sets these fields** at every PAUSED/WAITING_FOR_APPROVAL return (lines ~222, ~683, ~946).

3. **Add `_activeEngines` map** at module level in `chat-participant.ts`:
```ts
const _activeEngines = new Map<string, WorkflowEngine>();
```

4. **Store engine after creation** and delete on terminal state:
```ts
_activeEngines.set(threadId, engine);
// ... later, after COMPLETED/CANCELLED ...
_activeEngines.delete(threadId);
```

5. **Mark session paused** after execute:
```ts
if (result.pausedSessionId) {
  _sessionManager.markPaused(threadId, result.pausedSessionId);
}
```

6. **Wire paused-resumption branch** to call `engine.resume()`:
```ts
const storedEngine = _activeEngines.get(threadId);
if (storedEngine && session.pausedSessionId) {
  const parseApprovalResult = parseApproval(request.prompt);
  const resumeResult = await storedEngine.resume(
    session.pausedSessionId, 
    parseApprovalResult.approval !== 'reject'
  );
  // stream resumeResult, clear paused flag
  _sessionManager.markResumed(threadId);
}
```

7. **Dual-source resume fallback** (H2 — only works after P0-α and P0-β):
```ts
let resumeResult: WorkflowResult;
try {
  resumeResult = await storedEngine.resume(session.pausedSessionId, approval);
} catch (e) {
  if (String(e).includes('Session not found')) {
    resumeResult = await storedEngine.resumeFromSnapshot(
      session.pausedSessionId, 
      response, 
      contextProjectModel
    );
  } else throw e;
}
```

8. **Rebind turn handles** (H3 — fixes P0-γ properly):
```ts
if (storedEngine && session.pausedSessionId) {
  const ctx = storedEngine['pausedSessions'].get(session.pausedSessionId)?.context;
  if (ctx) {
    ctx.cancellation = new VSCodeCancellationHandle(token);
    ctx.progress = new VSCodeProgressReporter(response);
  }
}
```

**Files:** `src/shell/chat-participant.ts` (lines ~78, ~122–138, ~205–233), `src/engine/workflow-engine.ts` (result type + three return points), `src/types.ts` (WorkflowResult interface).

**Tests:** 
- After `execute()` with `requiresApproval: true`, `result.pausedSessionId` is set and matches a key in `pausedSessions`.
- Engine-to-resume path: execute → WAITING_FOR_APPROVAL → "yes" → resume completes (no "Session not found").
- Fallback path: engine drops stale session reference mid-resume → throws "Session not found" → falls back to `resumeFromSnapshot` → completes.
- Cancellation during resume is observed by engine.

---

## Phase 3 — Thread ID on WorkflowContext (Bug 4)

**Bug 4:** `threadId` is never passed into `WorkflowContext`, so `WorkflowEngine` saves snapshots with `threadId = 'unknown'`. Thread-scoped incomplete workflow lookup in `SessionManager.listIncompleteWorkflows()` always misses.

**Scope note:** Seven other unsafe-field casts remain in `workflow-engine.ts` (apiSpec, databaseSchema, projectModel, etc.). This phase fixes threadId only; a follow-up issue should address the rest.

**Fix:** 
1. Add optional `threadId?: string` to `WorkflowContext` in `src/types.ts`.  
2. Populate it in `src/shell/chat-participant.ts` when constructing `workflowContext` (line ~311): `workflowContext.threadId = threadId;`.  
3. Replace `(context as any).threadId` at `workflow-engine.ts:191` with `context.threadId`.

**Files:** `src/types.ts` (WorkflowContext interface), `src/shell/chat-participant.ts` (workflowContext construction), `src/engine/workflow-engine.ts` (line ~191 cast removal).

---

## Phase 4 — Approval Parsing & Clarify Intent Improvement (Bugs 5 & B9)

**Bug 5:** When `clarify` intent fires but no paused workflow exists, the handler outputs a generic clarification question even when `session.workflowId` is set. Users who rephrase after a completed workflow see "I'm not sure what you mean."

**B9 (Strict approval parsing):** Approval parsing only accepts `=== 'yes'` (exact match). "y", "yeah", "ok", "sure" all evaluate to `false` and abort the workflow.

**Fix:**

1. **Replace strict approval parsing** in `chat-participant.ts:132`:
```ts
const ack = /^(y|yes|ok(ay)?|confirm|continue|proceed|go|sure)[!.\s]*$/i;
const nack = /^(n|no|cancel|abort|stop|nope)[!.\s]*$/i;
const trimmed = request.prompt.trim();
const approval: 'approve' | 'reject' | 'unclear' =
  ack.test(trimmed) ? 'approve' : nack.test(trimmed) ? 'reject' : 'unclear';
if (approval === 'unclear') {
  response.markdown(`I didn't catch that — reply \`yes\` to continue or \`no\` to abort.`);
  return {};
}
```

2. **Harden clarify re-routing** (line ~250):  
If no paused workflow exists but `session.workflowId` is set, re-route to carry-over ONLY if the prompt looks like a continuation (reuse the `isLikelyWorkflowContinuationPrompt` guard):
```ts
if (!session.paused && session.workflowId &&
    isLikelyWorkflowContinuationPrompt(request.prompt) &&
    WORKFLOW_MAP[session.workflowId]) {
  classification = synthCarryOver(session.workflowId);
  // fall through to step 4
}
```
This prevents real clarifications ("explain step 3 in detail?") from being re-classified as a new workflow.

**Files:** `src/shell/chat-participant.ts` (lines ~132, ~250).

**Tests:** 
- "y", "yes!", "ok", "confirm", "go ahead" → approve.
- "n", "cancel", "abort!" → reject.
- "maybe", "what if", "" → unclear (re-prompt, don't abort).
- Clarify after completed feature workflow with short prompt → carry-over.
- Clarify with long prompt containing "?" → clarification UI, NOT carry-over.

---

## Phase 5 — Cross-Cutting Hardening (B6, B9, B10, B11, H13, H14)

These are independent, lower-priority fixes for hygiene and performance. Do these after Phases 0–4 ship.

**B6 — Cosmetic logging bug** (workflow-engine.ts:135):  
`transition()` logs `[workflowId] undefined → TO_STATE` because `from` is read from empty `executionState`. This is a log-hygiene defect, not a functional bug. Fetch the state locally:
```ts
const state = this.executionState.get(workflowId) ?? 'UNKNOWN';
log.debug(`[${workflowId}] ${state} → ${to}`);
```

**B10 — Dead state** (session-manager.ts:108):  
`session.clarifying` is written by `markClarifying()` and never read. Delete both the field and the method. (The clarify re-routing in Phase 4 already handles this via intent classification, not stale state.)

**B11 — Regex anchors and typo** (claude-md-parser.ts:89, 96, 111):  
In JavaScript, `\Z` is a literal `Z` (no end-of-string anchor by that name). Also at line 111: `[-*\d*]` has a duplicate `*`. Fix both:
```ts
// Before: `\n[-*]` | `\Z` 
// After:  `\n[-*]` | `$`
// And: `[-*\d*]` → `[-*\d]`
```
Test: input with no literal `Z` character and no trailing newline; all items extracted.

**H13 — Hoist telemetry require** (telemetry.ts:93):  
Module lazily loads `node:fs` inside `flush()`. Hoist to top-level:
```ts
import { appendFileSync } from 'node:fs';  // at top
```

**H14 — Async JSON logging with serial queue** (logger.ts:166, 176):  
Replace `fs.appendFileSync` with an async serial queue (prevents blocking the hot path on every log call) and cache the byte counter (avoid `statSync` on every line):
```ts
let writeChain: Promise<void> = Promise.resolve();
let cachedByteCount = 0;

function enqueueWrite(data: string) {
  writeChain = writeChain
    .then(() => fs.promises.appendFile(logPath, data))
    .then(() => { cachedByteCount += Buffer.byteLength(data); })
    .catch(err => { writeErrorCount++; });
}

function maybeRotate() {
  if (cachedByteCount > rotationThreshold) {
    // perform rotation
    cachedByteCount = 0;
  }
}
```

**Files:** `src/engine/workflow-engine.ts` (line ~135), `src/shell/session-manager.ts` (remove `clarifying` field + `markClarifying` method), `src/analyzer/claude-md-parser.ts` (lines ~89, 96, 111), `src/shell/telemetry.ts` (hoist import), `src/shell/logger.ts` (serial queue + cached counter).

---

## Implementation Steps (Sequenced)

### Phase 0 — Critical blockers *(prerequisite for all later phases)*
1. `0.1` — Fix P0-α: change `new WorkflowEngine(...)` at chat-participant.ts:388 to pass `deps?.learningDb`.
2. `0.2` — Fix P0-β: at activation, register all workflow definitions via `registerWorkflowDefinition()`.
3. `0.3` — Fix P0-γ: add `engine.rebindTurnHandles(sessionId, { cancellation, progress })` and wire before each `resume()`.
4. Test P0: after execute with `requiresApproval: true`, verify snapshot row exists in DB; resumeFromSnapshot round-trips; cancellation during resume is observed.

### Phase 1 — Thread identity *(depends on Phase 0)*
5. Implement `extractThreadId(context)` using content hash of first prompt (not `history[0].id`).
6. Replace threadId extraction at line ~105 with call to `extractThreadId(context)`.
7. Test: history with `{ kind: 'request', prompt: '...' }` (no `.id` field) → same threadId across two calls.

### Phase 2a — Slash command routing *(depends on Phase 0; can run in parallel with Phase 1)*
8. Add `workflow:` prefix normalization to COMMAND_WORKFLOW_MAP lookup (defensive).
9. Add tests for both `workflow:fix` and `fix` as `request.command` values; assert classifier NOT called for slash commands.

### Phase 2b — Pause/resume wiring *(depends on Phases 0, 1, 2a)*
10. Extend `WorkflowResult` with `pausedSessionId`, `pauseReason`, `lastStepName` fields.
11. Engine sets these fields at every PAUSED/WAITING_FOR_APPROVAL return point.
12. Add `_activeEngines` Map at module level; store/delete engines keyed by threadId.
13. After `engine.execute()` returns, call `_sessionManager.markPaused()` if `result.pausedSessionId` is set.
14. Wire paused-resumption branch to call `engine.resume()` using stored engine.
15. Implement dual-source resume fallback (try in-memory, fall back to snapshot).
16. Call `engine.rebindTurnHandles()` before resume (completes P0-γ fix).
17. Test integration: execute → WAITING_FOR_APPROVAL → "yes" → resume completes.

### Phase 3 — WorkflowContext type plumbing *(can run parallel with Phase 2b)*
18. Add `threadId?: string` to `WorkflowContext` interface in src/types.ts.
19. Set `workflowContext.threadId = threadId` during construction in chat-participant.ts.
20. Replace `(context as any).threadId` at workflow-engine.ts:191.
21. Test: snapshot saved with correct `thread_id` value.

### Phase 4 — Approval parsing & clarify intent *(depends on Phases 1, 2b)*
22. Replace strict `=== 'yes'` approval parsing with three-valued parser (approve/reject/unclear).
23. In clarify handler, add branch for `!session.paused && session.workflowId && isLikelyWorkflowContinuationPrompt()` → carry-over.
24. Test approval parsing: "y", "ok", "confirm" → approve; "n", "cancel" → reject; "maybe" → unclear.
25. Test clarify: short prompt + prior workflow → carry-over; long prompt with "?" → clarification UI.

### Phase 5 — Cross-cutting hardening *(independent; do after Phases 0–4)*
26. Fix cosmetic logging: `transition()` uses actual state instead of undefined.
27. Delete unused `session.clarifying` field and `markClarifying()` method.
28. Fix regex anchors: `\Z` → `$`; remove duplicate `*` in character class.
29. Hoist `require('node:fs')` to top-level import in telemetry.ts.
30. Replace `fs.appendFileSync` with async serial queue + cached byte counter in logger.ts.

---

## Relevant Files

- `src/shell/chat-participant.ts` — Phases 1–5 land here
- `src/shell/session-manager.ts` — no changes needed (API already sufficient)
- `src/engine/workflow-engine.ts` — line ~198 cast removal only (Phase 3)
- `src/types.ts` — `WorkflowContext.threadId?` addition (Phase 3)
- `src/shell/chat-participant.test.ts` — regression tests for Phases 1–5
- `src/analyzer/claude-md-parser.ts` — Phase 6a regex fix
- `src/shell/logger.ts` — Phase 6b async I/O fix
- `src/shell/telemetry.ts` — Phase 6c require() fix

---

## Verification

### Unit tests (all suites must pass)
1. `npx vitest run src/shell/chat-participant.test.ts` — all new tests including:
   - `extractThreadId`: empty history, identical prompts (case/whitespace variants) → same id
   - Slash command normalization: `workflow:fix | fix | workflow:review | review | unknown | ''` routing matrix
   - Approval parsing: "y", "yes!", "ok", "confirm" → approve; "n", "cancel" → reject; "maybe" → unclear
   - Clarify re-routing: short prompt + prior workflow → carry-over; long prompt with "?" → clarification
   - `resolveCarryOverIntent`: workflowId not in map → undefined; prompt with "?" → undefined

2. `npx vitest run src/engine/workflow-engine.test.ts` — all new tests including:
   - After execute with `requiresApproval: true`, `result.pausedSessionId` is set
   - After execute with normal completion, `result.pausedSessionId === undefined`
   - `registerWorkflowDefinition` round-trip: register → retrieve via `getWorkflowDefinitionById()`
   - `rebindTurnHandles`: after rebind, `context.cancellation.isCancelled` reflects new token
   - Snapshot retention: intermediate `'saved'` rows deleted after completion

3. `npx vitest run src/analyzer/claude-md-parser.test.ts` — regression test:
   - Input with no literal `Z` character and no trailing newline; all items extracted

4. `npm run test` — full suite green (100+ tests)

### Integration tests (workflows end-to-end with real DB)
5. `npx vitest run src/__integration__/`
   - Execute → WAITING_FOR_APPROVAL → DB has row with correct `thread_id` and `status='paused'` → "yes" → COMPLETED
   - Pause → "no" → CANCELLED, no residual `'saved'` rows
   - Pause → unclear ("maybe") → re-prompt, state unchanged
   - Durable resume after host reload: execute to paused, drop engine reference, create new engine, `resume()` throws → fallback to `resumeFromSnapshot()` → completes
   - Concurrent handlers on same thread: no half-written state

### Manual testing in extension host
6. `/workflow:fix null pointer in foo.ts` → routes to `bug_fix` workflow, NOT general chat classifier
7. `/workflow:review` → routes to `review` workflow
8. Workflow with `requiresApproval`: reply "y" (not "yes") → approves
9. Workflow with `requiresApproval`: reply "maybe" → re-prompts, doesn't abort
10. Start workflow, reload VS Code mid-pause via "Dev: Reload Window", reply "yes" → resumes from snapshot
11. Workflow cancellation via VS Code cancel button → workflow CANCELLED (check logs)
12. Type "create a react app" → hits feature workflow carry-over, not general chat

### Regression checks
13. No new breaking changes to `WorkflowContext` shape (grep all test constructions)
14. Session maps don't grow unbounded (spot-check memory in long session)
15. All six slash commands work: `workflow:fix`, `workflow:review`, `workflow:refactor`, `workflow:document`, `workflow:dependency`, `workflow:onboard`

---

## Key Decisions

- **Phase 0 is mandatory.** P0-α (learningDb), P0-β (registerWorkflowDefinition), P0-γ (rebindTurnHandles) are blockers. Pause/resume is inoperative without them.

- **ThreadId uses content hash, not API `.id` field.** VS Code's `ChatContext.history[n].id` does not exist in the documented API; the real type has `kind` and `prompt`/`response`. Content hash of the first prompt is the only stable cross-turn anchor.

- **Slash commands are P1 (not just Phase 5).** All six contributed commands are broken in production; the test-production gap shows CI doesn't catch it. Fix in Phase 2a.

- **Approval parsing is forgiving by design.** `unclear` re-prompts rather than aborting, because a false abort loses user work. Accept "y", "yeah", "ok", "sure", etc.

- **ThreadId survives within a process, not across host reload.** In-memory `_activeEngines` is ephemeral; durability via dual-source resume (in-memory first, snapshot fallback). A reload mid-pause must recover via `resumeFromSnapshot()`.

- **`_activeEngines` is pruned on terminal state.** When a workflow completes or is cancelled, the engine instance is removed from the map. This prevents unbounded growth for long-running sessions.

- **Phase 3 (threadId on WorkflowContext) is additive.** Optional field → zero risk of breaking existing tests.

- **Phase 5 cross-cutting fixes are lower-priority.** Hygiene + performance, not correctness. Do after core phases ship.

- **Pre-existing test failures are out of scope.** Confidence thresholds, enum mismatches, etc. This plan does not change them.

---

## Relevant Files

| File | Phase(s) | Changes |
|------|----------|---------|
| `src/shell/chat-participant.ts` | 0, 1, 2a, 2b, 4 | `extractThreadId`, slash normalization, engine storage, pause/resume wiring, approval parsing, clarify re-routing |
| `src/engine/workflow-engine.ts` | 0, 2b, 3, 5 | Pass learningDb, extend WorkflowResult, set paused fields, use threadId, fix logging |
| `src/types.ts` | 2b, 3 | WorkflowResult fields, WorkflowContext.threadId |
| `src/shell/session-manager.ts` | 5 | Remove `clarifying` field + `markClarifying` method |
| `src/shell/chat-participant.test.ts` | 1, 2a, 4 | New tests for threadId, slash commands, approval parsing, clarify routing |
| `src/shell/logger.ts` | 5 | Async serial queue + cached byte counter |
| `src/shell/telemetry.ts` | 5 | Hoist require to top-level import |
| `src/analyzer/claude-md-parser.ts` | 5 | Fix regex anchors (\Z → $) and character class typo |
| `extension.ts` | 0 | Call registerWorkflowDefinition for all workflows at activation |

---

## Sequencing Recommendation

```
Phase 0 (critical blockers)
  ├─ Phase 1 (threadId)
  │   └─ Phase 2a (slash commands)
  │       └─ Phase 2b (pause/resume wiring)
  │           ├─ Phase 3 (WorkflowContext.threadId)
  │           └─ Phase 4 (approval parsing + clarify routing)
  │               └─ Phase 5 (cross-cutting hardening)
```

**Why:** Phase 0 unblocks everything. Phase 1 is prerequisite for anything that reads `session.paused`. Phase 2a is cheap high-leverage (restores slash commands on its own). Phase 2b requires all of 0, 1, 2a to avoid data loss. Phases 3 & 4 can run after Phase 2b. Phase 5 is cleanup, run last.

---

## Suggested Updates (Detailed Audit Findings)

> **Note:** This section documents the full audit findings. The main plan above has been updated to incorporate the critical findings (P0 blockers, threadId approach, slash commands, approval parsing, etc.). This section is preserved for reference.

Evidence-gathering pass: read `chat-participant.ts`, `workflow-engine.ts`, `learning-database.ts`, `session-manager.ts`, `intent-classifier.ts`, `vscode-providers.ts`, `chat-participant.test.ts`, and `package.json`. Line numbers verified against source.

### 0. Executive Summary — Priority Reordering

The plan frames this as a 6-bug continuity fix. The code has **three P0 defects that make the entire pause/resume feature inoperative in production**, none of which the plan addresses:

| # | Defect | Where | Impact |
|---|--------|-------|--------|
| **P0-α** | `new WorkflowEngine(...)` at `chat-participant.ts:388` is constructed **without** `learningDb` | `chat-participant.ts:388` | Every `if (this.learningDb)` guard in the engine (workflow-engine.ts:190, 795, 904) short-circuits. **No snapshot is ever written.** The entire H1 persistence work is dead code at runtime. |
| **P0-β** | `registerWorkflowDefinition()` is exported (workflow-engine.ts:43) but **has zero call sites** in the codebase. `WORKFLOW_DEFINITION_REGISTRY` is permanently empty. | `workflow-engine.ts:43, 50` | `resumeFromSnapshot()` immediately throws `"Workflow definition not found for ID: <id>"` at line 821. Snapshot-based resume is unreachable even if P0-α is fixed. |
| **P0-γ** | `WorkflowContext.cancellation` is a `VSCodeCancellationHandle` bound to the **original turn's** cancellation token. It is captured into `pausedSessions.get(...).context` and reused during `resume()`. The old token is already disposed by then. | `chat-participant.ts:361`, `workflow-engine.ts:165 (stored), 593 (read)` | User cancellation during resume does not work. Also: `isCancelled` reads from the dead token and could return a stale value depending on VS Code's token lifecycle. |

Fixing the six originally-listed bugs without fixing α and β ships a feature whose happy path silently writes nothing to disk and whose recovery path throws. Reorder: α, β, γ go in Phase 0, **before** Phase 1.

### 1. Audit Findings (assumptions in the plan that need revision)

**A1. Phase 1 thread-identity fix is not actually a fix.**
VS Code's public `ChatRequestTurn`/`ChatResponseTurn` do not expose a stable `id` property in the documented API surface — the existing code reads `context.history[last].id`, which is `undefined` under the typed API, and the `|| generateThreadId()` fallback fires every turn. The plan's proposed "use `history[0].id`" hits the **same** undefined and regenerates every turn, just from a different index. The fallback "hash of the whole history" is worse: history grows each turn → hash changes each turn → no continuity.

→ **Replace with a content-derived id.** The only content stable across turns of one conversation is the *first user prompt*:
```ts
export function extractThreadId(context: vscode.ChatContext, cache = threadIdCache): string {
  const firstRequest = context.history?.find(
    (t): t is vscode.ChatRequestTurn => (t as any).prompt !== undefined,
  );
  if (!firstRequest) {
    const id = generateThreadId();
    cache.newestEphemeralId = id;
    return id;
  }
  const key = fnv1a(firstRequest.prompt.trim().toLowerCase());
  let id = cache.byFirstPromptHash.get(key);
  if (!id) {
    id = `thread-${key}`;
    cache.byFirstPromptHash.set(key, id);
  }
  return id;
}
```
Caveat: two independent conversations that start with identical prompts collide. Accept that collision — same-prompt same-session carry-over is still correct behavior, and the prior thread's session state is benign. If collision matters, scrape `vscode.env.sessionId` and mix it into the hash.

**A1b. Test coverage hides the threadId bug.**
`chat-participant.test.ts:378` uses `ctx = { history: [{ id: 'thread-follow-up' }] }` — a handcrafted fake with a literal string `id`. The current code path succeeds because the fake has `.id`. Real VS Code does not. The "reuses prior workflow context" test (line 333) is green but the production behavior is broken. Any fix to Phase 1 must come with a test whose `history` entry uses `{ kind: 'request', prompt: '...' }` (no `id`) — matching the real API shape — and still produces a stable threadId.

**A2. Bug 6 is a confirmed P1 regression, not "maybe".**
Verified: `package.json` lines 40–62 register `"name": "workflow:fix"`, `"workflow:document"`, `"workflow:review"`, `"workflow:refactor"`, `"workflow:onboard"`, `"workflow:dependency"`. VS Code passes the declared `name` verbatim as `request.command`. `COMMAND_WORKFLOW_MAP` keys are `fix|document|review|refactor|onboard|dependency`. `COMMAND_WORKFLOW_MAP['workflow:fix'] === undefined`, so the `if` at line 161 is false for every slash command and every slash invocation falls through to classification of the *already-stripped* prompt.

Every one of the six contributed slash commands is broken in production. The existing test at `chat-participant.test.ts:106` sends `command: 'fix'`, not `'workflow:fix'`, so CI is green. This is a test-production gap, not a prose ambiguity. Move the fix earlier (Phase 2a) and add the runtime-shape test to prevent the gap from reappearing. Also: the test should use `command: 'workflow:fix'` for at least one case and `'fix'` for another (back-compat / tests).

**A3. `extractSessionIdFromSummary` is fragile and unnecessary.**
Parsing `Session: <id>` out of a human-readable summary string couples chat-participant to an engine log format (workflow-engine.ts:228, 689, 952 — three separate summary templates). If anyone changes the wording, resume silently breaks.

→ **Replace with:** add `pausedSessionId?: string` and `pauseReason?: 'approval' | 'failure'` to `WorkflowResult`. Engine sets both at every PAUSED/WAITING_FOR_APPROVAL return (execute line 222–229, resume line 683–690, resumeFromSnapshot line 946–953). No regex scraping.

**A4. Phase 3 claims to remove "the cast" but seven similar casts remain.**
`workflow-engine.ts` has these unsafe-field reads against `WorkflowContext`:
- line 191: `(context as any).threadId`
- line 396, 421: `(context as any).apiSpec`
- line 397: `(context as any).databaseSchema`
- line 746–749: `(context as any).databaseSchema / backendRoutes / backendAuth / frontendPages`

Also line 365, 388, 412: `(context.projectModel as any).modelProvider`.

Scope decision: either extend `WorkflowContext` with the full set of intermediate fields the cross-agent pipeline needs (preferred — also documents the state machine) or declare Phase 3 as "threadId only" and file a follow-up issue. Do not pretend the cast is "removed."

**A5. `_activeEngines` Map does not solve the durability problem.**
The plan stores engines in a module Map keyed by threadId. Two failure modes remain:

1. **In-process GC.** Module-level state survives `registerChatParticipant` re-entry but not extension host reload. After reload, `pausedSessions` is empty and `SessionManager` still believes `paused: true`. Next message → `engine.resume(deadId)` throws "Session not found" at workflow-engine.ts:549.
2. **Snapshot fallback is currently impossible.** The fallback the plan implicitly relies on — `resumeFromSnapshot()` — is broken two ways (see P0-α and P0-β in the Executive Summary). Even with `_activeEngines`, a reload mid-pause = data loss forever.

→ Sequencing matters: **fix P0-α and P0-β before touching Phase 2**, then make the paused handler try `engine.resume()` first and fall back to `engine.resumeFromSnapshot()` on `"Session not found"`.

**A6. `WORKFLOW_MAP.resume = undefined` is a typed lie.**
`WORKFLOW_MAP: Record<string, WorkflowDefinition>` claims every value is a `WorkflowDefinition`, but `resume: undefined` declares otherwise. The only reason this compiles is that `Record<K,V>` in TS doesn't actually forbid `undefined` values. Consequences:
- `'resume' in WORKFLOW_MAP === true` — `resolveCarryOverIntent` at line 470 returns `'resume'` if a prior workflowId was somehow `'resume'`, causing `WORKFLOW_MAP['resume']` at line 284 to be `undefined` and silently fall through to general_chat.
- The `'clarify'` intent (intent-classifier.ts:115 — confirmed emitted) has no entry at all; its path is handled by the dedicated branch at line 250. The inconsistency is confusing — some special intents have stub entries, others don't.

→ Fix: drop the `resume: undefined` key; let the `'resume'` and `'clarify'` intent branches be the sole handlers. Tighten `resolveCarryOverIntent` with an explicit truthy check: `if (!WORKFLOW_MAP[workflowId]) return undefined;`.

**A7. Phase 4 clarify re-routing re-creates the bug it was supposed to fix.**
The plan says "if `!session.paused && session.workflowId`, apply carry-over." That loses the `isLikelyWorkflowContinuationPrompt` guard, so a real clarification ("can you explain step 3 of that feature workflow in detail?") gets re-classified as `feature` and spins a *new* workflow — the same silent-intent-switch problem the root bug was about. Re-use the helper, unmodified:
```ts
if (!session.paused && session.workflowId &&
    isLikelyWorkflowContinuationPrompt(request.prompt) &&
    WORKFLOW_MAP[session.workflowId]) {
  classification = synthCarryOver(session.workflowId);
  // fall through to step 4
}
```

**A8. Phase 2/3 ignore that the engine is recreated per turn.**
`chat-participant.ts:388` is `new WorkflowEngine(new StepExecutor(stepHandler))` *inside the handler*. After the handler returns, that engine instance is a local variable and is GC'd. `pausedSessions` is an instance-level `Map` (workflow-engine.ts:57) — it dies with the engine. Without both (a) `_activeEngines` holding the instance and (b) snapshot fallback, a paused workflow simply disappears between turns. This is the structural reason the plan's approach has to work on *all* the layers (in-memory + snapshot) at once, not as sequential phases.

**A9. `VSCodeCancellationHandle` captured into pausedSessions is bound to the previous turn's token.**
Written at workflow-engine.ts:178 (`context` object put into `pausedSessions`) and read at workflow-engine.ts:593 (`context.cancellation.isCancelled`). The token was supplied by VS Code for *that* handler invocation only and is already disposed by the time `resume()` runs on the next turn. Cancellation during resume cannot fire.

→ Fix during Phase 2: before calling `engine.resume(...)`, rebind the saved context's `cancellation` to the new turn's token:
```ts
const ctx = engine['pausedSessions'].get(session.pausedSessionId)!.context;
ctx.cancellation = new VSCodeCancellationHandle(token);
ctx.progress = new VSCodeProgressReporter(response);   // same staleness applies
```
Or expose a small `engine.rebindTurnHandles(sessionId, { cancellation, progress })` to avoid poking private fields. The same concern applies to `context.progress` — `VSCodeProgressReporter` wraps the *old* `ChatResponseStream`; writes to it after the turn completes are either dropped or throw.

**A10. Per-workflow, not per-thread, `executionState`.**
`this.executionState` (workflow-engine.ts:61) is keyed by `definition.id` (`bug_fix`, `feature`, etc.), not by thread/session. If two chat threads both run `bug_fix` concurrently, they overwrite each other's state in the Map. The logged `from` state in `transition()` becomes meaningless and any logic that depends on "current state for this workflow" is cross-talking. Today this is latent because `getState(workflowId)` is only used in tests, but adding `_activeEngines` keyed by thread does NOT fix the internal state-keying. Either key by `${threadId}:${workflowId}` or accept that one engine == one workflow run at a time (i.e. keep the per-turn-engine model and delete `executionState` since it's essentially unused).

### 2. Bug Hunting Findings (verified against the source)

**B1. `registerWorkflowDefinition()` is never called.** *(P0 — blocker for P4 snapshot resume.)*
Defined at `workflow-engine.ts:43`. Exhaustive grep across `src/` produced **zero call sites**. `WORKFLOW_DEFINITION_REGISTRY` is permanently `{}`. Result: `resumeFromSnapshot` calls `getWorkflowDefinitionById(definitionId)` at line 818, gets `null`, and throws at line 821. Every attempt to resume via snapshot fails hard.

→ Fix: at module load (bottom of `extension.ts` activation or top of `engine/definitions/index.ts` if one exists), call:
```ts
for (const def of [BUG_FIX_WORKFLOW, FEATURE_WORKFLOW, REFACTOR_WORKFLOW, REVIEW_WORKFLOW,
                   DOCUMENT_WORKFLOW, DEPENDENCY_WORKFLOW, ONBOARD_WORKFLOW]) {
  registerWorkflowDefinition(def);
}
```
Add a unit test that iterates each workflow and asserts it round-trips through registry.

**B2. Engine is instantiated without `learningDb`.** *(P0 — blocker for all snapshot writes.)*
`chat-participant.ts:388` is `new WorkflowEngine(new StepExecutor(stepHandler))` — no second argument. Every snapshot-save guard short-circuits:
- workflow-engine.ts:190 — skipped on approval pause
- workflow-engine.ts:904 — skipped in snapshot-resume loop
- workflow-engine.ts:795 — `resumeFromSnapshot` throws `"Learning database not configured"`

Net effect: `listIncompleteWorkflows(threadId)` always returns `[]` (SessionManager reads via learningDb directly, but the DB is empty). The Phase 3 threadId plumbing saves a `threadId` field into snapshots that are **never written**.

→ Fix (one line): `new WorkflowEngine(new StepExecutor(stepHandler), deps?.learningDb)`. Add a test that asserts — after an `execute()` that hits `requiresApproval` — a row exists in `workflow_snapshots` with the expected `thread_id`.

**B3. Cancellation handle in paused sessions is dead on arrival.** *(P0 — silent UX failure.)*
`VSCodeCancellationHandle` wraps a `vscode.CancellationToken` issued per chat turn (`vscode-providers.ts:114`). Engine stashes `context` into `pausedSessions` (workflow-engine.ts:178, 660) including the wrapped handle. On the next turn the token from the previous handler is already disposed; `context.cancellation.isCancelled` at line 593 reads from the dead token. User cancellations during `resume()` cannot propagate.

→ Fix: provide `engine.rebindTurnHandles(sessionId, { cancellation, progress })` that replaces `pausedSessions.get(id).context.cancellation` and `.progress` with the current turn's handles. Call it in chat-participant immediately before `engine.resume(...)`.

**B4. `resumeFromSnapshot` intermediate snapshots accumulate without bound.**
Lines 906–921 of workflow-engine.ts: each successful step during snapshot-resume INSERT OR REPLACE-writes a new row with id `${snapshotId}-${runStartTs}-step${i}`. The status is `'saved'`. The *original* pause row's status is never changed to `'completed'` or deleted. Result: a workflow that pauses once, resumes through 5 steps, and pauses again writes 6 rows; `listIncompleteWorkflows` returns all of them with status `paused`/`saved` and the user gets a "found 6 incomplete workflows" list for what is conceptually one run.

→ Fix: on completion/final-approval, UPDATE the original row's status to `'completed'` and DELETE the intermediate `'saved'` rows for that run. Or garbage-collect `'saved'` rows older than N seconds when the same `workflowId` reaches a terminal state. Add retention policy (drop rows older than, e.g., 7 days) to bound growth across sessions.

**B5. `saveWorkflowSnapshot` returns `void` but callers `await` it.**
`learning-database.ts:702` signature is `saveWorkflowSnapshot(snapshot): void`. Engine at line 206 does `await this.learningDb.saveWorkflowSnapshot(...)`. `await` on non-Promise is benign, but the signature lies: if/when this is made async (plan P6 suggests), callers assume they were already awaiting completion and ordering bugs appear. Pick one now: either make the method `async` end-to-end or remove the `await`.

**B6. `this.state` at workflow-engine.ts:135 is undefined — but only cosmetically.**
`transition()` at line 982 is:
```ts
private transition(workflowId, from, to, log): void {
  log.debug(`[${workflowId}] ${from} → ${to}`);
  this.executionState.set(workflowId, to);
}
```
No validation of `from`. So the bad call at line 135 logs `[bug_fix] undefined → WAITING_PARALLEL` but does not throw and does not corrupt state (the state map ignores `from` entirely). **Downgrade from the earlier claim**: this is a log-hygiene defect, not a functional bug. Still worth the one-line fix, but not in the P0 tranche.

**B7. `WorkflowContext.progress` in pausedSessions.context is the old stream.**
Same root cause as B3. `VSCodeProgressReporter.report(...)` writes to the `ChatResponseStream` captured in the previous turn (`vscode-providers.ts:99`). Writing to a completed stream either no-ops silently or throws depending on VS Code's lifecycle. Fold into B3's rebinding helper.

**B8. `_sessionManagerInitialized` guards against re-binding the learningDb.**
Lines 46 and 107–110 of chat-participant.ts: the flag is set `true` on first successful bind and never reset. If activation order differs (learningDb is first null, then non-null; or the db is recreated in tests), the SessionManager silently points at a stale reference. Replace the boolean guard with an identity check: `if (_sessionManager.getLearningDb() !== deps.learningDb) _sessionManager.setLearningDatabase(deps.learningDb);`.

**B9. Strict `=== 'yes'` approval parsing.**
`chat-participant.ts:132` compares `request.prompt.toLowerCase().trim() === 'yes'`. `"y"`, `"yes please"`, `"ok"`, `"confirm"`, `"continue"`, `"go"`, `"sure"` all evaluate to `false` → engine receives `userApproval=false` → workflow CANCELLED (workflow-engine.ts:565). Ironically the `CONVERSATIONAL_ACK_PATTERN` at line 66 of the same file already accepts all of these — it's just unused here.

→ Fix:
```ts
const ack = /^(y|yes|ok(ay)?|confirm|continue|proceed|go|sure)[!.\s]*$/i;
const nack = /^(n|no|cancel|abort|stop|nope)[!.\s]*$/i;
const trimmed = request.prompt.trim();
const approval: 'approve' | 'reject' | 'unclear' =
  ack.test(trimmed) ? 'approve' : nack.test(trimmed) ? 'reject' : 'unclear';
if (approval === 'unclear') {
  response.markdown(`I didn't catch that — reply \`yes\` to continue or \`no\` to abort.`);
  return {};
}
```

**B10. `session.clarifying` is write-only dead state.**
Set at SessionManager line 108 (`markClarifying`) and *never read*. Either wire it into the next-turn handler (so a follow-up after clarify re-routes to the remembered workflow) or delete the field and the method. Current code is misleading.

**B11. `claude-md-parser.ts` `\Z` bug is broader than the plan claims.**
In JavaScript RegExp, `\Z` is parsed as a literal `Z` — there is no end-of-string anchor by that name. The lookahead terminators at lines 89, 96, 111 only fire when the input contains a literal `Z` character. This affects any list in a markdown section; backtracking recovers some cases by hitting the alternative terminators (`\n[-*]`, `\n\d+\.`, `\n\*\*`), so the symptom is inconsistent rather than total failure. Also at line 111: `[-*\d*]` has a duplicate `*` inside the character class — probably intended `[-*\d]`. Both fixes together, with a test that uses no literal `Z` anywhere in the input to prove the anchor is doing real work.

**B12. `WORKFLOW_MAP.resume = undefined` is a type violation.**
`Record<string, WorkflowDefinition>` ought to forbid undefined values, but TS's index-signature treatment allows it. The key exists (`'resume' in WORKFLOW_MAP === true`) which confuses `resolveCarryOverIntent`. See A6 — drop the key.

**B13. SessionManager has no eviction.**
`this.sessions: Map<string, ConversationSession>` (line 37) grows forever. Each distinct threadId in the process lifetime adds an entry; nothing prunes them. Long-running VS Code sessions see steady memory growth. Cap + LRU.

**B14. `fs.statSync(logFilePath)` on every log line.**
`logger.ts:176`, called from `maybeRotate()` which is called from every `writeJsonLine` (line 167). Each `info`/`warn`/`error`/`debug` triggers a synchronous `stat` syscall. Replace with a cached byte counter (increment on successful append, re-stat only when counter crosses threshold, reset on rotation). Current plan mentions this but undersells impact — this is on the hot path of EVERY log call.

**B15. `request.prompt` shape for slash commands.**
When VS Code invokes a slash command, `request.prompt` contains the text *after* the command (prefix stripped). For `/workflow:fix this is broken`, prompt is `"this is broken"`. The handler's classification fallback path (line 175 when the slash map misses today) classifies `"this is broken"` in isolation — which probably lands in `bug_fix` by chance for this example, but for `/workflow:onboard` users, an empty prompt classifies to general_chat. This masked B2 (the slash-command map miss) from being noticed because fix-like slash-commands "just work" by luck through the classifier.

### 3. Hardening Ideas

**H1. First-class paused-session contract on `WorkflowResult`.**
```ts
pausedSessionId?: string;      // set iff state ∈ {PAUSED, WAITING_FOR_APPROVAL}
pauseReason?: 'approval' | 'step-failure';
lastStepName?: string;         // for UX: "Workflow paused at 'Run tests' (step 4/7)"
```
Eliminates the summary-string regex. Also lets chat-participant branch UX: approval → "Reply yes/no"; failure → "Step X failed: <reason>. Retry, skip, or abort?".

**H2. Dual-source resume with explicit precedence.**
```ts
try {
  result = await engine.resume(pausedSessionId, approval);
} catch (e) {
  if (String(e).includes('Session not found')) {
    result = await engine.resumeFromSnapshot(pausedSessionId, progress, projectModel);
  } else throw e;
}
```
Only works after P0-α (engine gets `learningDb`) and P0-β (`registerWorkflowDefinition` is called).

**H3. Rebind turn-scoped handles before resume.**
Expose `engine.rebindTurnHandles(sessionId, { cancellation, progress })` (see B3/B7). Fixes dead cancellation + dead stream writes.

**H4. Dispose-safe module state.**
Return a composite `Disposable` from `registerChatParticipant` that owns `_sessionManager`, `_activeEngines`, and the initialization flag. On `dispose()`, clear all three. Fixes B8 and eliminates test cross-contamination between suites.

**H5. Per-thread handler mutex.**
```ts
const threadQueues = new Map<string, Promise<void>>();
async function serialize(threadId: string, fn: () => Promise<void>) {
  const prev = threadQueues.get(threadId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  threadQueues.set(threadId, next);
  try { await next; } finally {
    if (threadQueues.get(threadId) === next) threadQueues.delete(threadId);
  }
}
```
Wrap the handler body. Fixes concurrent-message corruption without requiring global mutex.

**H6. Flexible approval parser.**
See B9 — a three-valued (`approve`/`reject`/`unclear`) parser, with the `unclear` branch re-prompting instead of defaulting to abort.

**H7. Structured telemetry around the new paths.**
Counters:
- `classification.carry_over_applied`
- `pause.entered` (labels: `reason=approval|failure`)
- `pause.resumed` (labels: `source=inmemory|snapshot`)
- `pause.abandoned` (fires when `_activeEngines` entry evicted without reaching a terminal state)
- `slash_command.invoked` (labels: `name=workflow:fix…`, `normalized=true|false`)
- `approval.unclear_prompt`
- `snapshot.write_failed`
- `snapshot.registry_miss` (fires when `getWorkflowDefinitionById` returns null — should be 0 after P0-β)

**H8. Drop `WORKFLOW_MAP.resume = undefined` and tighten the type.**
Change signature to `Record<WorkflowIntent, WorkflowDefinition>` where `WorkflowIntent` excludes `'resume'` and `'clarify'` and `'general_chat'`. Forces the handler to address special intents before the lookup, and the compiler will catch any drift.

**H9. Remove `executionState` or re-key it.**
Per A10 it is effectively unused except for test backward-compat (workflow-engine.ts:77–81). Decide:
- Delete it: remove the `executionState` field, rewrite the one test that reads it, simplify `transition()`.
- Or re-key to `${threadId}:${workflowId}` and accept the threadId dependency.

**H10. Cap and evict session maps.**
`_sessionManager.sessions` and `_activeEngines` both need soft caps (~200 and ~50). LRU eviction; evict idle entries first (`paused===false && workflowId===undefined` for sessions; workflows in terminal states for engines).

**H11. Snapshot retention policy.**
One `workflow_snapshots` row per step during resume (B4). Add `DELETE FROM workflow_snapshots WHERE thread_id = ? AND updated_at < datetime('now', '-7 days')` on activation, and — when a workflow reaches a terminal state — DELETE the intermediate `'saved'` rows belonging to that run (match on `id LIKE '${origId}-%'` or add a `run_id` column).

**H12. Typed `WorkflowContext`.**
Fold all the `(context as any).foo` fields in workflow-engine.ts into the interface (A4). Use a discriminated `runtime?: { threadId?: string; ... }` sub-object if you don't want to pollute the top level.

**H13. Hoist `require('node:fs')`.**
telemetry.ts:93 imports `node:fs` lazily inside `flush()`. Works but adds a module-load per flush on cold code paths. Hoist to top-level import.

**H14. Async JSON log writes with ordering guarantee.**
Replace `fs.appendFileSync` at logger.ts:166 with a serial queue:
```ts
let writeChain: Promise<void> = Promise.resolve();
function enqueueWrite(data: string) {
  writeChain = writeChain.then(() => fs.promises.appendFile(path, data)).catch(err => {
    writeErrorCount++;
  });
}
```
Track `writeErrorCount` in telemetry. Combine with cached byte counter (B14) to avoid `statSync`.

### 4. Testing Ideas

**P0 regression tests (write these first — they fail on `main` today).**
R1. Build a real `WorkflowContext` with `requiresApproval: true` on step 1, execute, then assert `learningDb.getRawDb().prepare('SELECT count(*) c FROM workflow_snapshots').get().c === 1`. Currently `0`. Fails until B2 is fixed.
R2. Register one workflow, call `resumeFromSnapshot(id, progress)` with a known snapshot id → expect success. Currently throws `"Workflow definition not found"`. Fails until B1 is fixed.
R3. Use a `FakeCancellationToken` that flips `isCancellationRequested` AFTER pause. Call `engine.resume(...)`; assert the engine observes cancellation. Currently hangs/no-ops. Fails until B3 is fixed.
R4. Simulate `request.command = 'workflow:fix'` (the real VS Code value) → assert `bug_fix` workflow ran and classifier was NOT called. Fails until A2 is fixed.
R5. Two turns on the same conversation, where `context.history` on turn 2 is `[{ kind: 'request', prompt: 'X' }, { kind: 'response', response: [...] }]` (no `.id` fields anywhere). Assert `extractThreadId` returns the same value for both turns. Fails until A1 is fixed.

**Unit — `chat-participant.ts`**
1. `extractThreadId` matrix: empty history, history with one request, history with one request+response, two different first prompts → two different ids, identical first prompt (case and whitespace variants) → same id.
2. Slash command normalization matrix: `workflow:fix | fix | workflow:review | review | unknown | '' | undefined` → routed workflow or classification fallback.
3. `resolveCarryOverIntent`:
   - `workflowId === 'resume'` → undefined (A6).
   - `workflowId` not in `WORKFLOW_MAP` as a *truthy* value → undefined.
   - Prompt with `?` → undefined.
   - Prompt > 60 chars → undefined.
   - Conversational ack ("thanks") → undefined.
4. Clarify-intent re-routing obeys `isLikelyWorkflowContinuationPrompt`:
   - Short prompt, prior workflow, no paused session → carry-over.
   - Long prompt with `?` → clarification UI, NOT carry-over (A7).
5. `parseApproval` matrix (~15 phrases): `yes`, `y`, `yes please`, `OK`, `confirm`, `Yes!`, `go ahead` → approve. `no`, `n`, `cancel`, `abort!` → reject. `maybe`, `what if…`, `""` → unclear.
6. `_sessionManagerInitialized` bug (B8): register twice with different `learningDb` instances; assert second db is bound.

**Unit — `workflow-engine.ts`**
7. After `execute()` with `requiresApproval: true`, `result.pausedSessionId` is set and matches a key in `pausedSessions` (H1).
8. After `execute()` that COMPLETED normally, `result.pausedSessionId === undefined`.
9. `registerWorkflowDefinition` round-trip: register → `getWorkflowDefinitionById(id)` returns the registered def.
10. `resumeFromSnapshot` with a missing registry entry throws with a message containing the workflow id (guards against silent regression of B1).
11. `rebindTurnHandles` (H3): after rebind, `context.cancellation.isCancelled` reflects the new token, not the old.
12. Snapshot retention: after a run completes, intermediate `'saved'` rows are deleted (H11).

**Integration — real DB, fake VS Code**
13. End-to-end approval happy path with real `LearningDatabase`: execute → WAITING_FOR_APPROVAL → DB has row with `thread_id=<expected>` and `status='paused'` → second handler turn sends "yes" → DB row status becomes `'completed'` (or deleted) → workflow completes.
14. Pause → reject: "no" → CANCELLED, no residual `'saved'` rows.
15. Pause → unclear ("maybe"): state unchanged, re-prompt streamed, no new snapshot row.
16. Durable resume: execute to WAITING_FOR_APPROVAL, drop the engine reference (simulating host reload), create a fresh engine, call `engine.resume` → throws `Session not found` → fallback to `resumeFromSnapshot` → completes. Assert the original pause was recovered from DB, not memory.
17. Concurrent handlers on same thread: fire two overlapping requests; assert second one's `_sessionManager.getSession(threadId).paused` read did NOT see a half-written state.
18. Thread-id stability across process: handler invocation A with history `[req(prompt='X')]` and invocation B with history `[req(prompt='X'), resp(...)]` produce the same threadId. Verify via `_sessionManager.getSession(threadId)` being the same object.

**Regression — `claude-md-parser.ts`**
19. Input containing no literal `Z` character — list with items that include only lowercase letters and numbers, no trailing newline. All items extracted (proves the `\Z` is doing real terminator work, not incidentally terminating on a stray `Z`).
20. Nested `**Header**` + bullets: header label NOT included in flat list; bullets ARE.
21. Duplicate `*` bug: `- item *with an asterisk*` → captured as `item *with an asterisk*` (not truncated).

**Regression — `logger.ts` / `telemetry.ts`**
22. 10k `info()` calls in parallel → no dropped lines (count them), no unhandled rejections.
23. Simulate `fs.appendFile` always failing → logger continues, error counter increments, process does not throw.
24. `maybeRotate` is called without performing a `statSync` when the cached byte count is below threshold (mock `fs.statSync` and assert 0 calls on the hot path).

**Property-based**
25. For 1000 random short prompts, `isLikelyWorkflowContinuationPrompt(p)` is false whenever `p` contains `?` or has more than 8 words (invariant).
26. For 1000 random threadIds, `extractThreadId(fakeContext(p))` is idempotent across 3 calls with the same first prompt.

### 5. Plan Improvements (concrete edits)

**P0. Insert Phase 0 — make persistence and resumption actually work.**
Before any of the original 6 bug fixes, land:
- `0.1` At activation, call `registerWorkflowDefinition(...)` for every workflow in `WORKFLOW_MAP` (fixes B1).
- `0.2` Change `chat-participant.ts:388` to `new WorkflowEngine(new StepExecutor(stepHandler), deps?.learningDb)` (fixes B2).
- `0.3` Add `engine.rebindTurnHandles(sessionId, { cancellation, progress })` + wire it in chat-participant before every `resume()` call (fixes B3/B7).

Rationale: Phases 2–4 are pointless without these three. Today they would wire up control flow that routes to code paths that either throw or silently drop data.

**P1. Rewrite Phase 1 around content-hash threadId.**
Replace `history[0].id` with `hash(firstRequestPrompt)` (see A1). Make the cache injectable for tests. Add the test from R5 (no-`.id` history shape) to prevent regression of the test-prod gap.

**P2. Upgrade Phase 5 to P1 and move it to Phase 2a.**
Slash commands are all broken in production (A2). Normalize `workflow:` prefix in the command lookup. Add both test cases (`command: 'workflow:fix'` AND `command: 'fix'`) and have at least one assert the classifier was NOT called.

**P3. Subdivide Phase 2.**
- `2.0` Extend `WorkflowResult` with `pausedSessionId?: string` and `pauseReason?: 'approval' | 'step-failure'` and `lastStepName?: string` (H1).
- `2.1` Engine sets all three at every PAUSED/WAITING_FOR_APPROVAL return point (execute line 222, resume line 683, resumeFromSnapshot line 946).
- `2.2` chat-participant reads `result.pausedSessionId` directly. Delete `extractSessionIdFromSummary` — never add it.
- `2.3` Store the engine in `_activeEngines` keyed by threadId. Evict on terminal state.
- `2.4` **Dual-source resume:** try `engine.resume(sessionId, approval)`; on `Session not found`, fall back to `engine.resumeFromSnapshot(sessionId, progress, projectModel)` (H2). Requires P0-α, P0-β.
- `2.5` Rebind cancellation+progress handles before resume (H3). Requires P0-γ.

**P4. Reshape Phase 3.**
Explicitly enumerate and fix all eight `(context as any)` sites (A4) OR scope the PR to just `threadId` and file a follow-up. Do not leave the wording "removes the cast" — it's false as written.

**P5. Harden Phase 4.**
Reuse `isLikelyWorkflowContinuationPrompt` inside the clarify branch (A7). Add the `WORKFLOW_MAP[workflowId]` truthy guard (A6). Add the test from §4.4.

**P6. Expand Phase 6 (cross-cutting).**
Add:
- `22.` Fix `this.state` → local `state` at workflow-engine.ts:135 (cosmetic, B6).
- `23.` Drop `resume: undefined` from `WORKFLOW_MAP` (A6/H8).
- `24.` Delete `session.clarifying` and `markClarifying()` (B10).
- `25.` Replace `=== 'yes'` with `parseApproval()`; handle `unclear` (B9).
- `26.` Fix `[-*\d*]` typo in claude-md-parser:111 (B11).
- `27.` Replace the user-facing placeholder at chat-participant.ts:145 (`*Pause resumption logic will integrate…*`). This ships to users today.
- `28.` Hoist `require('node:fs')` in telemetry.ts:93 to a top-level import (H13).
- `29.` Fix logger hot-path: cached byte counter + async serial queue (H14).

**P7. Add Phase 7 — lifecycle, eviction, retention.**
- `30.` Wrap module state in a disposable scope (H4).
- `31.` Per-thread handler mutex (H5).
- `32.` LRU eviction on `_sessionManager.sessions` and `_activeEngines` (H10).
- `33.` Snapshot retention: delete `'saved'` rows on terminal state; drop rows older than 7 days on activation (H11).
- `34.` Telemetry counters listed in H7.

**P8. Correct the Decisions section.**
- Previous claim "Phase 3 is additive — zero risk" is wrong: changing `WorkflowContext` shape can break tests that construct partial contexts. Add a grep pass across `src/**/*.test.ts` for `WorkflowContext` usages before the PR.
- Previous claim "Phase 5 is defensive normalization only" is wrong: it's a P1 regression (A2).
- Previous claim `_activeEngines` "avoids memory leak" is insufficient — it only avoids GC of the engine, not the unbounded-sessions map (B13) or the intermediate-snapshots table (B4). Tighten the decision to reflect H10 and H11.
- Add: "ThreadId does NOT survive host reload by design; durability is via snapshots + dual-source resume (§P3-2.4)."
- Add: "Approval parsing is forgiving by design (§B9); `unclear` re-prompts rather than aborts, because a false abort loses user work."

**P9. Expand Verification.**
Current verification has 6 items. Replace with:
1. `npx vitest run src/shell/chat-participant.test.ts` — including all new tests in §4.1–6.
2. `npx vitest run src/engine/workflow-engine.test.ts` — including §4.7–12.
3. `npx vitest run src/__integration__/` — including §4.13–18, no regressions in existing suites.
4. `npx vitest run src/analyzer/claude-md-parser.test.ts` — §4.19–21.
5. `npx vitest run src/shell/__tests__/logger-rotation.test.ts` — §4.22–24.
6. `npx vitest run src/learning/learning-database.test.ts` — verify a paused workflow persists a row (R1); resume-from-snapshot round-trips (R2).
7. Manual (real extension host): `/workflow:fix null pointer in foo.ts` → routes to `bug_fix`, not general_chat (R4).
8. Manual: run a workflow with `requiresApproval`, reload the extension host mid-pause via Dev: Reload Window, type "yes" → workflow resumes from snapshot (R2 + dual-source).
9. Manual: start a workflow; cancel via VS Code's cancel button on the approval prompt → assert CANCELLED in logs (B3/R3).
10. Manual: send "y" instead of "yes" on approval → approves (B9).
11. `npm run test` — full suite green.

**P10. Sequencing recommendation.**
```
Phase 0 (P0-α, P0-β, P0-γ)    ← blocker for everything else
  └─ Phase 2a (slash commands, A2)
      └─ Phase 1 (threadId, A1)
          └─ Phase 2b (pause/resume wiring, B3, H1, H2, H3)
              ├─ Phase 3 (WorkflowContext types, A4)
              ├─ Phase 4 (clarify, A7)
              └─ Phase 6 (cross-cutting, including B6/B10/B11/B9/placeholder text)
                  └─ Phase 7 (lifecycle/eviction/retention, H4/H5/H10/H11)
```
Phase 0 unblocks durability, Phase 2a is a cheap high-leverage fix that restores slash commands on its own, Phase 1 is a prerequisite for everything that reads `session.paused`, and Phase 7 cleans up after the rest of the work lands.

---

### 6. What's Still Unknown (would merit investigation before implementation)

**U1.** Does `vscode.ChatContext.history[n].id` exist on the real API? Grep the installed `@types/vscode` `index.d.ts` and verify. If it IS present and stable, the content-hash approach in A1 is overkill — but the current code still needs `history[last]` replaced, since `history[last]` is the most recent turn (which legitimately changes each call), not a stable anchor.

**U2.** Behavior of `vscode.ChatResponseStream.markdown()` after the handler returns — does it throw, no-op silently, or append to the next turn? Affects how seriously B7 (stale progress reporter) matters.

**U3.** Is `executionState` actually read anywhere meaningful? If not (A10), H9 can just delete it in one PR.

**U4.** Concurrency model: can VS Code deliver two chat requests to the same participant on the same thread concurrently? If it serializes at the API layer, B4/H5 are belt-and-suspenders. If it does not, H5 is required.

