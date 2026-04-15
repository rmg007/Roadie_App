# v0.7.1 — Audit and Harden Phase 7

**Target version:** `0.7.1`
**Theme:** Harden runtime robustness, error handling, and validation after the phase 7 learning-loop release.
**Test floor:** maintain ≥620 tests; add hardening-specific regression tests.
**Code budget:** ~300 hardening/bug-fix lines (production), ~200 new test lines.

> **Update — deep-audit addendum:** 14 additional source-verified findings were discovered after the original draft. Three of them together prove the v0.7.0 pattern-learning feature has never worked in production. See the Addendum section below and Batch 6 in Section 8.

---

## 1. Problem / Vision

Phase 7 delivered the learning loop. The architecture, workflow definitions,
and test coverage are all strong — but the implementation has accumulated
robustness gaps that would surface under real-world load: unguarded file I/O,
database lifecycle bugs, race conditions in startup and model resolution,
silent failure paths in commands and generators, and missing input validation
at trust boundaries. This release is dedicated exclusively to fixing those
gaps so the extension survives long sessions, large workspaces, corrupted
state, and rapid reloads without losing data or failing silently.

---

## 2. Critical bugs (crash / data loss / wrong output)

### 2A. Undefined logger variable — `src/extension.ts:237`

**Bug:** `log.error(...)` references a variable `log` that does not exist in
scope. `getLogger()` is used everywhere else in the file. When
`ensureProjectReady()` fails inside the step handler, this `log.error()` call
throws `ReferenceError`, masking the original analysis error.

**Fix:** Replace `log.error(...)` on line 237 with `getLogger().error(...)`.

**Test:** Add a unit test that exercises the catch-path in the step handler
when `ensureProjectReady()` rejects; verify no secondary throw.

---

### 2B. Database handle never closed — `src/learning/learning-database.ts:136`

**Bug:** `close()` at line 136 guards with `if (this.db.open)`, but
`better-sqlite3` does not expose an `.open` property. The property is always
`undefined` (falsy), so `this.db.close()` is never called. Every extension
deactivation leaks a file handle. After enough reload cycles the OS may deny
new handles.

```ts
// current (broken)
if (this.db.open) { this.db.close(); }

// better-sqlite3 actual API — no .open property; .close() is idempotent
```

**Fix:** Remove the `.open` guard. Call `this.db.close()` directly inside the
try block. `better-sqlite3`'s `.close()` is already safe to call on a closed
instance.

**Test:** After `close()`, confirm a second `close()` does not throw.

---

### 2C. Unprotected file writes in generators — `src/generator/file-generator.ts:156–177` and `:198–219`

**Bug:** `generatePathInstructionFiles()` (line 156) and
`generateCursorRulesDirFiles()` (line 198) both call `fs.mkdir()` +
`fs.writeFile()` without try/catch. The same class's `generateFile()` method
(line ~239) wraps its I/O in try/catch — this is an inconsistency. If a
write fails (permissions, full disk), the entire `generateAll()` promise
rejects without logging which file failed.

**Fix:** Wrap the `fs.mkdir()` + `fs.writeFile()` calls in both methods with
try/catch matching the existing pattern in `generateFile()`. Log the failing
path and re-push a `written: false, writeReason: 'error'` result instead of
propagating.

**Test:** Mock `fs.writeFile` to reject; verify the method returns a result
with `written: false` and does not throw.

---

### 2D. Unprotected atomic write — `src/generator/section-manager-service.ts:289–291`

**Bug:** `doWrite()` performs the atomic-write sequence
`fs.mkdir()` → `fs.writeFile(tmpPath)` → `fs.rename(tmpPath, filePath)` with
no try/catch. If any step fails the promise rejects, but the
`WriteSectionResult` error path is never used and the temp file is orphaned.

**Fix:** Wrap lines 289–291 in try/catch. On failure, attempt `fs.unlink(tmpPath)`
(best-effort cleanup), then return `{ written: false, deferred: false,
reason: 'write_error', ... }`.

**Test:** Mock `fs.rename` to reject; verify temp file cleanup and error result.

---

### 2E. Unwaited persistence on deactivation — `src/model/project-model-persistence.ts:155`

**Bug:** `deactivate()` at line 155 calls `await this.saveToDb()`, but the
caller in `extension.ts` currently calls `container.dispose()` which fires
synchronous `dispose()` methods. If the persistent model's `dispose()` does
not `await deactivate()`, the write is dropped. Additionally, there is no
timeout: a hung DB write blocks VS Code shutdown indefinitely.

**Fix:** Ensure the `dispose()` registered for this model is async-aware
(e.g., `container.registerAsync()`), or have `deactivate()` use
`Promise.race([this.saveToDb(), timeout(3_000)])` with a 3-second cap.

**Test:** Simulate `deactivate()` when `dirty===true`; verify `saveToDb()`
is awaited and the dirty flag is cleared.

---

### 2F. Flat tree building — `src/model/database.ts:164–175`

**Bug:** `buildTree()` pushes every row as a direct child of the root node:

```ts
for (let i = 1; i < rows.length; i++) {
  root.children!.push({ path: r.path, type: r.type, ... });
}
```

This collapses the directory hierarchy into a flat list. When templates
render `{project_context}`, the directory structure section loses all nesting
information, degrading agent context quality.

**Fix:** Build a proper parent-child tree using the pre-sorted `path`
column. For each row, walk up to find its parent (`path.dirname(r.path)`).
Rows are already sorted by path (from `ORDER BY path`), so parents appear
before children.

```ts
const nodeMap = new Map<string, DirectoryNode>();
nodeMap.set(root.path, root);
for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  const node: DirectoryNode = { path: r.path, type: r.type, ... };
  if (r.type === 'directory') node.children = [];
  const parentPath = path.dirname(r.path);
  const parent = nodeMap.get(parentPath) ?? root;
  parent.children!.push(node);
  nodeMap.set(r.path, node);
}
```

**Test:** Persist a 3-level tree (root → src → components), reload, verify
children are nested correctly.

---

### 2G. Unguarded JSON.parse — `src/schemas.ts:745`

**Bug:** `parsePatternRow()` calls `JSON.parse(row.evidence)` with no
try/catch. If the `evidence` column contains malformed JSON (e.g. after a
partial DB write or manual edit), this crashes the entire pattern-loading
path.

**Fix:** Wrap in try/catch; on failure, log a warning and return a
fallback `DetectedPattern` with `confidence: 0` and empty evidence arrays.

**Test:** Pass a row with `evidence: '{invalid'`; verify no throw and
fallback shape.

---

## Addendum — verified production failures

### 6A. Pattern confidence boost is dead code — `src/analyzer/project-analyzer.ts:73`
- The current boost formula is `Math.min(1.0, 1 + Math.log10(obs) * 0.1)`.
- For any `obs ≥ 2`, the right-hand side is always greater than `1.0`, so the
  multiplier is always `1.0` and the branch never changes `p.confidence`.
- This means the learning-derived confidence boost is effectively disabled
  even when observation data is present.

### 6B. Pattern observations are never recorded in production — `src/learning/learning-database.ts:360`
- `recordPatternObservation()` exists and is exercised only in tests.
- Grep of production sources shows the method is never called from runtime
  code, so `pattern_observations` remains empty in real use.
- Even if 6A is fixed, `countMap.get(id)` will still always return `undefined`.

### 6C. SQLite handles are never disposed — `src/extension.ts` activation flow
- `roadieDb` and `learningDb` are created in `activate()` but never registered
  with the `container` for disposal.
- This is separate from the broken `.open` guard in `LearningDatabase.close()`.
- Combined, this guarantees a file-handle leak on every window reload.

### 6D. Pattern keys embed version numbers — `src/analyzer/project-analyzer.ts:163`
- Pattern IDs are derived from descriptions such as
  `TypeScript project (v5.2.0)`.
- Every npm or toolchain upgrade changes the pattern key, orphaning prior
  observation history and preventing longitudinal learning.

### 6E. `pattern_observations` has no retention policy — `src/learning/learning-database.ts`
- The table is created without any pruning or TTL.
- In a long-lived repo, it will grow without bounds and eventually slow down
  pattern-count queries.

### 6F. `LearningDatabase` has no schema versioning — `src/learning/learning-database.ts`
- The learning schema is created directly from `LEARNING_SCHEMA`.
- There is no schema version table or migration strategy for future upgrades.
- This makes future extension updates brittle and likely to crash on DB schema changes.

### 6G. `cursor-rules.ts` simplified mode can persist broken empty output — `src/generator/templates/cursor-rules.ts`
- In simplified mode, the template drops the coding-standards section and may
  return `[]` for empty projects.
- The file generator still writes the preamble + marker wrapper, producing a
  file that contains only MDC frontmatter and no usable rule content.

### 6H. `cursor-rules-dir` ignores `simplified=true` — `src/generator/templates/cursor-rules-dir.ts`
- `FileGeneratorManager` retries failed generation with `simplified: true`.
- `generateCursorRulesDir()` has no `options` parameter, so its retry path is
  effectively a no-op for these files.

### 6I. `roadie.showMyStats` can render an empty per-intent table — `src/extension.ts:456`
- The command currently constructs a Markdown table from `stats.byType`.
- If `stats.byType` is empty but `totalWorkflows > 0`, the table header still
  appears with no rows, which is a poor UX and should have a fallback message.

### 6J. Missing SQLite index on `workflow_history.workflow_type`
- `workflow_history` has no index on `workflow_type`.
- Queries such as `getWorkflowCancellationStats()` and future analytics should
  be optimized with `CREATE INDEX IF NOT EXISTS idx_workflow_type ON workflow_history(workflow_type);`.

### 6K. `getWorkflowCancellationStats()` is untested — `src/learning/learning-database.ts:338`
- The method exists and is used by `roadie.showMyStats`.
- There is no dedicated test coverage for cancellation-count correctness.

### 6L. `agent-definitions.ts` is untested — `src/generator/templates/agent-definitions.ts`
- This template is core to the Chat Participant prompt generation path.
- No unit tests cover its conditional branches or output shape, making it a
  high-risk unverified component.

### 6M. Acceptance-rate file paths are not Markdown-escaped — `src/extension.ts:456`
- `showMyStats` renders generated file paths in Markdown without backticks.
- If a file path contains Markdown-sensitive characters, the report may be
  corrupted visually.

### 6N. VS Code marketplace metadata gaps — `package.json`
- Missing essential publishing fields: `icon`, `license`, `homepage`, `bugs`.
- The publisher field is set to `roadie`, which is likely not available or
  conflicts with Marketplace naming rules.
- This is a release-blocking packaging issue, separate from runtime hardening.

---

## 3. Race conditions and resource leaks

### 3A. Startup analysis race — `src/extension.ts:111–122`

**Bug:** `ensureProjectReady()` caches the analysis promise in
`projectReadyPromise`. On failure the catch resets it to `null` and
re-throws. If calls A and B arrive concurrently, A starts the promise, B
awaits it. When A's promise rejects, B receives the rejection and A resets
the cache. Then call C triggers a redundant re-analysis.

**Fix:** Use a settled-promise guard:
```ts
let analysisSettled = false;
projectReadyPromise = (async () => { ... })()
  .finally(() => { analysisSettled = true; });
```
Or simpler: don't reset `projectReadyPromise` on error — let subsequent
callers see the cached rejection via `.catch()`.

---

### 3B. Cancellation listener leak — `src/shell/vscode-providers.ts:68`

**Bug:** `options.cancellation.addEventListener('abort', () => ...)` adds a
listener that is never removed. Each model request accumulates one listener
on the shared `AbortSignal`. Over a long session with many chat turns this
can grow unbounded.

**Fix:** Pass `{ once: true }` as the third argument:
```ts
options.cancellation.addEventListener('abort', () => cancellationSource.cancel(), { once: true });
```

---

### 3C. Model resolver double-init — `src/engine/model-resolver.ts:42–47`

**Bug:** Two simultaneous `resolve()` calls before `cachedModelsPromise` is
assigned both enter the `if (!this.cachedModelsPromise)` branch and both call
`selectModels()`.

**Fix:** Assign the promise synchronously *before* the async body:
```ts
async resolve(tier: ModelTier): Promise<ModelInfo> {
  this.cachedModelsPromise ??= this.modelProvider.selectModels({}).catch((err) => {
    this.cachedModelsPromise = null;
    throw err;
  });
  // ...
}
```
The `??=` evaluates exactly once.

---

### 3D. Double-initialization of LearningDatabase — `src/learning/learning-database.ts:124`

**Bug:** `initialize()` can be called multiple times (e.g. rapid reload).
Each call runs `this.db.exec(LEARNING_SCHEMA)` and `this.prune()` on the
new handle without closing the old one). If the old handle had open
prepared statements, SQLite may report "database is locked".

**Fix:** At the top of `initialize()`, call `this.close()` first if
`this.db !== null`.

---

### 3E. Unbounded pending events — `src/watcher/file-watcher-manager.ts`

**Bug:** The `pending` Map has no size cap. If a tool generates thousands
of files at once (e.g. `npx create-next-app`), every file event is stored
in memory until the debounce fires.

**Fix:** Add a `MAX_PENDING` constant (e.g. 2000). When exceeded, clear the
map and emit a `FULL_RESCAN` event immediately instead of accumulating.

---

### 3F. Unbounded deferred writes — `src/generator/file-generator-manager.ts:115`

**Bug:** `deferredWrites: Map<string, GeneratedSection[]>` grows if files
are deferred but the user never saves them. No TTL or eviction.

**Fix:** Add a `MAX_DEFERRED` cap (e.g. 50) and/or a 10-minute TTL.
When the cap is hit, drop the oldest entry and log a warning.

---

### 3G. `Promise.all` in config regeneration — `src/extension.ts:163`

**Bug:** `Promise.all([generate('copilot_instructions'), generate('claude_md')])`
fails fast — if one generator throws, the other is abandoned.

**Fix:** Switch to `Promise.allSettled()` and log individual failures:
```ts
const results = await Promise.allSettled([...]);
for (const r of results) {
  if (r.status === 'rejected') logger.warn('Config regen failed:', r.reason);
}
```

---

## 4. Validation and error-handling hardening

### 4A. Command handlers unguarded — `src/shell/commands.ts:112–180`

**Bug:** All 10 command registrations call `await callbacks.onXxx()` with
no try/catch. If any callback throws, the VS Code command silently fails
and the user sees nothing.

**Fix:** Wrap each command body:
```ts
vscode.commands.registerCommand('roadie.init', async () => {
  try {
    await callbacks.onInit();
    void vscode.window.showInformationMessage('Roadie: Initialized');
  } catch (err) {
    getLogger().error('roadie.init failed', err);
    void vscode.window.showErrorMessage(
      `Roadie: Init failed — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
});
```
Repeat pattern for all 10 commands.

---

### 4B. Unsafe dependency-scanner casts — `src/analyzer/dependency-scanner.ts:86–88`

**Bug:** `pkg.dependencies` and `pkg.devDependencies` are cast to
`Record<string, string>` and spread:
```ts
const allDeps = {
  ...(pkg.dependencies as Record<string, string> | undefined),
  ...(pkg.devDependencies as Record<string, string> | undefined),
};
```
If these fields are not objects (e.g. `"dependencies": 42` in a malformed
package.json), spreading throws `TypeError: undefined is not iterable`.

**Fix:** Add a type guard:
```ts
const safeDeps = (v: unknown): Record<string, string> =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, string> : {};
const allDeps = { ...safeDeps(pkg.dependencies), ...safeDeps(pkg.devDependencies) };
```

Also guard `pkg.scripts` on line 113 the same way.

---

### 4C. No prompt length limit — `src/classifier/intent-classifier.ts:41`

**Bug:** `classify()` processes the full prompt through multiple regex
patterns with no size limit. A pathologically large input (100KB+) causes
regex backtracking and blocks the extension host.

**Fix:** Early-return for oversized prompts:
```ts
if (normalized.length > 10_000) {
  return { intent: 'general_chat', confidence: 0.5, signals: ['prompt-too-long'], requiresLLM: true };
}
```

---

### 4D. Unbounded file globbing — `src/analyzer/project-analyzer.ts`

**Bug:** The fast-glob call `fg(['**/*.{ts,tsx,js,jsx}'])` returns all
matching files into memory at once. In monorepos with 20K+ source files
this can cause OOM.

**Fix:** Pass a `limit` option to fast-glob (e.g. `{ limit: 5000 }`) and
log a warning when the limit is hit so the user knows analysis is partial.

---

### 4E. Silent section-marker skip — `src/generator/section-manager-service.ts:159`

**Bug:** When a start marker is found but no matching end marker exists,
the parser silently skips it (`i++; continue;`). If a user accidentally
deletes an end marker, their section edits are invisible — no warning, no
error.

**Fix:** Log a warning: `getLogger().warn('Unclosed section marker: ${id} in ${filePath}')`.

---

### 4F. Unguarded `onComplete` hook — `src/engine/workflow-engine.ts:195`

**Bug:** If `definition.onComplete(stepResults)` throws, the entire
workflow result is lost. The engine has already transitioned to `COMPLETED`
state, so the caller receives the rejection instead of the result plus the
error.

**Fix:** Wrap in try/catch; on failure, log the error and return the
`workflowResult` already computed (lines 186–193) with an appended warning
in `summary`.

---

### 4G. `previousError` not truncated — `src/engine/step-executor.ts:117`

**Bug:** `previousError = result.error ?? result.output` is passed to the
next attempt's prompt without length limits. If a step returns a 50KB error
or output, the refinement prompt can exceed model token limits.

**Fix:** Truncate: `previousError = (result.error ?? result.output)?.slice(0, 2_000)`.

---

### 4H. Overly broad model matching — `src/engine/model-resolver.ts:55`

**Bug:** `m.id.includes(preference)` matches substrings. A preference of
`'claude'` matches `'claude-opus'`, `'claude-sonnet'`, etc. The first
match wins, but the order depends on what VS Code's `selectChatModels()`
returns, which is not guaranteed.

**Fix:** Use `m.id.startsWith(preference)` or exact match against a
known model ID list. At minimum, prefer exact match first and fall back
to `includes` only if no exact match is found.

---

### 4I. Empty tool schemas in agent-spawner — `src/spawner/agent-spawner.ts:72–76`

**Bug:** Tools are passed with `inputSchema: {}` and
`description: name` (just the tool name repeated). Models may fail to
invoke tools correctly without proper schemas.

**Fix:** Have `ToolRegistry.getTools(scope)` return full tool
descriptors (name + description + schema) instead of just names.
`agent-spawner.ts` passes them through directly.

---

## 5. Code quality improvements

### 5A. Misleading stub implementations

**`src/tracking/edit-tracker.ts:~166`** — `getEditHistory()` always returns
`[]`. Callers believe they're getting history. Add `@deprecated` annotation
and a `getLogger().debug('getEditHistory: stub — not yet implemented')` log
line so the gap is visible.

**`src/model/project-model-persistence.ts:78–97`** — `reconcileWithFileSystem()`
returns `{ status: 'in-sync' }` without checking the filesystem. Add a
`// TODO(v0.8.0): implement actual filesystem reconciliation` comment and
log a debug message.

---

### 5B. Standardize logger usage — `src/extension.ts`

The file uses `log.error(...)` (broken), `getLogger().info(...)`,
`logger.info(...)` (local variable), and `(getLogger() as RoadieLogger).show()`.
Standardize: use the `logger` local variable throughout the `activate()`
function body (it's already declared at line 53), and `getLogger()` in
callbacks that close over it. Remove all bare `log` references.

---

### 5C. Weak binary detection — `src/dictionary/entity-writer.ts:76–81`

`isBinaryContent()` checks only the first 512 chars for null bytes. Large
text files with embedded nulls pass. Add a file-extension allowlist check
first (`.ts`, `.js`, `.json`, `.md`, `.yml`, `.yaml`, `.toml`, `.lock`)
and skip content scanning for known-text extensions.

---

### 5D. Circular dependency in workflow schemas — `src/schemas.ts:187`

`dependsOn: z.array(z.string()).default([])` allows step A → B → A cycles.
Add a `.superRefine()` check on `WorkflowDefinitionSchema` that
validates no step references itself or creates a cycle via DFS.

---

### 5E. Weak temp-file naming — `src/generator/section-manager-service.ts:289`

`${filePath}.roadie-tmp-${process.pid}` is unique per process but not per
concurrent write within the same process (the lock prevents this today,
but if the lock is ever bypassed, collisions occur). Use
`${filePath}.roadie-tmp-${process.pid}-${Date.now()}` for defense-in-depth.

---

## 6. Additional Findings From Deep Audit

The items below were found by re-auditing the v0.7.0 learning-loop code paths
against the codebase after drafting sections 2–5. They are **not duplicates** of
anything above. Each is verified against a specific line of source.

### 6A. **Confidence boost formula is permanently dead code** — `src/analyzer/project-analyzer.ts:73`

```ts
const boost = Math.min(1.0, 1 + Math.log10(obs) * 0.1);
p.confidence = Math.min(1.0, p.confidence * boost);
```

For any `obs ≥ 2`, `1 + Math.log10(obs) * 0.1 > 1.0`, so `Math.min(1.0, …)` **always** returns `1.0`. The multiplier is always exactly `1.0` — boost never activates. (For `obs = 0`, `log10(0) = -Infinity` would actually zero out confidence — but the `obs > 1` guard on line 72 prevents that, which is why no one has noticed.)

**Fix:** apply the clamp to the final confidence, not to the multiplier:
```ts
p.confidence = Math.min(1.0, p.confidence * (1 + Math.log10(obs) * 0.1));
```

**Severity:** High — v0.7.0 advertised this feature in the changelog and it has never worked.

---

### 6B. **`recordPatternObservation()` is never called in production** — `src/learning/learning-database.ts:360`

Only 3 test-file callers. `ProjectAnalyzer` *reads* from `pattern_observations` (line 66) but never *writes*. The table stays empty forever, `countMap.get(id)` always returns `undefined`, and the observation-count feature is structurally dead even if 6A is fixed.

**Fix:** in `ProjectAnalyzer.analyze()`, after `derivePatterns()`, iterate every derived pattern and call `this.learningDb.recordPatternObservation(p.category + ':' + p.description)` (using the same ID scheme that the read-side expects).

**Severity:** High — paired with 6A, v0.7.0's pattern-learning feature is 100% inert.

---

### 6C. **Neither `roadieDb` nor `learningDb` is registered with the dispose container** — `src/extension.ts:75–95`

Both databases are created inside `activate()` but never passed to `container.register()`. On `deactivate()` the container disposes only registered resources — these two SQLite handles are never closed. Separate from bug 2B (the broken `.open` guard): even if 2B is fixed, the fix is unreachable because `close()` is never called.

**Fix:** immediately after both DBs are created successfully:
```ts
container.register({
  dispose: () => {
    try { learningDb?.close(); } catch {}
    try { roadieDb?.close(); } catch {}
  },
});
```

**Severity:** Critical — pairs with 2B to cause a real file-handle leak on every reload.

---

### 6D. **Pattern key embeds dependency version — observations orphaned on every version bump** — `src/analyzer/project-analyzer.ts:70`

```ts
const id = p.category + ':' + p.description;   // e.g. "language:TypeScript project (v5.2.0)"
```

When TypeScript upgrades from 5.2.0 to 5.3.0, the description text changes, the key no longer matches stored rows, and every historical sighting becomes unreachable. Once we fix 6A+6B the boost becomes a *regression risk* on every `npm upgrade`.

**Fix:** build the key from stable fields only — e.g. `p.category + ':' + p.id` (if patterns have a stable ID), or strip the version with a regex: `p.description.replace(/\s*\(v[\d.]+\)\s*/, '')`.

**Severity:** High — must be fixed in the same batch as 6A/6B or the learning signal is self-sabotaging.

---

### 6E. **`pattern_observations` table has no retention policy** — `src/learning/learning-database.ts:277–307` (`prune()` method)

`prune()` caps `file_snapshots` (50 per file) and `workflow_history` (100 entries) but does nothing for `pattern_observations`. Every `analyze()` call — triggered on every watcher batch — appends N rows (5–9 per project). A busy workspace accumulates tens of thousands of rows per week with no cleanup.

**Fix:** add to `prune()`:
```sql
DELETE FROM pattern_observations
WHERE id NOT IN (SELECT id FROM pattern_observations ORDER BY id DESC LIMIT 5000);
```
Add `deletedPatternObservations` to `PruneResult`.

**Severity:** Medium — becomes critical after 6B is fixed, since only then does the table actually fill.

---

### 6F. **`LearningDatabase` has no schema version — future migrations will silently fail** — `src/learning/learning-database.ts:73–110`

`RoadieDatabase` tracks `CURRENT_SCHEMA_VERSION = 1` with a `schema_version` table; `LearningDatabase` uses `CREATE TABLE IF NOT EXISTS` throughout and has no versioning. Adding a non-nullable column in any future release will crash on existing installs.

**Fix:** add a `learning_schema_version` field. Simplest path: reuse `RoadieDatabase.schema_version` with a distinct key (`'learning'`), gate `initialize()` on it, run `ALTER TABLE` migrations conditionally.

**Severity:** Medium — latent; deferring past v0.8.0 means the first schema change will break every existing install.

---

### 6G. **`cursor-rules.ts` with `simplified=true` on an empty project writes a file containing only MDC frontmatter** — `src/generator/templates/cursor-rules.ts:27–56`

When `simplified=true` the function returns early after building `tech-stack` and `commands`. If the model is empty (first run before analysis completes), both sections are empty and `sections === []`. The preamble frontmatter is still prepended, so the output is literally:

```
---
alwaysApply: true
---

```

Cursor silently loads an empty rule. Because the file exists and has a stable hash, the watcher will never rewrite it.

**Fix:** if `sections.length === 0`, skip the write entirely, or emit a placeholder section (`## Status\nProject analysis pending.`).

**Severity:** Medium — user-visible bad output, silently persists.

---

### 6H. **`cursor-rules-dir` template does not accept a `simplified` option — silent contract gap** — `src/generator/templates/cursor-rules-dir.ts:69`

Every other v0.7.0 template (`claude-md`, `cursor-rules`, `copilot-instructions`, `path-instructions`) accepts `options?: { simplified?: boolean }`. `cursor-rules-dir` does not. `FileGeneratorManager`'s self-healing retry (`{ simplified: true }`) is therefore a no-op for this file type — it will regenerate identical output on retry and the retry-then-succeed loop from v0.6.1 H2 silently fails.

**Fix:** add `options?: { simplified?: boolean }` to `generateCursorRulesDir`. In simplified mode, omit the `patterns` block (same guard `path-instructions` already has at line 82).

**Severity:** Medium — regression from v0.6.1's self-healing contract.

---

### 6I. **`showMyStats` renders an empty markdown table on fresh install** — `src/extension.ts:471–491`

The "Per-Intent Accuracy" table header + separator are always emitted. If `stats.byType` is empty (workflow history is off by default — `roadie.workflowHistory = false`), no rows are appended and the user sees a bare table with just headers. The "Most-Edited Files" section below already has a `*No edit data recorded yet.*` fallback; "Per-Intent Accuracy" does not.

**Fix:** after the header rows, gate:
```ts
if (Object.keys(stats.byType).length === 0) {
  md += '*No workflow data recorded yet. Enable with `Roadie: Enable Workflow History`.*\n\n';
} else { /* emit rows */ }
```

**Severity:** Low — cosmetic but every first-run user hits it.

---

### 6J. **`workflow_history` has no index on `workflow_type`** — `src/learning/learning-database.ts:84–94`

`LEARNING_SCHEMA` defines only `idx_snapshots_path`. `getWorkflowStats()` and `getWorkflowCancellationStats()` both do `GROUP BY workflow_type` and run on **every** `@roadie` chat turn (from `chat-participant.ts:98`, after v0.7.0's `adjustWithLearning()` wiring). With `MAX_WORKFLOW_ENTRIES = 100` it's cheap today, but the query runs unconditionally.

**Fix:** add to `LEARNING_SCHEMA`:
```sql
CREATE INDEX IF NOT EXISTS idx_workflow_type ON workflow_history(workflow_type);
```

**Severity:** Low — preventative; zero behavioral change.

---

### 6K. **`getWorkflowCancellationStats()` is untested** — `src/learning/learning-database.ts:338–352`

Central to `adjustWithLearning()` and the AGENTS.md `learned-preferences` section. A regression (e.g., the `'cancelled'` status string changing) would be invisible. `learning-database.test.ts` has extensive tests for every other query method but **zero** for this one.

**Fix:** add two unit tests: (1) mixed `completed`/`cancelled` entries per type, asserting computed rates; (2) empty-table case returning `[]`.

**Severity:** Medium — test-coverage gap on load-bearing v0.7.0 code.

---

### 6L. **`agent-definitions.ts` has no sibling test file** — whole directory

Every other template has a `.test.ts` sibling. `agent-definitions.ts` — which has the most complex v0.7.0 logic (`key-files`, `learned-preferences`, nested `getMostEditedFiles` × `getGenerationAcceptanceRate` call pattern on lines 193–209) — is completely untested.

**Fix:** add `agent-definitions.test.ts` with at minimum: (1) empty `learningDb` (no sections appear); (2) populated `getMostEditedFiles` + `getGenerationAcceptanceRate`; (3) mock that throws on `getGenerationAcceptanceRate` to verify inner `catch`.

**Severity:** Medium — worst test-coverage gap in the codebase.

---

### 6M. **`agent-definitions.ts` acceptance-rate paths are not backtick-quoted** — line 200

```ts
acceptanceLines.push(`- ${filePath}: ${pct}% accepted (${acc.accepted + acc.edited} transitions)`);
```

The `key-files` section 15 lines above wraps paths in backticks. The acceptance-rate section does not. Paths with markdown specials (`_`, `|`, `*`) corrupt the rendered section; a path containing a literal backtick breaks the code span in `key-files`.

**Fix:** wrap the path in backticks and escape backticks defensively:
```ts
const safe = '`' + filePath.replace(/`/g, '\u200b`') + '`';
acceptanceLines.push(`- ${safe}: ${pct}% accepted …`);
```

**Severity:** Low — cosmetic, but the inconsistency with the neighboring section is a red flag.

---

### 6N. **`package.json` missing required Marketplace fields**

```json
"publisher": "roadie",
// no "icon", "license", "homepage", "bugs"
"repository": { "url": "https://github.com/rmg007/Roadie_App.git" }
```

- **`publisher: "roadie"`** — the `roadie` publisher ID is very likely already taken on the Marketplace; `vsce publish` will fail.
- **No `icon`** — ships a generic puzzle-piece icon.
- **No `license`** — `vsce package` warns; VSIX has no license metadata.
- **No `homepage`/`bugs`** — Marketplace sidebar shows broken links.
- **Repository URL** — if `rmg007/Roadie_App` is private, the Marketplace "View Source" link 404s.

**Fix:** add `"icon": "images/icon.png"`, `"license": "MIT"` (or whatever the project chooses), `"homepage"`, `"bugs": { "url": "https://github.com/.../issues" }`. Confirm publisher ID with `vsce login <publisher>` before shipping.

**Severity:** Low — blocks first Marketplace publish, otherwise harmless.

---

## 7. Verification

After each batch of changes:

1. `npm run test` — all tests pass (≥620).
2. `npm run lint` — zero new warnings.
3. `npm run build` — clean.

Manual verification:

4. Reload the extension 10 times rapidly (`Developer: Reload Window`) →
   confirm no "SQLITE_BUSY" or file-handle leak errors in the Output panel.
5. Open a workspace with 10K+ `.ts` files → confirm analysis completes and
   does not OOM the extension host.
6. Corrupt `.github/.roadie/project-model.db` by writing garbage →
   reactivate → confirm graceful fallback to in-memory mode.
7. Delete an end marker from a generated file (e.g. `AGENTS.md`) →
   rescan → confirm warning logged in Output panel.
8. Run every `roadie.*` command after injecting a failure into its
   callback → confirm `showErrorMessage` appears.

---

## 8. Implementation order

| Batch | Items | Files touched | Risk |
|-------|-------|---------------|------|
| 1 | 2A, 2B, 2G, 5B, **6C** | extension.ts, learning-database.ts, schemas.ts | Low — isolated one-liners; 6C pairs naturally with 2B |
| 2 | 2C, 2D, 2E, 4E, 5E, **6G** | file-generator.ts, section-manager-service.ts, project-model-persistence.ts, cursor-rules.ts | Low — wrapping existing code |
| 3 | 2F | database.ts | Medium — logic change in tree builder |
| 4 | 3A, 3B, 3C, 3D, 3G | extension.ts, vscode-providers.ts, model-resolver.ts, learning-database.ts | Medium — concurrency changes |
| 5 | 4A, **6I** | commands.ts, extension.ts (`showMyStats` empty-state) | Low — mechanical wrapping |
| 6 | 4B, 4C, 4D, **6A, 6B, 6D** | dependency-scanner.ts, intent-classifier.ts, project-analyzer.ts | Medium — **6A+6B+6D must ship together or the learning feature remains broken** |
| 7 | 4F, 4G, 4H, 4I | workflow-engine.ts, step-executor.ts, model-resolver.ts, agent-spawner.ts | Medium — engine touches |
| 8 | 3E, 3F, 5A, 5C, 5D, **6E, 6F, 6H, 6J** | file-watcher-manager.ts, file-generator-manager.ts, edit-tracker.ts, entity-writer.ts, schemas.ts, learning-database.ts, cursor-rules-dir.ts | Low — caps, retention, indices, schema version |
| 9 | **6K, 6L, 6M** | learning-database.test.ts, agent-definitions.test.ts (new), agent-definitions.ts | Low — pure test additions + one cosmetic fix |
| 10 | **6N** | package.json | Low — metadata only; confirm publisher ID before running `vsce` |

---

## 9. Release decision

This release is a hardening-only milestone — zero new features. Ship when
all 10 batches pass verification. If any medium-risk batch destabilizes
tests, defer it to v0.7.2 rather than blocking the rest.

**Batch 6 is the single most important batch in this release.** Items 6A + 6B + 6D, taken together, reveal that v0.7.0's advertised pattern-learning feature has been **100% inert since it shipped** — the boost formula is always 1.0× (6A), the table is never written to (6B), and even if both were fixed, every version bump orphans prior observations (6D). All three must ship in the same release or the feature is false advertising. Consider a dedicated batch-6 regression test that actually measures a non-trivial confidence delta end-to-end.
