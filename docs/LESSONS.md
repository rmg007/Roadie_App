# Lessons — self-correction log

Append one line per mistake caught. Newest first. Read this before starting a non-trivial task.

Format: `YYYY-MM-DD — <mistake> → <correction>`

---

- 2026-04-17 — doc-refresh-v1.0.0: Update `roadie_docs/` at every vX.Y.0 release; use content anchors (header/section patterns) not line numbers; verify actual source exports before writing spec docs.
- 2026-04-17 — Phase E: `TelemetryReporter.isEnabled()` used `require('vscode')` inside the method; overriding `getConfiguration` in a `beforeEach` had no effect because the module-level mock was already resolved → add an `_enabledOverride: boolean | null` constructor param so tests can force-enable/disable without touching the vscode mock.
- 2026-04-17 — Phase H: `vi.spyOn(fs, 'writeFileSync')` throws "Cannot redefine property" in Vitest because Node's built-in fs properties are non-configurable when imported as ESM → replace runtime spy with static source analysis for fs-boundary test.
- 2026-04-17 — Phase H: `require('../classifier/intent-classifier')` inside Vitest test fails with MODULE_NOT_FOUND because Vitest runs under ESM and `require` does not resolve TypeScript source → use `await import(...)` for all dynamic imports in integration tests.
- 2026-04-17 — Phase C: fuzz latency test used per-call `Date.now()` assertion (< 5ms) which is flaky under full-suite concurrency on Windows (coarse timer + CPU contention) → use median over a batch with `performance.now()` instead of per-call assertions for latency tests.
- 2026-04-17 — Phase C: `extension.test.ts` times out consistently when run in parallel with the full 61-file suite (dynamic import warm-up cost under CPU load); pre-existing flakiness confirmed by baseline check before any Phase C changes.
- 2026-04-17 — disposable-leak.test.ts: mocked `InMemoryProjectModel` class missing `dispose()` method caused container.dispose() to throw `d.dispose is not a function` → always mirror ALL disposable methods in mocks, including `dispose()`, for classes registered via `container.register()`.
- 2026-04-17 — A7 test used `vi.mock('../../shell/...')` paths from `src/__perf__/` but test file is at `src/__perf__/`, so paths should be `'../shell/...'` → always verify relative mock paths match the test file location.
- 2026-04-17 — B9 `isTrusted` defined as a getter; test tried `(learning as any).isTrusted = false` which throws "Cannot set property" → use `Object.defineProperty(obj, 'prop', { get: () => false, configurable: true })` to override getters in tests.
- 2026-04-15 — Package script failed with extraneous dependencies in node_modules → use `--no-dependencies` flag in `vsce package` to skip validation (better-sqlite3 is bundled anyway).
- 2026-04-15 — Left `test-output.txt`, `test-output2.txt`, `inspect-db.js` at repo root → temp diagnostics belong in `scripts/` or in OS `/tmp`; never in repo root.
- 2026-04-15 — Started implementing the chat-fallback fix without writing a plan → always write a plan to `roadie/docs/<slug>.md` and wait for approval before multi-file edits.
- 2026-04-14 — Hardcoded `roadie-0.5.0.vsix` in `scripts/install.js` and `scripts/doctor.js` → always read version from `package.json`.
- 2026-04-14 — Bumped to `0.5.1` when CHANGELOG already described `0.5.2` work in source → read CHANGELOG before choosing a version number.
- 2026-04-14 — Used `node.name` on `DirectoryNode` which only has `path` → always check the type definition before dereferencing a field; `path.basename(node.path)` is the correct idiom.
- 2026-04-14 — Package script used bare `vsce` which is not on PATH → use `npx @vscode/vsce package --allow-missing-repository` in the script.
2026-04-16: database.ts static import of better-sqlite3 crashed extension before extension.ts try/catch could run. Fix: change to import type + lazy require() in constructor.
