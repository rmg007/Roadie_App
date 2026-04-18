# Roadie v0.11.0 — Configuration First Pivot

## 🎯 Vision
Transition Roadie from an **Active Task Executor** to a **Universal Context Orchestrator & Coach**. 
This phase prioritizes high-fidelity, granular artifact generation (`.github/agents/*.agent.md`, `CLAUDE.md`, `.cursorrules`) over direct code manipulation. Roadie becomes the "Semantic Engine" that helps project rules evolve over time based on actual developer behavior.

---

## 🏗️ Architectural Realignment (v0.12.0)
We will move from a flat `src/` structure to a "Brain-Orchestra-Bridge" model:

### 1. The Brain (`src/brain/`)
- `intelligence/`: Scanners, detectors, and pattern observation.
- `memory/`: SQLite persistence and snapshot historical context.
- **`coach/` (New)**: Rule extraction logic that identifies recurring human edits and suggests config updates.

### 2. The Orchestra (`src/orchestra/`)
- `planners/`: Agents that write "Task Briefs" to project artifacts.
- `tracking/`: Real-time state management integrated with `docs/PLAN.md`.
- `workflows/`: FSMs that focus on documentation state and task planning.

### 3. The Bridge (`src/bridge/`)
- `dialects/`: Translation logic for Copilot, Cursor, and Claude.
- `api/`: VS Code host integration.

---

## 🛠️ Phase 1 Roadmap (v0.11.0)

### 1. Granular Agent Generation (The "PayVerify" Pattern)
- Transition from a single `AGENTS.md` to a directory-based agent structure:
  - `.github/AGENT_OPERATING_RULES.md` (Global constraints)
  - `.github/agents/*.agent.md` (Role-specific blueprints)
- Update `FileGenerator` to support multi-file agent definitions.

### 2. Standardized Persona & Plan Injection
- Introduce `roadie.conventions` setting.
- Integrate `docs/PLAN.md` tracking as a core requirement for all workflow "Planners."
- Update all 13 generator templates to dynamically inject engineering standards and active task states.

### 3. Evolutionary Rule Extraction
- Integrate `EditTracker` with `LearningDatabase` to surface "Candidate Rules."
- Command: `Roadie: Codify Last Edit` — allows the user to immediately turn a manual workspace fix into a permanent agent rule.

---

## 📈 Success Metrics
- **Consistency**: 100% parity of technical facts (commands/stack) across all 4+ agent config files.
- **Latency**: Maintain < 250ms activation while running background context hydration.
- **Symbiosis**: Verify that Copilot, Claude Code, and Cursor can successfully execute a task using ONLY Roadie-generated briefs.

---

> [!IMPORTANT]
> This pivot addresses the core user feedback: "Configuration is different between agents." Roadie's value is now officially the **Universal Translator** that bridges those differences.
