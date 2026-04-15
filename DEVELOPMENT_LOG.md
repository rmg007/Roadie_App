# Roadie Development Log

**Last Updated:** 2026-04-15

---

## v0.7.10 — Current Release

### What's Implemented

**Phase 1: Active Mode** ✅
- Intent classifier with 8 intent types (bug fix, feature, refactor, review, document, dependency, onboard, general chat)
- Workflow engine with FSM, parallel step execution, escalation logic, max 3 retries per step
- 7 full workflow definitions with proper termination conditions
- Chat interface: natural language (`@roadie`) + slash commands (`/fix`, `/review`, etc.)
- Code Actions integration for symbol-scoped operations
- Chat variable `#roadie` for context injection
- Project model scanner (tech stack, build commands, test runners, directory roles)

**Phase 1.5: Passive Mode** ✅
- File watcher with debouncing and priority classification
- SQLite persistence for project model and learning database
- 7 artifact families generated (copilot-instructions.md, AGENTS.md, CLAUDE.md, Cursor rules, path-scoped instructions, scan summary)
- Edit tracking with HTML comment markers (preserves user edits on regeneration)
- Workflow history logging (opt-in)
- Codebase dictionary for entity extraction
- Pattern derivation from source code analysis
- 11 commands covering doctor, scan, workflow launching, history, stats
- `.roadie/last-scan.json` with writeReason and hashPolicy
- Enhanced settings with model preference, telemetry, tracking options

### Configuration & Customization
- 7 user-configurable settings (model preference, telemetry, edit tracking, workflow history, auto-commit, test command/timeout, context logging level)
- Auto-detection of test runners and build tools
- Graceful fallback when SQLite is unavailable
- Edit preservation across file regenerations

### Testing & Quality
- 508+ unit tests (all passing)
- ESLint + @typescript-eslint integration
- Prettier code formatting
- Vitest test framework with coverage support
- Doctor health check script

### Deployment Ready
- Packaged VSIX for Marketplace
- Version synced across package.json and git tags
- Icon and branding assets included
- Proper bundling of dependencies (better-sqlite3 included)

---

## What's NOT Yet Implemented

**Phase 2: Integration & MCP** ⏳ (Specified but deferred pending Phase 1.5 stabilization)
- MCP Server implementation
- Standalone mode (non-Copilot environments)
- Cursor IDE deep integration
- Claude Code skill authoring

---

## Known Issues

1. **Chat participant intent routing:** Sometimes echoes `general_chat` instead of routing to LLM. Workaround: use slash commands (`/fix`, `/review`, etc.)
2. **SQLite compilation:** On rare systems where better-sqlite3 fails to compile, extension falls back to in-memory mode (features still work, just no persistence)

---

## Tech Stack

- **VS Code API:** 1.84+
- **Runtime:** Node 22+, TypeScript 5.2
- **Build:** tsup (CJS to `out/extension.js`)
- **Database:** better-sqlite3 (bundled)
- **Testing:** Vitest 0.34 with @vscode/test-electron
- **Dependencies:** zod, fast-glob
- **Linting:** ESLint + @typescript-eslint
- **Formatting:** Prettier

---

## Release Process

1. Update version in `package.json`
2. Run `npm run sync:displayNameVersion` to update VS Code display name
3. Run `npm test && npm run lint && npm run build`
4. Create git tag matching version (`v0.7.10`)
5. Push with tags: `git push origin main --follow-tags`
6. Run `npm run package` to create VSIX
7. (Optional) Run `vsce publish --no-dependencies` for Marketplace

---

## Scripts Reference

| Command | Purpose |
|---|---|
| `npm run build` | Compile TypeScript to `out/extension.js` |
| `npm run build:watch` | Watch mode for development |
| `npm test` | Run all tests |
| `npm test:watch` | Watch mode for testing |
| `npm test:coverage` | Generate coverage report |
| `npm test:scenarios` | Run harness scenario tests only |
| `npm run lint` | Check code with ESLint |
| `npm run lint:fix` | Auto-fix linting issues |
| `npm run format` | Format code with Prettier |
| `npm run package` | Create VSIX for local testing |
| `npm run publish` | Publish to VS Code Marketplace |

---

## Notes for Contributors

- All main code is in `src/extension.ts` and its imports
- Tests use Vitest with `@vscode/test-electron` for integration tests
- Configuration schemas use Zod for validation
- Database operations use better-sqlite3 (synchronous, bundled for portability)
- File generation uses HTML comment markers: `<!-- roadie:start:section -->` ... `<!-- roadie:end:section -->`
- Project scanning is lazy — only gathers what's needed for current workflow
- All workflows follow the same FSM lifecycle: trigger → steps → escalation/exit → summary
