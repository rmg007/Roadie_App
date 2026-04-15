# Testing Engine — v0.1.0 (Planning Only)

**Scope:** New test infrastructure under `test/harness/` inside the Roadie package.
**Extension impact:** Zero production code changes. No extension version bump required.
**Tracked under:** v0.7.1 release.
**Date drafted:** 2026-04-15.

---

## 1. Context

v0.7.1's deep audit surfaced a class of bugs that structurally cannot be caught by unit tests:

| Bug | Why unit tests missed it |
|---|---|
| 6A — dead `log10` boost formula | Each arithmetic piece passed its own micro-test; the *composed* expression was never measured end-to-end |
| 6B — `recordPatternObservation()` never called | Function had unit tests; nothing tested *whether the system ever invokes it* |
| 6C — DB handles not registered with container | Container tests passed; nothing exercised a full deactivation lifecycle |
| 1C regression risk — hot-files injection | Context composition is integration behavior, not unit behavior |

A scenario-driven harness fills that gap: **full wire-up** of analyzer → classifier → workflow engine → model provider, with the only thing faked being the LLM endpoint (via cassette replay). This plan delivers v0.1.0 — enough to land three blocking scenarios and the architecture to scale.

---

## 2. Goals (quantitative)

| Goal | Target |
|---|---|
| E2E scenarios blocking on Linux CI | ≥ 3 |
| E2E scenarios smoke on Windows CI (non-blocking) | ≥ 3 |
| Unit-test count | ≥ 639 (637 existing + 2 new) |
| Harness code budget | ≤ 800 production lines under `test/harness/` |
| Fixture count | 3 (ts-calculator, mixed-js-ts, nested-monorepo) |
| Chaos modes covered | 6 (timeout, throw, partial, rate-limit, token-exceeded, stream-corruption) |
| Redaction regex coverage | 8 patterns |
| New production dependencies | 0 |
| New dev dependencies | 2 (`ajv`, `ajv-formats`) |

---

## 3. In / Out / Non-Goals

### In scope
- `ScenarioRunner` harness under `test/harness/`
- JSON scenario format + Ajv schema validation
- Cassette-based LLM record/replay with prompt fingerprinting
- Deterministic fixture copy + LearningDatabase seeding
- Redaction pipeline + `cassette:lint` CI gate
- Golden prompt regression for one workflow
- Chaos injection for 6 fault modes
- Linux blocking + Windows smoke in GHA

### Out of scope for v0.1.0
- Full VS Code boot via `@vscode/test-electron` (intentional — we use DI fakes instead for speed)
- Synthetic workspace generator
- LLM-as-judge output grading
- Cross-platform parity as a hard gate (Windows blocking → v0.2.0)
- YAML scenarios (JSON only this release)

### Non-goals
- Replacing any unit tests
- Re-architecting workflow definitions
- Shipping any user-facing extension feature from this plan

---

## 4. Architecture

### 4.1 Hook points in existing code

The harness is a **thin wrapper around Roadie's existing dependency injection**. No production code changes are required — every hook already exists:

| Hook | File:line | Role in harness |
|---|---|---|
| `registerChatParticipant({ classifier, stepHandler, projectModel, learningDb })` | `src/shell/chat-participant.ts:50` | Inject scripted deps |
| `new ProjectAnalyzer(model, entityWriter, learningDb)` | `src/analyzer/project-analyzer.ts` | Inject seeded learning DB |
| `new FileGeneratorManager(fileGenerator)` | `src/generator/file-generator-manager.ts` | Inject in-memory FS |
| `new WorkflowEngine(stepExecutor)` | `src/engine/workflow-engine.ts` | Inject recording executor |
| `new ModelResolver({ modelProvider })` | `src/engine/model-resolver.ts:42` | Inject cassette provider |

The recorder/replayer sits at the `modelProvider` boundary only — nothing else in the system knows it exists.

### 4.2 Data flow (replay mode)

```
scenario.json
  ↓
ScenarioRunner.run()
  ├─ copy fixture/<name> → os.tmpdir()/roadie-scenario-<uuid>
  ├─ open LearningDatabase at temp path
  ├─ seed(scenario.seed) — workflowHistory + patternObservations rows
  ├─ build ProjectModel via real ProjectAnalyzer
  ├─ real IntentClassifier.classify(prompt)
  ├─ real WorkflowEngine.execute(definition, context)
  │    └─ step handler → cassette-backed modelProvider → replayed response
  ├─ collect: {intent, workflow, stepsExecuted, fileMutations, contextSnapshots}
  └─ assert against scenario.expect.*
```

Record mode is identical except the modelProvider forwards to a real LLM (requires `ANTHROPIC_API_KEY`) and appends to `<scenario>.cassette.jsonl`. **Record mode never runs in CI.**

---

## 5. Scenario schema (v1)

```jsonc
{
  "$schema": "test/harness/scenarios/schema.json",
  "version": 1,
  "id": "fix-null-pointer",                // must match filename (sans .json)
  "name": "Bug fix on null pointer",
  "workspaceFixture": "ts-calculator",     // must exist under test/fixtures/
  "prompt": "@roadie the add() function crashes on null inputs",

  "seed": {                                // optional — seeds LearningDatabase
    "workflowHistory": [                   // ≥ 5 entries activate adjustWithLearning()
      { "type": "bug_fix", "status": "completed", "count": 4 },
      { "type": "bug_fix", "status": "cancelled", "count": 1 }
    ],
    "patternObservations": [
      { "patternId": "language:TypeScript", "count": 10 }
    ]
  },

  "expect": {
    "intent":        { "type": "bug_fix", "confidence": ">= 0.7" },
    "workflow":      "bug_fix",
    "stepsExecuted": { ">=": 4, "<=": 8 },
    "fileMutations": [
      { "path": "src/add.ts", "mustContain": "null" }
    ],
    "contextMustContain": ["## Most-Edited Files"],   // regression guard
    "assertions": [
      "./assertions/confidence-adjusted.ts"            // custom JS asserters (optional)
    ]
  },

  "faultInjection": {                      // optional
    "onStep": 2,
    "mode": "timeout"                      // one of the 6 chaos modes
  },

  "cassette": "fix-null-pointer.cassette.jsonl"
}
```

**Validation:** every `*.json` under `test/harness/scenarios/` is validated against `schema.json` via Ajv as the first step of every CI run. Invalid scenarios fail with line-accurate error messages.

---

## 6. Cassette format (JSONL)

One JSON object per LLM call, one line per call, in execution order:

```jsonc
{ "seq": 0,
  "fingerprint": "sha256:a1b2…",          // see §7
  "model": "claude-haiku-4-5-20251001",
  "tools": ["read_file", "edit_file"],
  "input": {
    "role": "user",
    "contentHash": "sha256:…",            // raw content in <cassette>.content/<hash>.txt
    "contentPreview": "first 120 chars…"
  },
  "output": {
    "text": "…",                          // redacted before write (§9)
    "toolCalls": [ /* … */ ],
    "finishReason": "stop"
  },
  "recordedAt": "2026-04-15T12:00:00Z"
}
```

**Why JSONL, not single JSON:** easier git diffs, line-accurate failure reporting, append-friendly during record.
**Content stored out-of-line:** keeps cassette diffs small when prompt changes (content file gets a new hash, old file garbage-collected by `cassette:gc` CI script).

---

## 7. Fingerprint algorithm

```ts
fingerprint = 'sha256:' + sha256(
  normalizeModel(modelId) + '|' +
  canonicalJSON({ tools, temperature }) + '|' +
  normalizeText(promptBody),
);
```

`normalizeText()` rules (Windows-safe, deterministic on any host):

| Rule | Example |
|---|---|
| Replace `\\` → `/` in paths | `C:\Users\x\foo` → `C:/Users/x/foo` |
| Replace workspace temp root with token | `C:/Users/x/tmp/roadie-abc/foo.ts` → `{{WORKSPACE}}/foo.ts` |
| Normalize line endings | `\r\n` → `\n` |
| Strip trailing whitespace per line | `foo  \n` → `foo\n` |
| Strip ISO timestamps | `2026-04-15T12:00:00Z` → `{{TIMESTAMP}}` |
| Strip UUIDs | `550e8400-e29b-…` → `{{UUID}}` |

**On mismatch**, replay fails with a **side-by-side diff of the normalized prompt** (not a cryptic hash) so the author can see exactly what drifted.

---

## 8. Chaos modes

| Mode | Injected behavior | Roadie code it exercises |
|---|---|---|
| `timeout` | Sleep > `roadie.testTimeout` | `step-executor.ts` retry-on-timeout |
| `throw` | `Error("model unavailable")` | `model-resolver.ts` fallback |
| `partial` | Truncated output, `finishReason: "length"` | `workflow-engine.ts` continuation |
| `rate-limit` | `{ status: 429, retryAfterMs: 1000 }` | `step-executor.ts` backoff |
| `token-exceeded` | `{ code: "context_length_exceeded" }` | Should trigger `simplified: true` retry (v0.6.1 H2) |
| `stream-corruption` | Valid JSON tokens then malformed tail | `agent-spawner.ts` stream parser |

Each mode has a dedicated scenario file (deferred past v0.1.0 — see milestones).

---

## 9. Redaction policy

Applied to every cassette write. Matches replaced with `{{REDACTED:<type>}}`:

| Type | Pattern |
|---|---|
| `anthropic-key` | `/sk-ant-[a-zA-Z0-9\-_]+/g` |
| `openai-key` | `/sk-[a-zA-Z0-9]{32,}/g` |
| `github-token` | `/gh[pousr]_[a-zA-Z0-9]{36,}/g` |
| `bearer` | `/Bearer\s+[a-zA-Z0-9.\-_]+/gi` |
| `email` | `/[\w.+-]+@[\w-]+\.[\w.-]+/g` |
| `user-path-win` | `/[A-Z]:\\Users\\[^\\]+/gi` |
| `user-path-unix` | `/\/(Users\|home)\/[^/]+/g` |
| `ipv4` | `/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g` |

**Enforcement:** a new `npm run cassette:lint` CI step scans every `*.cassette.jsonl` for any surviving match of the 8 patterns. Positive match = CI failure with file + line number.

---

## 10. Must-have scenarios for v0.1.0

Three scenarios are blocking for release. Each is chosen because it exercises a v0.7.0 code path a unit test cannot touch:

| Scenario | What it proves | Would have caught |
|---|---|---|
| `fix-null-pointer.json` | bug_fix intent → workflow dispatch → ≥4 steps execute with cassette-backed LLM | Regression in `WORKFLOW_MAP[bug_fix]` wiring |
| `review-codebase-summary.json` | `review` context injection asserts `contextMustContain: ["## Most-Edited Files"]` | Regression in v0.7.0 §1C hot-files injection |
| `confidence-adjusted.json` | Seeds ≥5 bug_fix runs mixing success/cancel; asserts `classification.confidence` differs from baseline | **6A at system level** — the dead boost formula |

Post-v0.1.0, **not blocking**: `simplified-retry`, `empty-project`, `cursor-rules-dir-gating`, each chaos mode's own scenario.

## 10.1 Additional Unit Tests for v0.1.0

Two additional unit tests are required for v0.1.0 to cover critical routing and resolver behaviors:

| Test Case | What it proves | Implementation |
|---|---|---|
| Slash command routing | `request.command = 'fix'` bypasses IntentClassifier and routes directly to bug_fix workflow | Pure unit test on `chat-participant.ts` routing branch; no cassette or harness needed |
| #roadie variable resolver | `registerChatVariableResolver` callback returns `ProjectModel.toContext()` output | Mock `ProjectModel`, assert resolved string contains expected sections like "## Most-Edited Files" |

These tests increase the unit-test floor to ≥ 639.

---

## 11. VS Code API fakes

Minimal surface to run without `@vscode/test-electron` (intentional — DI-based harness is dramatically faster):

```
test/harness/fakes/vscode.ts   (~150 lines)
  ├─ ChatRequest               — { prompt, model, command, references: [] }
  ├─ ChatResponseStream        — captures markdown/progress/button calls into an array
  ├─ CancellationToken         — isCancellationRequested + onCancellationRequested
  ├─ LanguageModelChatMessage  — passthrough User/Assistant helpers
  ├─ LanguageModelChat         — forwards sendRequest() to cassette provider
  ├─ window                    — showInformationMessage/showErrorMessage stubs
  ├─ workspace                 — fs stub bound to the scenario's temp dir
  └─ commands                  — registerCommand no-op with invocation log
```

`engines.vscode: ^1.93.0` in `package.json` pins the API surface; CI runs `tsc --noEmit` on the fakes against `@types/vscode` to catch drift.

---

## 12. Integration with existing tests

- Scenarios live in **`test/harness/scenarios/*.json`**.
- One parametrized vitest file (`test/harness/scenario.test.ts`) discovers every scenario and emits one `test()` per file — so reporters, filtering, and `--reporter=verbose` output all work unchanged.
- `npm test` (existing command) now covers both unit and scenario tests.
- `npm run test:scenarios:record` (new) runs in record mode. Requires `ANTHROPIC_API_KEY`. **Never runs in CI.**
- Coverage: `--coverage.exclude=test/harness` so harness code doesn't inflate coverage.
- Existing 637 unit tests are preserved; 2 new unit tests added under this plan.

---

## 13. Dependencies

**New dev deps:**
- `ajv@^8.x` — JSON Schema Draft 2020-12 validation (~40 KB)
- `ajv-formats@^3.x` — `format: "uri"`, `"email"`, etc.

**No new production deps.** No new transitive risk surface for the extension binary.

---

## 14. Milestones

| # | Deliverable | Est. LOC |
|---|---|---|
| 1 | `schema.json` + Ajv validator + 1 sample scenario | ~120 |
| 2 | `ScenarioRunner` (fixture copy, DB seeding, assertion harness) | ~200 |
| 3 | Cassette recorder/replayer + fingerprint + content-hash storage | ~180 |
| 4 | VS Code API fakes | ~150 |
| 5 | Redaction pipeline + `cassette:lint` CLI | ~80 |
| 6 | The 3 blocking scenarios + their cassettes | ~60 |
| 7 | Chaos injector (all 6 modes) | ~100 |
| 8 | GitHub Actions: Linux blocking + Windows smoke jobs | YAML only |

**Total harness production lines: ~890** — tight to the 800 target; milestone 7 may split chaos modes across v0.1.0/v0.1.1 if over.

---

## 15. GitHub Actions sketch

```yaml
name: scenarios
on: [push, pull_request]

jobs:
  linux:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: roadie } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm', cache-dependency-path: 'roadie/package-lock.json' }
      - run: npm ci
      - run: npm test
      - run: npm run cassette:lint

  windows:
    runs-on: windows-latest
    continue-on-error: true            # non-blocking in v0.1.0; blocking in v0.2.0
    defaults: { run: { working-directory: roadie, shell: bash } }
    steps: [ /* same as linux */ ]
```

---

## 16. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Overfitting to one fixture | High | Require ≥3 fixtures at release; each scenario must declare which fixture it uses |
| Cassette rot from template changes | High | `npm run test:scenarios:record` + `CONTRIBUTING.md` workflow; cassette diffs reviewed in PR |
| Redaction gap leaks secrets | Medium | `cassette:lint` CI gate + recommended `pre-push` git hook |
| Windows path drift | Medium | Fingerprint normalizes `\\` → `/`; Windows kept non-blocking in v0.1.0 |
| VS Code API fakes drift | Medium | `tsc --noEmit` against pinned `@types/vscode`; fakes re-reviewed on every vscode types bump |
| Flaky timeout chaos tests | Low | Use vitest `vi.useFakeTimers()` for timeout mode |
| LearningDatabase nondeterminism | Medium | Always seed in a **fresh** temp-path DB; never reuse real workspace DB |
| Cassette repo bloat | Low | Content files referenced by hash; `cassette:gc` drops unreferenced files before commit |
| Author records real secrets into a cassette | Low | Redaction is **write-side** (happens before disk); CI lint is defense-in-depth |

---

## 17. Release criteria

- [ ] `schema.json` validates every scenario; invalid scenarios fail CI
- [ ] ≥ 3 scenarios pass in replay on Linux blocking job
- [ ] ≥ 3 scenarios pass in replay on Windows smoke job (non-blocking)
- [ ] `cassette:lint` passes on 100 % of committed cassettes
- [ ] A deliberate template change demonstrably fails the golden prompt regression test
- [ ] `npm test` total ≥ 642 (637 existing + 2 unit + 3 scenarios)
- [ ] Zero changes to `src/**`
- [ ] Harness production lines ≤ 800 (or a documented waiver)
- [ ] `CONTRIBUTING.md` has a scenario-authoring section
- [ ] Recording mode verified manually by one contributor (not CI)

---

## 18. Rollback plan

The harness is additive and isolated under `test/harness/` plus two new npm scripts. To disable:

1. Remove the `scenarios-linux` / `scenarios-windows` jobs from the GHA workflow.
2. Rename `test/harness/scenario.test.ts` → `scenario.test.ts.disabled` so vitest skips it.
3. (Optional) Remove `ajv`, `ajv-formats` from `devDependencies`.

No production code to revert. No database migrations. No user impact.

---

## 19. Next steps

1. Approve **§5 schema**, **§6 cassette format**, and **§7 fingerprint algorithm** in this plan before any code lands — changes after approval are expensive.
2. Ship **milestone 1** (schema + Ajv + one sample) as its own PR; must land before any scenario author can work.
3. Ship milestones 2–4 as a second PR (runner + recorder + fakes).
4. Ship milestones 5–8 together (redaction + scenarios + chaos + CI).
5. After **one week** of stable green CI on both jobs, promote Windows to blocking → tag as **v0.2.0** of the testing engine.
