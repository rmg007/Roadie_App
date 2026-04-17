---
slug: plan-validation-workflow
status: IMPLEMENTED 2026-04-17
target: tooling (no extension version bump)
---

# Multi-Agent Plan Validation Workflow

## Problem

Single-agent plans (from `/plan` → `roadie-architect`) routinely miss edge cases,
downstream consequences, and spec conflicts. The user has to catch these gaps by
re-reading the plan themselves — which defeats the purpose of delegation. We need
a workflow where a draft plan is cross-validated by independent agents with
distinct perspectives before it is declared "ready."

## Root cause

The current pipeline is linear: `roadie-architect` writes → user reviews.
There is no second pair of eyes before the user sees it, and the architect has
no adversarial pressure to hunt for gaps.

- `.claude/agents/roadie-architect.md` — one agent, one pass, no critique loop.
- `.claude/commands/plan.md` — one-shot delegation.
- No cross-check against `roadie_docs/` spec, `LESSONS.md`, or edge-case stress.

## Fix plan

### Step 1 — Create three new validator sub-agents (read-only)

All three live in `.claude/agents/`. Tools: `Read, Grep, Glob, Bash` only.
Each is told: "You have not seen the architect's reasoning. Read the plan file
cold and find what's missing." Each appends one review section to the plan file.

1. **`roadie-plan-scenario-validator.md`** — stress-tests the plan for:
   edge cases, failure modes, concurrency, empty/malformed inputs, partial-state
   recovery, what happens if step N crashes mid-way.

2. **`roadie-plan-spec-validator.md`** — cross-checks the plan against:
   `Roadie_Project_Documentations_Only/` (spec), `CLAUDE.md` (hard rules),
   `roadie-App/docs/LESSONS.md` (past mistakes). Flags contradictions.

3. **`roadie-plan-impact-validator.md`** — identifies: affected files the
   architect didn't list, downstream callers, regression risk, test-coverage
   gaps, version/changelog implications.

Each outputs a section appended to the plan:

```
## Review: <validator-name>
**Verdict:** APPROVE | CHANGES_REQUESTED
**Findings:**
- [BLOCKER|NIT] <file:line> — <issue> — <suggested fix>
```

### Step 2 — Create `/plan-deep` slash command

`.claude/commands/plan-deep.md`. Flow:

1. Invoke `roadie-architect` with slug + problem → writes draft plan.
2. Fan out all three validators **in parallel** against the draft file path.
3. Collect verdicts.
   - All APPROVE → append `## Plan Status: READY ✅` → done.
   - Any CHANGES_REQUESTED → re-invoke `roadie-architect` with the findings as
     input. Architect revises the plan (preserving review sections as history)
     and re-runs validators. Max 2 revision rounds.
   - Still blocked after round 2 → append `## Plan Status: NEEDS_HUMAN 🚧` with
     the open disagreements listed.
4. Return plan path + final status to user. Wait for approval before any code.

### Step 3 — Keep `/plan` as-is for simple changes

Shallow `/plan` stays the fast path for 1–2 file bug fixes. `/plan-deep` is the
opt-in path for: multi-file refactors, new features, anything touching
`engine/`, `classifier/`, `model/`, or cross-cutting concerns.

### Step 4 — Document the split in `CLAUDE.md`

Add a "When to use which plan command" subsection under the slash-commands list,
with 2-3 concrete examples of each.

## Acceptance tests

1. `/plan-deep test-dummy "add a no-op command called ping"` →
   - Plan file exists at `roadie-App/docs/test-dummy.md`.
   - Contains exactly 3 `## Review:` sections.
   - Contains a `## Plan Status:` line.
   - All validator sections have both `Verdict:` and `Findings:`.

2. Force-failure test: `/plan-deep test-broken "refactor the entire classifier"`
   with a deliberately vague problem →
   - At least one validator returns `CHANGES_REQUESTED`.
   - Plan file shows a revision cycle (original + revised sections visible).

3. `/plan test-simple "fix typo in README"` still works unchanged
   (one-shot, no review sections).

4. `.claude/agents/` listing shows 7 agents: original 4 + 3 new validators.

## Risks / rollback

- **Cost:** 3–4× tokens per plan. Mitigation: `/plan` remains for simple cases;
  deep path is opt-in.
- **Loop risk:** validators may disagree forever. Mitigation: hard cap at 2
  revision rounds, then `NEEDS_HUMAN`.
- **Duplication:** validators may surface the same finding. Mitigation: each
  prompt has an explicit out-of-scope list pointing to the others' domains.
- **Rollback:** delete the 4 new files and revert the `CLAUDE.md` edit. No
  extension source or build artifact changes.

## Version bump

None. This is `.claude/` tooling — no `package.json` change, no CHANGELOG entry.
Per repo convention, only the extension ships versioned changes.

## Files touched

**Create (5):**
- `.claude/agents/roadie-plan-scenario-validator.md`
- `.claude/agents/roadie-plan-spec-validator.md`
- `.claude/agents/roadie-plan-impact-validator.md`
- `.claude/commands/plan-deep.md`
- `roadie-App/docs/plan-validation-workflow.md` (this file)

**Update (1):**
- `CLAUDE.md` — add `/plan-deep` to slash-commands list with usage guidance.
