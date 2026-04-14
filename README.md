# Roadie — The Invisible AI Workflow Engine

VS Code extension that makes GitHub Copilot smarter. Transforms chat into autonomous workflows: bug fix, feature development, refactoring, code review, documentation, dependency management, onboarding.

**Status:** Bootstrap scaffold (Phase 0 — environment setup complete, implementation not yet started)

---

## Installation (Plug & Play)

One command sets up both the VS Code extension and the standalone MCP server:

```bash
npm install
npm run build
npm run install:all
```

`install:all` will:

1. Check prerequisites (Node 20+, npm, VS Code CLI).
2. Smoke-test the built MCP server over stdio (real JSON-RPC `initialize`).
3. `code --install-extension roadie-0.5.0.vsix`.
4. Register the Roadie MCP server in `~/.claude.json` (Claude Code) and the Claude Desktop config, so any MCP-capable client can use Roadie standalone.

Flags:

- `--skip-extension` — MCP-only install (for Claude Code-only users).
- `--skip-mcp` — VS Code extension only.
- `--uninstall` — reverses both steps.
- `--log-level LEVEL` — sets `ROADIE_LOG_LEVEL` in the written MCP entries.

The installer is idempotent and writes JSON configs atomically with timestamped backups.

## Health check

```bash
npm run doctor
```

Example output:

```
Roadie — doctor
package: C:\dev\Roadie\roadie

1. VS Code extension build
✓ out/extension.js exists (444.0 KB, 1 min old)

2. MCP server bundle
✓ out/bin/roadie-mcp.js exists (1008.5 KB, 1 min old)

3. MCP server smoke test
✓ server responded to initialize

4. VS Code extension registration
✓ roadie.roadie is installed

5. Claude Code MCP registration
✓ roadie registered in C:\Users\<you>\.claude.json
  command: npx roadie-mcp --project .
  ROADIE_LOG_LEVEL=INFO

6. Packaged .vsix
✓ roadie-0.5.0.vsix present (1281 KB)

All checks passed. Roadie is ready to use.
```

Exit code is 0 when everything is green, 1 otherwise.

---

## Specification

This repository contains only the implementation. The canonical specification lives in a separate, sibling documentation repository:

- **Path:** `../Roadie_Project_Documentations_Only/`
- **Entry point:** `00_START_HERE.md`
- **Agent quickstart:** `AGENT_ENTRYPOINT.md`
- **Build runbook:** `03_Implementation_Specs_Phase_1/Module Build Order & Verification.md`

**Do not modify spec files from this repo.** The docs repo is the source of truth for all module contracts, workflow definitions, error taxonomy, and build order. Changes to the spec must be made in the docs repo and exported from Notion.

---

## Dev Environment

Bootstrapped from `02_Technical_Architecture/Extension Manifest & Configuration.md` and `03_Implementation_Specs_Phase_1/Phase 1 Project Structure.md`.

```bash
# Install dependencies
npm install

# Build (tsup)
npm run build

# Test (vitest)
npm run test

# Lint (ESLint + @typescript-eslint)
npm run lint

# Format (Prettier)
npm run format

# Launch Extension Development Host
# Press F5 in VS Code (uses .vscode/launch.json)
```

## Build Order

Follow `03_Implementation_Specs_Phase_1/Module Build Order & Verification.md` step-by-step, starting at Step 1 (`src/types.ts`). Do not skip ahead or parallelize except where the runbook explicitly permits.

---

## Using Claude Code CLI?

See [Optima](https://github.com/rmg007/Optima-App) — same design philosophy, targets Claude Code as its native environment. Roadie is the VS Code Copilot-focused sibling project.
