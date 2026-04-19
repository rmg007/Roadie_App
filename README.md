# Roadie: Plug and Forget

Roadie is a powerful, **Standalone Model Context Protocol (MCP) Server** designed to be the invisible infrastructure for modern AI-assisted development. It analyzes your codebase, detects architecture patterns, and autonomously builds a "Project Model" that makes every AI tool (Claude, Cursor, Copilot) instantly smarter.

## 🧠 The "Plug and Forget" Philosophy

Roadie is designed to be set up once and run forever in the background. It doesn't ask questions; it solves problems by observing your work and documenting your conventions.

- **Universal Personal Learning**: Roadie maintains a "Global Brain" in your user profile (`~/.roadie/global-model.db`). It remembers your coding habits across every project you touch.
- **Project-Specific Memory**: Every repository gets its own local SQLite database to store fine-grained analysis, task history, and file snapshots.
- **Autonomous Discovery**: Roadie automatically detects agents and convention files (`AGENTS.md`, `.github/roadie/`) without any manual configuration.
- **Zero-Friction Integration**: Works with any MCP-compatible client. Simply point your client to the `roadie` server, and you're done.

## 🚀 Getting Started

### 1. Installation
Clone the repository and build the production bundle:
```powershell
npm install
npm run build
```

### 2. Quick Launch
Use the automated bootstrap script to start the server in any project:
```powershell
./run_roadie.bat
```

### 3. MCP Registration
Register Roadie in your MCP client (e.g., Claude Desktop Config):
```json
{
  "mcpServers": {
    "roadie": {
      "command": "node",
      "args": ["C:/absolute/path/to/roadie/out/index.js", "C:/path/to/your/project"]
    }
  }
}
```

## 🛠️ Integrated Learning Tools

- **`roadie_analyze`**: Performs a deep tech-stack and pattern scan. Returns a rich markdown summary of your project's soul.
- **`roadie_generate`**: Autonomously produces or updates context files (`AGENTS.md`) and GitHub-based project models.

## 📊 Observability & Growth

Roadie is a lifelong learner. You can monitor its progress through:
- **`roadie.log`**: A persistent diagnostic trace of every thought and action Roadie takes in your project.
- **Learning Heartbeat**: On startup, Roadie reports its historical task success rate and total tasks completed, showing you how much it has grown.

---
*Roadie: Because you have better things to do than explain your codebase to an AI for the 100th time.*
