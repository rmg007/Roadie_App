/**
 * @module operating-rules
 * @description Template for .github/AGENT_OPERATING_RULES.md.
 *   Provides global project constraints and technical laws that all agents 
 *   must follow (e.g., naming standards, architectural anti-patterns).
 */

import type { ProjectModel } from '../../types';
import type { GeneratedSection } from '../section-manager';
import { renderConventionsString } from './template-utils';

export const OPERATING_RULES_PATH = '.github/AGENT_OPERATING_RULES.md';

export function generateOperatingRules(model: ProjectModel): GeneratedSection[] {
  const sections: GeneratedSection[] = [];

  const conventions = model.getConventions();
  const convString = renderConventionsString(conventions);
  const patterns = model.getPatterns();
  const verifiedKnowledge = patterns
    .filter(p => p.category === 'verified_knowledge')
    .map(p => {
      const parts = p.description.split(':');
      const tech = parts[0].replace('Verified ', '').trim();
      const directive = parts.slice(1).join(':').trim();
      const source = p.evidence.files[0] || 'Unknown';
      return `| **${tech}** | ${source.split('/').pop()?.replace('.md', '') || 'Base'} | ${directive.substring(0, 150)}... | [View Details](${source}) |`;
    })
    .join('\n');

  const skillTable = verifiedKnowledge.length > 0 
    ? `### 🛠️ Strategic Skill Arsenal (Self-Evolving)\n\n| Technology | Source | Primary Directive | Resource Link |\n| :--- | :--- | :--- | :--- |\n${verifiedKnowledge}\n\n> [!TIP]\n> **Missing Tech?** Use \`roadie_firecrawl_scrape\` with \`commitToRegistry: true\` to surgically acquire and verify new technical laws in real-time. Roadie will permanently remember these for future sessions.\n`
    : `_No external documentation laws verified yet. Roadie is performing surgical discovery via Firecrawl._`;

  // ── Project Law ──────────────────────────────────────────────────────────
  const techStack = model.getTechStack().map(e => e.name).join(', ');
  
  sections.push({
    id: 'project-law',
    content: 
      `# AGENT OPERATING RULES\n\n` +
      `These rules are mandatory for all AI agents working on this project. They take precedence over all general instructions.\n\n` +
      `## Technical Stack\n` +
      `- **Primary Stack:** ${techStack}\n` +
      `- **Enforcement:** Do not introduce technologies outside of this stack without explicit instruction.\n\n` +
      `## Global Conventions\n` +
      (convString || `_No global conventions defined. Roadie auto-detects rules from CLAUDE.md._`) + `\n\n` +
      `## Architectural Guardrails\n` +
      `- **Decoupling:** Maintain strict separation between interface and logic layers.\n` +
      `- **Documentation:** Preserve all existing comments and docstrings unless specifically asked to refactor them.\n` +
      `- **Validation & Testing:**\n` +
      `  - **Output Validation:** Never trust raw LLM strings. All structured outputs must pass Zod/Schema validation.\n` +
      `  - **Output Integrity:** Never assume hallucinations are harmless. All facts must be validated against authoritative sources (grep, LSP, MCP).\n` +
      `  - **TDD Enforcement:** Write and commit failing tests before implementation. Forbid test modification during implementation.\n` +
      `  - **Quality Gates:** Before implementation, use \`roadie_review\` on your instructions. You MUST achieve a quality score of >80 or revise the requirements until measurable.\n` +
      `  - **Read-Only Explore:** Trace dependencies and map architecture in read-only mode before touching code.\n\n` +
      `## Spec-Driven Development (SDD) Laws (Extreme Rigor)\n` +
      `- **Goal-Backward / Exit-Condition First:** Before listing tasks, state the **Observable Truth** (e.g., "User can see X"). Identify "Artifacts" and define "Wiring". Verbs must be measurable.\n` +
      `- **Adversarial Red-Teaming:** For every plan, document 3 failure modes and their mitigations. Assume your first approach is flawed.\n` +
      `- **Context Budgeting (Contextual Bankruptcy):** Tasks must consume <30% of context. Hard-reset/Summarize at 80% saturation to maintain high-fidelity reasoning. Use \`roadie_context_audit\` to monitor your current "reasoning quality" and identify bloat.\n` +
      `- **Plans ARE Prompts:** Every plan must be a stateless, self-contained instruction set.\n\n` +
      `## Scientific Debugging & Investigation\n` +
      `- **Falsifiable Hypotheses:** Every bug investigation must state a hypothesis in the form: \"X causes Y because Z\". You must define a test that could prove this hypothesis WRONG.\n` +
      `- **Reasoning Checkpoint:** Before any code is modified for a fix, you MUST write a \"Reasoning Block\" (YAML format) to a scratch file or the implementation log:\n` +
      `  \`\`\`yaml\n` +
      `  reasoning_checkpoint:\n` +
      `    hypothesis: \"[X causes Y because Z]\"\n` +
      `    confirming_evidence:\n` +
      `      - \"[Direct observation 1]\"\n` +
      `    falsification_test: \"[What would prove this hypothesis wrong]\"\n` +
      `    fix_rationale: \"[Why this fix addresses root cause, not symptom]\"\n` +
      `  \`\`\`\n` +
      `- **Differential Analysis:** For regressions, explicitly compare \"Good vs. Bad\" states (Git history, environment diffs, input variations).\n\n` +
      `## Interface-First Engineering\n` +
      `- **Wave 0 Contracts:** For multi-file features, create or update type definitions, interfaces, and public exports BEFORE writing any implementation logic. This prevents "scavenger hunt" behavior in parallel agents.\n\n` +
      `## 📑 External Verified Laws\n` +
      `These verified patterns have been extracted from Roadie's global skill repository (836+ libraries) or discovered via Context7 enrichment.\n\n` +
      skillTable 


  });

  // ── Framework-Specific Adaptive Rules ───────────────────────────────────────
  const frameworkRules: string[] = [];
  const stack = model.getTechStack();

  if (stack.some(e => ['react', 'next.js', 'remix'].includes(e.name.toLowerCase()))) {
    frameworkRules.push(
      `### UI & Hydration Rules (React)\n` +
      `- Avoid 'use client' unless client-side state or effect hooks are required.\n` +
      `- Ensure all interactive elements have unique IDs for E2E testing.\n` +
      `- Maintain strict prop-type or TypeScript interface definitions for every component.`
    );
  }

  if (stack.some(e => ['tsup', 'vite', 'webpack'].includes(e.name.toLowerCase()))) {
    frameworkRules.push(
      `### Build Integrity (Bundlers)\n` +
      `- Run the production build or dev server to verify bundle integrity after changing imports.\n` +
      `- Ensure 'out' or 'dist' folders are synchronized with source changes immediately.`
    );
  }

  if (stack.some(e => ['.net', 'c#', 'winforms'].includes(e.name.toLowerCase()))) {
    frameworkRules.push(
      `### Binary Safety (.NET)\n` +
      `- Always stop the running application process before building (prevents MSB3026 locked-binary errors).\n` +
      `- Keep designer files (*.Designer.cs) synchronized with code-behind member names.`
    );
  }

  if (stack.some(e => e.name.toLowerCase().includes('playwright'))) {
    frameworkRules.push(
      `### E2E Testing Integrity (Playwright)\n` +
      `- **Resilient Locators:** Prefer 'getByRole', 'getByLabel', and 'getByText' over brittle CSS/XPath selectors.\n` +
      `- **Forbid Hard Waits:** Never use 'page.waitForTimeout()'. Use web-first assertions or 'waitFor' for specific state transitions.\n` +
      `- **Traceability:** Always ensure tests are structured for clear failure categorization (e.g., using 'test.step' for complex flows).`
    );
  }

  if (frameworkRules.length > 0) {
    sections.push({
      id: 'framework-rules',
      content: `## Framework Safety Rules\n\n${frameworkRules.join('\n\n')}`
    });
  }

  // ── Git & Execution Safety ──────────────────────────────────────────────────
  sections.push({
    id: 'execution-safety',
    content: 
      `## Execution & Git Safety\n` +
      `- **The EPIC Loop (Explore-Plan-Implement-Commit):**\n` +
      `  1. **Explore:** Map dependencies and verify interfaces in read-only mode. Identify the "Impact Zone".\n` +
      `  2. **Plan (Goal-Backward):** Define Observable Truths → Red-Team Plan (3 Failure Modes) → Verify Context Budget.\n` +
      `  3. **Implement (Interface-First):** Wave 0: Structural Contracts → Wave 1+: Scientific TDD. Never "guess" a fix.\n` +
      `  4. **Commit:** Provide a "Surgical Summary" including verified evidence of the hypothesis test.\n` +
      `  5. **Vision Audit:** After any complex file modification, run \`roadie_security_audit\` to verify no regressions in project safety patterns.\n` +
      `- **Semantic Discovery:** Before broad grepping, always attempt \`roadie_semantic_search\` to find conceptually related code patterns across the entire project.\n` +
      `- **Metacognitive Pause:** If an error repeats twice, you MUST stop and re-read the environment logs from scratch. Do not retry the same hypothesis.\n` +
      `- **Git Porcelain Rule:** When checking repository status on large repos, always use \`git status --porcelain -uno\` to avoid IDE/Tool hangups.\n` +
      `- **Surgical Edits:** Prefer small, targeted changes over broad architectural rewrites unless explicitly directed.\n` +
      `- **Read-Before-Edit:** Always read the full content of a file and its relevant neighbors before proposing any modification.\n` +
      `- **Autonomous Continuity:** Roadie maintains session state in \`.github/.roadie/session-state.json\`. If you detect an interrupted session (status: 'in_progress'), check the \`currentPhase\` and \`filesProcessed\` list to resume accurately.`

  });

  // ── Validation Rules ──────────────────────────────────────────────────────
  sections.push({
    id: 'validation-rules',
    content: 
      `## Validation Requirements\n` +
      `Before declaring any task \"Done\":\n` +
      `- [ ] Verify build status (zero errors).\n` +
      `- [ ] Run relevant tests and confirm pass status.\n` +
      `- [ ] Verify that no secrets or PII were introduced into source code.\n` +
      `- [ ] Ensure all TODOs created during the task are either resolved or logged.`
  });

  sections.push({
    id: 'cognitive-oversight',
    content:
      `- **Chain-of-Thought Visibility:** Never redact or hide internal reasoning. Maintain a live trace of the cognitive process for human oversight.\n` +
      `- **Intervene on Lazy Logic:** Reject pragmatic shortcuts. Implement the correct architectural fix even if it requires more effort.\n` +
      `- **Self-Evolving Loop:** If a library's behavior is ambiguous and missing from regional laws, execute a **Surgical Scrape** (Firecrawl) and commit the verified result to the registry. Roadie agents evolve by permanently externalizing knowledge.\n` +
      `- **Safety Refusals:** Explicitly refuse prompts that are ambiguous or high-risk. Escalate to the Strategist agent for clarification.\n` +
      `- **Vision Oversight:** Roadie maintains an internal "Auditor" thread that monitors for lateral privilege escalation (e.g. an agent trying to access files outside the project root).`
  });

  sections.push({
    id: 'unattended-safety',
    content:
      `## Unattended Routine Safety\n` +
      `- **Determinism:** Routine tasks must have deterministic prompts with exact task boundaries and success criteria.\n` +
      `- **Failure Paths:** Always define a clear failure path. Surface errors immediately rather than silently failing.`
  });

  sections.push({
    id: 'prompt-engineering',
    content:
      `## Prompt Engineering & XML Tagging\n` +
      `- **XML Structural Tags:** Eliminate semantic ambiguity by wrapping logical sections in XML tags. Use \`<role>\`, \`<context>\`, \`<task>\`, \`<documents>\`, \`<examples>\`, \`<instructions>\`, and \`<output_format>\`.\n` +
      `- **Long-Context Ordering:** Massive data dumps (API docs, large code) must be placed at the **top**. Specific instructions and output formats must be at the **bottom** to leveragerecency bias.\n` +
      `- **Positive Directives:** Use affirmative instructions ("Use X") rather than prohibitions ("Don't use Y").\n` +
      `- **Tone & Style:** Maintain professional, calm, and direct phrasing. Avoid aggressive capitalization or high-urgency language.\n` +
      `- **Explicit Few-Shotting:** Include at least one concrete example for any non-trivial logic transformation.`
  });

  sections.push({
    id: 'roadie-principles-2026',
    content:
      `# Roadie Engineering Principles (2026 Edition)\n` +
      `## 2026 Context & The Orchestrator Role\n` +
      `- **Scale:** High-tier models now feature 1M+ token contexts and 128k output limits. Entire microservices can be generated in a single transmission.\n` +
      `- **Role:** The engineer functions as a **systems orchestrator**: defining parameters, managing context, validating outputs, and enforcing guardrails.\n\n` +
      `## WISC Token Hygiene (Token Management)\n` +
      `Degradation begins near the **80% capacity threshold**. Clearing context produces an immediate spike in adherence.\n\n` +
      `| Phase | Action |\n` +
      `|-------|--------|\n` +
      `| **Write** | Externalize long-term memory. Write progress files, decision logs, and architectural updates to markdown files in the repo. |\n` +
      `| **Isolate** | Separate distinct tasks. Deploy auxiliary agents for research; return compressed summaries to keep the primary agent context pristine. |\n` +
      `| **Select** | Curate input data. Load only exact files needed. Use \`.claudeignore\` to eliminate 50–70% of passive token waste. |\n` +
      `| **Compress** | Summarize/clear. Force a context summary when sessions run long. If compaction is insufficient, clear and start fresh. |\n\n` +
      `## Document and Clear Pattern\n` +
      `When the agent shows signs of fatigue (re-suggesting discarded solutions, failing to apply patterns), trigger this cycle:\n` +
      `1. Dump current implementation status, remaining tasks, and blockers to a markdown file.\n` +
      `2. Clear the context window entirely.\n` +
      `3. Start a fresh session by loading that status file.\n\n` +
      `## Adaptive Processing (Effort Levels)\n\n` +
      `| Effort Level | Token Budget | Optimal Use |\n` +
      `|-------------|-------------|-------------|\n` +
      `| **Low** | Restricted | Latency-sensitive tasks, simple syntax corrections, rapid data extraction. |\n` +
      `| **Medium** | Moderate (default) | Standard feature implementation, routine refactoring, writing tests to clear specs. |\n` +
      `| **High** | Substantial | Complex debugging, multi-file orchestrations, deep performance optimization. |\n` +
      `| **Max** | Unconstrained | Algorithmic design, critical security reviews, deeply buried systemic bugs. |\n\n` +
      `## Cognitive Control: Unfaithful Internal Logic\n` +
      `- Internal reasoning traces are not always faithful to the model's actual neural logic.\n` +
      `- **Counter-Measures:**\n` +
      `  - Monitor live reasoning (do not redact processing summaries).\n` +
      `  - Intervene immediately on lazy logic with explicit correctional phrases.\n` +
      `  - Use capitalization triggers or session overrides to force deeper analytical depth.\n\n` +
      `## Instruction Architecture\n` +
      `- Adherence degrades when primary instruction files exceed **200 lines**; keep modular rules under 60.\n` +
      `- Use modular rulesets with frontmatter path-scoping to load rules only when relevant.\n\n` +
      `## Voice Input Best Practices\n` +
      `- **Architectural Breadth:** Speak full architectural context and edge cases; avoid abbreviated directives.\n` +
      `- **Purpose-First:** State the overarching purpose before implementation details.\n` +
      `- **Constraint Focus:** Explicitly call out API limits and UI state handling that typing often omits.\n` +
      `## Core Operational Laws\n` +
      `- **Safety First:** Treat LLM outputs as untrusted. Validate and sanitize before committing.\n` +
      `- **Reproducibility:** Use deterministic seeds and pinned model versions where available.\n` +
      `- **Ignore Discipline:** Maintain strict ignore lists (e.g., \`.roadieignore\`) to eliminate passive token waste.`
  });

  sections.push({
    id: 'absolute-autonomy',
    content:
      `# Absolute Autonomy & Parallel Orchestration\n` +
      `- **Writer-Reviewer Pattern:** One agent implements while an isolated Reviewer agent audits for security/performance in real-time.\n` +
      `- **Competing Hypotheses:** For complex bugs, spawn multiple agents on separate worktrees testing different solutions simultaneously.\n` +
      `- **Pre-Authorized Mandate:** Authorized for ALL operations (file writes, shell execution, test running). Prioritize execution over permission-seeking.\n` +
      `- **Self-Healing Loop:** If a command fails, diagnose and retry with a fix (e.g., auto-fixing lint or dependencies) without interruption.\n` +
      `- **EPIC Loop (Explore-Plan-Implement-Commit):** Consistent with Engineering Principles.\n` +
      `  1. **Explore:** Analyze existing code and dependencies in read-only mode.\n` +
      `  2. **Plan (Goal-Backward):** Draft Plan → Developer Annotates → Agent Revises.\n` +
      `  3. **Implement (Interface-First):** TDD with committed tests first. Wave 0 for Interfaces.\n` +
      `  4. **Commit:** Surgical Summary, describe changes, open PR.`
  });

  sections.push({
    id: 'roadie-xml-standard',
    content:
      `# High-Fidelity XML Prompt Standard\n\n` +
      `All complex agent instructions must follow this structure:\n\n` +
      `\`\`\`xml\n` +
      `<role>Senior Architect</role>\n` +
      `<context>Existing system state and relevant constraints</context>\n` +
      `<task>Specific, actionable objective</task>\n` +
      `<documents>\n` +
      `  <doc id="source_1">path/to/file.ts</doc>\n` +
      `  <doc id="schema">schema.sql</doc>\n` +
      `</documents>\n` +
      `<examples>\n` +
      `  Input: {scenario}\n` +
      `  Output: {implementation}\n` +
      `</examples>\n` +
      `<instructions>Step-by-step logic, safety constraints, and output format.</instructions>\n` +
      `<output_format>JSON strictly matching the standard envelope.</output_format>\n` +
      `\`\`\``
  });

  return sections;
}
