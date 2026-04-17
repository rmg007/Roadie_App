# Roadie v1.0.0 — The Invisible AI Workflow Engine

AI-powered workflow engine for VS Code. Transforms GitHub Copilot Chat into autonomous, structured workflows for bug fixing, feature development, refactoring, code review, documentation, dependency management, and onboarding.

## Quick Start

1. Install Roadie from the VS Code Extensions panel (search `Roadie`) or via Quick Open (`Ctrl+P`):
   ```text
   ext install roadie.roadie
   ```
2. Reload the VS Code window. Roadie auto-initializes and scans your project.
3. Open GitHub Copilot Chat and type `@roadie` followed by your request:
   ```
   @roadie fix the null-pointer crash in UserService
   @roadie /review src/api/routes.ts
   @roadie document the authentication module
   ```

**Requirements:** VS Code 1.93+, GitHub Copilot extension installed and active.

---

## Features

- **Intent-aware routing** — natural-language prompts automatically route to the correct workflow (bug fix, feature, refactor, review, document, dependency, onboard).
- **Slash subcommands** — bypass classification with direct commands: `/fix`, `/review`, `/document`, `/refactor`, `/onboard`, `/dependency`.
- **`#roadie` chat variable** — inject full project context (tech stack, patterns, commands) into any Copilot conversation.
- **Auto-generated context files** — on init, Roadie writes `.github/copilot-instructions.md`, `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/`, and per-directory path instructions for Copilot, Claude Code, and Cursor.
- **SQLite learning loop** — opt-in persistence tracks workflow outcomes, edits, and hot files. Confidence adjusts based on per-intent success/cancel rates.
- **Code Actions (Ctrl+.)** — on any function, class, or interface declaration, Roadie surfaces "Document this", "Review this", and "Fix this" quick actions.
- **Export Diagnostics** — one-command JSON bundle of logs, env, and DB schema for bug reports.
- **Opt-in telemetry** — off by default; anonymous, aggregate workflow events only. No code, file names, or project details ever sent.
- **Local-first** — all persistence is local SQLite. No cloud dependency.

---

## Commands

Open the Command Palette (`Ctrl+Shift+P`) and type `Roadie`:

| Command | Description |
|---|---|
| `Roadie: Initialize` | Force full project scan and regenerate all context files |
| `Roadie: Rescan Project` | Re-scan dependencies and scripts, regenerate if changed |
| `Roadie: Run Workflow` | Quick-pick a workflow and get a guided `@roadie` prompt |
| `Roadie: Doctor` | Run diagnostics — build, SQLite, generated files, commands |
| `Roadie: Show Stats` | Display workflow history statistics |
| `Roadie: Show My Stats` | Per-intent accuracy, cancel rates, hot files, top patterns |
| `Roadie: Show Last Context` | Focus Output channel and show the last LLM context snapshot |
| `Roadie: Get Scan Summary` | Show current project scan summary in the Output channel |
| `Roadie: Export Diagnostics` | Collect logs, env, DB schema into a JSON file for bug reports |
| `Roadie: Enable Workflow History` | Start recording every `@roadie` run to local SQLite |
| `Roadie: Disable Workflow History` | Stop recording `@roadie` runs |
| `Roadie: Reset` | Delete local database and reset all Roadie state |

### Chat slash commands

| Slash command | Workflow |
|---|---|
| `@roadie /fix <description>` | Bug fix (8-step: locate → diagnose → fix → verify → scan siblings → fix siblings → regression guard → summary) |
| `@roadie /review <target>` | Code review (5-step) |
| `@roadie /document <target>` | Documentation (4-step) |
| `@roadie /refactor <target>` | Refactor (5-step) |
| `@roadie /onboard` | Onboarding tour (4-step) |
| `@roadie /dependency <package>` | Dependency management (5-step) |

---

## Configuration

All settings are under `roadie.*` in VS Code Settings (`Ctrl+,`):

| Setting | Default | Description |
|---|---|---|
| `roadie.telemetry` | `false` | Anonymous, aggregate telemetry (workflow types, model tiers, success rates). Off by default. |
| `roadie.workflowHistory` | `false` | Persist workflow outcomes to local SQLite for the learning loop. |
| `roadie.editTracking` | `false` | Track edits to Roadie-generated files to improve future suggestions. |
| `roadie.modelPreference` | `"balanced"` | `economy` (Tier 0 only) / `balanced` (escalate on failure) / `quality` (start at Tier 1). |
| `roadie.testCommand` | `""` | Custom test command override. If empty, auto-detected from `package.json`. |
| `roadie.testTimeout` | `300` | Seconds to wait for test suite before timeout (10–3600). |
| `roadie.autoCommit` | `false` | Auto-stage and commit Roadie-generated `.github/` files. |
| `roadie.contextLensLevel` | `"summary"` | How much context Roadie logs: `off` / `summary` / `full`. |

---

## Privacy

Roadie is local-first. See [docs/privacy.md](docs/privacy.md) for what is collected, PII redaction rules, and the Export Diagnostics bundle format. Telemetry is opt-in and off by default.

---

## Health check

```bash
node scripts/doctor.js
```

Checks: extension build, Marketplace readiness, packaged VSIX, command registration, generated context files, SQLite persistence layer.

---

## Release Tag Policy

For any Marketplace release, push a semantic version tag together with the release commit.

- Tag format: `vX.Y.Z` (example: `v1.0.0`)
- Keep `package.json` version and the git tag in sync.
- Push with tags: `git push origin master --follow-tags`

---

## Known limitations / feedback

Report issues or feedback through [GitHub Issues](https://github.com/rmg007/Roadie_App/issues).

Marketplace note: icon and listing updates can take several minutes to propagate globally due to cache refresh delays.
