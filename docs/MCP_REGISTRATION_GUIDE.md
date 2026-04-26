# MCP Registration Guide (Claude Code Only)

This project supports MCP registration for Claude Code only.

## Quick Reference

| Client | Config File | Token | Example |
|--------|------------|-------|---------|
| Claude Code | .claude/settings.json | {projectRoot} | {projectRoot}/out/index.js |

Key rule: configure Roadie per project using Claude Code local settings.

---

## Setup

### 1. Build Roadie

```bash
npm install
npm run build
```

### 2. Create .claude/settings.json

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

What this does:
- args[0]: points to the built MCP entrypoint in this project.
- args[1]: passes the active project root to Roadie for logs, db, and generated files.

### 3. Restart Claude Code

Close and reopen Claude Code after changing settings.

### 4. Verify

Ask in Claude Code:

```text
@roadie analyze
```

If setup is correct, Roadie responds and initializes files under the project root.

---

## Troubleshooting

### Issue: Server fails to start

Checks:

```bash
npm run build
node out/index.js {projectRoot}
```

### Issue: No logs or generated files

Roadie writes to the project root provided in args[1]. Confirm it points to the intended project.

Expected outputs:
- .claude/logs/roadie.log
- AGENTS.md
- CLAUDE.md
- .github/roadie/project-model.json

### Issue: No file writes

Check environment flags:
- ROADIE_DRY_RUN=1 disables writes
- ROADIE_SAFE_MODE=1 restricts writes

---

## Best Practices

- Keep registration in each project's .claude/settings.json.
- Keep args exactly in this order: entrypoint first, project root second.
- Rebuild after source changes: npm run build.

---

## Unregister

Remove the roadie entry from .claude/settings.json and restart Claude Code.
