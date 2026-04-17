# Roadie Test Strategy — Incremental Plan

**Slug:** `e2e-extension-tester-plan`
**Date:** 2026-04-16
**Status:** Draft — awaiting approval
**Target rollout:** 0.7.14 → 0.9.0 (Phase 0 lands in 0.7.14; see §4 for mapping)
**Revision:** 4 (restructured around Goal / Scope / Phases / Acceptance / Open decisions; implementation detail moved to appendices)

---

## 1. Goal

Add a test stack that catches the Roadie failure modes most likely to ship:

- provider / VS Code API contract drift
- manifest-vs-code wiring mistakes
- generated-file format regressions (`CLAUDE.md`, `copilot-instructions.md`)
- activation and workflow performance regressions
- upgrade and degraded-mode data loss
- intent-classifier quality drift over time

The existing 694 unit tests stay. This plan adds the layers above and around them.

## 2. Evidence: what has already shipped broken

| Version | Bug | Why unit tests missed | Defended in phase |
|---|---|---|---|
| 0.7.11 | `AgentSpawner` got `ModelResolver` instead of `ModelProvider` | Wiring done in `extension.ts`, mocked in every test | Phase 0 |
| 0.7.12 | Chat participant id in `package.json` ≠ `createChatParticipant()` | No test reads manifest against code | Phase 0 |
| 0.7.13 | `vscode.LanguageModelChatMessage.System()` does not exist | `vscode` module fully mocked | Phase 0 (contract) + Phase 3 (E2E) |
| 0.7.13 | Chat markdown reports `0/1` when workflow completed `7/7` | No test exercised the full chat-render path | Phase 0 |

Every test added for these bugs must fail on the pre-fix revision and pass on main. That check is in Phase 0's exit criteria.

## 3. Scope

**In scope:**

- Fast PR-gate tests: wiring, manifest, provider contract, file snapshots, performance budgets
- Nightly real-VS-Code E2E against min-supported and latest VS Code in parallel
- Nightly upgrade + degraded-mode coverage
- Weekly classifier accuracy evaluation

**Out of scope:**

- Visual regression testing of chat rendering
- Real Copilot-backed LLM verification on every PR (fake provider is the default; one real-LLM smoke is an open decision, §6)
- Mutation testing as a release-blocking gate (advisory only, see §5.3)
- Cross-platform E2E (Linux-only on CI; Windows is manual)

## 4. Phase plan

Phase numbers are rollout order, not version labels. Versions are shipping artefacts; phases can slide between versions without renumbering.

| Phase | Risk reduced | Target version | Adds to CI |
|---|---|---|---|
| 0 | Regression for the 4 already-shipped bugs | 0.7.14 | Wiring + manifest + provider-contract (PR gate) |
| 1 | Silent drift in generated user-visible files | 0.7.15 | File snapshots (PR gate) |
| 2 | Activation and workflow performance creep | 0.7.16 | Perf budgets, monitor-only for 2 weeks then blocking |
| 3 | Integration regressions visible only in real VS Code | 0.8.0 | E2E on min-supported + latest, nightly |
| 4 | User data loss on upgrade or degraded environment | 0.8.1 | Upgrade + chaos, nightly |
| 5 | Intent classifier accuracy drift | 0.9.0 | Eval harness, weekly |

Each phase is independently shippable. Work stops at any phase if value/cost shifts.

### Phase 0 — Shipped-regression protection

**Deliver:**

- `FakeModelProvider` behind `ROADIE_TEST_MODE` env var; `/* @__PURE__ */` marker for esbuild tree-shaking
- `scripts/verify-bundle.js` guard that fails `npm run package` if `FakeModelProvider` leaks into `out/extension.js`
- Wiring tests (target coverage: feature workflow end-to-end under real DI graph, slash-command routing, general-chat fallback, cancellation)
- Manifest-consistency tests (chat participant id, commands, activation events, slash-command map)
- Provider-contract spec shared by `VSCodeModelProvider` and `FakeModelProvider`, including a **`role: 'system'` round-trip** test — the specific shape check that would have caught v0.7.13

**Exit criteria:**

- Each of the four bugs in §2 has a regression test that fails on the pre-fix commit and passes on main (demonstrated, not asserted)
- PR gate runtime increase attributable to Phase 0 is under 15 seconds, measured over 10 PRs
- `verify-bundle.js` fails a deliberately polluted build

### Phase 1 — Generated artifact safety

**Deliver:**

- Snapshot coverage for every file produced by `FileGenerator`: `CLAUDE.md`, `copilot-instructions.md`, `.cursor/rules/*`, path-instructions
- PR-template checkbox: "I reviewed the snapshot diff"

**Exit criteria:**

- No `undefined` or empty placeholder leaks in any snapshot
- Template edits produce reviewable diffs, not silent changes
- A deliberately-broken template edit fails CI locally and on PR

### Phase 2 — Performance budgets

**Deliver:**

- Perf harness covering: extension activation, `ProjectAnalyzer.analyze`, first-token time for `@roadie` (with fake LLM), 7-step workflow wall time (scripted fake), `getWorkflowStats` on 1,000 records
- Median-of-5 measurement per run

**Exit criteria:**

- Monitor-only for 2 weeks after introduction: results logged to CI artifact, no gating
- After 2 weeks of stable baselines, promote to blocking with budgets set at p95 + 20% of observed baseline
- Budget changes require PR approval and a baseline rerun

### Phase 3 — Real VS Code E2E

**Deliver:**

- `vscode-extension-tester` suite running on VS Code `1.93.0` (min-supported) and `stable` (current), in parallel
- Target coverage: activation, `roadie.doctor`, `roadie.init`, chat-natural, slash autocomplete, slash submit, code-action lightbulb, persistence across reload
- Assertions prefer observable state (files exist, command registered, workflow `state: COMPLETED` in output channel) over exact markdown substrings. Substring checks kept only where they are the point of the test (e.g. "intent was classified as `feature`").

**Exit criteria:**

- Suite green on both VS Code versions for 7 consecutive nights on main before becoming release-blocking
- Tests run against the packaged VSIX, not source
- Average wall clock under 6 minutes per run (parallel matrix)

**Follow-through status (2026-04-17):** code-action lightbulb + persistence-across-reload are now real assertions backed by fixtures at `e2e/fixtures/workspaces/{code-action,persistence}/` (persistence DB seeded by `e2e/fixtures/seed-persistence-db.js`). One `it.skip` remains in `persistence.suite.js` — a documented fallback for a close-folder / re-open path that needs a handle-swap helper before it can be enabled.

### Phase 4 — Upgrade and degraded mode

**Deliver:**

- Upgrade retention: install v0.7.x VSIX, record workflow history, upgrade to current, verify history survives
- SQLite unavailable path (simulated ABI failure): extension activates, logs the condition, chat still works
- Corrupt DB path (truncated file): graceful fallback, no unhandled activation error
- Concurrent access: two VS Code windows on the same workspace, both invoke `@roadie`; assert no data corruption

**Exit criteria:**

- No unhandled activation failures across all four scenarios
- Workflow history survives every supported upgrade path
- Degraded paths are visible in the `Doctor` output (SQLite ✗)

### Phase 5 — Classifier evaluation

**Deliver:**

- Labelled dataset at `evals/classifier/dataset.jsonl`. Initial ~200 entries sourced from:
  - Existing intent-classifier test fixtures (53)
  - Repository issues tagged `misclassified`
  - Anonymised extracts from `workflow_outcomes` SQLite table (PII stripped, prompts truncated to 200 chars; pending open decision #1 below)
- Labelling process: two-person; any disagreement flagged and excluded pending review
- Weekly CI job: runs classifier on the dataset, produces a confusion matrix and macro-averaged top-1 accuracy
- Reports are **CI artifacts**, not committed files. A single `evals/trend.tsv` file appends one line per run (date, macro-acc, per-intent acc) and is committed

**Exit criteria:**

- Macro-averaged accuracy ≥ 80%
- No single intent below 60%
- A PR that drops macro-accuracy by more than 2 percentage points blocks merge unless overridden with written justification

## 5. Acceptance criteria

- **PR gate stays fast.** Green in under 60 seconds for at least 95% of PRs over any rolling 30-day window, measured after Phase 2 is blocking.
- **Every shipped bug earns a regression test** that demonstrably fails on the pre-fix commit.
- **Nightly E2E catches packaging/integration failures** that unit tests cannot: at least one bug per two releases that was caught by E2E before user reports (tracked in `docs/LESSONS.md`).
- **Upgrade tests prevent data-loss incidents.** Zero user-reported loss of workflow history across supported upgrade paths from v0.8.1 onward.
- **Classifier accuracy is measured, not assumed.** Weekly trend available; threshold breaches produce a tracked response, not a shrug.

### 5.1 Advisory, non-blocking items

- **Mutation testing.** One-time Stryker baseline run in Phase 3. Score posted to the PR as informational; not a gate. Rerun quarterly on a scheduled job. Target informational baseline: ≥70% on `classifier/`, `engine/`, `analyzer/`.
- **Prompt-injection defence tests** (README injection, path traversal in workspace paths). Live in the wiring tier as unit tests; tracked separately in SECURITY.md. Not release-blocking.

## 6. Open decisions

1. **Real Copilot in CI.** Default: fake-only for all tiers. One "real LLM" contract check on release candidates is attractive but needs a service-account secret and on-call for token expiry. Recommend: defer to Phase 3 review.
2. **Perf budgets: start blocking immediately or monitor-only?** Recommended: monitor-only for 2 weeks, then blocking. Adopted in §4 Phase 2.
3. **Eval report artefacts.** Recommended: CI artifact + committed `trend.tsv` only. No committed HTML. Adopted in §4 Phase 5.
4. **Fixture workspaces.** Recommended: dedicated `e2e/fixtures/workspaces/`. `roadie-test-calculator/` drifts with manual testing and shouldn't double as CI fixture.
5. **Mining workflow history for the classifier eval dataset.** Default: yes, with PII stripping and prompt truncation. Needs a one-line note in SECURITY.md and a privacy review. Alternative: start synthetic + volunteer submissions only, grow from there.

---

## Appendix A — Target test inventory

These are target coverage lists, not mandatory test names. Names will change during implementation; coverage should not.

**Wiring (W):** end-to-end feature workflow, bug-fix escalation path, slash-command routing, general-chat fallback, cancellation, manifest↔code consistency (participants, commands, activation events, slash-commands both directions).

**Contract (C):** `selectModels` return shape, vendor/family filters, send-request user/assistant/system round-trips (**C-system catches v0.7.13**), response shape, cancellation propagation, usage monotonicity.

**Snapshot (S):** every template output from `FileGenerator`.

**Performance (P):** activation, analyzer, first-token, workflow wall time, SQLite stats query.

**E2E (E):** activation, doctor, init, chat-natural, slash autocomplete, slash submit, code-action lightbulb, lightbulb-click-opens-chat, persistence across reload.

**Upgrade / chaos (U):** upgrade retention, SQLite-unavailable, DB corruption, concurrent windows.

**Injection (I):** README injection, manifest-name injection, path traversal.

## Appendix B — Directory layout

```
roadie-App/
├── src/
│   ├── shell/
│   │   ├── vscode-providers.ts
│   │   ├── fake-providers.ts                   (NEW)
│   │   └── __contract__/
│   │       ├── model-provider.contract.ts      (NEW, shared spec)
│   │       ├── fake.contract.test.ts           (NEW)
│   │       └── vscode.contract.test.ts         (NEW, runs under E2E)
│   ├── __integration__/                        (NEW)
│   │   ├── workflow-end-to-end.test.ts
│   │   ├── slash-command-routing.test.ts
│   │   ├── general-chat-fallback.test.ts
│   │   ├── cancellation.test.ts
│   │   ├── manifest-consistency.test.ts
│   │   └── prompt-injection.test.ts
│   ├── __perf__/                               (NEW)
│   └── generator/__snapshots__/                (NEW)
├── e2e/                                        (NEW)
│   ├── suites/
│   ├── chaos/
│   ├── fixtures/{workspaces,llm-scripts}/
│   └── helpers/
├── evals/                                      (NEW)
│   ├── classifier/{dataset.jsonl, run.ts}
│   └── trend.tsv
└── scripts/verify-bundle.js                    (UPDATED: FakeModelProvider grep)
```

## Appendix C — CI topology

- **PR gate** (required, <60s): L0 unit + L1 wiring + L2 contract + L3 snapshot + L4 perf (once promoted past monitor-only)
- **Nightly on main** (~10 min parallel): PR gate + L5 E2E × two VS Code versions + L6 upgrade/chaos
- **Weekly** (Sunday 03:00 UTC, ~5 min): L7 classifier eval
- **Release candidate**: full nightly + eval, all green
- **Quarterly scheduled**: L8 mutation testing, advisory only

## Appendix D — Risks and mitigations

| Risk | Mitigation |
|---|---|
| `FakeModelProvider` ships to users | `/* @__PURE__ */` + `verify-bundle.js` grep; CI fails package on leak |
| Perf budgets flake on shared CI runners | Median-of-5 per run; monitor-only for 2 weeks before blocking |
| Snapshot tests become `-u` rubber stamps | PR-template checkbox forcing explicit diff review |
| Chat panel selectors change in future VS Code | Pin min version; bump with one-scenario smoke first |
| E2E wall-clock creep as suites grow | 6-minute target per matrix cell; split into parallel jobs if exceeded |
| Eval dataset labelling subjective | Two-person with disagreement flagged; confusion matrix surfaces ambiguity |
| Classifier eval regresses on a cleanup PR | 2pp drop = merge block unless overridden with written justification |

---

Approval of this v4 commits us to Phase 0 only. Later phases are re-reviewed as we go.
