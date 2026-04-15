# Changelog

All notable changes to the Roadie VS Code extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing pending.

## [0.7.8] — 2026-04-15 — Marketplace listing polish

### Changed
- Refined Marketplace metadata in `package.json` (display name + short description) for clearer
  discovery and listing readability.
- Refreshed `images/icon.png` to improve visibility in the Marketplace card and VS Code extension list.
- Polished `README.md` with a clearer Features section and release-facing listing notes.

## [0.7.7] — 2026-04-15 — Marketplace-ready package

### Added
- Added license, homepage, bugs, icon, and galleryBanner fields to `package.json`.
- Created a placeholder `images/icon.png` for Marketplace packaging.
- Added marketplace-readiness checks in `scripts/doctor.js` for icon presence,
  `.vscodeignore`, license metadata, and keyword count.

### Changed
- Trimmed extension keywords to 5 and kept publisher `roadie` for Marketplace discoverability.
- Patched `.vscodeignore` to exclude `docs/` and `scripts/` while explicitly keeping README,
  CHANGELOG, and images in the VSIX.
- Updated README installation guidance for Marketplace users and added Requirements
  plus Known limitations / feedback sections.

## [0.7.6] — 2026-04-15 — Testing Engine v0.1.1

### Added
- Unit tests for `LearningDatabase.getWorkflowCancellationStats()` covering empty history,
  cancellation aggregation, and the database-layer contract before classifier filtering.
- Shared workflow-structure coverage now asserts explicit `contextScope` values for all
  sequential workflow steps.
- Scenario harness support for `faultInjection.mode = "throw"`, plus optional
  `expect.faultExpected` schema coverage for early-stop scenarios.
- `#roadie` variable resolver coverage now asserts the returned `ChatVariableLevel.Full`
  shape contract.

### Fixed
- Bug-fix workflow steps missing explicit `contextScope` values now declare them directly.
- `test/harness/scenarios/fix-null-pointer.json` now exercises the implemented throw fault path
  and no longer expects downstream mutations after an injected step-2 failure.

## [0.7.5] — 2026-04-15 — Fixture Coverage Expansion

### Added
- `test/fixtures/mixed-js-ts/` — fixture for mid-migration JS+TS projects.
- `test/fixtures/nested-monorepo/` — fixture for monorepos with `packages/*/src/` layout.
- `test/harness/scenarios/mixed-js-ts-onboard.json` — onboard scenario against mixed fixture.
- `test/harness/scenarios/nested-monorepo-review.json` — review scenario against monorepo fixture.
- Two new `describe` blocks in `directory-scanner-calculator.test.ts` covering role assignment in both new fixtures.
- One new `it` in `project-analyzer-calculator.test.ts` verifying mixed-js-ts analysis does not throw.

### Fixed
- `test/harness/scenario-runner.ts`: made `cassette` field optional in `ScenarioSpec`
  interface to match the JSON schema change already made in v0.7.3.

## [0.7.4] — 2026-04-15 — Code Action Provider (Ctrl+. lightbulb)

### Added
- RoadieCodeActionProvider: pressing Ctrl+. on a function, class, interface,
  or const declaration in .ts/.tsx/.js/.jsx files now shows:
    • "Roadie: Document this" — pre-fills @roadie /document <Symbol> in chat
    • "Roadie: Review this"   — pre-fills @roadie /review <Symbol> in chat
    • "Roadie: Fix this"      — shown only when VS Code diagnostics are present;
                                pre-fills @roadie /fix <Symbol> in chat
- roadie._openChat internal command bridges code actions to the Chat panel.
- Symbol name extracted by backward keyword scan (no AST dependency).

### Changed
- extension.ts: registers RoadieCodeActionProvider for typescript, typescriptreact,
  javascript, and javascriptreact via vscode.languages.registerCodeActionsProvider,
  disposed through the existing container.
- package.json: roadie._openChat declared in contributes.commands with
  enablement: false (hidden from command palette).

### Known limitations (v0.7.4)
- Regex extractor does not handle exported arrow functions, destructured consts,
  class method shorthand, or TypeScript overload signatures; falls back to the
  nearest declaration above the cursor. AST-based extraction deferred to a future
  release.
- Action ordering in the Ctrl+. menu is VS Code-controlled and untested.

## [0.7.3] — 2026-04-15 — Testing Engine v0.1.0

### Added
- `npm run test:scenarios` script runs scenario integration tests in isolation.
- `.github/workflows/scenarios.yml` GitHub Actions job runs unit + scenario tests on push/PR.
- `CONTRIBUTING.md` documents how to write scenario JSON files, custom assertions, and fixtures.

### Fixed
- Dead `const workflow` variable at `chat-participant.ts:106` (slash-command branch) removed; the live declaration at line 139 was already correct.
- `cassette` field in scenario schema is now optional — scenario runner never required it and tests pass without cassette files on disk.

## [0.7.2] — 2026-04-15 — Chat Surfaces: Slash Subcommands + #roadie Variable

### Added
- @roadie /fix, /document, /review, /refactor, /onboard, /dependency slash
  subcommands: bypass intent classification and route directly to the named
  workflow. VS Code shows a dropdown when the user types "/" after "@roadie".
- #roadie chat variable: users can now type "#roadie" in any participant
  (including default Copilot) to inject the full Roadie project context
  (tech stack, patterns, commands) into the conversation.

### Changed
- chat-participant.ts: command-routing branch added before classification;
  extracts runWorkflow() helper to eliminate code duplication.
- extension.ts: registers the #roadie variable resolver on activation.
- package.json: slashCommands array added to chatParticipants[0] manifest entry.

## [0.7.0] — 2026-04-15 — Close the Local Learning Loop

### Added
- **Learning Loop (Pillar 1):** `IntentClassifier.adjustWithLearning()` boosts or penalises confidence using per-intent success/cancel rates from `LearningDatabase` (requires ≥ 5 runs to activate).
- **Hot-files injection:** For `onboard` and `review` intents, the 10 most-edited files are appended to the prompt via `buildContextWithHotFiles()`.
- **Pattern confidence boost:** `ProjectAnalyzer` consults `LearningDatabase` pattern observations and amplifies confidence for repeatedly-confirmed patterns (`confidence *= min(1.0, 1 + log10(count) * 0.1)`).
- **`roadie.showMyStats` command:** Opens a Markdown document with a per-intent stats table (run count, success rate, cancel rate, most-edited files).
- **`roadie.contextLensLevel` setting:** Enum (`off` | `summary` | `full`, default `summary`) passed through to the chat participant for future context-injection gating.
- **`pattern_observations` table:** New SQLite table tracking how often each detected pattern is re-confirmed; backed by `recordPatternObservation()`, `getPatternObservationCounts()`, and `getGenerationAcceptanceRate()` methods.
- **`simplified` flag on all 4 templates:** `generateClaudeMd`, `generateCursorRules`, `generateCopilotInstructions`, and `generatePathInstructions` all accept `{ simplified?: boolean }` to produce a lighter output for noisy repos.
- **Per-directory Cursor MDC files (Pillar 3B):** `generateCursorRulesDir()` emits `.cursor/rules/{dir}.mdc` with `alwaysApply: false` and a dir-scoped glob, wired into `FileGenerator.generateAll()`.
- **AGENTS.md learned-preferences enrichment:** The `learned-preferences` section now includes per-intent cancellation rates and per-file generation acceptance rates.

### Changed
- `ProjectAnalyzer` constructor accepts an optional `LearningDatabase` as the third argument; all three call sites in `extension.ts` now pass it.
- `FileGenerator.generateAll()` also runs `generateCursorRulesDirFiles()` alongside path-instructions.
- `GeneratedFileType` union extended with `'cursor_rules_dir'`.

## [0.6.2] — 2026-04-15 — Production Hardening

### Fixed
- Startup analysis now awaits completion and logs failures before activation finishes, preventing partial init state.
- `package.json` parsing is guarded against malformed JSON in dependency scanning.
- File generation write errors are caught and reported instead of crashing the generator pipeline.
- Learning database now closes the underlying SQLite handle cleanly and prunes snapshots with a single database query.
- Workflow execution validates that definitions include steps and step execution clamps invalid retry/timeout values.
- Intent classification regexes are hardened to avoid pathological backtracking.
- Chat participant no longer casts an empty object to `ProjectModel`; missing models now use a safe empty model stub.
- `roadie.*` configuration values are validated and invalid settings fall back to safe defaults.

### Added
- `docs/v0-6-2-hardening.md` documents the hardening plan, risk mitigations, and release criteria.

## [0.6.1] — 2026-04-15 — Hardening & Context Lens

### Fixed
- `roadie.getScanSummary`, `roadie.runWorkflow`, `roadie.doctor` commands no longer crash
  with TypeError on invocation (missing callbacks now stubbed in `extension.ts`).
- `priorityTrim` no longer returns an empty string when `maxTokens=0`; now returns `''` fast.
- `path-instructions` section id no longer contains a trailing-slash artifact from the
  `dirname+'/x'` trick; uses `basename(filePath, extname)` instead.
- `doctor.js` now checks `.github/instructions/` directory existence (5th generated family)
  and reports the correct count.
- Self-healing retry in `FileGeneratorManager` now passes `simplified=true` through the
  `FileTypeGenerator.generate` interface (was silently ignored before).

### Added
- Context Lens: the Roadie Output channel now logs the serialized `toContext()` snapshot
  (scope, approximate token count, full body) before every LLM call in chat-participant.
- New command `Roadie: Show Last Context` (`roadie.showLastContext`) focuses the Output
  channel and offers to copy the last context snapshot to clipboard.

## [0.6.0] — 2026-04-15 — Copilot Intelligence & Plug-and-Forget

### Added
- Generates `CLAUDE.md` (Claude Code workspace rules) and `.cursor/rules/project.mdc` (Cursor)
  automatically on init and on meaningful file changes.
- Per-directory `.github/instructions/{dir}.instructions.md` files for GitHub Copilot path
  scoping (up to 6 directories, gated on ≥ 3 source files).
- `AGENTS.md` now includes a `coding-standards` section (patterns ≥ 0.7 confidence),
  a `key-files` section (most-edited from snapshot history), and a `learned-preferences`
  section (per-workflow cancellation rate, shown after ≥ 5 runs).
- File watcher now triggers automatic regeneration of all context files on `HIGH`-priority
  or `DEPENDENCY_CHANGE` events — no manual rescan needed.
- Self-healing generation: if any template fails, retries with simplified (required
  sections only) output rather than leaving files empty.
- Per-step context scoping: each workflow step injects only the context slice it needs
  (`commands`, `stack`, `patterns`, `structure`), reducing prompt token waste.
- `LearningDatabase.getMostEditedFiles(limit)` and `getWorkflowCancellationStats()` methods.

### Changed
- `copilot-instructions.md` gains `project-overview` and `project-structure` sections.
- `toContext()` token trimmer now uses priority-ordered section dropping
  (commands → patterns → structure → stack) instead of a blunt character slice.

### Fixed
- Watcher events no longer cause generation loops — generated files (`AGENTS.md`,
  `CLAUDE.md`, `.cursor/rules/`, `.github/copilot-instructions.md`,
  `.github/instructions/`) added to ignore list in `change-classifier.ts`.

## [0.5.3] — 2026-04-15 — Chat Fallback LLM Fix

Chat participant now routes `general_chat` intents (unclear questions) through LLM
fallback with project context injection instead of echoing the prompt. Expanded
local classifier patterns to catch common onboarding triggers (how is, describe,
what is/are/does, responsibilities, structured). Resolves reported chat echoing issue.

### Fixed

- **Chat participant echoes for general_chat** — `@roadie` was returning
  `**Echo:** <prompt>` instead of calling the LLM. Wired up `request.model.sendRequest()`
  with `ProjectModel.toContext()` injected, so unclear intents get LLM answers with
  full project awareness.

- **Missing classifier patterns** — Added patterns for common onboarding phrasings:
  `/how is/i`, `/describe/i`, `/structured?/i`, `/responsibilit/i`,
  `/what (is|are|does)/i`. Intent classification now matches these before falling
  back to `general_chat`.

### Tests

- All 518 unit tests pass.
- Manual: `@roadie how is this project structured?` now routes to LLM + onboard intent.
- Manual: `@roadie any bugs in the power function?` classifies as bug_fix (confidence 0.8+).

## [0.5.2] — 2026-04-14 — Database Pipeline Fixes

Database inspection (2026-04-14) revealed that three core pipeline stages were
broken or missing, causing `detected_patterns` to always be empty, subdirectory
role assignments to be `null`, and `directoryRoles` in `last-scan.json` to
silently contain `undefined` entries. All 508 unit tests pass.

### Fixed

- **`detected_patterns` always empty** — `ProjectAnalyzer` never populated the
  `detected_patterns` SQLite table. Added `derivePatterns()` which converts the
  already-scanned tech stack and directory tree into `DetectedPattern[]` entries
  (language, testing framework, build tool, package manager, runtime, structure
  conventions). The model now holds 6–9 patterns after every scan.

- **`InMemoryProjectModel` missing `setPatterns()`** — The model had `setTechStack`,
  `setCommands`, and `setDirectoryTree` but no `setPatterns()`. The analyzer
  could never write patterns into the model. Method added with debounced-write
  behaviour identical to the other setters.

- **Subdirectory role inheritance broken** — `src/operations/` and other
  subdirectories under named directories (`src/`, `test/`) received `role=null`
  because `assignRole()` only matched the directory's own name. The scanner now
  applies inheritance: after the flat list is built, any node without a role
  checks if its immediate parent has an inheritable role (`source` or `test`)
  and adopts it. `src/operations` now correctly gets `role="source"`.

- **`directoryRoles` in `last-scan.json` contained `undefined`** — The
  `collectRoles` helper in `extension.ts` used `node.name` which does not exist
  on `DirectoryNode` (the property is `path`). Fixed to `path.basename(node.path)`
  so role groups contain real directory names.

### Added

- **Codebase dictionary entity extraction integrated into analysis pipeline** —
  `ProjectAnalyzer` now accepts an optional `EntityWriter`. When provided (i.e.,
  when SQLite is available), it scans all `.ts`, `.tsx`, `.js`, `.jsx` source
  files after dependency and directory scanning, extracting exported functions,
  classes, interfaces, types, enums, constants, and HTTP routes into the
  `codebase_entities` table. This powers code-aware `@roadie` chat responses.
  `EntityWriterImpl` is instantiated in `extension.ts` and passed to all four
  `ProjectAnalyzer` sites (startup, `roadie.init`, `roadie.rescan`, file watcher).

### Tests

- Added test: `src/operations/` inherits `role="source"` from `src/`
  (`directory-scanner-calculator.test.ts`)
- Added test: `getPatterns()` is non-empty after analysis, contains language
  and testing patterns (`project-analyzer-calculator.test.ts`)
- Added test: all detected patterns have confidence in (0, 1]
  (`project-analyzer-calculator.test.ts`)
- Total: 508 unit tests (was 505 in v0.5.1)

## [0.5.1] — 2026-04-14 — Post-Automated-Test Improvements

Changes driven by automated agent test run (2026-04-14). All 505 unit tests pass.

### Fixed

- **AGENTS.md missing commands section** — `AGENTS.md` was not including the project's npm commands (build, test, dev, lint). The generated file now has a `commands` section identical to the one in `copilot-instructions.md`. This was the "FAIL versus expected behavior" finding in Test 5.

- **Hash decision not logged** — The file generator now logs `reason=new|updated|unchanged|deferred` and the first 8 chars of the content hash on every generation decision, making it easy to understand why a file was or was not rewritten.

### Added

- **`roadie.doctor` command** — Environment health check. Verifies: workspace folder open, GitHub Copilot installed and active, SQLite persistence status, generated files on disk, project analysis run, last scan timestamp. Replaces all BLOCKED/PARTIAL test statuses that were due to output-channel visibility limits.

- **`roadie.getScanSummary` command** — Copies a machine-readable JSON summary to the clipboard after any scan. Also persists to `.roadie/last-scan.json`. Contains:
  - `techStack[]` — detected tech entries with name, version, category
  - `commands[]` — detected npm scripts
  - `directoryRoles{}` — source/test/config/static role assignments
  - `filesGenerated[]` — path, written, writeReason, hash for each file
  - `hashPolicy` — explains exactly what triggers vs. skips regeneration

- **`roadie.runWorkflow` command** — Shows an input box, converts the entered prompt to `@roadie <prompt>`, and copies it to the clipboard for pasting into GitHub Copilot Chat. Provides an automation-friendly entry point for workflow testing.

- **`writeReason` field on `GeneratedFile`** — New `WriteReason` type (`'new' | 'updated' | 'unchanged' | 'deferred'`). Every generated file result now includes a `writeReason` explaining the write decision.

- **AGENTS.md `directory-structure` section** — New section in `AGENTS.md` that maps directory names to their assigned roles (Source, Tests, Config, Static assets). Populated from the directory scanner on every generation.

- **`.roadie/last-scan.json`** — Written to the workspace root's `.roadie/` folder after every scan (startup, `roadie.init`, `roadie.rescan`, and file-watcher-triggered rescans). Machine-readable summary for external tooling and automation scripts.

### Improved

- **`roadie.init` and `roadie.rescan`** now both persist the scan summary after file generation.

- **File watcher re-scan** also persists the scan summary after triggered regeneration.

- **Structured hash-decision logging** — The file generator now logs why each file was skipped or written, including the hash and the note that version-only changes in `package.json` do not affect generated content.

### Tests

- Added 7 new tests in `file-generator.test.ts`:
  - `writeReason` is `'new'` on first write
  - `writeReason` is `'unchanged'` on identical rescan
  - `writeReason` is `'updated'` when content changes
  - AGENTS.md includes commands section (content contract)
  - AGENTS.md includes directory structure section (content contract)
  - AGENTS.md includes all 5 required section markers

- Updated `commands.test.ts` to cover 9 commands (was 6) and added tests for `roadie.getScanSummary`, `roadie.runWorkflow`, and `roadie.doctor` callbacks.

## [0.5.0] — Phase 1 + Phase 1.5 Complete

### Phase 1 — Active Mode

- **Types** (`src/types.ts`): All shared interfaces — WorkflowDefinition, WorkflowStep, AgentConfig, ProjectModel, StepResult, etc.
- **Intent Classifier** (`src/classifier/`): Two-tier classification — local keyword/regex (instant) + LLM fallback when confidence < 0.7. All 8 intent types: bug_fix, feature, refactor, review, document, dependency, onboard, general_chat.
- **Workflow Engine** (`src/engine/workflow-engine.ts`): FSM with states PENDING → RUNNING → COMPLETED/FAILED/PAUSED. Parallel step support via Promise.allSettled. Escalation on step failure.
- **Workflow Definitions** (`src/engine/definitions/`): All 7 workflows with full step definitions and prompt templates.
  - Bug Fix: 8 steps (locate → diagnose → fix → verify → scan siblings → fix siblings → regression guard → summary)
  - Feature: 7 steps (plan → backend → frontend → database → integrate → test → document)
  - Refactor: 5 steps
  - Review: 5 steps
  - Document: 4 steps
  - Dependency: 5 steps
  - Onboard: 4 steps
- **Agent Spawner** (`src/spawner/`): Spawns ephemeral subagents via VS Code Language Model API. Prompt builder with context injection. Tool registry per scope.
- **Project Model** (`src/model/project-model.ts`): In-memory model with tech stack, directory structure, patterns, commands. `toContext()` with token budgeting.
- **File Generator** (`src/generator/`): Generates `.github/copilot-instructions.md` and `AGENTS.md`. Section manager with HTML comment markers and append-below merge strategy.
- **Chat Participant** (`src/shell/chat-participant.ts`): Registered as `@roadie`. Routes to workflow or passthrough enrichment.
- **Status Bar** + **Commands**: Status indicator, `roadie.init`, `roadie.rescan`, `roadie.reset`, `roadie.stats`, enable/disable workflow history.
- **Schemas** (`src/schemas.ts`): Zod runtime validation for all trust-boundary data.
- **Tests**: Full unit and integration test coverage across all modules.

### Phase 1.5 — Passive Mode

- **File Watcher** (`src/watcher/`): Debounced (500ms), deduplicates events, classifies changes as HIGH (dependency) / MEDIUM (config) / LOW (source). Triggers re-analysis on HIGH or MEDIUM.
- **SQLite Persistence** (`src/model/database.ts`): Project model persisted to `.github/.roadie/project-model.db`. Tables: tech_stack, commands, directory_map, patterns.
- **Learning Database** (`src/learning/learning-database.ts`): Workflow history, file snapshots, section hashes. Opt-in via `roadie.workflowHistory`.
- **Edit Tracker** (`src/tracking/edit-tracker.ts`): Tracks developer edits to generated files. Opt-in via `roadie.editTracking`.
- **Codebase Dictionary** (`src/dictionary/`): Extracts and stores code entities (functions, classes, interfaces, routes, etc.) to SQLite. Queryable by path, name, or dependency graph.
- **SQLite fault tolerance**: If better-sqlite3 fails to load (ABI mismatch), extension degrades gracefully to in-memory-only mode.

### Infrastructure

- Bootstrap scaffold: `package.json`, `tsconfig.json`, `vitest.config.ts`, `tsup.config.ts`, ESLint + Prettier, `.vscode/launch.json`.
- Install/doctor scripts: `scripts/install.js`, `scripts/doctor.js`.
- Phase 2 verification stub: `scripts/verify-phase2.js` (gate for future MCP server).
