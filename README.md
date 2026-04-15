# Roadie — The Invisible AI Workflow Engine

VS Code extension that makes GitHub Copilot smarter. Transforms chat into autonomous workflows: bug fix, feature development, refactoring, code review, documentation, dependency management, onboarding.

**Status:** Phase 1 (Active Mode) + Phase 1.5 (Passive Mode) complete — currently in private testing.

## Features

- Intent-aware workflow routing for bug fix, feature, refactor, review, document, dependency, and onboard tasks.
- Chat-first operation with both natural prompts (`@roadie ...`) and direct slash commands (`@roadie /fix ...`).
- Developer telemetry surfaces: workflow stats, per-intent success/cancel rates, hot files, and context snapshots.
- Automatic project context generation for Copilot and agent tools (`.github/`, `AGENTS.md`, path rules).
- Local-first design with optional SQLite persistence and graceful fallback when native SQLite is unavailable.

## What's New in 0.7.10

- Full Phase 1.5 (Passive Mode) completion: file watcher, persistence, generators, learning database
- 11 command palette commands with comprehensive project intelligence
- Workflow history and edit tracking with SQLite backend
- Enhanced chat interface with slash subcommands and context variables
- Code Actions integration for quick symbol-scoped workflows
- 7 artifact families auto-generated: copilot-instructions.md, AGENTS.md, CLAUDE.md, Cursor rules, path-scoped instructions
- Expanded configuration options: model preference, telemetry, edit tracking, test command override, context logging levels

---

## Installation

Install Roadie from the VS Code Extensions panel by searching for `Roadie` and clicking **Install**.

You can also install it from Quick Open (`Ctrl+P`) with:

```text
ext install roadie.roadie
```

If you need to sideload manually, install the latest `.vsix` release.

After install, reload the VS Code window and type `@roadie` in Copilot chat.

## Requirements

- VS Code 1.93+
- GitHub Copilot extension installed and active

## Known limitations / feedback

Roadie is still evolving; report issues or feedback through [GitHub Issues](https://github.com/rmg007/Roadie_App/issues).

Marketplace note: icon and listing updates can take several minutes to propagate globally due cache refresh delays.

## Release Tag Policy

For any Marketplace release, push a semantic version tag together with the release commit.

- Tag format: `vX.Y.Z` (example: `v0.7.8`)
- Keep `package.json` version and the git tag in sync
- Push with tags: `git push origin master --follow-tags`

If publish automation is enabled, only tagged pushes should trigger Marketplace publish.

Automation setup (one-time):

1. Add repository secret `VSCE_PAT` in GitHub (Settings -> Secrets and variables -> Actions).
2. The workflow `.github/workflows/publish-marketplace.yml` publishes on `v*` tags.
3. Keep the tag and `package.json` version identical (workflow enforces this).

## Health check

```bash
node scripts/doctor.js
```

Example output:

```
Roadie — doctor
package: C:\dev\Roadie\roadie-App

1. VS Code extension build
✓ out/extension.js exists

2. Marketplace readiness
✓ images/icon.png exists
✓ .vscodeignore exists
✓ license set to MIT
✓ keywords count is 5

3. Packaged .vsix
✓ roadie-0.7.10.vsix present

4. VS Code extension registration
✓ roadie.roadie is installed

5. Generated context files
✓ .github/copilot-instructions.md exists
✓ AGENTS.md exists
✓ .roadie/last-scan.json exists (with writeReason and hashPolicy)

6. Persistence layer
✓ SQLite database available (or graceful fallback)

All checks passed.
```

Exit code is 0 when everything is green, 1 otherwise.

---

## Command Palette (11 commands)

Open with `Ctrl+Shift+P` and type `Roadie`:

| Command | Description |
|---|---|
| `Roadie: Doctor` | Environment health check — workspace, Copilot, SQLite, generated files, last scan |
| `Roadie: Get Scan Summary` | Copy JSON summary of last scan to clipboard + write `.roadie/last-scan.json` |
| `Roadie: Run Workflow` | Quick-pick a workflow and get the matching `@roadie` usage prompt |
| `Roadie: Initialize` | Force full project scan + regenerate `.github/` files |
| `Roadie: Rescan Project` | Re-scan dependencies and scripts, regenerate if changed |
| `Roadie: Show Stats` | Display workflow history stats (requires workflow history enabled) |
| `Roadie: Show Last Context` | Show the most recent workflow context snapshot in Output and optionally copy it |
| `Roadie: Show My Stats` | Open a Markdown report with per-intent success/cancel rates, hot files, and top patterns |
| `Roadie: Reset` | Delete local database and reset all state |
| `Roadie: Enable Workflow History` | Start recording every `@roadie` run to SQLite |
| `Roadie: Disable Workflow History` | Stop recording `@roadie` runs |

### Workflow entry point

Use **Roadie: Run Workflow** to select a workflow and get a guided `@roadie` prompt in chat:
1. `Ctrl+Shift+P` → `Roadie: Run Workflow`
2. Pick one: `bug_fix`, `feature`, `refactor`, `review`, `document`, `dependency`, or `onboard`
3. Run it in Copilot Chat with `@roadie ...` or the matching slash subcommand (`/fix`, `/review`, etc.)

---

## Generated Files

After `roadie.init`, Roadie writes multiple context families (root + per-directory):

### `.github/copilot-instructions.md`
Populates GitHub Copilot's workspace context with:
- `tech-stack` — detected languages, frameworks, runtimes, build tools
- `commands` — npm/yarn/pnpm scripts (build, test, dev, lint, etc.)
- `patterns` — coding conventions detected from source (export style, test framework, etc.)

### `AGENTS.md`
Provides AI coding agents (Copilot, Cursor, etc.) with:
- `project-overview` — tech stack summary, auto-gen notice
- `commands` — same commands as `copilot-instructions.md`
- `agent-roles` — Diagnostician, Fixer, Planner, Reviewer, Documentarian
- `workflows` — Bug Fix (8 steps), Feature (7), Refactor (5), Review (5), Document (4), Dependency (5), Onboard (4)
- `directory-structure` — source/test/config/static role assignments per directory

### `CLAUDE.md`
Generates workspace-scoped guidance for Claude-compatible agent tooling.

### `.cursor/rules/project.mdc`
Generates project-level Cursor rules.

### `.github/instructions/*`
Generates path-scoped instruction files for subdirectories.

### `.cursor/rules/*.mdc` (per-directory)
Generates directory-scoped Cursor rule files for inherited context.

Both files use `<!-- roadie:start:section --> ... <!-- roadie:end:section -->` markers. Content outside markers is preserved on every regeneration.

### `.roadie/last-scan.json`
Written after every scan. Machine-readable summary containing `techStack`, `commands`, `directoryRoles`, `filesGenerated` (with `writeReason` and `hash` per file), and `hashPolicy` explaining exactly what triggers regeneration.

---

## Chat Usage

Type `@roadie` in GitHub Copilot Chat. Roadie classifies your intent and runs the appropriate workflow:

| Intent | Trigger examples | Workflow |
|---|---|---|
| Bug fix | `@roadie fix the login bug` | 8-step: Diagnostician → Fixer → Reviewer → Documentarian |
| Feature | `@roadie add export to CSV` | 7-step: Planner → Backend → Frontend → DB → Integrate → Test → Document |
| Refactor | `@roadie simplify the auth module` | 5-step |
| Review | `@roadie review error handling` | 5-step |
| Document | `@roadie document the Calculator class` | 4-step |
| Dependency | `@roadie upgrade react to v19` | 5-step |
| Onboard | `@roadie how does the payment flow work?` | 4-step |

### Slash commands

Roadie also supports direct slash routing from chat:

- `@roadie /fix ...`
- `@roadie /document ...`
- `@roadie /review ...`
- `@roadie /refactor ...`
- `@roadie /onboard ...`
- `@roadie /dependency ...`

### `#roadie` context variable

Use `#roadie` in chat to inject Roadie's current project context (tech stack, patterns, commands) into the conversation.

### Code actions (Ctrl+.)

In TypeScript/JavaScript files, Roadie contributes quick actions on detected symbols:

- `Roadie: Document this`
- `Roadie: Review this`
- `Roadie: Fix this` (when diagnostics are present)

---

## Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `roadie.modelPreference` | enum | `balanced` | `economy` / `balanced` / `quality` — controls starting model tier |
| `roadie.telemetry` | boolean | `false` | Anonymous aggregate telemetry (workflow types, success rates). No code or file names. |
| `roadie.testCommand` | string | `""` | Override auto-detected test command |
| `roadie.testTimeout` | number | `300` | Max seconds to wait for test suite (10–3600) |
| `roadie.workflowHistory` | boolean | `false` | Persist workflow outcomes to SQLite (Phase 1.5) |
| `roadie.editTracking` | boolean | `false` | Track edits to Roadie-generated files (Phase 1.5) |
| `roadie.autoCommit` | boolean | `false` | Auto-stage and commit generated files (Phase 1.5) |
| `roadie.contextLensLevel` | enum | `summary` | Output context logging level: `off`, `summary`, or `full` |

---

## Specification

This repository contains only the implementation. The canonical specification lives in a separate, sibling documentation repository:

- **Path:** `../Roadie_Project_Documentations_Only/`
- **Entry point:** `00_START_HERE.md`
- **Agent quickstart:** `AGENT_ENTRYPOINT.md`
- **Build runbook:** `03_Implementation_Specs_Phase_1/Module Build Order & Verification.md`

**Do not modify spec files from this repo.** The docs repo is the source of truth for all module contracts, workflow definitions, error taxonomy, and build order.

---

## Dev Environment

```bash
# Install dependencies
npm install

# Build (tsup)
npm run build

# Test (vitest — 674 tests)
npm run test

# Lint (ESLint + @typescript-eslint)
npm run lint

# Format (Prettier)
npm run format

# Launch Extension Development Host
# Press F5 in VS Code (uses .vscode/launch.json)
```

## What's Implemented

**Phase 1 — Active Mode**
- Intent classifier (8 intent types, two-tier local + LLM)
- Workflow engine (FSM, parallel steps, escalation)
- 7 workflow definitions: bug fix, feature, refactor, review, document, dependency, onboard
- Agent spawner with prompt builder and tool registry
- Project model (in-memory with SQLite backing)
- File generator for `.github/copilot-instructions.md` and `AGENTS.md`

**Phase 1.5 — Passive Mode**
- File watcher (debounced, priority-classified)
- SQLite persistence for project model and learning database
- Section manager (HTML comment markers, append-below merge strategy)
- Edit tracker (opt-in via `roadie.editTracking`)
- Workflow history logging (opt-in via `roadie.workflowHistory`)
- Codebase dictionary (entity extraction and queries)
- Expanded command surface: `roadie.doctor`, `roadie.getScanSummary`, `roadie.runWorkflow`, `roadie.showLastContext`, `roadie.showMyStats`
- `.roadie/last-scan.json` scan summary with `writeReason` and `hashPolicy`
- Pattern derivation from tech stack + directory structure
- Subdirectory role inheritance (e.g., `src/operations/` inherits `source` from `src/`)
- Chat slash subcommands for direct workflow routing (`/fix`, `/review`, etc.)
- `#roadie` chat variable for full context injection into any participant
- Code Action Provider integration for symbol-scoped document/review/fix prompts

**Phase 2 — MCP Server** — specified, not yet built. Deferred until testing of Phase 1/1.5 is complete.
