# v0.7.0 — Close the Local Learning Loop

**Target version:** `0.7.0`  
**Theme:** Make `LearningDatabase` actually change runtime behavior, not just store data.  
**Test floor:** ≥620 (currently 557; need +63 minimum).  
**Code budget:** ~400 new/changed production lines.

---

## 1. Problem / Vision

`LearningDatabase` has been accumulating per-repo signals since v0.5.x —
workflow success rates, cancellation ratios, most-edited files, pattern
observations — but nothing reads them back. The classifier assigns identical
confidence weights on every repo regardless of what has worked there. Templates
ignore `simplified: true`. Context Lens verbosity cannot be tuned. The data is
there; the actuators are not. v0.7.0 wires the loop closed.

---

## 2. Architecture Changes

### Pillar 1 — Learning Loop

#### 1A. Classifier confidence adjustment

**Hook point:** `IntentClassifier.classify()` in
`src/classifier/intent-classifier.ts:36`.

`classify()` currently returns a static confidence. Add a new optional method:

```ts
// intent-classifier.ts — new public method
adjustWithLearning(
  result: ClassificationResult,
  stats: WorkflowStats,
  cancelStats: Array<{ workflowType: string; totalRuns: number; cancelledRuns: number }>,
): ClassificationResult
```

**Confidence adjustment formula (the heart of the release):**

Let `R` = per-intent success rate from `stats.byType[intent]` (0–1, or `null`
if fewer than 5 runs — below the minimum-data gate).  
Let `C` = cancellation rate = `cancelledRuns / totalRuns` for that intent.  
Let `base` = classifier's raw confidence.

```
if (runs < 5) return base;  // not enough data — no adjustment

successBias  = (R - 0.5) * 0.20   // range: -0.10 to +0.10
cancelPenalty = C * 0.15           // range: 0 to -0.15

adjusted = base + successBias - cancelPenalty

// Floor and ceiling to avoid entrenchment:
adjusted = Math.max(0.30, Math.min(0.95, adjusted))
```

Rationale for the floor (0.30): an intent that keeps failing must still be
*suggestable* so it can eventually succeed. The ceiling (0.95) prevents
false certainty. The 5-run gate is already used in the AGENTS.md
`learned-preferences` section — reusing it is consistent.

`adjustWithLearning()` is pure (no DB access) — the caller fetches stats
once and passes them in. This keeps the classifier testable without SQLite.

**Caller:** `chat-participant.ts:108` — after `classifier.classify()`, call
`adjustWithLearning()` if `learningDb` is available. One call site; no
interface change needed.

#### 1B. Pattern repeat-sighting confidence growth

`ProjectModel.getPatterns()` returns patterns with a `confidence` field. The
analyzer today writes flat confidence values. Add a new query to
`LearningDatabase`:

```ts
// learning-database.ts — new method
getPatternObservationCounts(): Array<{ patternId: string; observationCount: number }>
```

**New DB table** (`pattern_observations`):
```sql
CREATE TABLE IF NOT EXISTS pattern_observations (
  pattern_id TEXT NOT NULL,
  observed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pattern_obs ON pattern_observations(pattern_id);
```

Confidence boost formula: for each pattern whose `patternId` is in the DB,
multiply confidence by `min(1.0, 1 + log10(count) * 0.1)`. At 10 sightings
that is `+10%`; at 100 it is `+20%`. Applied inside
`ProjectAnalyzer.analyze()` after pattern detection
(`src/analyzer/project-analyzer.ts`).

#### 1C. Most-edited files → onboard and review context injection

`LearningDatabase.getMostEditedFiles()` already exists (line 315). Add a
helper in `chat-participant.ts` that, for `onboard` and `review` intents,
appends a `## Most-Edited Files` subsection to the `{project_context}`
placeholder before the workflow starts:

```ts
// chat-participant.ts — private helper
function buildContextWithHotFiles(
  base: string,
  hotFiles: Array<{ filePath: string; editCount: number }>,
): string
```

No new DB queries needed — just surfacing existing data into the prompt that
workflows already consume.

#### 1D. Generation acceptance detection

When `FileGeneratorManager.generate()` writes a file (line 118), it calls
`learningDb.recordSnapshot(filePath, content, 'roadie')`. On the *next* scan,
`FileWatcherManager` detects the file has changed and calls
`learningDb.recordSnapshot(filePath, newContent, 'human')`.

Add a new query to `LearningDatabase`:

```ts
// learning-database.ts — new method
getGenerationAcceptanceRate(filePath: string): { accepted: number; edited: number } | null
```

Logic: count consecutive `roadie`→`human` transitions in `file_snapshots` for
the file. If the first human snapshot after a roadie snapshot differs in hash
→ `edited++`; if same → `accepted++`. Returns `null` if fewer than 3
transitions (not enough data).

This feeds the `roadie.showMyStats` command display (Pillar 2) and AGENTS.md.
No template priority change in v0.7.0 — that is v0.8.0.

---

### Pillar 2 — Observability

#### 2A. `Roadie: Show My Stats` command

New command ID: `roadie.showMyStats` (does not collide with existing `roadie.stats`).

Implementation: `onShowMyStats` callback added to `registerCommands()` in
`src/shell/commands.ts`. The handler calls:
- `learningDb.getWorkflowStats()`
- `learningDb.getWorkflowCancellationStats()`
- `learningDb.getMostEditedFiles()`
- `learningDb.getGenerationAcceptanceRate()` for each of the 4 generated files
- `projectModel.getPatterns()` sorted by confidence (top 10)

Renders to a Markdown string and opens it via
`vscode.workspace.openTextDocument({ content, language: 'markdown' })` then
`vscode.window.showTextDocument(doc)`. No webview needed — Markdown preview
is built in to VS Code.

Pattern: reuses the existing `onStats` callback shape in `extension.ts:334`.

#### 2B. AGENTS.md `learned-preferences` updates

Already gated at ≥5 runs. Extend the existing section to include:
- Per-intent cancellation rate (from `getWorkflowCancellationStats()`)
- Generation acceptance rate per file (from `getGenerationAcceptanceRate()`)

No schema changes — this is text added to the existing `learned-preferences`
section in the AGENTS.md template (`src/generator/templates/agent-definitions.ts`).

---

### Pillar 3 — v0.6.x Debt

#### 3A. Templates honoring `simplified: true`

`FileGeneratorManager.generate()` passes `{ simplified: true }` on retry
(line 143) but templates ignore it. Add `options?: { simplified?: boolean }`
parameter to each of the 4 template functions:

| File | Function | Sections to drop when simplified |
|------|----------|----------------------------------|
| `templates/claude-md.ts:27` | `generateClaudeMd` | `repo-map`, `forbidden` |
| `templates/cursor-rules.ts:27` | `generateCursorRules` | `coding-standards` |
| `templates/copilot-instructions.ts:19` | `generateCopilotInstructions` | `project-structure`, `patterns` |
| `templates/path-instructions.ts:43` | `generatePathInstructions` | per-dir pattern lines |

Each function already has an `enforceBudget` helper — the simplified flag
bypasses that and returns only mandatory sections directly.

#### 3B. Per-directory Cursor `.mdc` files

New generator file: `src/generator/templates/cursor-rules-dir.ts`.  
Output path pattern: `.cursor/rules/{dirName}.mdc`.  
Gating: same as path-instructions — `role === 'source'`, ≥3 source files, max 6 dirs.  
Content: identical section structure to `path-instructions.ts` but with MDC
frontmatter (`alwaysApply: false`, `globs: "{dirName}/**"`).  
Registered in `file-generator.ts` alongside existing generators.

#### 3C. `roadie.contextLensLevel` setting

New setting in `package.json` contributions:
```json
"roadie.contextLensLevel": {
  "type": "string",
  "enum": ["off", "summary", "full"],
  "default": "summary",
  "description": "Controls how much context Roadie logs to the Output channel..."
}
```

Read in `readConfiguration()` (`commands.ts:58`). Passed into
`chat-participant.ts` via the existing `deps` injection point. At the two
context-logging sites in `chat-participant.ts:134–138`:
- `off`: skip both `[CONTEXT]` lines and `appendRaw()`
- `summary`: log the `[CONTEXT] scope=full tokens≈N chars=N` header only
- `full`: current behavior (header + body)

---

## 3. Phased Milestones

### Alpha.1 — Learning loop math + observability (Pillars 1A, 1C, 2A, 2B)

**Files touched:**
| File | Change | Est. lines |
|------|--------|-----------|
| `src/classifier/intent-classifier.ts` | `adjustWithLearning()` method | +35 |
| `src/shell/chat-participant.ts` | call `adjustWithLearning()`, `buildContextWithHotFiles()` | +30 |
| `src/shell/commands.ts` | add `onShowMyStats` callback | +10 |
| `src/extension.ts` | wire `onShowMyStats`, call `adjustWithLearning` path | +20 |
| `package.json` | add `roadie.showMyStats` command | +6 |
| `src/classifier/intent-classifier.test.ts` | tests for `adjustWithLearning` | +40 |
| `src/shell/chat-participant.test.ts` | tests for hot-files injection | +20 |

Tests added: ~25. Running total: ~582.

### Alpha.2 — Pattern observations + acceptance detection + contextLensLevel (1B, 1D, 3C)

**Files touched:**
| File | Change | Est. lines |
|------|--------|-----------|
| `src/learning/learning-database.ts` | `pattern_observations` table, 2 new methods | +55 |
| `src/analyzer/project-analyzer.ts` | apply observation-count confidence boost | +20 |
| `src/shell/commands.ts` | read `contextLensLevel` | +8 |
| `src/shell/chat-participant.ts` | honor `contextLensLevel` at 2 log sites | +12 |
| `package.json` | add `roadie.contextLensLevel` setting | +10 |
| `src/learning/learning-database.test.ts` | tests for new methods + table | +35 |
| `src/analyzer/project-analyzer.test.ts` | test confidence boost path | +15 |

Tests added: ~25. Running total: ~607.

### Stable — Templates + per-dir MDC + AGENTS.md updates (3A, 3B, 2B extension)

**Files touched:**
| File | Change | Est. lines |
|------|--------|-----------|
| `src/generator/templates/claude-md.ts` | simplified flag | +12 |
| `src/generator/templates/cursor-rules.ts` | simplified flag | +10 |
| `src/generator/templates/copilot-instructions.ts` | simplified flag | +10 |
| `src/generator/templates/path-instructions.ts` | simplified flag | +10 |
| `src/generator/templates/cursor-rules-dir.ts` | new file | +80 |
| `src/generator/file-generator.ts` | register cursor-rules-dir | +15 |
| `src/generator/templates/agent-definitions.ts` | cancellation + acceptance in learned-preferences | +25 |
| `src/generator/templates/claude-md.test.ts` | simplified tests | +10 |
| `src/generator/templates/cursor-rules.test.ts` | simplified tests | +8 |
| `src/generator/templates/cursor-rules-dir.test.ts` | new test file | +30 |
| `src/generator/templates/path-instructions.test.ts` | simplified tests | +8 |

Tests added: ~20. Running total: ~627.  

---

## 4. Acceptance Tests

```bash
# 1. Test suite must pass at ≥620 tests
cd roadie && npm test
# Expected: Tests NNN passed — NNN ≥ 620

# 2. adjustWithLearning raises confidence for high-success intent
# (unit test in intent-classifier.test.ts)
# Input: base=0.80, runs=20, successRate=0.85, cancelRate=0.0
# Expected: adjusted = 0.80 + (0.85-0.5)*0.20 - 0 = 0.87

# 3. adjustWithLearning floors at 0.30 for chronically-failing intent
# Input: base=0.80, runs=20, successRate=0.10, cancelRate=0.60
# Expected: adjusted = max(0.30, 0.80 + (0.10-0.5)*0.20 - 0.60*0.15) = max(0.30, 0.62) = 0.62

# 4. Fewer than 5 runs → no adjustment (gate test)
# Input: base=0.80, runs=4, successRate=1.0
# Expected: result.confidence === 0.80 (unchanged)

# 5. simplified=true produces fewer sections
# (unit test in claude-md.test.ts)
# Call generateClaudeMd(model, { simplified: true })
# Expected: sections.length === 1 (workspace-rules only)

# 6. roadie.showMyStats command opens a markdown document
# (integration smoke test — manual)
# Run command via Command Palette
# Expected: a new editor tab opens with intent stats table

# 7. contextLensLevel='off' suppresses context log lines
# (unit test in chat-participant.test.ts)
# Spy on logger.info; trigger general_chat with contextLensLevel='off'
# Expected: no '[CONTEXT]' string in logger.info calls

# 8. Per-dir cursor MDC gating
# (unit test in cursor-rules-dir.test.ts)
# Model with 2 dirs each with ≥3 source files → 2 .mdc files emitted
# Model with a dir with 2 source files → that dir excluded

# 9. Version bump
grep '"version"' roadie/package.json
# Expected: "version": "0.7.0"

# 10. CHANGELOG entry exists
grep '0.7.0' roadie/CHANGELOG.md
# Expected: [0.7.0] — 2026-04-15 — Close the Local Learning Loop
```

---

## 5. Risks / Rollback

**Feedback loop (entrenchment):** If `bug_fix` consistently fails, its adjusted
confidence drops, it gets suggested less, so it cannot accumulate successes to
recover. The 0.30 floor prevents this — even a heavily penalized intent still
clears the 0.20 scoring threshold so it remains in rotation.

**Stats gate race:** On a fresh install with <5 runs, `adjustWithLearning()` is
a no-op (returns base unchanged). The gate is idiomatic and safe.

**`roadie.showMyStats` vs `roadie.stats`:** Both commands exist. `stats` shows a
notification + Output channel breakdown. `showMyStats` opens a markdown document.
They are complementary, not duplicates. No command ID collision.

**New DB table (`pattern_observations`):** The `initialize()` method runs
`db.exec(LEARNING_SCHEMA)` which already uses `CREATE TABLE IF NOT EXISTS`
— the new table migrates safely on next activation. No migration script needed.

**Per-dir MDC files and Cursor:** `.mdc` files with `alwaysApply: false` are
inert until Cursor loads them. Adding up to 6 new files does not break anything
if Cursor is absent.

**Rollback:** All Pillar 1 changes are additive (new methods, optional call
sites). To disable: delete the `adjustWithLearning()` call in
`chat-participant.ts` and revert the `contextLensLevel` read. No DB migration
needed for rollback since all new tables use `CREATE TABLE IF NOT EXISTS`.

---

## 6. Non-Goals / Deferred

- Cross-user aggregation (v0.8.0)
- Insight cards / proactive nudges (v0.8.0)
- Template priority changes from acceptance rate (v0.8.0 — rate is *captured*
  in v0.7.0 but not acted upon)
- Federated patterns
- Changing `roadie.stats` command behavior (preserved as-is)

---

## 7. Version Bump

**Target:** `0.7.0` (minor bump — additive features, no breaking changes).

**CHANGELOG entry:**

```
[0.7.0] — 2026-04-15 — Close the Local Learning Loop

### Added
- Classifier confidence adjustment: per-repo workflow success and cancellation
  rates from LearningDatabase now bias IntentClassifier output (floor 0.30,
  ceiling 0.95, gate at <5 runs).
- Most-edited files from LearningDatabase injected into onboard and review
  workflow contexts automatically.
- Generation acceptance detection: tracks whether users keep or edit
  Roadie-generated AGENTS.md sections between scans.
- Pattern repeat-sighting confidence growth: patterns observed 10× rank
  higher than those observed twice (log-scaled, max +20%).
- `Roadie: Show My Stats` command (roadie.showMyStats): opens a Markdown
  document with per-intent accuracy, cancellation rates, top-10 patterns,
  most-edited files, and generated-file acceptance rates.
- `roadie.contextLensLevel` setting (off | summary | full, default summary):
  controls Output channel context verbosity.
- Per-directory Cursor `.mdc` files emitted under `.cursor/rules/` for
  qualifying directories (same gating as path-instructions: ≥3 source
  files, max 6 dirs).

### Fixed
- All 4 templates (claude-md, cursor-rules, copilot-instructions,
  path-instructions) now drop optional sections when `simplified: true` is
  passed on self-healing retry, preventing oversized outputs on retry.
- AGENTS.md learned-preferences section now includes per-intent cancellation
  rates and generated-file acceptance rates.
```
