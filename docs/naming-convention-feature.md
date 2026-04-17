# Naming Convention Feature for Generated Artifacts

**Slug:** `naming-convention-feature`  
**Version:** 0.8.0  
**Date:** 2026-04-17

---

## Problem

Generated user artifacts (agent-definitions.md, skill files, workflow files, template files, codebase dictionary, etc.) currently lack a consistent naming and identification convention. This makes it ambiguous to users and AI agents which artifacts are agents, skills, workflows, or other types, especially when multiple types exist in the same directory or are referenced across documents.

Users need:
- Clear file naming that indicates artifact type (e.g., `agent:fixer`, `workflow:deploy`, `skill:code-review`)
- Consistent frontmatter headers with type prefixes
- Standardized description templates
- Clear distinction between Roadie-internal artifacts and generated user artifacts

Example ambiguity today:
- `fixer.md` — is this an agent? A skill? A workflow?
- Generated file names do not signal their purpose to the user or to IDE plugins.
- Frontmatter lacks type metadata that could be parsed by downstream tools.

---

## Root Cause

1. **Generator templates** (`roadie-App/src/generator/templates/*.ts`) do not enforce naming prefixes for generated user artifacts.
2. **File names** are derived from role/type names without a formal convention (e.g., `fixer.md` instead of `agent:fixer.md`).
3. **Frontmatter** in generated files (agent-definitions.ts, claude-hooks.ts, etc.) has no type field.
4. **Documentation** lacks clear guidance for users and contributors on expected naming patterns.
5. **Roadie internals** (AGENTS.md, CLAUDE.md, etc.) should NOT be renamed; only user-generated artifacts are in scope.

---

## Affected Files with Line Numbers

### Generator Templates (Content Generation)

| File | Lines | Role |
|------|-------|------|
| `roadie-App/src/generator/templates/agent-definitions.ts` | 26–150 | Generates agent definitions; will include type prefix in frontmatter |
| `roadie-App/src/generator/templates/claude-hooks.ts` | 1–100 | Generates skill/hook definitions; needs naming convention |
| `roadie-App/src/generator/templates/path-instructions.ts` | 1–80 | Generates per-directory instructions; needs file name and frontmatter updates |
| `roadie-App/src/generator/templates/cursor-rules-dir.ts` | 1–120 | Generates per-directory cursor rules; needs convention |
| `roadie-App/src/generator/file-generator.ts` | 41–111 | FileSpec definitions and file generation; may log naming standard |

### Generator Logic (File Naming)

| File | Lines | Role |
|------|-------|------|
| `roadie-App/src/generator/file-generator-manager.ts` | 19–22 | Defines GeneratedFileType enum; may add type field to GeneratedContent |
| `roadie-App/src/generator/section-manager.ts` | 1–50 | Section building; may add type-aware metadata |

### Tests (Snapshot & Unit)

| File | Lines | Role |
|------|-------|------|
| `roadie-App/src/generator/file-generator.snapshot.test.ts` | 1–200 | Snapshots for generated files; will update to reflect new naming |
| `roadie-App/src/generator/templates/*.test.ts` (multiple) | varies | Unit tests; will validate naming convention |

### Documentation

| File | Role |
|------|------|
| `roadie-App/docs/naming-convention-feature.md` | This plan |
| `roadie-App/AGENTS.md` | May document convention for users |
| `.claude/CLAUDE.md` | May reference convention in contribution guide |

---

## Specific Changes

### 1. File Naming Convention

**Pattern for generated user artifacts:**
```
{name}.md
```

Examples:
- `fixer.md`
- `architect.md`
- `code-review.md`
- `deploy.md`
- `bugfix.md`
- `onboard.md`
- `codebase-dictionary.md`

**Type prefix goes in the `name` field (frontmatter), not filename:**
- Agent: `name: "agent: fixer"`
- Skill: `name: "skill: code-review"`
- Workflow: `name: "workflow: deploy"`

**Roadie internals (DO NOT rename):**
- `AGENTS.md` — project overview and agent roles table
- `CLAUDE.md` — project instructions
- `.github/.roadie/project-model.db` — internal database
- `COPILOT_CHAT_COMMANDS.md` — human-facing test plan
- `.github/.roadie/*` — internal generated files

### 2. Frontmatter Format

All generated user artifacts must include a YAML frontmatter block (at top of file, between `---` delimiters) with:

```yaml
---
name: "agent: fixer"
description: Code fixes and refactoring for identified bugs
generated-by: roadie
generated-at: YYYY-MM-DDTHH:MM:SSZ
---
```

Example:

```markdown
---
name: "agent: fixer"
description: Code fixes and refactoring for identified bugs
generated-by: roadie
generated-at: 2026-04-17T14:30:00Z
---

# Fixer

...
```

**Note:** Type prefix is included in the `name` field (e.g., `"agent: fixer"`, `"skill: code-review"`). This makes it appear with the type in VS Code's "Set Agent" dropdown menu.

### 3. Description Template

For consistency, generated files should follow a structured description:

```
{Type}: {Name} — {Function}. {Scope/Responsibility}.
```

Examples:
- `Agent: Fixer — Code fixes and refactoring. Minimal changes, pattern-following, test-aware.`
- `Skill: Code Review — Automated review of pull requests. Security, performance, quality gates.`
- `Workflow: Deploy — End-to-end deployment pipeline. Pre-flight checks, versioning, release steps.`

### 4. Generator Template Updates

#### `agent-definitions.ts`

**Lines 28–42:** Add type prefix to `name` field in generated content:

```typescript
// Example: generated section now includes type prefix in name
const agentName = `agent: ${role.name}`;
sections.push({
  id: 'project-overview',
  content:
    `---\n` +
    `name: "${agentName}"\n` +
    `description: ${role.description}\n` +
    `generated-by: roadie\n` +
    `generated-at: ${new Date().toISOString()}\n` +
    `---\n\n` +
    `# ${role.displayName}\n...`
});
```

#### `agent-files.ts` (New — Individual agent files)

**New file:** Generate individual agent `.md` files in `.github/agents/`:

```typescript
// File naming: agent-name.md (e.g., fixer.md)
// Frontmatter name: "agent: fixer"
// Location: .github/agents/fixer.md
```

#### `skill-files.ts` (New — Individual skill files)

**New file:** Generate individual skill `.md` files in `.github/skills/`:

```typescript
// File naming: skill-name.md (e.g., code-review.md)
// Frontmatter name: "skill: code-review"
// Location: .github/skills/code-review.md
```

#### `path-instructions.ts` (Directory-level instructions)

**Lines 1–80:** Update frontmatter to include name with type prefix:

```typescript
// Name field: "instruction: lib" (for .github/instructions/lib.md)
// File names remain clean without type prefix
```

#### `cursor-rules-dir.ts` (Per-directory rules)

**Lines 1–120:** Update frontmatter name field:

```typescript
// Name field: "rules: src" (for .cursor/rules/src.mdc)
// File names remain clean
```

### 5. File Generator Updates

**`file-generator.ts` Lines 41–67 & 103–109:**

Update `buildFileSpecs()` and `generateAll()` to include new multi-file generators:

```typescript
// Add to buildFileSpecs()
{
  type: 'agent_files',
  path: '.github/agents/',  // Multi-file generation
  generate: generateAgentFiles,
},
{
  type: 'skill_files',
  path: '.github/skills/',   // Multi-file generation
  generate: generateSkillFiles,
},

// Add to generateAll() similar to generatePathInstructionFiles()
const agentResults = await this.generateAgentFiles(model);
results.push(...agentResults);

const skillResults = await this.generateSkillFiles(model);
results.push(...skillResults);
```

**`types.ts` Lines 495–502:**

Update `GeneratedFileType` to include new types (if creating new agents/skills generators):

```typescript
export type GeneratedFileType =
  | 'copilot_instructions' | 'agents_md'
  | 'agent_files'    // NEW
  | 'skill_files'    // NEW
  | 'claude_md' | 'cursor_rules' | 'path_instructions';
```

### 6. Documentation Updates

#### `AGENTS.md`

Add a section documenting the naming convention for users:

```markdown
## Generated Artifact Naming

Roadie generates standardized user artifacts with clear type identification:

| Type | Folder | File Pattern | Name in Dropdown |
|------|--------|--------------|------------------|
| Agent | `.github/agents/` | `fixer.md` | `agent: fixer` |
| Skill | `.github/skills/` | `code-review.md` | `skill: code-review` |
| Workflow | `.github/workflows/` | `deploy.md` | `workflow: deploy` |
| Instructions | `.github/instructions/` | `lib.md` | `instruction: lib` |

Each artifact includes YAML frontmatter with type-prefixed name, description, and generation metadata. The type prefix in the `name` field appears in VS Code's "Set Agent" dropdown menu for easy identification.
```

#### `roadie-App/CLAUDE.md` (Extension contribution guide)

Add naming convention guide for contributors:

```markdown
### Generated Artifact Naming Convention

All generator templates must add type prefixes to the `name` field in frontmatter:
- `name: "agent: {name}"`
- `name: "skill: {name}"`
- `name: "workflow: {name}"`
- `name: "instruction: {name}"`

File names remain clean (e.g., `fixer.md`, `code-review.md`). Type prefixes go ONLY in the `name` field to ensure they appear in VS Code's UI without breaking filenames.

See `roadie-App/docs/naming-convention-feature.md` for full details.
```

---

## Test Strategy

### 1. Unit Tests

**File:** `roadie-App/src/generator/templates/agent-definitions.test.ts`

Test cases:
- [ ] Generated agent definitions include frontmatter with `type: agent`
- [ ] Frontmatter includes `name`, `description`, `generated-by`, `generated-at`
- [ ] Generated content is valid YAML + Markdown

**File:** `roadie-App/src/generator/templates/claude-hooks.test.ts`

Test cases:
- [ ] Generated skills include frontmatter with `type: skill`
- [ ] File names follow pattern `skill:{name}.md`

**File:** `roadie-App/src/generator/templates/path-instructions.test.ts`

Test cases:
- [ ] File names follow pattern `.github/instructions/{dir}:instruction.md`
- [ ] Frontmatter is present and valid

### 2. Snapshot Tests

**File:** `roadie-App/src/generator/file-generator.snapshot.test.ts`

- [ ] Update snapshots to reflect new file naming patterns
- [ ] Verify frontmatter presence and structure
- [ ] Ensure backwards-compatibility message if old files exist

### 3. Integration Tests

**File:** `roadie-App/src/generator/file-generator.test.ts` (or new integration test)

Test cases:
- [ ] Full generation cycle produces files with correct names
- [ ] Frontmatter is parseable as YAML
- [ ] Type field can be extracted and used downstream
- [ ] File hashing and diff detection still work with new format

### 4. Manual Acceptance Tests

1. **Setup:** Run Roadie on the test fixture (`roadie-test-calculator`)
2. **Verify generated files:**
   ```bash
   ls -la .github/instructions/ | grep ':'
   ls -la .cursor/rules/ | grep ':'
   ```
3. **Parse frontmatter:**
   ```bash
   head -20 agent:*.md | grep "^type:"
   ```
4. **Check AGENTS.md:** Includes naming convention documentation
5. **Backwards compatibility:** Old files (without naming convention) still load without error

---

## Risk Assessment

### Very Low Risk

- **File naming unchanged:** Clean file names (e.g., `fixer.md`) remain Windows-compatible and do not break glob patterns.
- **Name field only:** Type prefixes added only to frontmatter `name` field; no file system changes.
- **Backwards compatible:** Existing generated files without type prefixes continue to work; frontmatter is optional.
- **Localized changes:** Generator template updates are isolated; no schema or type definition changes needed.
- **No new dependencies:** Uses existing frontmatter and `Date.toISOString()` for timestamps.

### Snapshot Test Updates (Mechanical)

- **Affected files:** `file-generator.snapshot.test.ts`, templates `*.test.ts` files
- **Change:** Update expected frontmatter to include type-prefixed `name` field
- **Effort:** Mechanical, no logic changes

### Rollback Risk: Minimal

1. **Code changes:** Revert generator templates to remove type prefix from `name` field.
2. **Backwards compatibility:** Old files without prefixes are unaffected; new files simply gain prefixes on next generation.
3. **No data loss:** Frontmatter is purely additive; removing it doesn't corrupt any content.

---

## Version Bump

**Target Version:** `0.8.0` (minor bump — new feature, backwards compatible)

**CHANGELOG Entry:**

```markdown
## [0.8.0] — 2026-04-17 — Artifact Naming Convention

### Added

- **Type-prefixed artifact names:** Generated agent, skill, workflow, and instruction files now include type prefixes in their frontmatter `name` field (e.g., `name: "agent: fixer"`, `name: "skill: code-review"`). This makes artifact types immediately clear in VS Code's "Set Agent" dropdown menu and aids IDE integration.

### Improved

- Generated user artifacts now include consistent YAML frontmatter with `name`, `description`, `generated-by`, and `generated-at` metadata.
- Artifact discovery and identification is clearer for users and downstream tooling.

### Notes

- Backwards compatible: existing projects with legacy artifact naming continue to work unchanged.
- File names remain clean and Windows-compatible (no colons or special characters).
```

---

## Acceptance Criteria

- [ ] Generator templates updated to include type prefix in `name` field
- [ ] Snapshot tests regenerated and passing
- [ ] Unit tests validate frontmatter with type-prefixed `name` field
- [ ] Manual test on sample project confirms naming convention applied
- [ ] CHANGELOG entry reflects feature
- [ ] Version bumped to 0.8.0 in package.json
- [ ] Documentation in AGENTS.md covers the naming convention
- [ ] No breaking changes to Roadie internal files or existing project structure

---

## Plan Status: REVISED ✅

**Revision Date:** 2026-04-17  
**Changes from Original:**
- File names remain clean (e.g., `fixer.md` not `agent:fixer.md`) — Windows-compatible
- Type prefix moved to `name` field in frontmatter only (e.g., `name: "agent: fixer"`)
- Eliminates all filename-related blockers (Windows compatibility, schema validation, file watcher issues)
- Simpler implementation with lower risk and no schema changes needed
