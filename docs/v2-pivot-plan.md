# Roadie v2.0 Pivot Plan: Configuration First

## 🎯 Vision Statement
Transition Roadie from an **Active Task Executor** (doing the work) to a **Universal Context Orchestrator** (preparing the ground). Roadie will become the single source of truth for "Agent Intelligence," hydrating Copilot, Claude, and Cursor with real-time project state.

---

## 🏗️ Architectural Overhaul (The "Orchestra" Model)
We will refactor the `src/` directory into a Domain-Driven structure:

### 1. The Brain (`src/brain/`)
*Focus: Internalizing the project.*
- **`intelligence/`**: Technology detectors, pattern derivation, and entity dictionaries.
- **`memory/`**: SQLite logic, snapshot history, and learning-loop statistics.

### 2. The Orchestra (`src/orchestra/`)
*Focus: Planning and Coordinating.*
- **`planners/`**: New agents that transform user requests into "Task Briefs" written to `AGENTS.md` and `CLAUDE.md`.
- **`workflows/`**: Simplified state machines that focus on updating project documentation rather than code execution.

### 3. The Bridge (`src/bridge/`)
*Focus: Specialized Communication.*
- **`dialects/`**: Templates for `.github/copilot-instructions.md`, `CLAUDE.md`, `.cursorrules`, etc.
- **`api/`**: VS Code API adapters.

---

## 🔥 Key Pillars of "Configuration First"

### A. Persona & Engineering Standards Injection
- **Feature**: A unified config (e.g., `roadie.conventions`) that propagates a consistent "Tone" and "Engineering Style" to all generated files.
- **Benefit**: Your instructions for naming conventions, architectural patterns, and testing requirements are synced across all IDE tools instantly.

### B. Task Briefing Mode
- **Current @roadie Flow**: Classifier -> Step Executor -> Code Changes.
- **New @roadie Flow**: Classifier -> Planning Agent -> **Artifact Update**.
- **Result**: @roadie updates `AGENTS.md` with:
  > `[CRITICAL TASK] Implement Python Sum Logic. Requirements: ... Patterns: ...`
- The user then simply asks their preferred agent (Copilot/Claude): *"Do the task in AGENTS.md."*

### C. Live Context Hydration
- **Feature**: The background file watcher updates `.cursorrules` or `CLAUDE.md` with the "Top 5 Hot Files" and "Recent Test Failures" as you work.
- **Benefit**: Other agents always have the most relevant "Local Context" without you needing to copy-paste logs or file paths.

---

## 🗓️ Phased Roadmap

### Phase 1: Foundation (v1.1.0)
- [ ] Add `roadie.conventions` setting for global persona injection.
- [ ] Implement `AGENTS.md` "Active Task" section.
- [ ] Refactor `FileWatcher` to trigger "Quick Hydration" of artifact files.

### Phase 2: Restructuring (v1.5.0)
- [ ] Move `src/` code to the **Brain/Orchestra/Bridge** hierarchy.
- [ ] Clean up `TaskExecutor` code to favor "Artifact Generation" over direct file editing.
- [ ] Standardize the communication format across all 13 templates.

### Phase 3: The Universal Orchestrator (v2.0.0)
- [ ] Introduce "Planning Mode" as the default for all 7 workflows.
- [ ] Launch Roadie as a standalone MCP server to serve this project context to Claude Desktop and other non-VS Code tools.

---

## 🛡️ Success Metrics
1. **Sync Quality**: Do Copilot, Cursor, and Claude accurately reflect the tech stack after a package update?
2. **Reduced Friction**: Does a user prefer "@roadie plan feature" followed by "@copilot execute" over direct execution?
3. **Agent Sanity**: Do generated instructions stay within the "line-count budget" of the targets (especially `CLAUDE.md`)?

---

> [!NOTE]
> This plan shifts the risk from "model failure during loop" to "information quality during scan." This is a more stable long-term bet for the Roadie ecosystem.
