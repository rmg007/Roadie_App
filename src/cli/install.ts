/**
 * @module cli/install
 * @description Install Roadie MCP into host AI configuration (Claude, Copilot, Cursor)
 * @exports installRoadie
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { z } from 'zod';

const InstallResultSchema = z.object({
  success: z.boolean(),
  host: z.string().describe('Detected host: claude|copilot|cursor|none'),
  configPath: z.string(),
  message: z.string(),
});

export type InstallResult = z.infer<typeof InstallResultSchema>;

/**
 * Detect which AI host is available on the user's machine
 */
function detectHost(): { host: string; configPath: string } | null {
  const homeDir = os.homedir();

  // Check Claude desktop config
  const claudeConfigPath = path.join(homeDir, '.claude', 'claude_desktop_config.json');
  if (fs.existsSync(claudeConfigPath)) {
    return { host: 'claude', configPath: claudeConfigPath };
  }

  // Check Copilot config
  const copilotConfigPath = path.join(
    homeDir,
    'AppData',
    'Local',
    'GitHub Copilot',
    'hosts.json'
  );
  if (fs.existsSync(copilotConfigPath)) {
    return { host: 'copilot', configPath: copilotConfigPath };
  }

  // Check Cursor config
  const cursorConfigPath = path.join(
    homeDir,
    '.cursor',
    'rules',
    'mcp.json'
  );
  if (fs.existsSync(cursorConfigPath)) {
    return { host: 'cursor', configPath: cursorConfigPath };
  }

  return null;
}

/**
 * The system-prompt snippet that tells the host-AI to always forward messages to roadie_chat.
 * A SHA-256 hash comment at the top makes it detectable to avoid double-installation.
 */
const SYSTEM_PROMPT_SNIPPET_HASH = 'roadie-system-prompt-v1';
const SYSTEM_PROMPT_SNIPPET = `
# Roadie AI Routing (auto-installed by \`npx roadie install\`)
# ${SYSTEM_PROMPT_SNIPPET_HASH}
For EVERY user request — bug fixes, features, refactors, reviews, documentation updates, or dependency management —
call the \`roadie_chat\` tool with the user's exact message as the \`message\` parameter.
Do not attempt to handle project tasks yourself. Roadie will classify intent and dispatch the right workflow.
Only respond directly (without calling roadie_chat) for: pure conversational questions, meta questions about Roadie itself, or when the user explicitly says "don't use Roadie".
`.trim();

/**
 * Write the system-prompt snippet to the appropriate host config location.
 * Idempotent — checks for snippet hash before writing.
 */
function installSystemPromptSnippet(host: string): void {
  const homeDir = os.homedir();
  let snippetPath: string;

  if (host === 'claude') {
    snippetPath = path.join(homeDir, '.claude', 'CLAUDE.md');
  } else if (host === 'cursor') {
    snippetPath = path.join(homeDir, '.cursor', 'rules', 'roadie-routing.mdc');
  } else {
    // Copilot and others: write to a local prompt file
    snippetPath = path.join(process.cwd(), '.github', 'copilot-instructions.md');
  }

  // Read existing if present
  let existing = '';
  if (fs.existsSync(snippetPath)) {
    existing = fs.readFileSync(snippetPath, 'utf-8');
  }

  // Skip if already installed (hash detection)
  if (existing.includes(SYSTEM_PROMPT_SNIPPET_HASH)) return;

  fs.mkdirSync(path.dirname(snippetPath), { recursive: true });
  const separator = existing.length > 0 ? '\n\n---\n\n' : '';
  fs.writeFileSync(snippetPath, existing + separator + SYSTEM_PROMPT_SNIPPET + '\n', 'utf-8');
}

/**
 * Get the MCP server entry for Roadie
 */
function getRoadieMCPEntry(): object {
  const serverPath = path.resolve(process.argv[1], '..', 'index.js');
  return {
    command: 'node',
    args: [serverPath],
    disabled: false,
  };
}

/**
 * Install Roadie into host AI configuration
 */
export async function installRoadie(): Promise<InstallResult> {
  try {
    const detection = detectHost();

    if (!detection) {
      return {
        success: false,
        host: 'none',
        configPath: '',
        message: 'No supported AI host configuration found. Install Claude, Copilot, or Cursor.',
      };
    }

    const { host, configPath } = detection;
    let config: any = {};

    // Load existing config
    if (fs.existsSync(configPath)) {
      try {
        const content = fs.readFileSync(configPath, 'utf-8');
        config = JSON.parse(content);
      } catch {
        // If parse fails, start fresh
        config = {};
      }
    }

    // Ensure directory exists
    fs.mkdirSync(path.dirname(configPath), { recursive: true });

    // Add Roadie MCP server
    if (host === 'claude') {
      if (!config.mcpServers) config.mcpServers = {};
      config.mcpServers.roadie = getRoadieMCPEntry();
    } else if (host === 'copilot') {
      if (!config.servers) config.servers = {};
      config.servers.roadie = getRoadieMCPEntry();
    } else if (host === 'cursor') {
      if (!config.mcp) config.mcp = {};
      config.mcp.roadie = getRoadieMCPEntry();
    }

    // Write updated config
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

    // Auto-install system-prompt routing snippet
    installSystemPromptSnippet(host);

    return {
      success: true,
      host,
      configPath,
      message: `Roadie MCP installed successfully into ${host} at ${configPath}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      host: 'none',
      configPath: '',
      message: `Installation failed: ${message}`,
    };
  }
}
