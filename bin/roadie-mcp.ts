/**
 * @module bin/roadie-mcp
 * @description CLI entry point for the Roadie MCP server.
 *   Supports subcommands: prime, observe, reconcile (fire-and-forget, always exit 0)
 *   and default MCP server mode for stdio JSON-RPC clients.
 * @inputs CLI args: --project, --db, --api-key, --api-provider, --log-level, subcommand
 * @outputs MCP JSON-RPC over stdio (default) or SQLite-backed prime/observe/reconcile
 * @depends-on mcp/server.ts, container.ts
 * @depended-on-by Claude Code, GitHub Copilot, or any MCP-capable client
 */

import * as path from 'node:path';
import { RoadieMCPServer } from '../src/mcp/server';
import { createContainer } from '../src/container';

// =====================================================================
// Argument parsing (no external deps)
// =====================================================================

interface ParsedArgs {
  subcommand: 'serve' | 'prime' | 'observe' | 'reconcile';
  projectRoot: string;
  dbPath?: string;
  apiKey?: string;
  apiProvider?: 'anthropic' | 'openai';
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2); // drop node + script
  const result: ParsedArgs = {
    subcommand: 'serve',
    projectRoot: process.env['ROADIE_PROJECT_ROOT'] ?? process.cwd(),
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    switch (arg) {
      case 'prime':
      case 'observe':
      case 'reconcile':
        result.subcommand = arg;
        break;
      case '--project':
      case '-p':
        result.projectRoot = path.resolve(args[++i] ?? '.');
        break;
      case '--db':
        result.dbPath = path.resolve(args[++i] ?? '');
        break;
      case '--api-key':
        result.apiKey = args[++i];
        break;
      case '--api-provider': {
        const prov = args[++i];
        if (prov === 'anthropic' || prov === 'openai') {
          result.apiProvider = prov;
        }
        break;
      }
      case '--log-level': {
        const lvl = args[++i];
        if (lvl === 'debug' || lvl === 'info' || lvl === 'warn' || lvl === 'error') {
          result.logLevel = lvl;
        }
        break;
      }
      default:
        // Unknown flag — ignore (forward-compatible)
        break;
    }
    i++;
  }

  // Also accept env var overrides
  if (!result.apiKey && process.env['ANTHROPIC_API_KEY']) {
    result.apiKey = process.env['ANTHROPIC_API_KEY'];
    result.apiProvider = result.apiProvider ?? 'anthropic';
  }
  if (!result.apiKey && process.env['OPENAI_API_KEY']) {
    result.apiKey = process.env['OPENAI_API_KEY'];
    result.apiProvider = result.apiProvider ?? 'openai';
  }

  return result;
}

// =====================================================================
// Subcommand handlers (fire-and-forget, always exit 0)
// =====================================================================

/**
 * prime — run initial project analysis and persist to SQLite.
 * Used by extension on first activation to warm the DB before MCP server starts.
 */
async function runPrime(config: ParsedArgs): Promise<void> {
  process.stderr.write(`[roadie] prime: analyzing ${config.projectRoot}\n`);
  try {
    const container = await createContainer('standalone', {
      projectRoot: config.projectRoot,
      dbPath: config.dbPath,
      apiKey: config.apiKey,
      apiProvider: config.apiProvider,
    });
    const { projectModel, projectAnalyzer } = container.services!;
    await projectAnalyzer.analyze(config.projectRoot);
    const stackCount = projectModel.getTechStack().length;
    process.stderr.write(`[roadie] prime: complete — ${stackCount} tech entries\n`);
    container.dispose();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[roadie] prime: failed (non-fatal): ${msg}\n`);
  }
}

/**
 * observe — subscribe to file system events and update the model incrementally.
 * Phase 2: fire-and-forget stub; logs to stderr and exits cleanly.
 */
async function runObserve(config: ParsedArgs): Promise<void> {
  process.stderr.write(`[roadie] observe: watching ${config.projectRoot} (stub — Phase 3)\n`);
  // Phase 3 will implement inotify/FSEvents watcher loop here.
  // For now: exit cleanly so callers don't hang.
}

/**
 * reconcile — compare DB model against file system and repair drift.
 * Phase 2: runs analyze() which implicitly reconciles by overwriting.
 */
async function runReconcile(config: ParsedArgs): Promise<void> {
  process.stderr.write(`[roadie] reconcile: reconciling ${config.projectRoot}\n`);
  try {
    const container = await createContainer('standalone', {
      projectRoot: config.projectRoot,
      dbPath: config.dbPath,
      apiKey: config.apiKey,
      apiProvider: config.apiProvider,
    });
    const { projectAnalyzer } = container.services!;
    await projectAnalyzer.analyze(config.projectRoot);
    process.stderr.write('[roadie] reconcile: complete\n');
    container.dispose();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[roadie] reconcile: failed (non-fatal): ${msg}\n`);
  }
}

// =====================================================================
// Main
// =====================================================================

async function main(): Promise<void> {
  const config = parseArgs(process.argv);

  switch (config.subcommand) {
    case 'prime':
      await runPrime(config);
      process.exit(0);
      break;

    case 'observe':
      await runObserve(config);
      process.exit(0);
      break;

    case 'reconcile':
      await runReconcile(config);
      process.exit(0);
      break;

    case 'serve':
    default: {
      const server = new RoadieMCPServer({
        projectRoot: config.projectRoot,
        dbPath: config.dbPath,
        mode: 'standalone',
        apiKey: config.apiKey,
        apiProvider: config.apiProvider,
        logLevel: config.logLevel,
      });

      // Graceful shutdown on SIGINT / SIGTERM
      const shutdown = async () => {
        await server.stop();
        process.exit(0);
      };
      process.on('SIGINT', () => { void shutdown(); });
      process.on('SIGTERM', () => { void shutdown(); });

      await server.start();
      // server.start() connects stdio transport — process stays alive
      break;
    }
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[roadie] fatal: ${msg}\n`);
  process.exit(1);
});
