import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import * as path from 'node:path';
import * as os from 'node:os';
import { createMCPContainer } from './container.js';
import { MCP_LOGGER } from './platform-adapters.js';

class RoadieMcpServer {
  private server: Server;
  private containerPromise: ReturnType<typeof createMCPContainer>;

  constructor() {
    this.server = new Server(
      {
        name: 'roadie-mcp-server',
        version: '0.11.0',
      },
      {
        capabilities: {
          prompts: {},
        },
      }
    );

    const projectRoot = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
    
    // Set up persistent diagnostic logging
    if (MCP_LOGGER.setLogFile) {
      MCP_LOGGER.setLogFile(path.join(projectRoot, 'roadie.log'));
    }

    // Identify Global Brain Path
    const globalRoadieDir = path.join(os.homedir(), '.roadie');
    const globalDbPath = path.join(globalRoadieDir, 'global-model.db');

    this.containerPromise = createMCPContainer({ projectRoot, globalDbPath }, MCP_LOGGER);

    this.setupHandlers();
    this.startAutonomousCycle(); // Activate background brain
    
    this.server.onerror = (error) => MCP_LOGGER.error('MCP Server Error', error);
    process.on('SIGINT', async () => {
      MCP_LOGGER.info('Shutting down Roadie MCP server...');
      await this.server.close();
      process.exit(0);
    });
  }

  private async startAutonomousCycle() {
    const container = await this.containerPromise;
    const projectRoot = container.services.projectRoot;

    let isRunning = false;
    const runCycle = async () => {
      if (isRunning) return;
      isRunning = true;
      try {
        MCP_LOGGER.info('Starting autonomous synchronization cycle...');
        
        // 1. Deep Analyze
        await container.services.projectAnalyzer.analyze(projectRoot);
        
        // 2. Auto-Generate all files
        const genResults = await container.services.fileGenerator.generateAll(container.services.projectModel);
        const writtenCount = genResults.filter(r => r.written).length;
        
        MCP_LOGGER.info(`Autonomous Sync Complete | Files Updated: ${writtenCount}/${genResults.length}`);
      } catch (err: any) {
        MCP_LOGGER.error('Autonomous synchronization cycle failed', err.stack || err);
      } finally {
        isRunning = false;
      }
    };

    // Initial run
    runCycle();

    // Loop every 30 minutes
    setInterval(runCycle, 30 * 60 * 1000);

    // Heartbeat every 4 hours
    setInterval(() => this.logLearningHeartbeat(), 4 * 60 * 60 * 1000);
  }

  private setupHandlers() {
    // 1. Prompts Registry (Summoning Agents)
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: [
        {
          name: 'summon_agent',
          description: 'Summon a specialized Roadie agent (Strategist, Builder, Critic, or Delivery)',
          arguments: [
            {
              name: 'role',
              description: 'The agent role to summon',
              required: true,
            },
            {
              name: 'task',
              description: 'The specific problem to address',
              required: false,
            }
          ]
        }
      ]
    }));

    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      if (request.params.name !== 'summon_agent') {
        throw new McpError(ErrorCode.MethodNotFound, `Unknown prompt: ${request.params.name}`);
      }

      const role = (request.params.arguments?.role as string) || 'fixer';
      const task = (request.params.arguments?.task as string) || 'the current problem';
      const roleName = role.charAt(0).toUpperCase() + role.slice(1);

      return {
        description: `Summon the ${roleName} Specialist`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `You are the ${roleName} Specialist. Read your instructions in .github/agents/${role}.agent.md and then help me with ${task}. Check .github/roadie/project-model.json for architectural context.`
            }
          }
        ]
      };
    });

    // 2. Empty Tools (Legacy compatibility if needed, but we prefer Prompts)
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: []
    }));

  }

  private async logLearningHeartbeat() {
    try {
      const container = await this.containerPromise;
      const stats = container.services.projectAnalyzer.getLearningDb()?.getWorkflowStats();
      if (stats && stats.totalWorkflows > 0) {
        const successRate = (stats.successRate * 100).toFixed(1);
        MCP_LOGGER.info(`Autonomous Learning Heartbeat | Total Tasks: ${stats.totalWorkflows} | Success Rate: ${successRate}% | Avg Time: ${stats.averageDurationMs}ms`);
      } else {
        MCP_LOGGER.info('Roadie is ready to learn and grow. No tasks recorded yet.');
      }
    } catch { /* Silent */ }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    MCP_LOGGER.info('Roadie MCP server running on stdio');
    await this.logLearningHeartbeat();
  }
}

const server = new RoadieMcpServer();
server.run().catch(console.error);
