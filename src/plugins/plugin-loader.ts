/**
 * @module plugin-loader
 * @description Loads Roadie plugins from `.roadie/plugins/`.
 *   Each plugin file must export a default object conforming to `PluginDefinition`.
 *   Plugins may contribute additional WorkflowDefinitions and/or raw template strings.
 *   Loading errors for individual plugins are caught and logged; they do not crash the server.
 * @inputs pluginDir path (default: <workspaceRoot>/.roadie/plugins)
 * @outputs PluginDefinition[]
 * @depended-on-by index.ts (server startup)
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { WorkflowDefinition } from '../types';
import { CONSOLE_LOGGER, type Logger } from '../platform-adapters';

/** Shape that plugin files must export as `default`. */
export interface PluginDefinition {
  /** Unique plugin identifier (e.g. 'my-org-security-workflow') */
  id: string;
  /** Human-readable plugin name */
  name: string;
  /** Additional workflow definitions contributed by this plugin */
  workflows?: WorkflowDefinition[];
  /** Raw template strings (keys are template names) */
  templates?: Record<string, string>;
}

export class PluginLoader {
  constructor(
    private readonly pluginDir: string,
    private readonly log: Logger = CONSOLE_LOGGER,
  ) {}

  /**
   * Dynamically load all `.js` / `.mjs` / `.cjs` / `.ts` files from `pluginDir`.
   * Returns successfully-loaded plugins. Individual failures are logged and skipped.
   */
  async loadFromDir(): Promise<PluginDefinition[]> {
    let entries: string[];
    try {
      const dirEntries = await fs.readdir(this.pluginDir);
      entries = dirEntries.filter((e) => /\.(m?js|cjs)$/.test(e));
    } catch (err: unknown) {
      // Directory doesn't exist or isn't readable — no plugins
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      this.log.warn(`PluginLoader: failed to read plugin directory ${this.pluginDir}`, err);
      return [];
    }

    const plugins: PluginDefinition[] = [];

    for (const entry of entries) {
      const filePath = path.join(this.pluginDir, entry);
      try {
        const fileUrl = pathToFileURL(filePath).href;
        // Dynamic import — works for ESM and CJS via the dual-output tsup build
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mod = await (Function('url', 'return import(url)')(fileUrl) as Promise<any>);
        const definition: PluginDefinition = mod.default ?? mod;

        if (!definition || typeof definition.id !== 'string') {
          this.log.warn(`PluginLoader: ${entry} does not export a valid PluginDefinition — skipping`);
          continue;
        }

        this.log.info(`PluginLoader: loaded plugin "${definition.name}" (${definition.id}) from ${entry}`);
        plugins.push(definition);
      } catch (err: unknown) {
        this.log.warn(`PluginLoader: failed to load plugin ${entry}`, err);
      }
    }

    return plugins;
  }
}

/** Convenience factory — loads plugins from the standard location under workspaceRoot. */
export async function loadPlugins(
  workspaceRoot: string,
  log?: Logger,
): Promise<PluginDefinition[]> {
  const pluginDir = path.join(workspaceRoot, '.roadie', 'plugins');
  return new PluginLoader(pluginDir, log).loadFromDir();
}
