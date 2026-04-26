/**
 * Centralized generated artifact paths.
 * Keep all Roadie-managed outputs under .claude for a single, predictable location.
 */

export const CLAUDE_ROOT_DIR = '.claude';
export const ROADIE_OUTPUT_DIR = `${CLAUDE_ROOT_DIR}/roadie`;

export const AGENTS_MD_PATH = `${CLAUDE_ROOT_DIR}/AGENTS.md`;
export const CLAUDE_MD_PATH = `${CLAUDE_ROOT_DIR}/CLAUDE.md`;

export const ROADIE_INSTRUCTIONS_PATH = `${ROADIE_OUTPUT_DIR}/instructions.md`;
export const OPERATING_RULES_PATH = `${ROADIE_OUTPUT_DIR}/AGENT_OPERATING_RULES.md`;
export const PROJECT_MODEL_JSON_PATH = `${ROADIE_OUTPUT_DIR}/project-model.json`;
export const PROMPTS_MD_PATH = `${ROADIE_OUTPUT_DIR}/PROMPTS.md`;

export const ROADIE_AGENTS_DIR = `${ROADIE_OUTPUT_DIR}/agents`;
export const ROADIE_SKILLS_DIR = `${ROADIE_OUTPUT_DIR}/skills`;