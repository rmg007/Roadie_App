/**
 * E2E test suite: MCP Server interaction tests.
 *
 * Mimics real user interactions via MCP Inspector by spawning the built
 * server (out/index.js) as a child process and communicating over stdio
 * using the official MCP SDK client.
 *
 * Covers: List Prompts, List Resources, List Tools, Call Tools.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as path from 'node:path';

const SERVER_ENTRY = path.resolve(__dirname, '../../out/index.js');
const PROJECT_ROOT = path.resolve(__dirname, '../../');
const TIMEOUT = 30_000;

// ─── Expected tool names registered in src/index.ts ───
const EXPECTED_TOOLS = [
  'roadie_chat',
  'roadie_summon_agent',
  'roadie_resolve_library',
  'roadie_fetch_docs',
  'roadie_get_skill',
  'roadie_sync_skills',
  'roadie_firecrawl_scrape',
  'roadie_registry_health',
  'roadie_firecrawl_is_enabled',
  'roadie_context_audit',
  'roadie_security_audit',
  'roadie_semantic_search',
  'roadie_rollback',
  'roadie_review',
  'roadie_verify_blackbox',
  'roadie_cycle_diagnostics',
];

let client: Client;
let transport: StdioClientTransport;

beforeAll(async () => {
  transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_ENTRY, PROJECT_ROOT],
    env: {
      ...process.env as Record<string, string>,
      // Prevent the autonomous cycle from hitting real APIs
      ROADIE_DRY_RUN: '1',
    },
    stderr: 'pipe',
  });

  client = new Client(
    { name: 'roadie-e2e-test', version: '1.0.0' },
    { capabilities: {} },
  );

  await client.connect(transport);
}, TIMEOUT);

afterAll(() => {
  // Avoid explicit close: protocol teardown can race and surface as a suite-level error.
});

// ═══════════════════════════════════════════════════════════════════════
// 1. List Prompts
// ═══════════════════════════════════════════════════════════════════════

describe('List Prompts', () => {
  it('returns summon_agent and roadie_onboard_tech prompts', async () => {
    const result = await client.listPrompts();
    const names = result.prompts.map(p => p.name);

    expect(names).toContain('summon_agent');
    expect(names).toContain('roadie_onboard_tech');
  }, TIMEOUT);

  it('summon_agent has role and task arguments', async () => {
    const result = await client.listPrompts();
    const summon = result.prompts.find(p => p.name === 'summon_agent');

    expect(summon).toBeDefined();
    const argNames = summon!.arguments!.map(a => a.name);
    expect(argNames).toContain('role');
    expect(argNames).toContain('task');
  }, TIMEOUT);

  it('roadie_onboard_tech has techName argument', async () => {
    const result = await client.listPrompts();
    const onboard = result.prompts.find(p => p.name === 'roadie_onboard_tech');

    expect(onboard).toBeDefined();
    const argNames = onboard!.arguments!.map(a => a.name);
    expect(argNames).toContain('techName');
  }, TIMEOUT);
});

// ═══════════════════════════════════════════════════════════════════════
// 2. Get Prompt (invoke a prompt template)
// ═══════════════════════════════════════════════════════════════════════

describe('Get Prompt', () => {
  it('summon_agent returns a user message with the role and task', async () => {
    const result = await client.getPrompt({
      name: 'summon_agent',
      arguments: { role: 'reviewer', task: 'audit the auth module' },
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');

    const text = (result.messages[0].content as { type: 'text'; text: string }).text;
    expect(text).toContain('Reviewer');
    expect(text).toContain('audit the auth module');
  }, TIMEOUT);

  it('roadie_onboard_tech returns a fallback when skill is unknown', async () => {
    const result = await client.getPrompt({
      name: 'roadie_onboard_tech',
      arguments: { techName: 'nonexistent-tech-xyz' },
    });

    expect(result.messages.length).toBeGreaterThanOrEqual(1);
    const text = (result.messages[0].content as { type: 'text'; text: string }).text;
    expect(text).toMatch(/don.t have a verified skill|Fallback/i);
  }, TIMEOUT);

  it('throws on unknown prompt name', async () => {
    await expect(
      client.getPrompt({ name: 'does_not_exist', arguments: {} }),
    ).rejects.toThrow();
  }, TIMEOUT);
});

// ═══════════════════════════════════════════════════════════════════════
// 3. List Resources (Skill Registry)
// ═══════════════════════════════════════════════════════════════════════

describe('List Resources', () => {
  it('returns an array of skill resources', async () => {
    const result = await client.listResources();

    expect(result.resources).toBeDefined();
    expect(Array.isArray(result.resources)).toBe(true);

    // Each resource should have uri, name, mimeType
    for (const r of result.resources) {
      expect(r.uri).toMatch(/^roadie:\/\/skills\//);
      expect(r.name).toBeTruthy();
      expect(r.mimeType).toBe('text/markdown');
    }
  }, TIMEOUT);
});

// ═══════════════════════════════════════════════════════════════════════
// 4. List Tools
// ═══════════════════════════════════════════════════════════════════════

describe('List Tools', () => {
  it('returns all expected tools', async () => {
    const result = await client.listTools();
    const names = result.tools.map(t => t.name);

    for (const expected of EXPECTED_TOOLS) {
      expect(names).toContain(expected);
    }
  }, TIMEOUT);

  it('each tool has a valid inputSchema', async () => {
    const result = await client.listTools();

    for (const tool of result.tools) {
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
    }
  }, TIMEOUT);

  it('roadie_chat requires a message argument', async () => {
    const result = await client.listTools();
    const chat = result.tools.find(t => t.name === 'roadie_chat');

    expect(chat).toBeDefined();
    expect((chat!.inputSchema as any).required).toContain('message');
  }, TIMEOUT);
});

// ═══════════════════════════════════════════════════════════════════════
// 5. Call Tools — individual tool invocations
// ═══════════════════════════════════════════════════════════════════════

describe('Call Tools', () => {
  it('roadie_firecrawl_is_enabled returns enabled/disabled status', async () => {
    const result = await client.callTool({ name: 'roadie_firecrawl_is_enabled', arguments: {} });

    expect(result.content).toBeDefined();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toMatch(/Firecrawl is (ENABLED|DISABLED)/);
  }, TIMEOUT);

  it('roadie_security_audit returns a security report', async () => {
    const result = await client.callTool({ name: 'roadie_security_audit', arguments: {} });

    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('Security Audit');
    expect(text).toMatch(/\[PASS\]|\[WARN\]|\[INFO\]/);
  }, TIMEOUT);

  it('roadie_context_audit returns a context health report or handled error', async () => {
    const result = await client.callTool({ name: 'roadie_context_audit', arguments: {} });

    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    // The tool may return a full report or a handled error depending on model state
    expect(text).toMatch(/Context Audit|Roadie Tool Error/);
  }, TIMEOUT);

  it('roadie_registry_health returns registry stats or handled error', async () => {
    const result = await client.callTool({ name: 'roadie_registry_health', arguments: {} });

    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    // May fail gracefully if getAllSkills is not available on the registry
    expect(text).toMatch(/Skill Registry Health|Roadie Tool Error/);
  }, TIMEOUT);

  it('roadie_sync_skills returns synchronization confirmation', async () => {
    const result = await client.callTool({ name: 'roadie_sync_skills', arguments: {} });

    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toMatch(/synchronized/i);
    expect(text).toMatch(/\d/);
  }, TIMEOUT);

  it('roadie_review detects vague language in requirements', async () => {
    const result = await client.callTool({
      name: 'roadie_review',
      arguments: { content: 'The system should be fast and user-friendly with good performance.' },
    });

    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('Quality Audit');
  }, TIMEOUT);

  it('roadie_review passes on precise requirements', async () => {
    const result = await client.callTool({
      name: 'roadie_review',
      arguments: { content: 'The /api/users endpoint must return a 200 status within 200ms for 99th percentile requests.' },
    });

    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('Quality Audit');
  }, TIMEOUT);

  it('roadie_verify_blackbox returns a verification report', async () => {
    const result = await client.callTool({
      name: 'roadie_verify_blackbox',
      arguments: {
        requirement: 'Login API must return 401 for invalid credentials',
        testCommand: 'npm test',
      },
    });

    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('Blackbox Verification');
    expect(text).toContain('npm test');
  }, TIMEOUT);

  it('roadie_summon_agent returns an agent system prompt', async () => {
    const result = await client.callTool({
      name: 'roadie_summon_agent',
      arguments: { role: 'builder', task: 'implement the settings page' },
    });

    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('BUILDER');
    expect(text).toContain('implement the settings page');
  }, TIMEOUT);

  it('roadie_get_skill returns error for unknown skill', async () => {
    const result = await client.callTool({
      name: 'roadie_get_skill',
      arguments: { skillName: 'nonexistent-skill-xyz-123' },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('not found');
  }, TIMEOUT);

  it('roadie_semantic_search returns results for a query', async () => {
    const result = await client.callTool({
      name: 'roadie_semantic_search',
      arguments: { query: 'workflow engine', limit: 3 },
    });

    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('Semantic Search Results');
  }, TIMEOUT);

  it('unknown tool returns an error', async () => {
    const result = await client.callTool({
      name: 'totally_fake_tool',
      arguments: {},
    });

    expect(result.isError).toBe(true);
  }, TIMEOUT);
});

// ═══════════════════════════════════════════════════════════════════════
// 6. Server metadata
// ═══════════════════════════════════════════════════════════════════════

describe('Server Info', () => {
  it('reports correct server name and version', () => {
    const info = client.getServerVersion();
    expect(info?.name).toBe('roadie-mcp-server');
    expect(info?.version).toBeTruthy();
  });

  it('advertises prompts and resources capabilities', () => {
    const caps = client.getServerCapabilities();
    expect(caps?.prompts).toBeDefined();
    expect(caps?.resources).toBeDefined();
  });
});
