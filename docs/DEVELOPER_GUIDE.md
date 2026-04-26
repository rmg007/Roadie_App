# Roadie Developer Guide

This guide documents the three core development rules that govern all work on the Roadie codebase:

1. **Project Isolation** — All configuration, artifacts, and state belong in the project folder
2. **Semantic Code Search** — Use semantic search for exploration, never grep/find
3. **Project-Local MCP Registration** — MCP servers are registered per-project, never globally

Follow these rules strictly to maintain isolation, consistency, and reproducibility across development environments.

---

## Rule 1: Project Isolation

**Everything project-related stays inside the project folder. No exceptions.**

### What Stays In the Project

All of the following **must** be in the project folder, never in user home directories or system paths:

- **Configuration Files**
  - `.claude/settings.json` — Claude Code project configuration
  - `.claude/settings.local.json` — Local overrides (git-ignored)
  - `roadie.config.json` — Roadie-specific settings
  
- **Logs & Diagnostics**
  - `.claude/logs/` — All log files
  - `.claude/logs/roadie.log` — Roadie diagnostic trace
  - `.claude/logs/mcp.log` — MCP server logs
  
- **Artifacts & Databases**
  - `.claude/roadie-db.sqlite` — Project learning database
  - `.claude/artifacts/` — Generated files, caches, temporary outputs
  - `.claude/reports/` — Analysis reports, snapshots, metrics
  
- **Sessions & Memory**
  - `.claude/sessions/` — Chat session history
  - `.claude/memory/` — Claude Code memory files
  
- **Plans & Documentation**
  - `PLANS/` — Feature plans, design docs, sprint notes

### What Stays Out of the Project

These **must not** be committed or stored in the project folder:

- Node modules and dependencies (`node_modules/`, `.npm/`, package-lock files are git-ignored by default)
- Build artifacts (handled by build system, git-ignored)
- IDE-specific temp files (`.vscode/`, `.idea/`, handled by git-ignore)
- OS-specific files (`.DS_Store`, `Thumbs.db`, handled by git-ignore)

### Anti-Patterns: Don't Do This

```bash
# ❌ WRONG: Storing Roadie config in home directory
~/.roadie/config.json
~/.roadie/global-model.db

# ❌ WRONG: Global MCP registration outside project
~/.claude_desktop_config.json (for project-specific servers)
~/.config/roadie/

# ❌ WRONG: Logs in home or system paths
~/logs/roadie.log
/var/log/roadie.log

# ❌ WRONG: Artifacts outside project
~/artifacts/
/tmp/roadie-output/
```

### Correct Pattern

```bash
# ✅ RIGHT: All project config in project folder
/path/to/project/.claude/settings.json
/path/to/project/.claude/roadie-db.sqlite
/path/to/project/.claude/logs/
/path/to/project/.claude/artifacts/

# ✅ RIGHT: Feature plans in project
/path/to/project/PLANS/feature-x.md

# ✅ RIGHT: Global-only Roadie brain (not project-specific)
~/.roadie/global-model.db
```

### Checking Project Isolation

Before committing, verify:

```bash
# Find all files/dirs with "roadie", ".claude" in project root
find . -name "*roadie*" -o -name ".claude" -type d

# Check that only .gitignore'd items are outside src/
git status --porcelain | grep -v ".claude\|PLANS"

# Verify .gitignore covers all artifacts
cat .gitignore | grep -E ".claude|PLANS|artifacts"
```

---

## Rule 2: Semantic Code Search (NOT grep or find)

**Always use semantic vector search to explore code. Never use grep, find, or text-based matching.**

### Why Semantic Search?

- **7-12x faster** for intent-based queries than text grep
- **Catches patterns** that text search misses (renamed variables, refactored logic, cross-file patterns)
- **Intent-aware** — finds "error handling" even if the code uses custom exception names
- **Eliminates noise** — grep finds every instance of "error", semantic search finds relevant error handling

### How to Use It

Use the semantic search tool at the project root:

```bash
python3 .workspace/search.py "<semantic-query>" --top-k 5
```

**Examples:**

```bash
# Find all MCP tool definitions
python3 .workspace/search.py "MCP tool definitions" --top-k 10

# Find error handling for database operations
python3 .workspace/search.py "database error handling" --top-k 5

# Find file watcher implementation
python3 .workspace/search.py "file system watcher watching files" --top-k 5

# Find model selection logic
python3 .workspace/search.py "selecting best model priority" --top-k 5

# Find logging setup
python3 .workspace/search.py "logger initialization setup" --top-k 5
```

### What's Prohibited

**Never use these for code exploration:**

```bash
# ❌ WRONG: grep for code patterns
grep -r "error" src/
grep -r "class.*Manager" src/

# ❌ WRONG: find for files
find . -name "*model*"
find . -type f -name "*.ts"

# ❌ WRONG: ls/cat to manually browse
ls src/
cat src/types.ts | grep "interface"
```

### When to Break the Rule

Use `grep` or `find` **only** for:

1. **Exact file paths you already know** — `cat src/index.ts`
2. **Build/CI commands** — `find . -name "*.spec.ts" | xargs npm test`
3. **Git commands** — `git grep "TODO"`
4. **Simple counts** — `grep -c "export" src/*.ts`

Don't use text search to **discover** code patterns or modules.

### Setup: `.workspace/search.py`

The search tool must be present at:

```
/path/to/project/.workspace/search.py
```

If it's missing, create a stub that calls a semantic search API:

```python
#!/usr/bin/env python3
import sys
import subprocess

if __name__ == "__main__":
    query = sys.argv[1] if len(sys.argv) > 1 else ""
    # Delegate to actual semantic search (e.g., Claude API, embedding DB)
    print(f"Searching for: {query}")
```

---

## Rule 3: Project-Local MCP Registration

**MCP servers are registered per-project, never globally. All server commands and arguments must use project-local paths.**

### Where MCP Registration Lives

#### Claude Code (`.claude/settings.json`)

```json
{
  "mcpServers": {
    "roadie": {
      "command": "node",
      "args": ["{projectRoot}/out/index.js", "{projectRoot}"]
    }
  }
}
```

Use `{projectRoot}` token to reference the project folder. This is resolved at runtime.

Claude Code is the only supported MCP client in this repository.

### Anti-Patterns: Don't Do This

```json
// ❌ WRONG: Global system path
{
  "mcpServers": {
    "roadie": {
      "command": "node",
      "args": ["/usr/local/roadie/out/index.js", "/usr/local/roadie"]
    }
  }
}

// ❌ WRONG: Using environment variables
{
  "mcpServers": {
    "roadie": {
      "command": "node",
      "args": ["$ROADIE_HOME/out/index.js", "$ROADIE_HOME"]
    }
  }
}

// ❌ WRONG: Relative paths in desktop config
{
  "mcpServers": {
    "roadie": {
      "command": "node",
      "args": ["./out/index.js", "."]
    }
  }
}

// ❌ WRONG: Shared MCP server across projects
{
  "mcpServers": {
    "roadie-shared": {
      "command": "node",
      "args": ["/home/user/.roadie/server/index.js"]
    }
  }
}
```

### Correct Pattern

**Claude Code (.claude/settings.json):**
```json
{
  "mcpServers": {
    "roadie": {
      "command": "node",
      "args": ["{projectRoot}/out/index.js", "{projectRoot}"]
    }
  }
}
```

### Enforcing Project-Local Registration

Check that all MCP registration is project-local:

```bash
# Check Claude Code settings
cat .claude/settings.json | grep -A 5 "mcpServers"

# Verify paths are project-relative or absolute to project
grep -E "(/home|/root|/var|/usr|~/\.|\.npm)" .claude/settings.json  # should be empty

# Claude Code-only policy: no alternate MCP client registration guidance.
```

### What About Shared/Global Servers?

Some MCP servers **can** be registered globally (e.g., GitHub, Linear, Slack). Roadie **cannot** because:

1. **Project-specific databases** — Roadie maintains per-project learning databases
2. **Isolation requirements** — Roadie's state must not leak between projects
3. **Multiple project versions** — You may have Roadie v1.0 in one project, v1.1 in another

If you need to share learning across projects, use the **global brain** (`~/.roadie/global-model.db`), not a shared server instance.

---

## Checklists

### Before Committing Code

- [ ] All `.claude/` directories are project-local (not in home)
- [ ] All logs go to `.claude/logs/`
- [ ] All databases go to `.claude/roadie-db.sqlite` or `.claude/data/`
- [ ] No `~/.roadie/` project-specific configs
- [ ] `.gitignore` covers `.claude/`, `PLANS/`, and build artifacts
- [ ] MCP registration uses `{projectRoot}` token or absolute project paths

### Before Running Code Exploration

- [ ] Used `python3 .workspace/search.py` for discovery
- [ ] No grep/find commands used to find code patterns
- [ ] Results are semantic (intent-based), not text matches

### Before Shipping MCP Registration

- [ ] `.claude/settings.json` exists for Claude Code users
- [ ] README only documents Claude Code MCP registration
- [ ] No alternate client registration assumptions
- [ ] Example configs in docs use `{projectRoot}`
- [ ] No env variable expansion in MCP args

---

## FAQ

**Q: Can I install Roadie globally?**
A: No. While Roadie can be installed in one location, each project must register its own local instance. The global brain (`~/.roadie/global-model.db`) is project-agnostic, but the server itself must be project-local.

**Q: Why not use grep for a quick search?**
A: Because "quick" text search often misses what you're looking for. Semantic search is fast and finds intent-based patterns. Train yourself to use the tool — it's faster in practice.

**Q: What if `.workspace/search.py` is missing?**
A: Create it as a stub that delegates to a semantic search service. Document the setup in your project README.

**Q: Can I store Roadie logs in `/var/log/`?**
A: No. All logs must stay in `.claude/logs/` for project isolation and portability.

**Q: Can I register the same MCP server in multiple configs?**
A: Use one Claude Code config per project (`.claude/settings.json`). Avoid shared global instances.

---

## Examples

### Example 1: Exploring the Codebase

**Goal:** Find all MCP tool definitions.

```bash
# ✅ Correct
python3 .workspace/search.py "MCP tool interface definitions" --top-k 10

# Output:
# - src/mcp-tools/index.ts (line 45)
# - src/types.ts (line 120)
# - src/server.ts (line 200)
```

### Example 2: Setting Up a New Project

**Goal:** Register Roadie in Claude Code.

1. Create `.claude/settings.json`:
```json
{
  "mcpServers": {
    "roadie": {
      "command": "node",
      "args": ["{projectRoot}/out/index.js", "{projectRoot}"]
    }
  }
}
```

2. Create `.gitignore` entry:
```
.claude/logs/
.claude/artifacts/
.claude/roadie-db.sqlite
```

3. Done. Roadie is now registered for Claude Code in this project.

### Example 3: Sharing Project State

**Goal:** Store learning across projects using global brain.

Roadie maintains:
- **Project-specific**: `.claude/roadie-db.sqlite` (patterns, tasks, edits for *this* project)
- **Global**: `~/.roadie/global-model.db` (your coding habits, learned conventions across all projects)

This is correct and intended. No action needed.

---

## References

- `.claude/settings.json` format — [Claude Code docs](https://claude.com/docs)
- Semantic search API — `.workspace/search.py` (local)
- MCP tool definitions — `src/mcp-tools/index.ts`
