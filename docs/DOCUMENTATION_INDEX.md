# Roadie Documentation Index

This index reflects the current single-developer documentation layout.

## Primary Docs

1. ../README.md
Project overview, setup, run commands, and MCP basics.

2. DEVELOPER_GUIDE.md
Core development rules and coding conventions.

3. MCP_REGISTRATION_GUIDE.md
Claude Code/Desktop MCP registration and troubleshooting.

## Planning And Exceptions

- PLAN.md
Active implementation plan.

- ../plans/HARDENING_PLAN.md
Primary threat-focused hardening roadmap.

- ../plans/HARDENING_PLAN_V2_2026-04-25.md
Operational resilience and release-gate hardening roadmap.

- LINT_WAIVERS.md
Documented lint exceptions and rationale.

## Root-Level Support Files

- ../AGENTS.md
Agent roles and workflow metadata.

- ../CLAUDE.md
Project operating instructions.

## Structure Snapshot

```text
roadie-App/
|-- README.md
|-- AGENTS.md
|-- CLAUDE.md
|-- docs/
|   |-- DEVELOPER_GUIDE.md
|   |-- MCP_REGISTRATION_GUIDE.md
|   |-- DOCUMENTATION_INDEX.md
|   |-- LINT_WAIVERS.md
|   |-- PLAN.md
|-- src/
|-- test/
```

## Notes

- CONTRIBUTING.md was intentionally removed for this repo workflow.
- Runtime logs can go under logs/runtime/ when needed for local diagnostics.
