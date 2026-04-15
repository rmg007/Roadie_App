# v0.6.2 — Hardening & Production Readiness

**Target version:** 0.6.2
**Base version:** 0.6.1
**Date drafted:** 2026-04-15

---

## 1. Problem

v0.6.1 fixed the most visible crashes (missing command callbacks, `priorityTrim` panic,
section-id artifacts) and shipped Context Lens. Under sustained real-world use, a second
wave of robustness gaps has surfaced: fire-and-forget promises during activation, uncaught
`JSON.parse` and `fs.writeFile` exceptions, a database `close()` that doesn't actually
close the underlying connection, unvalidated step-executor parameters, regex patterns
vulnerable to ReDoS, and an N+1 query in database pruning. This release is purely
defensive — no new features, only hardening.

---

## 2. Hardening Items

| # | Severity | Area | File + Lines | Issue | Fix | ~Lines |
|---|----------|------|-------------|-------|-----|--------|
| H1 | Critical | Fire-and-forget activation | `src/extension.ts` L163-181 | `analyzer.analyze().then(...)` chain is not awaited — activation completes before analysis finishes; errors are swallowed and leave the extension in an inconsistent state | Await the promise chain inside `activate()`, or wrap in `Promise.allSettled()` and log failures explicitly; set a `ready` flag consumers can check | +10 |
| H2 | Critical | Unguarded JSON.parse | `src/analyzer/dependency-scanner.ts` L59 | `JSON.parse(raw)` on `package.json` content has no try-catch — malformed JSON crashes the scanner | Wrap in try-catch, log warning, return empty result on parse error | +6 |
| H3 | Critical | Database close() is a no-op | `src/learning/learning-database.ts` L323 | `close()` only nulls the `this.db` ref without calling `db.close()` on the underlying better-sqlite3 connection — file handle stays open, database file remains locked | Call `this.db.close()` before nulling the reference; add guard for double-close | +4 |
| H4 | High | fs.writeFile unhandled throw | `src/generator/file-generator.ts` L221-222 | `fs.mkdir()` and `fs.writeFile()` are not wrapped in try-catch — permission denied or disk-full throws an unhandled exception that crashes the generator pipeline | Wrap both calls in try-catch; on failure, set `written: false` in the result and log the error | +8 |
| H5 | High | Empty workflow steps | `src/engine/workflow-engine.ts` L44 | `execute()` does not validate that `definition.steps` is non-empty — empty definitions complete silently with a success status, masking config errors | Add early guard: `if (!definition.steps?.length) throw new WorkflowError('Workflow has no steps')` | +3 |
| H6 | High | step-executor input validation | `src/engine/step-executor.ts` L68, L99 | `maxRetries` and `timeoutMs` are used without validation — negative `maxRetries` makes `maxAttempts = 0` (skips execution), negative `timeoutMs` creates immediate timeout | Clamp: `const maxAttempts = Math.max(1, (step.maxRetries ?? 0) + 1)` and `const timeout = Math.max(1000, step.timeoutMs ?? 30_000)` | +4 |
| H7 | High | ReDoS in intent patterns | `src/classifier/intent-patterns.ts` L49 | Patterns like `/\bmake\b.*\bwork\b/i` use greedy `.*` between word boundaries — catastrophic backtracking on long strings without the terminating word | Replace greedy `.*` with lazy `.*?` or length-limited `.{0,200}`; add test with 10 KB input to prove no timeout | +6 |
| H8 | High | Unsafe projectModel fallback | `src/shell/chat-participant.ts` L157 | `(deps?.projectModel ?? {}) as ProjectModel` casts an empty object to `ProjectModel` — any method call on it throws TypeError | Replace with null propagation: remove the `?? {}` cast; use optional chaining (`projectModel?.toContext(...)`) at all call sites; skip context injection when model is absent | +8 |
| H9 | Medium | N+1 prune query | `src/learning/learning-database.ts` L306-312 | `prune()` SELECTs all distinct file paths then DELETEs per file in a loop — O(n) queries instead of O(1) | Collapse into a single DELETE with a window-function subquery: keep only the N most recent snapshots per file path in one statement | +10 |
| H10 | Medium | Unsafe array access — classifier empty sort | `src/classifier/intent-classifier.ts` ~L35-40 | If `INTENT_PATTERNS` becomes empty (e.g., import error), `sorted[0]` is `undefined` — crashes classification | Guard: `if (!sorted.length) return { intent: 'general_chat', confidence: 0 }` | +3 |
| H11 | Medium | Missing bounds on section markers | `src/generator/section-manager.ts` ~L58-75 | `indexOf()` for `<!-- roadie:start:… -->` markers fails silently if markers have trailing whitespace or Windows line endings mixed in | Use regex with flexible whitespace: `/<!--\s*roadie:start:(\w[\w-]*)\s*-->/` | +6 |
| H12 | Medium | Entity extraction silent failure | `src/analyzer/project-analyzer.ts` ~L61-73 | Individual file extraction errors are logged but not counted — analysis reports success even if 50 % of files fail | Track failure count; emit warning when failure rate exceeds 10 % | +5 |
| H13 | Low | Magic constants scattered | Multiple files | `DEBOUNCE_MS`, `MAX_SNAPSHOTS_PER_FILE`, `MAX_WORKFLOW_ENTRIES` etc. are defined inline in various modules | Extract to `src/constants.ts` and import everywhere | +20 |
| H14 | Low | No config enum validation | `src/shell/commands.ts` ~L17-27 | `readConfiguration()` returns unvalidated strings for enum-like settings (e.g., modelPreference) | Validate against allowed values, log warning and fall back to default on mismatch | +8 |

---

## 3. Implementation Order

### Phase 1 — Critical (do first, each is a potential crash)

1. **H2** — JSON.parse guard (smallest change, highest crash likelihood)
2. **H3** — Database close() fix (resource leak)
3. **H1** — Await activation analysis (startup reliability)

### Phase 2 — High (do next, each is a silent failure or security concern)

4. **H4** — fs.writeFile error handling
5. **H5** — Empty workflow validation
6. **H6** — Step-executor input clamping
7. **H7** — ReDoS pattern hardening
8. **H8** — ProjectModel fallback safety

### Phase 3 — Medium (robustness polish)

9. **H9** — N+1 prune query
10. **H10** — Classifier empty-sort guard
11. **H11** — Section marker regex
12. **H12** — Entity extraction failure tracking

### Phase 4 — Low (code hygiene)

13. **H13** — Constants extraction
14. **H14** — Config validation

---

## 4. Testing Strategy

| Item | Test Type | What to Assert |
|------|-----------|----------------|
| H1 | Integration | `activate()` resolves only after analysis completes; simulated analysis failure still activates extension with degraded flag |
| H2 | Unit | `scanDependencies()` returns empty result on `{ "invalid json` input |
| H3 | Unit | After `close()`, underlying `db.open` is `false`; double-close does not throw |
| H4 | Unit | `generate()` returns `written: false` when `fs.writeFile` rejects |
| H5 | Unit | `execute()` throws `WorkflowError` for `{ steps: [] }` |
| H6 | Unit | `executeStep()` with `maxRetries: -1` still executes once; `timeoutMs: -5` uses floor of 1000 ms |
| H7 | Unit | `classify()` completes in < 50 ms on a 10 KB random-word input |
| H8 | Unit | Chat handler with `projectModel: undefined` does not throw |
| H9 | Benchmark | `prune()` on 1000-file DB runs in < 100 ms (was O(n) separate queries) |
| H10 | Unit | Empty `INTENT_PATTERNS` returns `general_chat` fallback |
| H11 | Unit | Markers with `\r\n` and trailing spaces are found correctly |
| H12 | Unit | Warning logged when > 10 % of files fail extraction |

---

## 5. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| H1 await changes activation timing, breaking consumers that assume sync activation | Medium | High | Add `onReady()` promise; existing callers that don't await are unaffected |
| H3 better-sqlite3 `close()` called on already-closed DB throws | Low | Medium | Guard with `if (this.db?.open)` before closing |
| H7 stricter regexes miss valid intents | Low | Medium | Run full intent-classifier test suite after pattern changes |
| H9 single-query prune might lock DB longer | Low | Low | Use WAL mode; prune is already called off-main-thread |

---

## 6. Out of Scope

- No new features in this release
- No dependency upgrades
- No changes to generated file content or templates
- Logging verbosity changes (confirmed correct in v0.6.1 H7)

---

## 7. Definition of Done

- [ ] All 14 hardening items implemented
- [ ] All new tests passing (`npm test`)
- [ ] Zero `any` casts introduced
- [ ] `npm run lint` clean
- [ ] `npm run build` succeeds
- [ ] CHANGELOG updated for v0.6.2
- [ ] Manual smoke test: activate on a repo with malformed `package.json` — no crash
