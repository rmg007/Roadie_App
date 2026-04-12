# Roadie — The Invisible AI Workflow Engine

VS Code extension that makes GitHub Copilot smarter. Transforms chat into autonomous workflows: bug fix, feature development, refactoring, code review, documentation, dependency management, onboarding.

**Status:** Bootstrap scaffold (Phase 0 — environment setup complete, implementation not yet started)

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
