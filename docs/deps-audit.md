# Dependency Audit & Hardening

**Last updated:** April 17, 2026 (Phase A0)

---

## Added Dependencies (A0.5+)

| Package | Version | License | Purpose | Reviewed | Notes |
|---|---|---|---|---|---|
| `fast-check` | latest | MIT | Property-based testing harness for determinism & fuzz tests | ✅ | Maintained by dubzzz. Alternatives: `fc` (alias). Used for: A6 (cancellation), A-lazy (lazy module loading), C2 (classifier purity), C6 (classifier fuzz), F4 (watcher debounce). |

---

## Stryker (C7 — added in Phase C)

| Package | Version | License | Purpose | Notes |
|---|---|---|---|---|
| `@stryker-mutator/core` | ^9.6.1 | Apache 2.0 | Mutation testing engine | Added in C7 (Phase C). Scoped to `src/classifier` initially. Config: `stryker.config.mjs`. |
| `@stryker-mutator/vitest-runner` | ^9.6.1 | Apache 2.0 | Vitest integration for Stryker | Added in C7. Run via `npm run stryker:classifier` or `.github/workflows/mutation.yml` (weekly). |

---

## CI/CD Tooling Audit

| Tool | Installed | License | Purpose | Notes |
|---|---|---|---|---|
| `@vscode/vsce` | ✅ | MIT | VS Code extension packaging & publishing | Already in devDeps. Used for H4 (signed VSIX) & E4 (doctor v2). |
| Node.js LTS | ✅ | MIT | Runtime | ≥ 22.0.0 per `engines.node`. |

---

## Regular Audit Schedule

- **CI gate (H2):** `npm audit --audit-level=high` runs on every PR/push (`.github/workflows/ci.yml`).
- **Dependabot (H1):** Enabled in Phase H (post-E completion).
- **Manual review:** quarterly or on major releases.

---

## Known Dependencies with Caveats

| Package | Caveat | Mitigation |
|---|---|---|
| `node:sqlite` | Experimental; stability 1.1 in Node 22.x | Isolate DB access behind `src/learning/db-adapter.ts` interface. Fallback drivers documented in hardening-master-plan.md Risk register. |
| `better-sqlite3` (bundled) | Native binding; requires rebuild on install | `scripts/rebuild-native.js` handles platform-specific builds. |
| `@types/vscode` | May lag stable VS Code releases | Test against min `engines.vscode` (1.93.0) and insiders in D4. |

---

## Privacy & Security Checklist (Phase E2 / H7)

- [ ] `roadie.telemetry` setting is default-false; opt-in only (E2).
- [ ] No `fetch`/`http`/`https` calls in production code (H7).
- [ ] All secrets must be handled via `vscode.SecretStorage` (H5).
- [ ] Filesystem writes scoped to `globalStorage` + `.github/.roadie/` (H6).
