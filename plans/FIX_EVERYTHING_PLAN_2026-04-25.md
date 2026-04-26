# Fix Everything Plan (2026-04-25)

## Objective

Implement all critical and high-value fixes identified in the Questerix audit findings for checkpoint correctness, session-state integrity, dry-run/safe-mode behavior, config root resolution, vector-store churn, and observability diagnostics.

## Observable Truth (Done Criteria)

1. No successful checkpoint log is emitted when checkpoint commands fail.
2. Repositories without valid HEAD produce one checkpoint-skip warning and continue safely.
3. session-state persists valid string-only filesProcessed and normalized terminal phase.
4. Dry-run and safe-mode are enforced consistently across startup, generator, and git mutators.
5. Config is loaded from the actual target project root, not process cwd drift.
6. Reindexing does not unboundedly duplicate vector rows for unchanged files.
7. A new diagnostics MCP tool can report last-N cycle health summaries.
8. Tests cover all above behaviors and pass in CI.

## Workstream A: Checkpoint Correctness + Git Preflight (P0)

Files:

- src/platform-adapters/git-service.ts
- src/index.ts
- src/engine/workflow-engine.ts (optional consistency pass)

Changes:

1. Replace string-returning git command helper with structured result { ok, stdout, stderr, exitCode }.
2. Add preflight checks before checkpoint:

- repo validity
- HEAD availability (rev-parse --verify HEAD)

1. Change createCheckpoint return shape to structured status:

- created
- skipped_no_head
- skipped_not_git
- failed

1. Only log "Safety Checkpoint Created" when status is created.
2. Emit explicit failure/skip logs and audit events otherwise.
3. Ensure stash pop runs only if stash push actually succeeded.

Tests:

- New unit tests for git-service checkpoint paths (clean, dirty, no HEAD, non-git, stash/tag failure).
- Integration assertion from startup cycle that false-success log never appears on failures.

## Workstream B: Session-State Integrity (P0)

Files:

- src/engine/session-tracker.ts
- src/index.ts
- src/schemas.ts

Changes:

1. Add runtime validation + sanitizer for loaded state.
2. Force filesProcessed to string[] only; drop/null-filter malformed values.
3. Normalize finishSession to terminal phase (Completed) and consistent timestamps.
4. In indexing loop, only push valid filePath values.
5. Persist cycle health/error fields for diagnostics consumption.

Tests:

- New session-tracker tests for malformed JSON/state repair.
- Indexing loop tests for null/missing paths.

## Workstream C: Runtime Mode Unification (P1)

Files:

- src/config-loader.ts
- src/container.ts
- src/engine/step-executor.ts
- src/generator/file-generator.ts
- src/platform-adapters/git-service.ts
- src/index.ts

Changes:

1. Introduce single runtime mode resolver (normal/dry-run/safe-mode).
2. Stop duplicative env parsing across modules.
3. Pass effective mode to mutating services (file generator, git service, startup cycle).
4. Skip mutating git checkpoint actions in dry-run/safe-mode.
5. Log startup mode banner with effective target root and config path.

Tests:

- Config mode precedence tests (file vs env).
- Startup dry-run test verifies no git mutation attempted.
- Safe-mode write-allowlist tests.

## Workstream D: Config Root Awareness (P1)

Files:

- src/index.ts
- src/config-loader.ts
- src/container.ts
- src/generator/templates/mcp-config.ts
- src/generator/templates/claude-hooks.ts
- docs/MCP_REGISTRATION_GUIDE.md

Changes:

1. Parse project root from positional arg, --project flag, and ROADIE_PROJECT_ROOT fallback.
2. Make config-loader root-aware and keyed by project root.
3. Initialize config for resolved project root before service construction.
4. Keep generated launcher templates consistent with supported runtime parsing.

Tests:

- Arg parser tests for all root-resolution precedence cases.
- Config loader tests verifying external-root correctness.

## Workstream E: Vector Index Dedupe + Retention (P1)

Files:

- src/engine/vector-store-service.ts
- src/index.ts
- src/config-loader.ts
- src/observability/audit-log.ts

Changes:

1. Reindex strategy:

- detect unchanged file hash and skip
- replace or deactivate previous chunks for same file before add

1. Add retention controls:

- max versions per file
- max age
- optional max total chunks

1. Add maintenance task: periodic compaction/pruning.
2. Emit indexing metrics for inserted/replaced/skipped rows.

Tests:

- Reindex unchanged file should not grow rows.
- Reindex changed file should replace old active rows.
- Compaction should enforce retention policy.

## Workstream F: Observability + Diagnostics Tool (P2)

Files:

- src/observability/audit-log.ts
- src/index.ts
- src/tools/* (new diagnostics handler module)
- src/schemas.ts
- test/e2e/mcp-server-interaction.test.ts

Changes:

1. Extend audit taxonomy with cycle/checkpoint/indexing/session-sanitization event types.
2. Emit cycle correlation id and start/end summaries.
3. Add MCP tool: roadie_cycle_diagnostics

- Input: { limit?, maxAgeHours?, includeRawEvents? }
- Output: cycle summaries, checkpoint status, index stats, top errors, latest session state.

1. Register tool in list and call handlers.

Tests:

- Unit tests for audit query helpers and diagnostics aggregation.
- E2E tool listing and call assertions for diagnostics output shape.

## Parallel Execution Strategy

1. Wave 1 (parallel): Workstreams A + B + D.
2. Wave 2 (parallel): Workstreams C + E.
3. Wave 3: Workstream F + final integration tests.
4. Final gate: lint + typecheck + test + build.

## Risks and Mitigations

1. Risk: behavior drift in existing workflows.
Mitigation: structured result types and explicit compatibility fallbacks.

2. Risk: vector migrations may affect existing search quality.
Mitigation: keep backward-compatible read path and staged rollout with stats.

3. Risk: config root changes may break current users relying on cwd.
Mitigation: preserve fallback precedence and add explicit startup logging.

## Acceptance Verification Checklist

1. Run unit tests for git-service/session-tracker/config-loader/vector-store.
2. Run MCP e2e tests including diagnostics tool.
3. Manual smoke in a repo without initial commit:

- no false checkpoint success
- autonomous cycle still completes safely

1. Manual smoke in dry-run mode:

- no mutating git/file writes outside allowed policy

1. Confirm log and audit summaries include cycle id and checkpoint status.
