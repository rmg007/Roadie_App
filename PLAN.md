# Roadie MCP — Master Plan to "Beyond Production-Ready, Fully Autonomous, Chat-Only"

**Version target:** v0.12.0 → v1.0.0
**Horizon:** 6 phases, ship each phase independently
**Owner:** Solo (personal dev tool, used across your projects)
**Guiding principle:** *Plug-and-forget.* The user types in chat; Roadie does the rest.

---

## 0. Executive Summary

Roadie today (v0.12.0) is an MCP server with a 30-minute autonomous sync loop, a 7-state FSM workflow engine, 6 workflow definitions, 22 template generators, Context7 live-docs integration, a skill registry, and a learning database. It has 171 passing tests and a clean one-way dependency graph.

To reach **"chat-only, fully autonomous, beyond production-ready,"** three gaps must close:

1. **Intent → Action loop is not chat-native.** Today the MCP exposes tools the model calls explicitly. A chat-only experience needs automatic intent detection + workflow dispatch from the conversation itself, not tool invocation. This is the single biggest architectural shift.
2. **Autonomy is narrow.** The 30-min cycle only re-generates files. It does not detect regressions, fix stubs (refactor/review/document/dependency workflows are skeletons), pull new skills, or self-heal when workflows fail.
3. **Production-readiness has sharp edges.** No dry-run, no rollback, no config file, no structured logging, no offline/degraded mode, no install automation, tests missing for new modules (context7-client, skill-registry, patterns/structure/tech-stack/frontend-design/engineering-rigor templates).

The plan below closes these gaps in 6 phases, each shippable on its own.

---

## 1. Current State Inventory

| Area | Status | Evidence |
|------|--------|----------|
| MCP server (stdio) | Live | [src/index.ts:1](src/index.ts) |
| Prompts API | 2 prompts | summon_agent, roadie_onboard_tech |
| Tools API | 5 tools | resolve_library, fetch_docs, summon_agent, get_skill, sync_skills |
| Resources API | Live | roadie://skills/{category}/{name} |
| Autonomous cycle | 30 min loop, analyze + generate | [src/index.ts:58](src/index.ts) |
| Workflow engine | 7-state FSM, pause/resume, parallel | [src/engine/workflow-engine.ts](src/engine/workflow-engine.ts) |
| Workflow definitions | bug-fix, feature **complete**; refactor/review/document/dependency **stubs** | [src/engine/definitions/](src/engine/definitions/) |
| Project analyzer | Deps, dirs, conventions | [src/analyzer/](src/analyzer/) |
| Dictionary index | AST entity index | [src/dictionary/](src/dictionary/) |
| Learning DB | SQLite, workflow stats | [src/learning/](src/learning/) |
| Templates | 22 generators, section-manager diffing | [src/generator/templates/](src/generator/templates/) |
| Context7 client | Live HTTP to mcp.context7.com | [src/context7-client.ts](src/context7-client.ts) |
| Skill registry | Scans assets/skills/ | [src/engine/skill-registry-service.ts](src/engine/skill-registry-service.ts) |
| Tests | 171 files passing | vitest |
| Build | tsup, CJS only, Node 22+ | [tsup.config.ts](tsup.config.ts) |

**Total prod deps:** 4 (MCP SDK, better-sqlite3, fast-glob, zod) — lean and good.

---

## 2. Vision — What "Done" Looks Like at v1.0.0

**A user opens any project, starts a chat with their AI assistant (Claude/Copilot/Cursor), and says:**

> "Fix the login bug where sessions expire after 1 minute."

**Without any further input, Roadie:**

1. Classifies intent → `bug_fix` workflow.
2. Auto-dispatches the bug-fix workflow via MCP.
3. Locates the bug using the dictionary index.
4. Writes a failing test that reproduces it.
5. Fixes the code, re-runs the test.
6. Scans siblings for the same class of bug.
7. Commits with a generated message.
8. Reports a one-paragraph summary in chat.
9. Records the outcome in the learning DB for future prioritization.

**If anything fails, Roadie self-heals:** retries with a different model tier, falls back to a safer path, or surfaces a single clear question in chat ("I can't access the DB — approve a rollback to the last snapshot?").

**What the user NEVER does:** manually pick tools, name files, pick models, configure anything, wait on a sync, approve routine writes, copy outputs between windows.

---

## 3. Gap Analysis — Current → Vision

### 3.1 Chat-Only Interface Gap

Today, tools must be *called* (e.g. `roadie_summon_agent` with explicit args). The user's host-AI (Claude/Copilot) has to know when to call. That's not chat-only — it's tool-calling.

**Fix:** add a `roadie_chat` meta-tool that accepts a single natural-language message, runs intent classification server-side, and returns either (a) the streamed workflow result or (b) a single clarifying question. The host-AI's job shrinks to: "forward the user message to `roadie_chat`." A system-prompt snippet (auto-installed, see Phase 1) tells the host-AI to do exactly that.

### 3.2 Autonomy Gap

- **Incomplete workflows:** refactor, review, document, dependency are stubs.
- **No self-healing:** on step failure, workflow enters Failed state and stops. No retry-with-fallback-model, no alternate-path selection.
- **No proactive skills:** the 30-min cycle only regenerates files. It doesn't detect new deps and pull corresponding skills, doesn't warn on drift, doesn't auto-open remediation workflows.
- **No learning feedback:** LearningDatabase records outcomes but nothing reads them to re-rank workflow steps, skill relevance, or model choice.

### 3.3 Production-Readiness Gap

| Concern | Today | Needed |
|---------|-------|--------|
| Dry-run mode | None | `ROADIE_DRY_RUN=1` or per-tool flag |
| Rollback | Hash-diff skip only | Git checkpoint before each workflow |
| Config | Hardcoded | `.roadie/config.json` + env overrides |
| Structured logs | Plain string | JSON log lines, log level, log rotation |
| Offline mode | Context7 fails gracefully | Local skill cache, versioned snapshot |
| Install UX | Manual `npm i -g` + MCP host config | `npx roadie install` auto-writes MCP config |
| Cross-platform | Windows paths seen today | Verify Mac/Linux, CI matrix |
| Test coverage | 171 files, gaps | 100% of new modules + integration E2E |
| Security | No audit | Path traversal, secret redaction, eval-free |
| Performance | No benchmarks | Analyze-time SLO, generate-time SLO |
| Docs | README + CLAUDE.md | User guide, troubleshooting, architecture doc |

---

## 4. Phased Roadmap

Each phase ends with a shippable release. Each item has an acceptance criterion.

### Phase 1 — Chat-Only Foundation *(target: v0.13.0, ~1 week)*

**Goal:** One tool the host-AI calls. Roadie does intent + dispatch.

| # | Task | Acceptance |
|---|------|------------|
| 1.1 | Add `roadie_chat` MCP tool accepting `{ message, sessionId? }` | Tool visible in `tools/list`, schema in zod |
| 1.2 | Wire to `IntentClassifier` → route to `WorkflowEngine` | Unit test: 9 intents → correct workflow dispatch |
| 1.3 | Stream progress via MCP progress notifications | Host sees step-by-step updates |
| 1.4 | Return structured result `{ summary, files_changed, next_action? }` | JSON schema validated |
| 1.5 | Add `npx roadie install` CLI command | Writes MCP server entry to user's Claude/Cursor/Copilot config (detect which is installed) |
| 1.6 | Auto-install system-prompt snippet ("for any request, call `roadie_chat`") | Detectable via snippet-hash in host config |
| 1.7 | Session memory (SQLite) — resume interrupted workflows by sessionId | Pause → kill process → restart → `resume` works |

**Cut line:** if 1.5/1.6 slip, they go to Phase 2. 1.1–1.4 are the minimum.

### Phase 2 — Complete the Workflow Library *(v0.14.0, ~1 week)*

**Goal:** No more stub workflows.

| # | Task | Acceptance |
|---|------|------------|
| 2.1 | Implement `refactor.ts` workflow (Locate→Propose→Test→Apply→Verify→Commit) | `workflow.test.ts` passes all steps |
| 2.2 | Implement `review.ts` workflow (Diff→Lint→SecurityScan→Suggest→Report) | Reads `git diff`, reports SARIF-like output |
| 2.3 | Implement `document.ts` workflow (Scan→GenerateJSDoc→GenerateREADME→Diff→Commit) | Produces inline + README docs |
| 2.4 | Implement `dependency.ts` workflow (Audit→UpgradePath→Apply→TestSuite→Rollback-on-fail) | Auto-rolls back on test failure |
| 2.5 | Per-workflow "safety gate" config — which steps require approval | Default gates on: force-push, schema-migrate, mass-delete |
| 2.6 | Add step-level retry with model-tier fallback (Opus → Sonnet → Haiku) | On step failure, retry at next tier once before Failed |

### Phase 3 — Production Hardening *(v0.15.0, ~1 week)*

**Goal:** Safe to run unattended on real codebases.

| # | Task | Acceptance |
|---|------|------------|
| 3.1 | Global `--dry-run` / `ROADIE_DRY_RUN` — no writes, logs intended changes | Grep: zero `fs.writeFile` under dry-run test |
| 3.2 | Git checkpoint before every workflow (`roadie/autosave-<ts>` tag) | Recoverable via `roadie rollback` |
| 3.3 | `.roadie/config.json` schema + loader; env overrides | Zod schema validates; docs list all keys |
| 3.4 | Structured JSON logging (pino or custom) with levels + correlation-id | Every log line parseable JSON |
| 3.5 | Log rotation (10MB × 5) for `roadie.log` | Files capped |
| 3.6 | Secret redaction filter (API keys, tokens) in logs | Unit test: inject fake secret → not present in log output |
| 3.7 | Path-traversal guard on every generator write | Reject writes outside `projectRoot` |
| 3.8 | Tests for `context7-client.ts`, `skill-registry-service.ts`, patterns/structure/tech-stack/frontend-design/engineering-rigor templates | Coverage gate ≥85% for new modules |
| 3.9 | Cross-platform CI matrix (Win/Mac/Linux × Node 22/24) | GH Actions green across all 6 cells |
| 3.10 | Performance budgets — analyze ≤3s on medium repo, generate ≤2s | Benchmark suite added |

### Phase 4 — True Autonomy *(v0.16.0, ~1 week)*

**Goal:** Roadie notices things and fixes them without being asked.

| # | Task | Acceptance |
|---|------|------------|
| 4.1 | Drift detector — compare current generated files vs expected; open remediation workflow if diverged | "Drift detected" log + auto-fix |
| 4.2 | Dep-change watcher — on `package.json` change, auto-fetch matching Context7 skills, regen `tech-stack.ts`-driven sections | Measured: add a dep → skill appears within one cycle |
| 4.3 | Failure-pattern learner — query `LearningDatabase` for repeat failures, prioritize fixes in next cycle | `getTopFailingWorkflows()` implemented and consumed |
| 4.4 | Model-choice learner — record success rate per (workflow, step, model); pick best-performing model next time | `getOptimalModel(workflowId, stepId)` in ModelResolver |
| 4.5 | Self-healing sync loop — on cycle error, capture, classify, and open meta-workflow to fix Roadie itself (e.g. missing deps, schema mismatch) | Fault-injection test: corrupt DB → next cycle repairs |
| 4.6 | Skill hot-reload — `assets/skills/` file-watcher; no restart needed | Touch a .md → `listSkills()` shows it ≤1s later |
| 4.7 | Chat inbox — non-blocking user messages queued; Roadie reports when work's done via MCP notification | Host-AI surfaces "Roadie finished X" toast |

### Phase 5 — DX & Distribution *(v0.17.0, ~4 days)*

**Goal:** Install-and-go across machines/projects.

| # | Task | Acceptance |
|---|------|------------|
| 5.1 | `npx roadie install` supports Claude Desktop, Claude Code, Cursor, Copilot | Each host detected + configured |
| 5.2 | `roadie doctor` command — diagnoses Node version, DB integrity, Context7 reach, MCP host config | One command, pass/fail per check |
| 5.3 | `roadie upgrade` — pulls latest, runs migrations, keeps local config | Idempotent |
| 5.4 | Published to npm under `@rmg007/roadie` (or keep `roadie` if available) | `npm view` shows latest |
| 5.5 | CHANGELOG.md auto-generated from conventional commits | Each release has entry |
| 5.6 | README rewrite: 30-second install, gif/asciinema demo, troubleshooting | Test: new user installs in ≤2 min |
| 5.7 | Architecture doc — layer diagram, workflow FSM, data flow | Single Markdown, diagrams in Mermaid |

### Phase 6 — Beyond Production *(v1.0.0, ~1 week)*

**Goal:** Things nobody asked for but make it feel magical.

| # | Task | Acceptance |
|---|------|------------|
| 6.1 | Multi-project global brain — `~/.roadie/global-model.db` learns across projects; patterns from project A speed up project B | Measured: repeat-bug class detected across 2 projects |
| 6.2 | Workflow cost tracking — $ per workflow, surfaced in summary | Learning DB gains `cost_usd` column |
| 6.3 | Safe mode — whitelist-only writes; all other file ops need single-tap approval | Toggle in config |
| 6.4 | Audit log — append-only JSONL of every action (intent, steps, writes, commits, rollbacks) | `.roadie/audit.jsonl`, rotates daily |
| 6.5 | Telemetry opt-in — anonymous workflow success/failure counts, off by default | Explicit opt-in flag; local first |
| 6.6 | "Explain mode" — Roadie narrates *why* it chose a workflow, skill, or model | Flag; appends rationale to summary |
| 6.7 | Plugin API — users add custom workflows/templates under `.roadie/plugins/*.ts`, hot-loaded | Sample plugin in repo |
| 6.8 | E2E suite — spin up a sandbox repo, run 20 realistic chat prompts, assert end-state | Nightly CI job |

---

## 5. Architecture Changes Required

### 5.1 New modules

| Module | Purpose | Phase |
|--------|---------|-------|
| `src/chat/chat-gateway.ts` | `roadie_chat` MCP tool handler, intent → engine | 1 |
| `src/chat/session-store.ts` | Per-session state, resume keys | 1 |
| `src/install/host-detector.ts` | Find Claude/Cursor/Copilot configs | 1/5 |
| `src/install/host-writer.ts` | Safely edit host MCP config files | 1/5 |
| `src/safety/git-checkpoint.ts` | Pre-workflow tag + rollback | 3 |
| `src/safety/path-guard.ts` | Reject traversal | 3 |
| `src/config/config-loader.ts` | `.roadie/config.json` + env | 3 |
| `src/observability/logger.ts` | JSON, levels, rotation, redaction | 3 |
| `src/autonomy/drift-detector.ts` | Expected vs actual generated files | 4 |
| `src/autonomy/meta-healer.ts` | Self-repair on cycle error | 4 |
| `src/autonomy/model-learner.ts` | Success-rate → best model picker | 4 |
| `src/cli/doctor.ts`, `upgrade.ts`, `install.ts`, `rollback.ts` | CLI subcommands | 5 |
| `src/plugins/plugin-loader.ts` | Hot-load user plugins | 6 |

### 5.2 Module changes

- `src/index.ts` — add `roadie_chat` tool, wire session store, move autonomous cycle into `src/autonomy/sync-scheduler.ts`.
- `src/engine/workflow-engine.ts` — step-level retry, model-tier fallback, safety gates.
- `src/engine/model-resolver.ts` — consume `ModelLearner.getOptimalModel`.
- `src/generator/file-generator.ts` — honor `dryRun`, path-guard, emit audit event.
- `src/learning/learning-database.ts` — add `failure_reason`, `model_used`, `cost_usd`, `correlation_id` columns (migration).

### 5.3 Config schema (`.roadie/config.json`)

```json
{
  "syncIntervalMs": 1800000,
  "heartbeatIntervalMs": 14400000,
  "dryRun": false,
  "safeMode": false,
  "autoApprove": ["generate", "analyze", "document"],
  "requireApproval": ["force-push", "schema-migrate", "mass-delete"],
  "models": { "primary": "opus-4-7", "fallback": ["sonnet-4-6", "haiku-4-5"] },
  "context7": { "enabled": true, "timeoutMs": 5000 },
  "logging": { "level": "info", "format": "json", "rotate": { "maxBytes": 10485760, "maxFiles": 5 } },
  "telemetry": { "enabled": false }
}
```

---

## 6. Success Metrics (v1.0.0 gate)

| Metric | Target |
|--------|--------|
| Chat-only prompts handled end-to-end without user tool calls | ≥95% |
| Workflow success rate on realistic E2E suite | ≥90% |
| Median analyze time (medium repo, ~500 files) | ≤3s |
| Median full-generate time | ≤2s |
| Test coverage (new modules) | ≥85% |
| Test coverage (overall) | ≥75% |
| Cross-platform CI matrix | green × Win/Mac/Linux × Node 22/24 |
| Install → first successful workflow | ≤2 min |
| Mean time to recovery after a workflow failure | ≤1 cycle |
| Zero leaked secrets across all log fixtures | enforced |

---

## 7. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Host-AI (Claude/Cursor/Copilot) ignores "always use `roadie_chat`" prompt | Chat-only flow breaks | Make `roadie_chat` the only user-facing tool; mark others `hidden`. Accept that some hosts need a system-prompt bump at install. |
| Context7 outage | Skills stale | Local skill cache with versioned snapshots; cycle still runs |
| Git checkpoint tags pollute history | Repo noise | Namespace under `roadie/autosave/*`; prune older than 7 days on cycle |
| Better-sqlite3 native build fails on a target platform | Install break | Prebuild binaries (already done via bundleDependencies); fallback to `sqlite3` pure-js as last resort |
| Autonomy makes wrong call, commits bad code | User trust lost | Git checkpoint + `roadie rollback` is one command; safe-mode config; per-workflow approval gates |
| Learning DB corruption | Loop crashes | Startup validator + auto-rebuild from audit log (Phase 6) |
| Scope creep — "beyond PR" is infinite | Never ships | Strict phase cut lines; each phase shippable alone; v1.0.0 is the freeze point |

---

## 8. Out-of-Scope (Explicit Non-Goals)

- Multi-user / team features (this is personal).
- Web UI / dashboard (chat is the UI).
- Windows-only or Mac-only features.
- Pluggable LLM providers beyond what the host-AI already uses.
- Cloud sync of the learning DB (stays local; Phase 6 "global brain" is single-user cross-project).

---

## 9. Immediate Next Actions (this week)

1. Cut branch `feat/chat-gateway` from `master`.
2. Write tests for `roadie_chat` behavior (mock intent classifier, assert workflow dispatch) **before** code.
3. Implement `src/chat/chat-gateway.ts` + register tool in `src/index.ts`.
4. Ship v0.13.0-alpha.1 behind a feature flag; dog-food across 3 personal projects for 48h.
5. Parallel: add tests for untested new modules (context7-client, skill-registry, 5 new templates) — closes a Phase 3 gap early.

After v0.13.0 ships, revisit this plan; phases 2–6 may compress or expand based on dog-food findings.

---

## 10. File References

- Entry: [src/index.ts:1](src/index.ts)
- Autonomous cycle: [src/index.ts:58](src/index.ts)
- Workflow engine: [src/engine/workflow-engine.ts](src/engine/workflow-engine.ts)
- Workflow stubs (Phase 2): [src/engine/definitions/refactor.ts](src/engine/definitions/refactor.ts), [review.ts](src/engine/definitions/review.ts), [document.ts](src/engine/definitions/document.ts), [dependency.ts](src/engine/definitions/dependency.ts)
- New untested modules: [src/context7-client.ts](src/context7-client.ts), [src/engine/skill-registry-service.ts](src/engine/skill-registry-service.ts)
- New untested templates: [src/generator/templates/engineering-rigor.ts](src/generator/templates/engineering-rigor.ts), [frontend-design.ts](src/generator/templates/frontend-design.ts), [patterns.ts](src/generator/templates/patterns.ts), [structure.ts](src/generator/templates/structure.ts), [tech-stack.ts](src/generator/templates/tech-stack.ts)
- Package: [package.json](package.json)
- Build: [tsup.config.ts](tsup.config.ts)

---

*End of plan. Ship Phase 1. Iterate from signal, not speculation.*
