# v0.6.0 — Copilot Intelligence & Plug-and-Forget

**Target version:** 0.6.0  
**Current version:** 0.5.3  
**Date drafted:** 2026-04-15

---

## 1. Problem / Vision

Roadie already scans projects and generates two files (`AGENTS.md`,
`.github/copilot-instructions.md`). Those files are sparse (tech stack + commands +
patterns), static (same output for every project with the same stack), and incomplete
(Cursor, Claude Code, and GitHub path-scoped instructions are not covered). Workflows are
executed identically regardless of what past runs taught us. The watcher classifies
changes but nothing hooks watcher events to regeneration. The result: the user still has
to think about Roadie — triggering rescans, noticing stale context files, tweaking
thresholds. v0.6.0 closes all three gaps: richer multi-target context files, workflows
that adapt from the learning database, and a reactive backbone that keeps everything
current without user involvement.

---

## 2. Root Cause — Where the Gaps Live

| Gap | File | Key lines |
|---|---|---|
| Only two output files | `src/generator/file-generator.ts` | `FILE_SPECS` array, lines 35-46 — add 4 new specs |
| AGENTS.md content thin | `src/generator/templates/agent-definitions.ts` | Lines 30-141 — no token budget, no per-area context, no learned outcomes |
| `copilot-instructions.md` thin | `src/generator/templates/copilot-instructions.ts` | Lines 18-58 — missing `project-overview`, `project-structure` sections spec'd in spec doc |
| Watcher never triggers generation | `src/extension.ts` | Lines 106-128 — `onBatch` handler not wired to `FileGenerator.generateAll` |
| `toContext()` token budget is char-based | `src/model/project-model.ts` | Lines 108-110 — `maxTokens * 4` char approximation, no scope-per-step injection |
| Workflows use static 2 000-token context | `src/extension.ts` | Line 147 — `toContext({ maxTokens: 2_000 })` hard-coded, no per-step scoping |
| LearningDatabase stats never feed prompts | `src/learning/learning-database.ts` | `getWorkflowStats()` result unused at workflow dispatch time |
| `FileGeneratorManager` registered but unused | `src/generator/file-generator-manager.ts` | Manager is instantiated in tests but not wired in `extension.ts` |

---

## 3. Architecture Changes

### 3A — New Context-File Targets

Add four new `GeneratedFileType` entries and their template modules. Each implements the
existing `FileTypeGenerator` interface (already in `file-generator-manager.ts`).

```
src/generator/templates/claude-md.ts         → CLAUDE.md (workspace root)
src/generator/templates/cursor-rules.ts      → .cursor/rules/project.mdc
src/generator/templates/path-instructions.ts → .github/instructions/{dir}.instructions.md
src/generator/templates/agents-md-rich.ts    → replaces current agent-definitions.ts sections
```

**Token-budget contract (all templates):**  
Every `generate()` call receives `{ maxTokens: number }` option threaded from
`ProjectModel.toContext()`. Templates must call `model.toContext({ maxTokens, scope })`
to get a pre-trimmed serialized string. The `toContext` char approximation (line 108-110
of `project-model.ts`) must be replaced with a genuine 4-chars-per-token heuristic plus
a hard section-priority ordering: `commands > tech-stack > patterns > structure`.

### 3B — Richer AGENTS.md Sections

The current template emits 5 static sections. Replace/augment with 8 sections:

| Section ID | What's new |
|---|---|
| `project-overview` | Add package description, detected language, node version |
| `commands` | unchanged |
| `agent-roles` | unchanged (5 fixed roles) |
| `workflows` | Add live success-rate column sourced from `LearningDatabase.getWorkflowStats()` |
| `directory-structure` | Emit actual top-level tree with file counts, not just role groups |
| `coding-standards` | NEW — patterns with confidence ≥ 0.7, grouped by category |
| `key-files` | NEW — top 10 most-edited source files from `file_snapshots` table |
| `learned-preferences` | NEW — per-workflow cancellation rate; shown only if ≥ 5 runs exist |

### 3C — CLAUDE.md Template

`CLAUDE.md` at the workspace root is consumed by Claude Code. Content contract:
- `workspace-rules` section: mirrors commands + patterns (≤ 60 lines)
- `repo-map` section: same directory-structure data as AGENTS.md
- `forbidden` section: static stub the user can fill (preserved by merge markers)
- Total output: ≤ 120 lines to stay within Claude Code's auto-read budget

### 3D — Cursor Rules Template

`.cursor/rules/project.mdc` uses MDC frontmatter with `alwaysApply: true`. Content: tech
stack, top commands, detected coding-standards. Kept to ≤ 80 lines. No per-path rules
in this release (that is a v0.7.0 item).

### 3E — Path-Scoped `.github/instructions/` Files

The spec (`File-Specific Generator Templates All 8.md`, section 2) defines per-directory
`.instructions.md` files with YAML `applyTo` frontmatter. Implementation:

1. `src/generator/templates/path-instructions.ts` iterates `model.getDirectoryStructure()`
   children whose `role === 'source'` or `role === 'test'`.
2. For each qualifying directory, emit one file:
   `.github/instructions/<dirname>.instructions.md`
3. Content: inferred role description + relevant patterns + sample command.
4. Skip if fewer than 3 source files in the directory (avoid noise).
5. Gate on a directory count: max 6 path-instruction files per workspace to avoid
   overwhelming Copilot.

### 3F — Reactive Auto-Regeneration (Watcher → Generator)

Wire `FileWatcherManager` to `FileGeneratorManager` in `extension.ts`.

```
activation:
  watcher.onBatch(events => {
    const needsRegen = events.some(e =>
      e.priority === 'HIGH' || e.classifiedAs === 'DEPENDENCY_CHANGE'
    );
    if (needsRegen) generatorManager.generateAll(projectModel);
  });
```

The `FileGeneratorManager` is already built and tolerant of concurrent calls (deferred
write protection). The only change is wiring.  
Debounce threshold: `HIGH`/`DEPENDENCY_CHANGE` events trigger regeneration; `LOW` events
do not. `CONFIG_CHANGE` events trigger only the copilot-instructions and CLAUDE.md
generators (not AGENTS.md or Cursor rules), because config changes affect patterns but
rarely project structure.

### 3G — Self-Healing Generation

Wrap each `generator.generate()` call in a two-attempt retry: if the first attempt throws
or produces an empty sections array, retry with `{ simplified: true }` flag. Templates
check this flag and return only `required`-priority sections (dropping `recommended` and
`optional`). This prevents partial failures from leaving files empty.

Add to `FileGeneratorManager.generate()`:

```typescript
if (result.error && !options?.simplified) {
  return this.generate(fileType, model, { ...options, simplified: true });
}
```

### 3H — Confidence-Adaptive Intent Classification

The classifier already has `requiresLLM` and `getClassificationPromptPrefix()`. The
`chat-participant.ts` currently echoes `general_chat` instead of calling the LLM (the
known 0.5.3 bug). Once the 0.5.3 fix is applied, instrument the LLM path to also record
the outcome back to `LearningDatabase`:

```typescript
// after parseClassification() succeeds:
learningDb?.recordWorkflowOutcome({
  workflowType: 'classification',
  prompt: prompt.slice(0, 200),
  status: result.intent === 'general_chat' ? 'fallback' : 'classified',
  stepsCompleted: 1, stepsTotal: 1,
});
```

This seeds the `workflow_history` table with classification data for future use.

### 3I — Per-Step Context Scoping in Workflows

Replace the hard-coded `toContext({ maxTokens: 2_000 })` in `extension.ts` (line 147)
with a step-aware scope selector:

```typescript
const STEP_SCOPE_MAP: Record<string, ProjectModel['toContext'] extends (o?: infer O) => unknown ? NonNullable<O>['scope'] : never> = {
  'locate-error':       'structure',
  'diagnose-root-cause':'full',
  'generate-fix':       'patterns',
  'verify-tests':       'commands',
  'scan-siblings':      'structure',
  // default: 'full' at 2 000 tokens
};
```

Inject via a new optional field `contextScope` on `WorkflowStep` (non-breaking: field is
optional and defaults to `'full'`).

---

## 4. Phased Milestones

### Alpha (0.6.0-alpha.1) — Core Plumbing (≈ 3 days)

**Goal:** New file targets written on disk; watcher wired; no regressions.

| Step | File(s) | Change | Est. lines |
|---|---|---|---|
| 1 | `src/types.ts` | Add `'claude_md' \| 'cursor_rules' \| 'path_instructions'` to `GeneratedFileType` | +3 |
| 2 | `src/generator/templates/claude-md.ts` | New template, 3 sections | +90 |
| 3 | `src/generator/templates/cursor-rules.ts` | New template, 2 sections | +60 |
| 4 | `src/generator/templates/path-instructions.ts` | New template, 1 section per dir | +120 |
| 5 | `src/generator/file-generator.ts` | Add 3 specs to `FILE_SPECS` | +15 |
| 6 | `src/extension.ts` | Wire `FileWatcherManager.onBatch` → `FileGeneratorManager.generateAll` | +20 |
| 7 | Tests for claude-md, cursor-rules, path-instructions | New test files | +180 |

### Alpha.2 — Richer AGENTS.md (≈ 2 days)

| Step | File(s) | Change | Est. lines |
|---|---|---|---|
| 8 | `src/generator/templates/agent-definitions.ts` | Add `coding-standards`, `key-files`, `learned-preferences` sections | +80 |
| 9 | `src/learning/learning-database.ts` | Add `getMostEditedFiles(limit: number)` query method | +25 |
| 10 | `src/model/project-model.ts` | Replace char approximation with priority-ordered token trimmer | +40 |
| 11 | Tests for new sections and token trimmer | Extend existing test files | +60 |

### Alpha.3 — Adaptive Context & Self-Healing (≈ 2 days)

| Step | File(s) | Change | Est. lines |
|---|---|---|---|
| 12 | `src/types.ts` | Add optional `contextScope` to `WorkflowStep` | +3 |
| 13 | `src/engine/definitions/bug-fix.ts` | Add `contextScope` to each step | +8 |
| 14 | `src/engine/definitions/feature.ts` | Same | +7 |
| 15 | `src/engine/definitions/refactor.ts` etc. | Same for all 5 remaining definitions | +30 |
| 16 | `src/extension.ts` | Step handler reads `step.contextScope` before calling `toContext()` | +10 |
| 17 | `src/generator/file-generator-manager.ts` | Add two-attempt self-healing retry | +20 |
| 18 | `src/generator/templates/claude-md.ts` etc. | Honor `simplified` flag in all templates | +15 |
| 19 | Tests for scope injection, retry logic | +60 |

### Stable (0.6.0) — Polish + Changelog

| Step | File(s) | Change |
|---|---|---|
| 20 | `package.json` | Bump to `0.6.0` |
| 21 | `CHANGELOG.md` | Dated entry (see Section 7) |
| 22 | `scripts/doctor.js` | Verify all 5 generated files exist |
| 23 | Full test suite must reach ≥ 540 tests | Covered by steps 7, 11, 19 |

---

## 5. Files Touched (full list)

```
src/types.ts                                  — new GeneratedFileType variants + contextScope on WorkflowStep
src/generator/file-generator.ts               — 3 new FILE_SPECS entries
src/generator/file-generator-manager.ts       — self-healing retry
src/generator/templates/agent-definitions.ts  — 3 new sections
src/generator/templates/claude-md.ts          — NEW
src/generator/templates/cursor-rules.ts       — NEW
src/generator/templates/path-instructions.ts  — NEW
src/generator/templates/copilot-instructions.ts — add project-overview + project-structure sections
src/model/project-model.ts                    — priority-ordered token trimmer
src/learning/learning-database.ts             — getMostEditedFiles()
src/engine/definitions/bug-fix.ts             — contextScope per step
src/engine/definitions/feature.ts             — contextScope per step
src/engine/definitions/refactor.ts            — contextScope per step
src/engine/definitions/review.ts              — contextScope per step
src/engine/definitions/document.ts            — contextScope per step
src/engine/definitions/dependency.ts         — contextScope per step
src/engine/definitions/onboard.ts             — contextScope per step
src/extension.ts                              — watcher wiring + step-aware context scope
src/watcher/change-classifier.ts              — add AGENTS.md/CLAUDE.md/cursor-rules to isIgnoredPath (avoid self-loop)
scripts/doctor.js                             — check 5 generated files
package.json                                  — version bump
CHANGELOG.md                                  — entry
```

---

## 6. Acceptance Tests

```bash
# 1. New files generated on first init
cd roadie-test-calculator && code .
# Run: Roadie: Initialize
# Expected: AGENTS.md, .github/copilot-instructions.md, CLAUDE.md,
#           .cursor/rules/project.mdc all exist with roadie markers.
# Expected: .github/instructions/src.instructions.md exists (if src/ has ≥3 files).

# 2. Watcher triggers regeneration
echo "// change" >> roadie-test-calculator/src/calculator.ts
# Wait 600ms (debounce)
# Expected: Roadie Output channel logs "FileGenerator: wrote AGENTS.md (reason=updated)"

# 3. Self-healing: corrupt a generator
# Temporarily make cursor-rules template throw; confirm AGENTS.md still writes.

# 4. Token budget respected
# In test: call model.toContext({ maxTokens: 200 }) on a model with 50 tech entries.
# Expected: serialized.length ≤ 200 * 4 = 800 chars; '[truncated]' present.

# 5. Per-step context scoping
# Unit test: step with contextScope='commands' → toContext called with scope:'commands'.
# Unit test: step with no contextScope → toContext called with scope:'full'.

# 6. CLAUDE.md output budget
# Unit test: generateClaudeMd(largeModel) → output line count ≤ 120.

# 7. Path instructions gating
# Unit test: directory with 2 source files → NOT emitted.
# Unit test: directory with 4 source files → emitted.

# 8. learned-preferences section gating
# Unit test: < 5 runs in history → section absent from AGENTS.md.
# Unit test: ≥ 5 runs with mixed cancellations → section present.

# 9. Full test suite
cd roadie && npm test
# Expected: ≥ 540 tests, 0 failures.

# 10. Build
npm run build
# Expected: out/extension.js produced, no TypeScript errors.
```

---

## 7. Risks / Rollback

| Risk | Likelihood | Mitigation |
|---|---|---|
| Watcher → generator loop: Roadie writes AGENTS.md, watcher detects it, triggers regeneration | High | Add `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/`, `.github/copilot-instructions.md`, `.github/instructions/` to `IGNORED_PREFIXES` in `change-classifier.ts` |
| Path-instructions produces 20+ files on monorepos | Medium | Cap at 6 files, skip directories with < 3 source files |
| `getMostEditedFiles()` expensive on large snapshots table | Low | Wrap in `LIMIT 10` SQLite query with index on `file_path` (already indexed) |
| Cursor `.mdc` frontmatter format changes | Low | File is under marker control; user can override |
| `contextScope` on WorkflowStep breaks existing JSON serializations | None | Field is optional with `?`; undefined == current behavior |

**Rollback:** Remove the 3 new `FILE_SPECS` entries from `file-generator.ts` and the
`onBatch` wiring in `extension.ts`. All new template files are additive — removing their
specs leaves the existing two files untouched. Revert `package.json` to `0.5.3`.

---

## 8. Non-Goals for This Release

- No new VS Code settings (all behavior is automatic with sensible defaults).
- No Phase 2.5 generation quality scoring (spec says "DO NOT BUILD BEFORE 2028").
- No per-step LLM escalation changes — escalation logic is unchanged.
- No `.github/instructions/{path}` files for monorepos with > 1 workspace root.
- No Cursor `.mdc` per-directory files (v0.7.0).
- No remote telemetry or data leaving the machine.
- No breaking changes to command IDs, scan output shape, or public workflow API.

---

## 9. Version Bump

**Target:** `0.6.0`

**CHANGELOG entry:**

```
[0.6.0] — 2026-04-15 — Copilot Intelligence & Plug-and-Forget

### Added
- Generates CLAUDE.md (Claude Code workspace rules) and .cursor/rules/project.mdc (Cursor)
  automatically on init and on meaningful file changes.
- Per-directory .github/instructions/{dir}.instructions.md files for GitHub Copilot path
  scoping (up to 6 directories, gated on ≥ 3 source files).
- AGENTS.md now includes a coding-standards section (patterns ≥ 0.7 confidence),
  a key-files section (most-edited from snapshot history), and a learned-preferences
  section (per-workflow cancellation rate, shown after ≥ 5 runs).
- File watcher now triggers automatic regeneration of all context files on HIGH-priority
  or DEPENDENCY_CHANGE events — no manual rescan needed.
- Self-healing generation: if any template fails, retries with simplified (required
  sections only) output rather than leaving files empty.
- Per-step context scoping: each workflow step injects only the context slice it needs
  (commands, stack, patterns, structure), reducing prompt token waste.

### Changed
- copilot-instructions.md gains project-overview and project-structure sections per spec.
- toContext() token trimmer respects section priority order (commands first).

### Fixed
- Watcher events no longer cause generation loops (generated files added to ignore list).
```
