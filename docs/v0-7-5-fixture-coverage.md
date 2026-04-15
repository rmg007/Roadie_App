# v0.7.5 — Fixture Coverage Expansion

**Target version:** 0.7.4 → 0.7.5
**Author:** roadie-architect
**Date:** 2026-04-15

---

## 1. Problem

The analyzer test suite exercises only a single fixture (`ts-calculator`) for all
directory-scanner and project-analyzer scenarios. Two untested edge cases exist:
(a) projects in mid-TypeScript migration where `.js` and `.ts` files coexist under
`src/`, and (b) monorepos where source lives under `packages/*/src/` instead of a
top-level `src/`. This plan adds stress-test coverage for both layouts to pin
intentional behaviour and surface regressions early. No source files are changed.

---

## 2. Root cause

This is a **coverage plan**, not a bug fix. The behaviours described below are
intentional. The goal is to document them with assertions so that any future
unintended change is caught by CI.

**`roadie/src/analyzer/project-analyzer.ts`, line 170–185** — `derivePatterns()`
checks for TypeScript first via an `if / else if` chain. For a mixed JS+TS project
this emits `language:TypeScript` and omits a separate `language:JavaScript` entry.
That is the designed behaviour (TypeScript subsumes JavaScript). No change is made
to `derivePatterns()` in this release. If that design decision needs revisiting,
open a separate bug-fix plan.

**`roadie/src/analyzer/directory-scanner.ts`, line 25–33** — `assignRole()` maps
directory names to roles. Intermediate monorepo directories (`packages`, `core`,
`ui`, `utils`) are not in the allow-list and receive `role: undefined`. The leaf
`src/` nodes inside each package correctly receive `role: 'source'`. This is the
current designed behaviour; the new tests pin it explicitly.

---

## 3. Fix plan

No source files are changed in this version. The plan delivers new fixtures, new
scenario files, a `cassette?: string` interface fix, and new unit test cases only.

### Step 1 — Create `test/fixtures/mixed-js-ts/`

Create the following files. Content must be minimal — only what the scanner needs.

**`roadie/test/fixtures/mixed-js-ts/package.json`**
```json
{
  "name": "mixed-js-ts-sample",
  "version": "1.0.0",
  "scripts": { "build": "tsc" },
  "devDependencies": {
    "typescript": "^5.4.0"
  }
}
```

**`roadie/test/fixtures/mixed-js-ts/tsconfig.json`**
```json
{
  "compilerOptions": {
    "allowJs": true,
    "outDir": "dist",
    "target": "ES2020",
    "module": "commonjs"
  },
  "include": ["src"]
}
```

**`roadie/test/fixtures/mixed-js-ts/src/utils.js`**
```js
// Plain JS utility — intentionally not converted to TS
export function clamp(n, min, max) { return Math.min(Math.max(n, min), max); }
```

**`roadie/test/fixtures/mixed-js-ts/src/parser.ts`**
```ts
export function parseNumber(s: string): number { return Number(s); }
```

### Step 2 — Create `test/fixtures/nested-monorepo/`

**`roadie/test/fixtures/nested-monorepo/package.json`**
```json
{
  "name": "nested-monorepo-sample",
  "version": "1.0.0",
  "private": true,
  "workspaces": ["packages/*"]
}
```

**`roadie/test/fixtures/nested-monorepo/packages/core/package.json`**
```json
{ "name": "@sample/core", "version": "1.0.0", "devDependencies": { "typescript": "^5.4.0" } }
```

**`roadie/test/fixtures/nested-monorepo/packages/core/src/index.ts`**
```ts
export const CORE_VERSION = '1.0.0';
```

**`roadie/test/fixtures/nested-monorepo/packages/ui/package.json`**
```json
{ "name": "@sample/ui", "version": "1.0.0", "dependencies": { "react": "^18.0.0" }, "devDependencies": { "typescript": "^5.4.0" } }
```

**`roadie/test/fixtures/nested-monorepo/packages/ui/src/Button.tsx`**
```tsx
export const Button = ({ label }: { label: string }) => <button>{label}</button>;
```

**`roadie/test/fixtures/nested-monorepo/packages/utils/package.json`**
```json
{ "name": "@sample/utils", "version": "1.0.0" }
```

**`roadie/test/fixtures/nested-monorepo/packages/utils/src/format.js`**
```js
export function formatDate(d) { return d.toISOString(); }
```

### Step 3 — Make `cassette` optional in `ScenarioSpec`

File: **`roadie/test/harness/scenario-runner.ts`, line 48**

Change:
```ts
  cassette: string;
```
To:
```ts
  cassette?: string;
```

Reason: the JSON schema was already made optional in v0.7.3. The TypeScript
interface was not updated at the same time. The new scenario JSONs intentionally
omit cassette files (they run in offline/mock mode). Without this fix the
TypeScript compiler will reject the scenario JSON imports at type-check time.

### Step 4 — Create scenario `mixed-js-ts-onboard.json`

**`roadie/test/harness/scenarios/mixed-js-ts-onboard.json`**
```json
{
  "$schema": "test/harness/scenarios/schema.json",
  "version": 1,
  "id": "mixed-js-ts-onboard",
  "name": "Onboard intent on mixed JS/TS project",
  "workspaceFixture": "mixed-js-ts",
  "prompt": "@roadie help me understand this project",
  "expect": {
    "intent": { "type": "onboard", "confidence": ">= 0.6" },
    "workflow": "onboard",
    "stepsExecuted": { ">=": 4, "<=": 10 }
  }
}
```

### Step 5 — Create scenario `nested-monorepo-review.json`

**`roadie/test/harness/scenarios/nested-monorepo-review.json`**
```json
{
  "$schema": "test/harness/scenarios/schema.json",
  "version": 1,
  "id": "nested-monorepo-review",
  "name": "Review intent on nested monorepo",
  "workspaceFixture": "nested-monorepo",
  "prompt": "@roadie review the core package",
  "expect": {
    "intent": { "type": "review", "confidence": ">= 0.6" },
    "workflow": "review",
    "stepsExecuted": { ">=": 5, "<=": 12 }
  }
}
```

### Step 6 — Add tests to `directory-scanner-calculator.test.ts`

File: **`roadie/src/analyzer/directory-scanner-calculator.test.ts`**

After the existing last `it()` block (line 57), add a new `describe` block:

```ts
describe('DirectoryScanner — mixed-js-ts fixture', () => {
  const MIXED_ROOT = path.resolve(__dirname, '../../test/fixtures/mixed-js-ts');

  it('assigns source role to src/ in a mixed JS/TS project', async () => {
    const root = await scanDirectories(MIXED_ROOT);
    const src = root.children?.find((c) => c.path.endsWith('src'));
    expect(src).toBeDefined();
    expect(src!.role).toBe('source');
  });
});

describe('DirectoryScanner — nested-monorepo fixture', () => {
  const MONO_ROOT = path.resolve(__dirname, '../../test/fixtures/nested-monorepo');

  it('has no role=undefined entries at depth 2+ under packages/', async () => {
    const root = await scanDirectories(MONO_ROOT);
    // fast-glob returns forward-slash paths on all platforms including Windows;
    // use '/' explicitly rather than path.sep to avoid incorrect depth counts.
    const allNodes = root.children ?? [];
    const depth2plus = allNodes.filter((c) => {
      const rel = path.relative(MONO_ROOT, c.path).replace(/\\/g, '/');
      return rel.split('/').length >= 2;
    });
    // src/ nodes at depth 2+ (e.g. packages/core/src) must be assigned 'source'
    const srcNodes = depth2plus.filter((c) => path.basename(c.path) === 'src');
    expect(srcNodes.length).toBeGreaterThan(0);
    srcNodes.forEach((n) => expect(n.role).toBe('source'));
    // Intermediate dirs (packages/core, packages/ui) intentionally have role=undefined.
    // Assert that zero src/ nodes are undefined — if this fails, assignRole() regressed.
    const nullSrcRoles = srcNodes.filter((n) => n.role === undefined);
    expect(nullSrcRoles.length).toBe(0);
  });
});
```

### Step 7 — Add test to `project-analyzer-calculator.test.ts`

File: **`roadie/src/analyzer/project-analyzer-calculator.test.ts`**

After the last existing `it()` block, add inside the outer `describe`:

```ts
it('mixed-js-ts fixture derives TypeScript pattern without throwing', async () => {
  const mixedRoot = path.resolve(__dirname, '../../test/fixtures/mixed-js-ts');
  const mixedTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'roadie-mixed-'));
  try {
    await fs.copyFile(path.join(mixedRoot, 'package.json'), path.join(mixedTmpDir, 'package.json'));
    await fs.copyFile(path.join(mixedRoot, 'tsconfig.json'), path.join(mixedTmpDir, 'tsconfig.json'));
    const mixedModel = new InMemoryProjectModel(null);
    const mixedAnalyzer = new ProjectAnalyzer(mixedModel);
    await expect(mixedAnalyzer.analyze(mixedTmpDir)).resolves.not.toThrow();
    const patterns = mixedModel.getPatterns();
    expect(patterns.some((p) => p.category === 'language')).toBe(true);
  } finally {
    await fs.rm(mixedTmpDir, { recursive: true, force: true });
  }
});
```

---

## 4. Acceptance tests

```bash
# From roadie/
npm test -- --reporter=verbose 2>&1 | grep -E "(PASS|FAIL|mixed-js-ts|nested-monorepo)"
```

Expected: all lines contain `PASS`; the two new `describe` blocks appear in output.
Total test count must be >= 649 (baseline 646 + 3 new tests from Steps 6 and 7).

```bash
# Scenario schema validation (if harness runner exists)
node roadie/scripts/verify-phase2.js
```

Expected: exits 0; new scenario IDs `mixed-js-ts-onboard` and
`nested-monorepo-review` listed as discovered.

```bash
npm run lint
```

Expected: 0 errors, 0 warnings related to new test files or the `cassette?`
interface change in `scenario-runner.ts`.

---

## 5. Risks / rollback

| Risk | Likelihood | Mitigation |
|---|---|---|
| `tsconfig.json` `allowJs` causes analyzer to emit unexpected stack entries | Low | Test pins exact assertion (`patterns.some(p => p.category === 'language')`) — any change is visible |
| Scenario JSONs rejected by harness for missing `cassette` field before Step 3 lands | High | Step 3 (make `cassette?` optional) must be implemented before Steps 4–5 in the same PR |
| `packages/ui/src/Button.tsx` JSX extension confuses file-type detection | Low | Only `package.json` and `tsconfig.json` are copied into tmpDir for analyzer test; `.tsx` file is only scanned by `scanDirectories` which ignores file extensions |
| Test count drops below 646 gate | None | Steps only add tests, never remove |
| Windows `path.sep` causes incorrect depth split | Mitigated | Step 6 uses `.replace(/\\/g, '/')` before splitting on `'/'` |

**Rollback:** delete the two fixture directories and two scenario JSON files;
revert the two test file additions and the `cassette?: string` change in
`scenario-runner.ts`. No other source files were modified.

---

## 6. Version bump

**Target version:** `0.7.5`

**`roadie/package.json`:** `"version": "0.7.4"` → `"version": "0.7.5"`

**`CHANGELOG.md` entry:**

```
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
```
