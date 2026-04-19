# Lint Waivers (R0.b Recovery Baseline)

**Updated**: 2026-04-19  
**Baseline**: 82 errors, 37 warnings remaining (post-Phase 2, after eqeqeq fixes)

> **Note**: All waivers below expire on **2026-05-19** (30 days). They should be resolved in R1 as part of comprehensive type safety improvements.

## Waiver Summary

| Rule | Count | Owner | Status | Notes |
|------|-------|-------|--------|-------|
| `@typescript-eslint/no-explicit-any` | 37 | Solo | Deferred | Complex API contracts; requires upstream type definitions |
| `@typescript-eslint/no-non-null-assertion` | 27 | Solo | Deferred | Safe guards in place; refactoring requires architecture review |
| `@typescript-eslint/explicit-function-return-type` | 13 | Solo | Deferred | Auto-inferrable returns; low-priority consistency lint |
| `no-restricted-syntax` (sync fs) | 11 | Solo | Deferred | Session-tracker & vector-store; requires async migration |
| `@typescript-eslint/no-floating-promises` | 2 | Solo | Deferred | Error boundaries and test fixtures; non-blocking |
| `@typescript-eslint/no-var-requires` | 2 | Solo | Deferred | Dynamic requires in utility-mapper; low risk |
| `@typescript-eslint/no-unused-vars` | 6 | Solo | Deferred | Dead imports; safe to remove but low priority |
| `no-console` | 6 | Solo | Deferred | Debug output; temporary pending logging infrastructure |

**Total Remaining**: 82 errors, 37 warnings (119 problems)

---

## Detailed Waivers

### 1. `@typescript-eslint/no-explicit-any` (37 errors)

These occur in dynamic mapping logic, workflow engine callbacks, and API bridge code where contract types are either upstream-dependent or require significant refactoring.

**Files affected**:
- `src/engine/definitions/feature.ts` (4 errors, lines 24, 68, 76, 84)
- `src/engine/workflow-engine.ts` (25 errors)
- `src/generator/file-generator.ts` (4 errors)
- `src/platform-adapters/firecrawl-client.ts` (3 errors)
- `src/shell/errors.ts`, `src/types.ts`, `src/platform-adapters/git-service.ts` (1 each)

**Reason**: Contract convergence deferred. Many `any` types exist at API boundaries (LLM responses, firecrawl enrichment) where the shape is dynamically determined. Upstream documentation standards need to be locked before full typing.

**Expiry**: 2026-05-19

---

### 2. `@typescript-eslint/no-non-null-assertion` (27 errors)

Non-null assertions used after guarded length checks or safely after optional chaining.

**Files affected**:
- `src/classifier/intent-classifier.ts` (3 errors, lines 105, 165)
- `src/container.ts` (1 error)
- `src/generator/templates/cursor-rules.ts` (1 error)
- `src/index.ts` (2 errors)
- `src/engine/index.ts` (20 errors)

**Reason**: Safe-guarded assertions. The assertions follow explicit length checks, existence guards, or occur in control flow where null is impossible. Removing requires adding verbose null checks; considered low risk.

**Expiry**: 2026-05-19

---

### 3. `@typescript-eslint/explicit-function-return-type` (13 warnings)

Functions with inferrable return types (void, string literals, object shapes).

**Files affected**:
- `src/index.ts` (5 warnings)
- `src/engine/vector-store-service.ts` (2 warnings)
- `src/generator/templates/` (4 warnings)
- `src/platform-adapters.ts` (2 warnings)

**Reason**: Consistency lint. Return types are auto-inferrable; explicit annotations add verbosity without safety gains.

**Expiry**: 2026-05-19

---

### 4. `no-restricted-syntax` (11 errors — synchronous fs)

Synchronous filesystem operations in session and vector store modules.

**Files affected**:
- `src/engine/session-tracker.ts` (4 errors, lines 25, 26, 33, 35)
- `src/engine/vector-store-service.ts` (2 errors, lines 22, 23)
- `src/learning/learning-database.ts` (5 errors)

**Reason**: Session persistence and vector cache require synchronous reads/writes during initialization. Full async migration deferred to R1 (impacts startup flow).

**Expiry**: 2026-05-19

---

### 5. `@typescript-eslint/no-floating-promises` (2 errors)

Promises not awaited in test fixtures and error boundaries.

**Files affected**: `src/engine/index.ts` (lines 57, 133)

**Reason**: Test cleanup and error boundaries; non-blocking fire-and-forget semantics intentional.

**Expiry**: 2026-05-19

---

### 6. `@typescript-eslint/no-var-requires` (2 errors)

Dynamic require in utility-mapper (`src/engine/index.ts`, lines 224–225).

**Reason**: Module resolution for dynamic skill loading; low-risk, wrapped in error boundaries.

**Expiry**: 2026-05-19

---

### 7. `@typescript-eslint/no-unused-vars` (6 warnings)

Dead imports pending codebase stabilization.

**Reason**: Safe to remove but deferred for stability.

**Expiry**: 2026-05-19

---

### 8. `no-console` (6 warnings)

Debug statements pending Logger infrastructure.

**Reason**: Temporary output; will be replaced with `Logger` interface.

**Expiry**: 2026-05-19

---

## Escalation Notes

- **High-priority fixes** (next session):
  - Resolve 11 sync-fs errors (impact: startup performance)
  - Add explicit return types to entry points (impact: IDE autocomplete)

- **Medium-priority fixes** (R1 sprint):
  - Type LLM response contracts
  - Audit and remove safe non-null assertions

- **Low-priority fixes** (code health):
  - Remove dead imports
  - Replace debug console with Logger

---

**Owner**: Solo  
**Last Updated**: 2026-04-19  
**Baseline Lint**: 142 problems (105 errors, 37 warnings)  
**Current Lint**: 119 problems (82 errors, 37 warnings)  
**Reduction**: 23 errors fixed (22% improvement)
