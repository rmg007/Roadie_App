/**
 * @module mcp/server
 * @description MCP server scaffold using @modelcontextprotocol/sdk.
 *   Uses StdioServerTransport for stdio JSON-RPC communication.
 *   Registers all 10 tool handlers and routes calls by name.
 *   IMPORTANT: All logging MUST go to stderr — stdout is reserved for MCP protocol.
 * @inputs MCPServerConfig (projectRoot, dbPath, mode, apiKey, apiProvider)
 * @outputs MCP server instance with start() and stop() methods
 * @depends-on @modelcontextprotocol/sdk, container.ts
 * @depended-on-by bin/roadie-mcp.ts
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type Tool,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';

import { createContainer, type RuntimeMode, type Container } from '../container';
import { handleAnalyzeProject, handleGetProjectContext, handleRescanProject } from './tools/project-tools';
import { handleQueryPatterns, handleQueryWorkflowHistory, handleGetRecommendations } from './tools/query-tools';
import { handleGenerateFile, handleGenerateAllFiles } from './tools/generator-tools';
import { handleRunWorkflow, handleGetWorkflowStatus } from './tools/workflow-tools';

// =====================================================================
// Config
// =====================================================================

export interface MCPServerConfig {
  projectRoot: string;
  dbPath?: string;
  mode: RuntimeMode;
  apiKey?: string;
  apiProvider?: 'anthropic' | 'openai';
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

// =====================================================================
// Tool manifest
// =====================================================================

const TOOLS: Tool[] = [
  {
    name: 'roadie/analyze_project',
    description: 'Scan the project structure and return tech stack, patterns, directory structure, and commands.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['full', 'dependencies', 'patterns', 'structure'], default: 'full' },
        force: { type: 'boolean', default: false },
      },
    },
  },
  {
    name: 'roadie/get_project_context',
    description: 'Return the serialized project model as text suitable for LLM prompt injection.',
    inputSchema: {
      type: 'object',
      properties: {
        maxTokens: { type: 'integer', minimum: 100, maximum: 50000 },
        scope: { type: 'string', enum: ['full', 'stack', 'structure', 'commands', 'patterns'], default: 'full' },
        relevantPaths: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'roadie/rescan_project',
    description: 'Force a full re-scan of the project.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'roadie/run_workflow',
    description: 'Trigger a named workflow. Returns the complete result when finished.',
    inputSchema: {
      type: 'object',
      required: ['workflow', 'prompt'],
      properties: {
        workflow: { type: 'string', enum: ['bug_fix', 'feature', 'refactor', 'review', 'document', 'dependency', 'onboard'] },
        prompt: { type: 'string' },
        options: {
          type: 'object',
          properties: {
            modelPreference: { type: 'string', enum: ['economy', 'balanced', 'quality'], default: 'balanced' },
            testTimeout: { type: 'integer', default: 300 },
            testCommand: { type: 'string' },
            autoApprove: { type: 'boolean', default: true },
          },
        },
      },
    },
  },
  {
    name: 'roadie/get_workflow_status',
    description: 'Check progress of a running workflow.',
    inputSchema: {
      type: 'object',
      required: ['executionId'],
      properties: {
        executionId: { type: 'string', pattern: '^wf_[a-zA-Z0-9]+$' },
      },
    },
  },
  {
    name: 'roadie/generate_file',
    description: 'Generate or regenerate a specific .github/ file.',
    inputSchema: {
      type: 'object',
      required: ['fileType'],
      properties: {
        fileType: {
          type: 'string',
          enum: ['copilot-instructions', 'agents-md', 'typescript-instructions', 'react-instructions',
                 'python-instructions', 'debugger-agent', 'reviewer-agent', 'hooks', 'pr-template',
                 'issue-templates', 'mcp-config', 'claude-hooks'],
        },
        force: { type: 'boolean', default: false },
      },
    },
  },
  {
    name: 'roadie/generate_all_files',
    description: 'Regenerate all .github/ files from current project model.',
    inputSchema: {
      type: 'object',
      properties: {
        force: { type: 'boolean', default: false },
      },
    },
  },
  {
    name: 'roadie/query_patterns',
    description: 'Return discovered coding patterns.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['export_style', 'test_convention', 'error_handling', 'import_ordering',
                 'commit_convention', 'async_patterns', 'all'],
          default: 'all',
        },
        minConfidence: { type: 'number', minimum: 0, maximum: 1, default: 0.5 },
      },
    },
  },
  {
    name: 'roadie/query_workflow_history',
    description: 'Return past workflow outcomes.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        workflowType: { type: 'string', enum: ['bug_fix', 'feature', 'refactor', 'review', 'document', 'dependency', 'onboard'] },
        status: { type: 'string', enum: ['completed', 'failed', 'cancelled'] },
      },
    },
  },
  {
    name: 'roadie/get_recommendations',
    description: 'Get actionable recommendations for improving AI configuration.',
    inputSchema: { type: 'object', properties: {} },
  },
];

// =====================================================================
// RoadieMCPServer
// =====================================================================

export class RoadieMCPServer {
  private server: Server;
  private transport: StdioServerTransport;
  private container: Container | null = null;
  private config: MCPServerConfig;

  constructor(config: MCPServerConfig) {
    this.config = config;
    this.server = new Server(
      { name: 'roadie', version: '0.5.0' },
      { capabilities: { tools: {} } },
    );
    this.transport = new StdioServerTransport();
    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: TOOLS,
    }));

    // Call tool
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const input = (args ?? {}) as Record<string, unknown>;

      if (!this.container) {
        return this.errorResult('Server not yet initialized', 'SERVER_NOT_READY');
      }

      const services = this.container.services!;

      try {
        switch (name) {
          case 'roadie/analyze_project':
            return await handleAnalyzeProject(input, services);
          case 'roadie/get_project_context':
            return await handleGetProjectContext(input, services);
          case 'roadie/rescan_project':
            return await handleRescanProject(input, services);
          case 'roadie/query_patterns':
            return await handleQueryPatterns(input, services);
          case 'roadie/query_workflow_history':
            return await handleQueryWorkflowHistory(input, services);
          case 'roadie/get_recommendations':
            return await handleGetRecommendations(input, services);
          case 'roadie/generate_file':
            return await handleGenerateFile(input, services);
          case 'roadie/generate_all_files':
            return await handleGenerateAllFiles(input, services);
          case 'roadie/run_workflow':
            return await handleRunWorkflow(input, services);
          case 'roadie/get_workflow_status':
            return await handleGetWorkflowStatus(input, services);
          default:
            return this.errorResult(`Unknown tool: ${name}`, 'UNKNOWN_TOOL');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return this.errorResult(msg, 'INTERNAL_ERROR');
      }
    });
  }

  private errorResult(message: string, code: string): CallToolResult {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: message, code }),
        },
      ],
      isError: true,
    };
  }

  /**
   * Start the MCP server. Initializes the container, runs initial analysis if needed,
   * then connects the stdio transport.
   */
  async start(): Promise<void> {
    process.stderr.write(`[roadie] Starting MCP server (mode: ${this.config.mode})...\n`);

    // Initialize container
    this.container = await createContainer(this.config.mode, {
      projectRoot: this.config.projectRoot,
      dbPath: this.config.dbPath,
      apiKey: this.config.apiKey,
      apiProvider: this.config.apiProvider,
    });

    const { projectModel, projectAnalyzer } = this.container.services!;

    // Auto-analyze if model is empty or stale
    const techStack = projectModel.getTechStack();
    if (techStack.length === 0) {
      process.stderr.write('[roadie] Project model empty, running initial analysis...\n');
      try {
        await projectAnalyzer.analyze(this.config.projectRoot);
        process.stderr.write(`[roadie] Initial analysis complete — ${projectModel.getTechStack().length} tech entries\n`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[roadie] Initial analysis failed: ${msg}\n`);
      }
    }

    // Connect transport and start accepting requests
    await this.server.connect(this.transport);
    process.stderr.write(`[roadie] MCP server ready. ${TOOLS.length} tools available.\n`);
  }

  /**
   * Stop the MCP server gracefully.
   */
  async stop(): Promise<void> {
    process.stderr.write('[roadie] MCP server stopping...\n');
    try {
      await this.server.close();
    } catch {
      // Best-effort
    }
    if (this.container) {
      this.container.dispose();
      this.container = null;
    }
    process.stderr.write('[roadie] MCP server stopped.\n');
  }
}
