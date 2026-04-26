---
title: Roadie Hardening Plan
status: proposed
owner: solo-maintainer
created: 2026-04-21
target_completion: 2026-06-02 (6 weeks)
scope: roadie-App/src/** only (per repo CLAUDE.md ONE RULE)
mode: autonomous ("plug and forget") — hardening must preserve zero-touch operation
---

# Roadie Hardening Plan

> Roadie is a personal MCP Dev Tool / VS Code extension for Claude Code that runs autonomously.
> Because it writes files, shells out to git, loads dynamic plugins, and triggers itself on a 30-min loop
> **without a human in the loop**, every weakness compounds. A single bad execSync, malformed JSON, or
> unsigned plugin can corrupt the repo, leak secrets, or silently brick the autonomy loop.
> This plan hardens the blast radius so "plug and forget" is actually safe to forget about.

---

## 1. Threat Model (what we are hardening against)

| # | Threat | Likelihood | Impact | Where it bites |
|---|--------|-----------|--------|----------------|
| T1 | Shell/command injection via git args | Medium | High — arbitrary code exec in repo | `platform-adapters/git-service.ts`, `engine/workflow-engine.ts` |
| T2 | Untrusted dynamic plugin code | Medium | Critical — full node process access | `plugins/plugin-loader.ts` (`Function('url','return import(url)')`) |
| T3 | Corrupted state crashes autonomy loop | High | High — silent death of "plug and forget" | `engine/session-tracker.ts`, `.roadie/session-state.json` |
| T4 | Malformed skill / YAML frontmatter | High | Medium — skill registry lookup fails | `.roadie/skills/**.md` |
| T5 | Path traversal outside repo | Low | High — overwrites user files | `generator/file-generator.ts` (partially guarded) |
| T6 | Hanging network call blocks loop | High | Medium — loop stalls 30min+ | `context7-client.ts`, `firecrawl-client.ts` |
| T7 | SQLite / LanceDB corruption on crash | Medium | High — loses learning + vectors | `model/database.ts`, `engine/vector-store-service.ts` |
| T8 | Autonomous drift-remediation rewrites working files | Medium | Critical — destroys user work | `autonomy/autonomy-loop.ts` |
| T9 | Secret leakage in logs / telemetry | Low | High — credential exposure | logger, audit log, heartbeat telemetry |
| T10 | Dependency supply-chain | Low | High — transitive malicious pkg | `package.json` (esp. firecrawl, lancedb) |

---

## 2. Current Posture (from codebase audit)

**Good:**
- `file-generator.ts` has path-traversal + symlink guards (lines 113–148)
- `model/database.ts` backs up + recreates corrupt SQLite (lines 86–102)
- MCP logger redacts secrets; heartbeat + audit log already present
- Workflow engine retries and escalates per step

**Weak:**
- `execSync` with string-concatenated git args (no escaping)
- Dynamic `import()` via `Function()` constructor for plugins (no signature, no whitelist)
- `JSON.parse` on session state with no schema validation
- No network timeouts on Context7 / Firecrawl
- Vector store re-indexes without dedup — silent bloat
- Zero tests for `plugin-loader`, `git-service`, `session-tracker`, `autonomy/**`

---

## 3. Phased Workstreams

### Phase 1 — CRITICAL (Week 1, must ship first)

**Goal:** eliminate code-execution and state-corruption pathways before any new feature work.

| ID | Task | Files | Acceptance |
|----|------|-------|------------|
| P1.1 | Replace `execSync` templates with `execFileSync(cmd, args[])` for all git ops | `platform-adapters/git-service.ts`, `engine/workflow-engine.ts` | No string-interpolated shell commands remain; unit tests cover tag-name injection (`"; rm -rf"`), branch names with spaces/quotes |
| P1.2 | Validate git tag / branch / ref input against `/^[A-Za-z0-9._\-\/]{1,120}$/` before any git op | new `platform-adapters/git-ref-validator.ts` | Rejects `..`, spaces, `;`, `$`, backticks; rejection path logs + returns Err |
| P1.3 | Plugin allowlist-only (no signing in P1; defer crypto to P3). Maintain explicit allowlist in `src/plugins/allowlist.json` (checked in); load only plugins named in list; anything else → skip + audit log. Zero false security. | `plugins/plugin-loader.ts` | Unlisted/missing plugin → skip + audit; no theater HMAC |
| P1.4 | Zod schema for session state; on parse failure → quarantine corrupt file to `.roadie/state.corrupt.<ts>` + start fresh | `engine/session-tracker.ts` | Corrupt JSON no longer crashes loop; quarantine file exists after fault injection |
| P1.5 | Wrap autonomy loop cycle in per-module isolation (try/catch per sub-task, not per cycle) | `autonomy/autonomy-loop.ts` | One failing module does not skip the others in that cycle |
| P1.6 | MCP input validation at protocol boundary: validate all tool call payloads against schema (tool name, argument types, ranges) before dispatch | `src/index.ts` MCP server handler | Malformed tool call → returns structured error, does not crash or skip validation |
| P1.7 | Kill-switch env var: `ROADIE_DISABLE=1` makes MCP server a graceful no-op (returns "disabled" for all tool calls without executing). Cheap safety brake during rollout. | `src/index.ts` | ROADIE_DISABLE=1 deployed, all tool calls return "disabled" status, Claude Code is not broken |

**Exit criteria for Phase 1:** `npm test` green with new injection / corruption tests; `npm audit` shows no Critical/High; `ROADIE_DISABLE=1` tested and operational; MCP input validation tested with malformed payloads.

---

### Phase 2 — HIGH (Week 2–3)

**Goal:** prevent silent failures and resource exhaustion in the 30-min autonomous loop.

| ID | Task | Files | Acceptance |
|----|------|-------|------------|
| P2.1 | Add `AbortController` + 10s default timeout to all outbound HTTP | `platform-adapters/context7-client.ts`, `platform-adapters/firecrawl-client.ts`, any fetch in `deepseek` provider | No network call can block the loop > 10s; test with delayed-response mock |
| P2.2 | Exponential backoff retry (3 attempts, 1s/2s/4s, jittered) for idempotent network ops | same as P2.1 | Transient 5xx recovers; permanent 4xx fails fast |
| P2.3 | Vector store dedup on re-index (hash `path + content_sha`; delete old rows before insert) | `engine/vector-store-service.ts` | Re-indexing same file twice leaves row count unchanged |
| P2.4 | Skill frontmatter validation (Zod + YAML); malformed skills quarantined, not registered | `generator/**` + new `skills/skill-validator.ts` | Broken skill does not poison lookup; registry still loads remaining skills |
| P2.5 | Test coverage for: `plugin-loader`, `git-service`, `session-tracker`, `vector-store-service`, `autonomy-loop` | `src/__tests__/**`, `test/**` | Each hardened module ≥ 80% line coverage; `npm test -- --coverage` enforces |
| P2.6 | SQLite PRAGMA tuning: `busy_timeout=5000`, `synchronous=NORMAL`, `journal_mode=WAL` (already), `foreign_keys=ON` | `model/database.ts` | Concurrent reads during write no longer error; startup sets pragmas |

**Exit criteria:** coverage gate ≥ 80% for hardened modules; synthetic 10-loop soak run with network faults completes cleanly.

---

### Phase 3 — MEDIUM (Week 4–5)

**Goal:** safety rails on autonomy itself — the most dangerous feature.

| ID | Task | Files | Acceptance |
|----|------|-------|------------|
| P3.1 | Autonomy approval gates: drift remediation, dependency watcher, skill re-generation require `ROADIE_AUTONOMY_LEVEL` env (`observe` / `suggest` / `apply`); default `suggest` on first run | `autonomy/autonomy-loop.ts`, `autonomy/drift-detector.ts`, `autonomy/dependency-watcher.ts` | `observe` never writes; `suggest` emits proposals to `.roadie/pending/`; `apply` matches today's behavior |
| P3.2 | Pre-write git checkpoint with rollback metadata (tag + manifest of files touched) for every autonomy cycle that writes files. **Precondition:** stash dirty working tree before checkpoint (`git stash` + tag), apply stash after rollback. On dirty-tree detection, emit warning to audit log + decline to write unless `--force`. | `autonomy/autonomy-loop.ts`, `platform-adapters/git-service.ts` | `roadie rollback --cycle <id>` restores pre-cycle state; dirty tree during autonomy cycle logged as warning, no silent inclusion of unrelated changes |
| P3.3 | Atomic file writes (`write tmp → fsync → rename`) for session-state, project-model dumps, skill registry | `engine/session-tracker.ts`, `generator/file-generator.ts` | kill -9 mid-write leaves either old or new content, never partial |
| P3.4 | Audit log rotation: cap 10MB or 30d, whichever first; compress old | observability module | Log directory does not grow unbounded over 90d soak |
| P3.5 | Structured error codes (enum `RoadieErrorCode`) instead of stringly-typed errors in logs | new `types/errors.ts` | Every thrown Roadie error carries a code; logger serializes it |
| P3.6 | Secret-redaction pass on telemetry / heartbeat payload (not just logger) | `observability/**` | Injected fake secret into state never appears in heartbeat output |

**Exit criteria:** default `ROADIE_AUTONOMY_LEVEL=suggest` for new installs; rollback verified on real repo.

---

### Phase 4 — NICE-TO-HAVE (Week 6+)

| ID | Task | Notes |
|----|------|------|
| P4.1 | Dependency pinning + `npm audit --omit=dev` in CI; renovate bot weekly | catch supply-chain early |
| P4.2 | Symlink-loop detection in analyzer glob walk | `analyzer/**` |
| P4.3 | Self-diagnostic MCP tool (`roadie_health`) — reports pragmas, disk, last cycle, corruption flags | new `tools/health-check.ts` |
| P4.4 | Plugin signing with externalized key management: derive ROADIE_PLUGIN_KEY from system keychain (OS-specific) or require explicit `~/.roadie/plugin-signing-key` (outside repo, mode 0600); retire allowlist-only once in-place | `plugins/plugin-signer.ts` (new) |
| P4.5 | Property-based tests (fast-check) for path validators and git-ref validator | `src/__tests__/**` |

---

## 4. Invariants (regressions that must never land)

These are guardrails for future PRs — every change must preserve them:

1. No `execSync` or `spawnSync` with interpolated strings. Args are arrays. Always.
2. No `JSON.parse` on disk content without a Zod schema + quarantine-on-fail path.
3. No dynamic `import()` / `require()` of paths derived from user or plugin-supplied input without allowlist + signature check.
4. Every outbound network call has a timeout and a bounded retry.
5. Every autonomy-loop write path is preceded by a git checkpoint, and produces a rollback manifest.
6. Every new log site runs through the redaction helper — raw `console.log` is banned outside `src/cli/**`.
7. `.roadie/` is the only writable directory outside `src/`; no code may write above the repo root.

Add a lightweight `npm run lint:invariants` script (phase 2) that greps for `execSync(` / `JSON.parse(` / `Function(` and fails if unescorted.

---

## 5. Test Strategy

| Layer | Tooling | What it proves |
|-------|---------|----------------|
| Unit | Vitest | Individual validators, escapers, schemas behave correctly |
| Injection | Vitest + parametric | Shell metacharacters, path traversal, prototype pollution, giant JSON all rejected safely |
| Corruption | Vitest + fault injection | Truncated JSON, bad SQLite, partial writes all recoverable |
| Soak | scripted 10-cycle run with offline network + random kills | Autonomy loop self-heals; no leaked files; rollback works |
| E2E | `test/e2e/mcp-server-interaction.test.ts` expanded | MCP client round-trip unaffected by hardening |

Coverage target: ≥ 80% line on hardened modules; overall repo ≥ 70%.

---

## 6. Rollout & Risk

- **Rollout:** all changes behind the existing tsup build — no new infra. Version-bump minor for each phase.
- **Backwards compat:** `ROADIE_AUTONOMY_LEVEL` defaults to current behavior (`apply`) on existing installs for one version, then flips to `suggest` in the next major. Announced in the changelog.
- **Rollback:** each phase is independently revertable; phases do not share uncommitted state. Deploy with `ROADIE_DISABLE=1` as a kill-switch. If P1/P2 causes issues, set the env var and redeploy; no manual recovery needed.
- **P1.3 Plugin allowlist risk:** Only affects new/missing plugins; already-installed plugins continue to work (allowlist auto-populated on first run with `plugins/` contents). P4.4 (signing) is a non-breaking future capability.
- **P3.2 Dirty-tree risk:** Stashing unrelated changes before checkpoint can mask accidental changes. Mitigation: warning logged to audit trail; `--force` flag required if dirty; users can review stash before applying.
- **P4.4 Key management:** ROADIE_PLUGIN_KEY in `.env` is a non-starter (checked in). Only exfiltrate keys from system keychain (macOS Keychain, Windows Credential Manager, Linux pass/gpg-agent) or require explicit `~/.roadie/plugin-signing-key` (outside repo). Key rotation policy TBD.

---

## 7. Success Metrics

After Phase 3 ships, the following must all be true:

- Zero Critical/High `npm audit` findings.
- Fault-injection test suite (corrupt JSON, killed mid-write, unreachable network, injected shell metachars) passes.
- A 24-hour autonomous soak with randomly-killed child processes and flaky network produces no partial files, no orphaned tags, no crashes.
- `grep -rE "execSync\\(['\"]" src/` returns zero hits.
- Hardened modules ≥ 80% line coverage.
- Default install is `ROADIE_AUTONOMY_LEVEL=suggest` — no write happens without a checkpoint + manifest.

---

## 8. Out of Scope

- Multi-tenant / multi-user auth (Roadie is single-user by design).
- Network sandboxing (trust boundary is the user's machine).
- Claude Code protocol hardening (upstream concern).
- Extension marketplace distribution hardening (separate plan).

---

## 9. Critical Gaps Addressed (feedback revision)

1. **Plugin signing theater (P1.3):** Moved from crypto-signing to allowlist-only in P1; deferred proper key-management signing to P4.4 with externalized keys (system keychain or `~/.roadie/plugin-signing-key`, never in .env).

2. **P3.2 dirty-tree assumption:** Added git stash pre-checkpoint and dirty-tree detection with audit logging + `--force` flag. Prevents silent inclusion of unrelated changes in rollback tags.

3. **Coverage gate inconsistency (70% vs 80%):** Changed P2.5 to require 80% for hardened modules (matching §5). CI will enforce consistently.

4. **MCP input validation:** Added P1.6 to validate all tool call payloads at protocol boundary (tool name, argument types, ranges) before dispatch. Malformed calls return structured error instead of crashing.

5. **Kill-switch moved to Phase 1:** P1.7 implements `ROADIE_DISABLE=1` as an emergency brake — cheap to add, critical for safe rollout of dangerous changes. All tool calls return graceful "disabled" status if set.

---

## 10. Next Action

Open tracking branch `hardening/phase-1`, implement tasks in order:
1. **P1.1** (execFile conversion) — unblocks injection test suite
2. **P1.6** (MCP input validation) — boundary hardening  
3. **P1.7** (kill-switch) — safety brake
4. **P1.2–P1.5** — validators, schema, isolation

Commit + test each independently before moving to P2.
