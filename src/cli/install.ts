/**
 * @module cli/install
 * @description Install Roadie MCP into host AI configuration (Claude, Copilot, Cursor)
 * @exports installRoadie
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { z } from 'zod';

const ROADIE_SUPERPOWER_ALLOW_RULES = [
  'Bash(*)',
  'Read(*)',
  'Write(*)',
  'Edit(*)',
  'MultiEdit(*)',
  'Glob(*)',
  'Grep(*)',
  'WebFetch(*)',
  'Task(*)',
] as const;

const InstallResultSchema = z.object({
  success: z.boolean(),
  host: z.string().describe('Detected host: claude|copilot|cursor|none'),
  configPath: z.string(),
  message: z.string(),
});

export type InstallResult = z.infer<typeof InstallResultSchema>;

type HostConfig = {
  mcpServers?: Record<string, unknown>;
  servers?: Record<string, unknown>;
  mcp?: Record<string, unknown>;
  [key: string]: unknown;
};

/**
 * Detect which AI host is available on the user's machine
 */
async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function detectHost(): Promise<{ host: string; configPath: string } | null> {
  const homeDir = os.homedir();

  // Check Claude desktop config
  const claudeConfigPath = path.join(homeDir, '.claude', 'claude_desktop_config.json');
  if (await pathExists(claudeConfigPath)) {
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
  if (await pathExists(copilotConfigPath)) {
    return { host: 'copilot', configPath: copilotConfigPath };
  }

  // Check Cursor config
  const cursorConfigPath = path.join(
    homeDir,
    '.cursor',
    'rules',
    'mcp.json'
  );
  if (await pathExists(cursorConfigPath)) {
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
async function installSystemPromptSnippet(host: string): Promise<void> {
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
  if (await pathExists(snippetPath)) {
    existing = await fs.readFile(snippetPath, 'utf-8');
  }

  // Skip if already installed (hash detection)
  if (existing.includes(SYSTEM_PROMPT_SNIPPET_HASH)) return;

  await fs.mkdir(path.dirname(snippetPath), { recursive: true });
  const separator = existing.length > 0 ? '\n\n---\n\n' : '';
  await fs.writeFile(snippetPath, existing + separator + SYSTEM_PROMPT_SNIPPET + '\n', 'utf-8');
}

/**
 * Get the MCP server entry for Roadie
 */
function getRoadieMCPEntry(): object {
  const cliEntry = process.argv[1]
    ? path.resolve(process.argv[1])
    : path.join(process.cwd(), 'out', 'index.js');
  const serverPath = path.join(path.dirname(cliEntry), 'index.js');
  return {
    command: 'node',
    args: [serverPath],
    disabled: false,
  };
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown>> {
  if (!(await pathExists(filePath))) return {};

  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf-8')) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Start fresh on malformed JSON.
  }

  return {};
}

async function writeJsonFile(filePath: string, payload: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8');
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function mergeUniqueStrings(a: string[], b: readonly string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const item of [...a, ...b]) {
    if (!seen.has(item)) {
      merged.push(item);
      seen.add(item);
    }
  }

  return merged;
}

async function installClaudeGlobalSuperpowers(): Promise<void> {
  const homeDir = os.homedir();
  const settingsPath = path.join(homeDir, '.claude', 'settings.json');
  const existing = await readJsonFile(settingsPath);

  const permissions = asRecord(existing.permissions);
  const nextPermissions: Record<string, unknown> = {
    ...permissions,
    defaultMode: 'bypassPermissions',
  };

  delete nextPermissions.ask;
  delete nextPermissions.deny;

  const next = {
    ...existing,
    permissions: nextPermissions,
  };

  await writeJsonFile(settingsPath, next);
}

async function installProjectClaudeSuperpowers(projectRoot: string): Promise<void> {
  const settingsPath = path.join(projectRoot, '.claude', 'settings.local.json');
  const existing = await readJsonFile(settingsPath);
  const permissions = asRecord(existing.permissions);
  const allow = asStringArray(permissions.allow);

  const nextPermissions: Record<string, unknown> = {
    ...permissions,
    allow: mergeUniqueStrings(allow, ROADIE_SUPERPOWER_ALLOW_RULES),
  };

  const next = {
    ...existing,
    permissions: nextPermissions,
  };

  await writeJsonFile(settingsPath, next);
}

async function installWindowsAutoStart(projectRoot: string): Promise<void> {
  if (process.platform !== 'win32') return;

  const deployDir = path.join(projectRoot, 'deploy');
  const autoStartBatPath = path.join(deployDir, 'roadie-autostart.bat');
  const startupDir = path.join(
    process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Startup',
  );

  const startupEntryName = `Roadie-${path.basename(projectRoot)}.cmd`;
  const startupEntryPath = path.join(startupDir, startupEntryName);

  const batContent = [
    '@echo off',
    'setlocal',
    `cd /d "${projectRoot}"`,
    'if exist "node_modules\\.bin\\roadie.cmd" (',
    '  call "node_modules\\.bin\\roadie.cmd"',
    ') else (',
    '  roadie',
    ')',
    '',
  ].join('\r\n');

  const startupEntry = [
    '@echo off',
    `"${autoStartBatPath}"`,
    '',
  ].join('\r\n');

  await fs.mkdir(deployDir, { recursive: true });
  await fs.mkdir(startupDir, { recursive: true });
  await fs.writeFile(autoStartBatPath, batContent, 'utf-8');
  await fs.writeFile(startupEntryPath, startupEntry, 'utf-8');
}

/**
 * Install Roadie into host AI configuration
 */
export async function installRoadie(): Promise<InstallResult> {
  try {
    const detection = await detectHost();

    if (!detection) {
      return {
        success: false,
        host: 'none',
        configPath: '',
        message: 'No supported AI host configuration found. Install Claude, Copilot, or Cursor.',
      };
    }

    const { host, configPath } = detection;
    let config: HostConfig = {};

    // Load existing config
    if (await pathExists(configPath)) {
      try {
        const content = await fs.readFile(configPath, 'utf-8');
        const parsed = JSON.parse(content);
        config = typeof parsed === 'object' && parsed !== null ? (parsed as HostConfig) : {};
      } catch {
        // If parse fails, start fresh
        config = {};
      }
    }

    // Ensure directory exists
    await fs.mkdir(path.dirname(configPath), { recursive: true });

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
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');

    // Auto-install system-prompt routing snippet
    await installSystemPromptSnippet(host);

    // Optional: elevated defaults are opt-in only for multi-developer safety.
    if (host === 'claude') {
      if (process.env.ROADIE_INSTALL_SUPERPOWERS === '1') {
        await installClaudeGlobalSuperpowers();
        await installProjectClaudeSuperpowers(process.cwd());
      }

      if (process.env.ROADIE_INSTALL_AUTOSTART === '1') {
        await installWindowsAutoStart(process.cwd());
      }
    }

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
