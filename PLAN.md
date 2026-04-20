## What is Roadie?

**Roadie is an MCP (Model Context Protocol) server** that runs on your machine as a plugin to Claude, Copilot, or Cursor. When you integrate Roadie into your AI client, it enables automatic intent detection, workflow dispatch, and code operations — all triggered by natural language in chat.

- **Where it runs:** User's local machine (not cloud, not third-party servers)
- **How it works:** User types a request in chat → Roadie classifies intent → executes the appropriate workflow (bug fix, feature, refactor, etc.) → reports results
- **What it does:** Analyzes projects, generates code, runs workflows, learns from outcomes, self-heals on failure
- **Architecture:** Standalone Node.js process communicating with the AI client via stdin/stdout (MCP protocol)

---

# Roadie MCP — Remaining Work to v1.0.0

**Current version:** v0.17.0 (all code features complete)
**Remaining:** Publishing, documentation, and changelog tasks only.

All code-level features from the original six-phase plan have been implemented:
- ✅ Phase 1 — Chat-Only Foundation (1.1–1.7)
- ✅ Phase 2 — Complete Workflow Library (2.1–2.6)
- ✅ Phase 3 — Production Hardening (3.1–3.10)
- ✅ Phase 4 — True Autonomy (4.1–4.7)
- ✅ Phase 5 (partial) — DX & Distribution (5.1–5.3)
- ✅ Phase 6 — Beyond Production (6.1–6.8)

---

## Remaining Tasks (v1.0.0 release)

These are non-code tasks required before the official v1.0.0 release:

| # | Task | Acceptance |
|---|------|------------|
| 5.4 | Publish to npm under `@rmg007/roadie` (or `roadie` if available) | `npm view` shows latest |
| 5.5 | CHANGELOG.md auto-generated from conventional commits | Each release has an entry |
| 5.6 | README rewrite: 30-second install, gif/asciinema demo, troubleshooting section | Test: new user installs in ≤2 min |
| 5.7 | Architecture doc — layer diagram, workflow FSM, data flow | Single Markdown, diagrams in Mermaid |

---

## Success Metrics (v1.0.0 gate)

| Metric | Target |
|--------|--------|
| Chat-only prompts handled end-to-end without user tool calls | ≥95% |
| Workflow success rate on realistic E2E suite | ≥90% |
| Median analyze time (medium repo, ~500 files) | ≤3s |
| Median full-generate time | ≤2s |
| Test coverage (new modules) | ≥85% |
| Test coverage (overall) | ≥75% |
| Cross-platform CI matrix | green × Win/Mac/Linux × Node 22/24 |
| Install → first successful workflow | ≤2 min |
| Mean time to recovery after a workflow failure | ≤1 cycle |
| Zero leaked secrets across all log fixtures | enforced |

---

*End of plan. Only publishing and documentation tasks remain.*
