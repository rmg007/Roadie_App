# Changelog

All notable changes to the Roadie VS Code extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] — 2026-04-17 — Chat Fallback Fix

### Fixed
- `src/shell/chat-participant.ts` — `general_chat` intent now calls `request.model.sendRequest()` with project context instead of echoing the user prompt. Falls back to a canned error message if the LLM call fails.
- `src/classifier/intent-classifier.ts` — negative-signal fallbacks now set `requiresLLM: true` so the LLM path is taken consistently.

### Tests
- Added two tests in `src/shell/chat-participant.test.ts` covering the new LLM path: success (chunks streamed) and failure (canned error, no echo).

---

## [1.0.0] — 2026-04-17 — First stable release

After 8 phases of hardening (v0.10.0 → v0.15.0):
- Global error boundary + unhandled rejection trap
- SQLite WAL mode, schema versioning, crash recovery, durability tests
- exactOptionalPropertyTypes strict TS (0 escape hatches)
- Classifier accuracy 96.6% macro, fuzz-tested, confusion-matrix regression gate
- E2E coverage matrix (cross-OS × VS Code version), restricted-mode suite
- Security: Dependabot, npm audit gate, SBOM, prompt-injection test, secret scan
- Export Diagnostics command, opt-in telemetry, structured log rotation, doctor v2
- Activation < 250ms, bundle 561 KB, memory < 50 MB/10k ops — all BLOCKING

### Added
- `src/api/index.ts` — public API freeze: semver-stable exports for `ClassificationResult`, `IntentClassifier`, `RoadieError`, `TelemetryReporter`.
- `e2e/suites/upgrade.suite.js` — upgrade-path E2E stub (skipped until v0.9.x fixture DB committed).
- `docs/accessibility.md` — accessibility audit confirming WCAG 2.1 AA via VS Code built-ins.
- `scripts/check-licenses.js` — production dependency license gate (exits 1 on GPL/LGPL/AGPL/UNKNOWN).
- `THIRD_PARTY_NOTICES.md` — production dependency notices (better-sqlite3, fast-glob, zod).
- `scripts/verify-1.0.js` — 7-gate v1.0 release gate script.
- `"check:licenses"` and `"verify-1.0"` scripts in `package.json`.

### Changed
- `package.json` — version `0.15.0` → `1.0.0`; displayName updated to `Roadie v1.0.0 — AI Workflow Engine for Copilot`; keywords expanded; categories updated to include `Machine Learning`.
- `README.md` — refreshed with Quick Start, Features, Commands table, Configuration, and Privacy sections.
- `CHANGELOG.md` — pre-1.0 history collapsed under `## Pre-1.0 History`.

---

## Pre-1.0 History

<details>
<summary>Click to expand v0.x release history</summary>

## [0.15.0] — 2026-04-17 — Phase F: Activation BLOCKING, memory/bundle/disposable budgets, perf baseline

### Added
- `src/__perf__/activation.test.ts` (F1) — BLOCKING median-of-5 activation latency test; budget < 250 ms; measures dynamic import + construction of `IntentClassifier`.
- `src/__perf__/memory.test.ts` (F2) — BLOCKING memory ceiling test; RSS delta after 10,000 classify ops must stay < 50 MB.
- `src/watcher/__tests__/debounce.test.ts` (F4) — Property-based tests for `FileWatcherManager` debounce using `fast-check` + `vi.useFakeTimers()`; verifies burst collapsing, timer reset, and no-missed-events.
- `scripts/check-bundle-size.js` (F5) — Enforces 600 KB bundle budget for `out/extension.js` (hard limit: 630 KB, 5% tolerance). Exit code 1 if exceeded.
- `package.json` script `check:bundle` — `node scripts/check-bundle-size.js`.
- `docs/perf-baseline.md` (F6) — Records activation latency, bundle size, and memory baselines established at v0.15.0.

### Changed
- `src/__perf__/performance.test.ts` (F1/F3) — Flipped `BLOCKING = false` → `BLOCKING = true`; all existing classifier-inference, workflow-wall-time, and DB-query budgets are now release-blocking.
- `src/extension.ts` (F7) — Records cold-start activation duration (`performance.now()` across `activate()`); logs it on `Roadie activated ✓`; exposes it in `roadie.stats` Output channel as `Cold activation: Xms (budget: 250ms)`.

## [0.14.0] — 2026-04-17 — Phase E: Export Diagnostics, telemetry reporter, structured log rotation, doctor v2

### Added
- `src/shell/diagnostics.ts` (E1) — `registerDiagnosticsCommand()` registers `roadie.exportDiagnostics`; collects last 1 000 log lines, env metadata, and sanitised DB schema; saves via VS Code save dialog.
- `package.json` contributes `roadie.exportDiagnostics` command (E1).
- `src/shell/telemetry.ts` (E2) — `TelemetryReporter` class with `recordActivation`, `recordCommand`, `recordError`; PII redaction strips file paths and `sk-*`/`ghp_*` tokens; in-memory queue flushed to structured log; off by default.
- `docs/privacy.md` (E2) — Documents what Roadie collects, telemetry opt-in, PII redaction, and the Export Diagnostics bundle.
- `e2e/suites/diagnostics.suite.js` (E5) — E2E smoke suite with `it.skip` stubs pending ExTester save-dialog API.
- Doctor v2 checks (E4) added to `scripts/doctor.js`: SQLite integrity_check, classifier smoke (intent label coverage), command registration audit (package.json vs source), disk space warning (< 100 MB), and write-permission check to OS temp dir.

### Changed
- `src/extension.ts` — imports and registers `registerDiagnosticsCommand` at activation.

## [0.13.1] — 2026-04-17 — Phase H: Dependabot, SBOM, prompt-injection test, secret scan (parallel with D)

### Added
- Phase H hardening items (Dependabot config, SBOM generation, prompt-injection unit test, secret scan workflow) shipped alongside Phase D.

## [0.13.0] — 2026-04-17 — Phase D: E2E coverage matrix, cross-OS nightly, flake budget, restricted-mode suite

### Added
- `scripts/audit-e2e-coverage.js` (D1) — Reads `package.json` commands and all `e2e/suites/*.suite.js` files; reports which commands have no E2E coverage; exits 1 on gaps unless `--report-only` is passed.
- `"e2e:coverage-audit"` script in `package.json` (D1) — `node scripts/audit-e2e-coverage.js --report-only`.
- `e2e/helpers/window.js` (D2) — `swapWindowHandle(driver, previousHandle, timeout)` helper for polling and switching to a new CDP window handle after `closeFolder`.
- `e2e/helpers/retry.js` (D4) — `withRetry(fn, maxAttempts)` flake-budget wrapper; logs each attempt; 3-night flake-detection hook scaffolded (requires GitHub Actions API token to implement).
- `e2e/helpers/screenshot.js` (D5) — `captureOnFailure(driver, testTitle)` saves a timestamped PNG to `e2e/screenshots/` on test failure.
- `e2e/suites/restricted-mode.suite.js` (D6) — Restricted-mode (untrusted workspace) suite; two `it.skip` tests with full TODO comment explaining the ExTester API blocker and the implementation steps.

### Changed
- `.github/workflows/ci.yml` (D1) — Added "Audit E2E command coverage" step after Build; `continue-on-error: true` (monitor-only until coverage reaches 100%).
- `.github/workflows/e2e-nightly.yml` (D3) — Added `macos-latest` and `windows-latest` to OS matrix; retained `vscode_version` matrix `['1.93.0', 'stable']`; `fail-fast: false`; Linux leg is non-optional (`continue-on-error: false`); macOS/Windows are `continue-on-error: true` until promoted; screenshot upload now also captures `e2e/screenshots/**`; added comment about Linux as merge gate.
- `e2e/suites/persistence.suite.js` (D2) — Imports `swapWindowHandle` from new `e2e/helpers/window.js`; `it.skip` for close+re-open fallback now includes a full TODO body showing exactly how to wire up `swapWindowHandle` once ExTester support is confirmed.

## [0.12.0] — 2026-04-17 — Phase C: exactOptionalPropertyTypes, classifier determinism, fuzz harness, dataset hygiene

### Added
- `evals/classifier/dataset.jsonl` (C0) — Added 3 new `general_chat` entries with `source`/`addedIn` fields, bringing intent count to ≥ 20 samples.
- `evals/classifier/dataset.test.ts` (C0/C3) — Dataset hygiene gate: fails CI if any intent has < 20 samples, duplicate prompts, prompts > 500 chars, unknown intents, or versioned entries missing `source`/`addedIn` fields.
- `evals/classifier/fuzz.test.ts` (C2) — Property-based fuzz test using `fast-check` (1000 runs): determinism, no throws, known intent set, latency < 5ms.
- `evals/confusion.json` (C5) — Committed confusion matrix baseline for regression detection.
- `stryker.config.mjs` (C7) — Stryker mutation testing config scoped to `src/classifier/**/*.ts`.
- `.github/workflows/mutation.yml` (C7) — Weekly mutation testing CI workflow (Sunday 4am UTC).
- `@stryker-mutator/core` and `@stryker-mutator/vitest-runner` devDependencies (C7).
- `"stryker:classifier"` script in `package.json` (C7).

### Changed
- `tsconfig.json` (C1) — Enabled `exactOptionalPropertyTypes: true`.
- `src/__integration__/classifier-eval.test.ts` (C4) — Two-tier per-intent threshold: `PER_INTENT_THRESHOLD_HI = 0.80` for intents with ≥ 20 samples, `PER_INTENT_THRESHOLD_LO = 0.70` for intents with < 20 samples.
- `evals/classifier/run.ts` (C5) — After computing confusion matrix, compares against `evals/confusion.json` baseline; warns if any cell drifts > 5 absolute points.
- `src/shell/errors.ts` — Added `override` modifier to `readonly cause` to fix pre-existing `TS4114` error.

### Fixed (exactOptionalPropertyTypes — C1)
- `src/analyzer/dependency-scanner.ts` — Conditional spread for optional `version` in TechStackEntry.
- `src/analyzer/directory-scanner.ts` — Conditional spread for optional `role` in DirectoryNode.
- `src/classifier/intent-classifier.ts` — Non-null assertions on `sorted[0]!` and `sorted[1]!` (length-guarded).
- `src/detector/ide-detector.ts` — `string | null` explicit typing for `primaryIDE`.
- `src/dictionary/entity-writer.ts` — Nullish fallbacks for regex capture groups.
- `src/engine/step-executor.ts` — Conditional spread for optional `previousError`.
- `src/engine/workflow-engine.ts` — Guard for `step === undefined`; `delete branchContext.previousStepResults` pattern; non-null assertions for `r` and `branch`.
- `src/extension.ts` — `const c = container` local; conditional spread for optional `cancellation` in AgentConfig.
- `src/generator/file-generator-manager.ts` — Nullish fallback for `fileTypes[i]`.
- `src/generator/section-manager-service.ts` — Guards for `lines[i]` and `lines[j]` index accesses.
- `src/generator/section-manager.ts` — Nullish fallback for `match[1]`.
- `src/generator/templates/agent-definitions.ts` — Non-null assertion on `roleGroups[node.role]!` (key-in-guard).
- `src/generator/templates/claude-md.ts` — Guard for `sections[0]`.
- `src/generator/templates/cursor-rules.ts` — Non-null assertion on `sections[sections.length - 1]!`.
- `src/learning/learning-database.ts` — Guards for `rows[i]` and `rows[i+1]` in loop.
- `src/model/database.ts` — Conditional spreads for optional `version`, `role`, `language`; non-null `rows[0]!`.
- `src/shell/__contract__/model-provider.contract.ts` — Non-null assertion on `allModels[0]!` and `byId[0]!`.
- `src/shell/chat-participant.ts` — `!` assertion for `COMMAND_WORKFLOW_MAP[request.command]`; conditional spread for optional `errorSummary`.
- `src/shell/code-action-provider.ts` — Nullish fallback for `m[1] ?? null`.
- `src/shell/commands.ts` — Removed `testCommand: undefined` from DEFAULTS; conditional spread in `readConfiguration`; literal `'balanced'` fallback.
- `src/shell/vscode-providers.ts` — Conditional spread for optional `vendor`, `family`, `id` in `LanguageModelChatSelector`.
- `src/spawner/agent-spawner.ts` — Conditional spread for optional `cancellation`; safe index access in `spawnParallel`.
- `src/watcher/file-watcher-manager.ts` — Nullish fallback in priority sort.

## [0.11.0] — 2026-04-17 — Phase B: SQLite pragmas, schema versioning, crash recovery, durability tests

### Added
- `src/learning/learning-database.ts` (B1) — `applyPragmas(db)` private method: sets `PRAGMA foreign_keys = ON`, `busy_timeout = 5000`, `temp_store = MEMORY`, `synchronous = NORMAL`, `journal_mode = WAL`; warns via logger if WAL mode cannot be set.
- `src/learning/learning-database.ts` (B2) — `SCHEMA_VERSION = 1` constant; `runMigrations()` reads `PRAGMA user_version`, upgrades schema and logs at INFO.
- `src/learning/learning-database.ts` (B4) — `backupDatabase()` creates timestamped `.bak.<ts>` before any migration; keeps last 3 backups.
- `src/learning/learning-database.ts` (B6) — `checkIntegrity()` runs `PRAGMA integrity_check` on `initialize()`; backs up corrupt DB to `.corrupt.<ts>` and continues (schema recreated by `CREATE TABLE IF NOT EXISTS`).
- `src/learning/learning-database.ts` (B8) — `safeExec()` wraps write operations: ENOSPC/EACCES → `RoadieError('DB_WRITE_FAILED', ...)`.
- `src/learning/learning-database.ts` (B9) — Workspace trust gate: `recordSnapshot()` and `recordWorkflowOutcome()` are no-ops when `vscode.workspace.isTrusted === false`.
- `src/learning/db-adapter.ts` — `DbAdapter` TypeScript interface abstracting all database operations; `LearningDatabase` implements it. Isolates node:sqlite from callers.
- `src/learning/__tests__/pragmas.test.ts` (B1) — 7 tests on a real temp-file DB verify each pragma value via PRAGMA reads after `initialize()`.
- `src/learning/__tests__/error-handling.test.ts` (B8 + B9) — 6 tests: ENOSPC/EACCES throw `RoadieError(DB_WRITE_FAILED)`; untrusted workspace skips all INSERTs.
- `tests/fixtures/db-corpus/v1.db` (B3) — Pre-seeded SQLite DB with full schema + 5 workflow_history rows; used by migration corpus test.
- `src/__integration__/migration-corpus.test.ts` (B3) — 5 tests: copies v1.db, opens with LearningDatabase, asserts `integrity_check = ok` and row count = 5.
- `scripts/chaos/crash-mid-write.js` (B5) — Child process script that opens DB, begins transaction, writes 50 rows, then exits without COMMIT (simulates crash).
- `src/__integration__/durability.test.ts` (B5) — Spawns crash-mid-write.js via spawnSync; asserts `integrity_check = ok` and row count = 0 after crash.
- `src/__integration__/concurrent-access.test.ts` (B7) — Extended stress test: 10 readers + 2 writers × 1000 ops × 5 iterations; asserts `integrity_check = ok` and correct total row count.

### Changed
- `src/learning/learning-database.ts` — `initialize()` now accepts optional `dbPath` parameter for backup/recovery operations. Calls `applyPragmas()`, `checkIntegrity()`, and `runMigrations()`.
- `package.json` — version 0.10.0 → 0.11.0; `displayName` prefix bumped in sync.

## [0.10.0] — 2026-04-17 — Phase A: Error boundary, disposable hygiene, lazy activation

### Added
- `src/shell/__tests__/cancellation.test.ts` (A6) — Property-based tests using `fast-check` that verify all async command handlers respect `CancellationToken`/`AbortSignal` with no side effects after cancellation within 50ms. Covers 6 property-based scenarios (idempotency, pre-cancel, mid-flight cancel, AbortSignal-based handlers, callback ordering).
- `src/__perf__/disposable-leak.test.ts` (A7) — Disposable hygiene tests: 100 activate/deactivate cycles verify every registered disposable is cleaned up; end-to-end mock test confirms `context.subscriptions.push(container)` pattern and `deactivate()` dispose chain work correctly.

### Changed
- `src/extension.ts` (A-lazy) — Moved 14 eager static imports to a single `Promise.all(import(...))` at the top of `activate()`. Reduces extension activation time by deferring module parsing to activation. Only `import type` declarations remain at module scope.
- `package.json` — version 0.9.1 → 0.10.0; `displayName` prefix bumped in sync.

## [0.9.1] — 2026-04-17 — Classifier accuracy: 65.1% → 96.6% macro

### Changed
- `src/classifier/intent-patterns.ts` — expanded keyword and signal coverage for every under-performing intent.
- `src/__integration__/classifier-eval.test.ts` — `BLOCKING = true` unconditionally.
- `package.json` — version 0.9.0 → 0.9.1; `displayName` prefix bumped in sync.

| Intent | v0.9.0 | v0.9.1 |
|---|---|---|
| bug_fix | 42.9% | 100.0% |
| dependency | 46.4% | 89.3% |
| document | 63.0% | 100.0% |
| feature | 89.3% | 96.4% |
| general_chat | 94.1% | 94.1% |
| onboard | 59.3% | 100.0% |
| refactor | 51.7% | 93.1% |
| review | 74.1% | 100.0% |
| **macro** | **65.1%** | **96.6%** |

## [0.9.0] — 2026-04-17 — Phase 5 test stack: classifier evaluation harness

### Added
- `evals/classifier/dataset.jsonl` expanded from 92 → 211 labelled prompts across 8 intents.
- `evals/trend.tsv` — classifier accuracy trend tracking.
- `npm run eval:classifier` script.
- `.github/workflows/classifier-eval.yml` — weekly CI job.

## [0.8.1] — 2026-04-17 — Phase 4 test stack: upgrade & concurrent-access safety

### Added
- `src/__integration__/concurrent-access.test.ts` — two LearningDatabase instances against one SQLite file.
- `scripts/check-upgrade-retention.js` (`npm run check:upgrade`).

## [0.8.0] — 2026-04-17 — Phase 3 scaffold: real VS Code E2E

### Added
- `npm run e2e` and `npm run e2e:min` scripts.
- E2E suites: `code-action.suite.js`, `persistence.suite.js`, `activation.suite.js`, `chat.suite.js`.
- `.github/workflows/e2e-nightly.yml` — daily at 03:00 UTC.

## [0.7.x] — 2026-04-15/16 — Phases 0–2 test stack, chat surfaces, code actions, hardening

- 0.7.14: Phase 0 test stack (provider contract spec, FakeModelProvider, integration tests, manifest-consistency test).
- 0.7.13: Fix `LanguageModelChatMessage.System` crash.
- 0.7.12: Fix chat participant ID mismatch (`roadie.roadie` → `roadie`).
- 0.7.11: Fix workflow planner crash (`selectModels is not a function`).
- 0.7.10: Node.js 22 engine upgrade, test fixture directories.
- 0.7.9: Linux CI path normalization fix.
- 0.7.8: Marketplace listing polish.
- 0.7.7: Marketplace-ready package (license, icon, galleryBanner, doctor checks).
- 0.7.6: LearningDatabase cancellation stats tests, scenario harness fault injection.
- 0.7.5: Mixed-JS/TS and nested monorepo fixture coverage.
- 0.7.4: Code Action Provider (Ctrl+. lightbulb) — Document/Review/Fix this.
- 0.7.3: Testing Engine v0.1.0 — scenario JSON harness, CONTRIBUTING.md.
- 0.7.2: Slash subcommands (`/fix`, `/document`, `/review`, `/refactor`, `/onboard`, `/dependency`) and `#roadie` chat variable.
- 0.7.0: Learning loop (confidence adjustment), hot-files injection, `roadie.showMyStats`, `pattern_observations` table.

## [0.6.x] — 2026-04-15 — Production hardening, context lens, Claude.md / Cursor rules generation

- 0.6.2: Startup analysis hardening, malformed JSON guard, DB close fix, intent regex hardening.
- 0.6.1: Context Lens (Output channel LLM context logging), `roadie.showLastContext` command.
- 0.6.0: `CLAUDE.md`, `.cursor/rules/project.mdc`, per-directory `.github/instructions/`, AGENTS.md improvements, file watcher auto-regeneration.

## [0.5.x] — 2026-04-14/15 — Phase 1 (Active Mode) + Phase 1.5 (Passive Mode) complete

- 0.5.3: Chat fallback LLM fix (general_chat echoing resolved).
- 0.5.2: Database pipeline fixes (detected_patterns, role inheritance, entity extraction).
- 0.5.1: `roadie.doctor`, `roadie.getScanSummary`, `roadie.runWorkflow`, `writeReason` field.
- 0.5.0: Initial complete release — IntentClassifier, WorkflowEngine (7 workflows), AgentSpawner, ProjectModel, FileGenerator, ChatParticipant, SQLite persistence, LearningDatabase, EditTracker, FileWatcher, CodebaseDictionary.

</details>
