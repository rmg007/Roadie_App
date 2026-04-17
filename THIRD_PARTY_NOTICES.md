# Third-Party Notices — Roadie v1.0.0

Roadie bundles the following production dependencies. Each dependency retains its original license.

## Production Dependencies

### better-sqlite3
- **Version:** ^9.4.3
- **License:** MIT
- **Source:** https://github.com/WiseLibs/better-sqlite3
- **Use:** SQLite persistence layer for workflow history and project model.

### fast-glob
- **Version:** ^3.3.0
- **License:** MIT
- **Source:** https://github.com/mrmlnc/fast-glob
- **Use:** File system glob matching for project scanning.

### zod
- **Version:** ^3.22.4
- **License:** MIT
- **Source:** https://github.com/colinhacks/zod
- **Use:** Runtime schema validation for LLM structured output parsing.

## Built-in Node.js Modules (no separate license)

- `node:sqlite` — Built-in Node.js SQLite module (Node.js 22+). Governed by the Node.js MIT license.
- `node:fs`, `node:path`, `node:child_process`, `node:os` — Standard Node.js built-ins.

## VS Code Extension API

- `vscode` — VS Code extension API. Provided by Microsoft under the MIT license.
  Source: https://github.com/microsoft/vscode
