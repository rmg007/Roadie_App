# Lessons — self-correction log

Append one line per mistake caught. Newest first. Read this before starting a non-trivial task.

Format: `YYYY-MM-DD — <mistake> → <correction>`

---

- 2026-04-15 — Package script failed with extraneous dependencies in node_modules → use `--no-dependencies` flag in `vsce package` to skip validation (better-sqlite3 is bundled anyway).
- 2026-04-15 — Left `test-output.txt`, `test-output2.txt`, `inspect-db.js` at repo root → temp diagnostics belong in `scripts/` or in OS `/tmp`; never in repo root.
- 2026-04-15 — Started implementing the chat-fallback fix without writing a plan → always write a plan to `roadie/docs/<slug>.md` and wait for approval before multi-file edits.
- 2026-04-14 — Hardcoded `roadie-0.5.0.vsix` in `scripts/install.js` and `scripts/doctor.js` → always read version from `package.json`.
- 2026-04-14 — Bumped to `0.5.1` when CHANGELOG already described `0.5.2` work in source → read CHANGELOG before choosing a version number.
- 2026-04-14 — Used `node.name` on `DirectoryNode` which only has `path` → always check the type definition before dereferencing a field; `path.basename(node.path)` is the correct idiom.
- 2026-04-14 — Package script used bare `vsce` which is not on PATH → use `npx @vscode/vsce package --allow-missing-repository` in the script.
