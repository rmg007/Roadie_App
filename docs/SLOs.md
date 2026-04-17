# Roadie Service Level Objectives (SLOs)

**Last updated:** April 17, 2026 (pre-1.0 hardening phase)  
**Owner:** @roadie-core  
**Link to master plan:** [hardening-master-plan.md](./hardening-master-plan.md)

---

## SLO Table

| SLO | Target | Measured by | CI gate | Notes |
|---|---|---|---|---|
| P95 activation latency | ≤ 250 ms | median-of-5, CI Linux runner | `src/__perf__/activation.test.ts` | Requires A-lazy to land first |
| Classifier macro-acc | ≥ 95 % | `evals/classifier/run.ts` | `src/__integration__/classifier-eval.test.ts` | |
| Per-intent floor (≥ 20 samples) | ≥ 80 % | same | same | |
| Per-intent floor (< 20 samples) | ≥ 70 % | same | same | `general_chat` is at 17 samples today |
| Data durability | 0 lost rows under process crash | `src/__integration__/durability.test.ts` | wired to CI | |
| Migration safety | 100 % corpus dbs forward-migrate | `src/__integration__/migration-corpus.test.ts` | wired to CI | |
| Bundle size | ≤ 600 KB minified | `scripts/check-bundle-size.js` | wired to CI | |
| Memory ceiling | RSS delta < 50 MB / 10k ops | `src/__perf__/memory.test.ts` (nightly) | scheduled CI | Shortened from "1 h idle" — impractical in CI |
| Disposable leak | 0 across 100 activate/deactivate cycles | `src/__perf__/disposable-leak.test.ts` | wired to CI | |
| Mutation score | ≥ 70 % on `src/classifier` | Stryker (classifier-only, weekly) | `.github/workflows/mutation.yml` | Expand to engine + learning once baseline is stable |
| Branch coverage | ≥ 82 % `src/` (current); path to 85 % | Vitest `--coverage` global threshold | wired to CI | Vitest doesn't support per-directory thresholds — single global threshold only; per-directory needs a custom reporter script |
| E2E command coverage | 100 % of `package.json` commands[] | `scripts/audit-e2e-coverage.js` | wired to CI | |
| VS Code compat | activates on min `engines.vscode` + stable + insiders | E2E nightly matrix | `.github/workflows/e2e-nightly.yml` | |
| Dependency vulns | 0 high/critical advisories | `npm audit --audit-level=high` | wired to CI | |

---

## Test count watermark

**Baseline (A0):** 52 test files, 786 tests passing (April 17, 2026)

Phases that reduce test count must justify the delta in their exit-gate documentation.

---

## Gate documentation

- **A0.2 CI gate:** `.github/workflows/ci.yml` — runs `npm run lint && npm test && npm run build` on every PR and push to main.
- **A5 `as any` gate:** Grep for ` as any` in `src/` (excl. test dirs). The pattern `as typeof import('node:sqlite')` is explicitly allowed.
- **H2 audit gate:** `npm audit --audit-level=high` blocks merge.

---

## exactOptionalPropertyTypes escape-hatch count

| Version | `@ts-expect-error` escapes | `!` non-null assertions (new) | Notes |
|---|---|---|---|
| 0.12.0 | 0 | 8 | All `!` assertions are length- or key-guarded. No blind suppressions. Modules with most fixes: `extension.ts` (1), `engine/workflow-engine.ts` (2), `model/database.ts` (3), `generator/templates/` (2). |

---

## Phase tracking

| Phase | Status | Target version | Notes |
|---|---|---|---|
| A0 (pre-phase) | ✅ Complete | n/a | All deliverables done; test baseline: 53 files, 789 tests |
| Phase A | 🟡 In progress (50%) | v0.10.0 | A0-comments, A1, A2, A3, A4, A5 done; A6, A7, A-lazy pending |
| Phase B | ✅ Complete | v0.11.0 | SQLite pragmas, schema versioning, crash recovery, durability |
| Phase C | ✅ Complete | v0.12.0 | exactOptionalPropertyTypes, classifier determinism, fuzz harness, dataset hygiene, mutation testing setup |
| Phase D | ⚪ Not started | v0.13.0 | |
| Phase E | ⚪ Not started | v0.14.0 | |
| Phase H | ⚪ Not started | v0.15.0 | |
| Phase F | ⚪ Not started | v0.16.0 | |
| Phase G | ⚪ Not started | v1.0.0 | |
