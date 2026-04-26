---
title: Roadie Hardening Plan V2
status: proposed
owner: solo-maintainer
created: 2026-04-25
target_completion: 2026-07-03 (10 weeks)
scope: roadie-App/src/** and release gates
mode: autonomous-compatible (preserve plug-and-forget behavior)
---

# Roadie Hardening Plan V2

This plan is a follow-on to the existing hardening work. It focuses on deterministic execution,
safe autonomy boundaries, and release-time safeguards so reliability improves even when the
assistant is running without human supervision.

## 1. Observable Outcomes

1. A malformed input, network timeout, or plugin issue cannot crash the entire cycle.
2. Any autonomous write can be traced, reviewed, and rolled back from one command.
3. Release pipelines block risky changes before publish.
4. Recovery from corruption is automatic and verifiable.

## 2. Why A Second Plan

The current hardening plan is threat-first and code-surface focused. V2 adds operations-first
controls: deterministic behavior under fault, stronger release gates, and measurable service-level
targets for a continuously running local MCP server.

## 3. Workstreams

## WS1. Deterministic Runtime Contracts (Weeks 1-2)

Goal: identical inputs produce bounded, predictable outcomes.

Tasks:
- Define and enforce timeout budgets for all external actions:
  - tool dispatch: 15s default, 45s max
  - network adapters: 10s default, 30s max
  - git operations: 8s default, 20s max
- Add a global cancellation policy object passed through workflow execution paths.
- Add a deterministic retry policy profile (idempotent-only retries, jitter, bounded attempts).
- Add an execution reason code to every failed step (timeout, validation, dependency, internal).

Acceptance:
- No blocking operation can run unbounded.
- A replay test of 100 deterministic fixtures has zero nondeterministic failures.

Files expected:
- src/engine/workflow-engine.ts
- src/engine/step-executor.ts
- src/types.ts
- src/platform-adapters/*.ts

## WS2. Autonomy Safety Envelope (Weeks 2-4)

Goal: autonomous actions are reversible and policy-controlled.

Tasks:
- Introduce policy levels for write actions:
  - observe: never write
  - propose: write proposals only under .claude/roadie/pending
  - apply: full writes with checkpoint
- Require pre-write checkpoint manifest for every autonomous file mutation:
  - cycle id
  - file list
  - content hashes before and after
  - rollback reference
- Refuse autonomous writes on dirty tree unless explicit override is configured.
- Add rate limits:
  - max writes per cycle
  - max files touched per cycle

Acceptance:
- Single command rollback restores all files from the latest write cycle.
- Dirty tree protection is enforced in integration tests.

Files expected:
- src/autonomy/autonomy-loop.ts
- src/autonomy/drift-detector.ts
- src/autonomy/dependency-watcher.ts
- src/platform-adapters/git-service.ts

## WS3. State Durability And Recovery (Weeks 4-6)

Goal: recover safely from partial writes, corrupted state, and process interruption.

Tasks:
- Standardize atomic writes in all persistence paths (temp file, fsync, rename).
- Add schema versioning and migrators for session and model state.
- Add quarantine directories for corrupted artifacts with metadata sidecar:
  - origin path
  - timestamp
  - parser error
  - attempted migration version
- Build startup integrity checks for:
  - session state
  - workflow snapshots
  - sqlite pragmas and readability

Acceptance:
- Crash injection during write yields either previous valid file or new valid file, never partial.
- Startup self-check completes under 2 seconds for normal local project sizes.

Files expected:
- src/engine/session-tracker.ts
- src/learning/learning-database.ts
- src/model/database.ts
- src/model/project-model-persistence.ts

## WS4. Plugin And Tool Governance (Weeks 6-8)

Goal: reduce plugin and tool execution risk without adding user friction.

Tasks:
- Keep explicit plugin allowlist with immutable metadata snapshot at startup.
- Add plugin capability declaration model:
  - read
  - write
  - shell
  - network
- Block undeclared capabilities at runtime with structured audit events.
- Enforce strict schema validation for all incoming tool payloads.
- Add deny-by-default path policy for writes outside project root and .claude/roadie.

Acceptance:
- Plugin with undeclared write capability is blocked and logged.
- Invalid tool payloads never reach execution layer.

Files expected:
- src/plugins/plugin-loader.ts
- src/index.ts
- src/generator/file-generator.ts
- src/schemas.ts

## WS5. Release Hardening Gates (Weeks 8-10)

Goal: hardening regressions cannot ship.

Tasks:
- Add hardening gate command and wire into verify pipeline:
  - invariant scan
  - audit threshold check
  - flaky test detector on critical suites
  - minimum coverage threshold for hardened modules
- Add fault-suite in CI:
  - corrupted json
  - timeout storms
  - dirty-tree autonomy write attempt
  - plugin capability mismatch
- Add release checklist requiring explicit sign-off on hardening metrics.

Acceptance:
- Release pipeline fails if any gate fails.
- At least one weekly scheduled fault-suite run is green before release.

Files expected:
- package.json
- test/e2e/**
- src/__tests__/**
- docs/PLAN.md

## 4. Metrics

- Mean time to recovery after cycle fault: <= 1 cycle
- Autonomous write rollback success rate: 100% on test scenarios
- Unhandled exception count in runtime log: 0 in 24-hour soak
- Hardened module coverage: >= 85%
- Critical or High vulnerabilities at release: 0

## 5. Suggested Execution Order

1. WS1 contracts and cancellation
2. WS2 autonomy envelope
3. WS3 durability and recovery
4. WS4 plugin governance
5. WS5 release gates and policy enforcement

## 6. Definition Of Done

V2 is complete when all workstreams meet acceptance, all gate checks are wired into verify,
and a 24-hour local soak run finishes with no unhandled exceptions and no unrecoverable state.