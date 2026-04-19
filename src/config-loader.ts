/**
 * @module config-loader
 * @description Loads and validates Roadie configuration from .roadie/config.json
 *   with environment variable overrides.
 * @inputs .roadie/config.json, environment variables
 * @outputs RoadieConfig singleton
 * @depends-on zod
 * @depended-on-by step-executor, workflow-engine
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';

/**
 * Zod schema for Roadie configuration.
 * All fields are optional with sensible defaults.
 */
const RoadieConfigSchema = z.object({
  dryRun: z.boolean().optional().default(false),
  maxRetries: z.number().int().min(0).optional().default(2),
  models: z
    .object({
      defaultTier: z.enum(['free', 'standard', 'premium']).optional().default('standard'),
      timeoutMs: z.number().int().min(1000).optional().default(30000),
    })
    .optional()
    .default({}),
  logging: z
    .object({
      level: z.enum(['debug', 'info', 'warn', 'error']).optional().default('info'),
      fileMaxSizeMb: z.number().int().min(1).optional().default(10),
      fileMaxCount: z.number().int().min(1).optional().default(10),
    })
    .optional()
    .default({}),
}).strict();

export type RoadieConfig = z.infer<typeof RoadieConfigSchema>;

/**
 * Load configuration from disk and environment.
 * Loads from .roadie/config.json if it exists, then applies env overrides.
 * Warns if sensitive fields (passwords) are found.
 */
function loadConfig(): RoadieConfig {
  let config: Partial<RoadieConfig> = {};

  // Load from .roadie/config.json if present
  const projectRoot = process.cwd();
  const configPath = path.join(projectRoot, '.roadie', 'config.json');

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw);

      // Warn if sensitive fields are present
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        ('password' in parsed ||
          'apiKey' in parsed ||
          'secret' in parsed ||
          'token' in parsed)
      ) {
        console.warn('[CONFIG] ⚠️  Sensitive fields detected in config.json (password, apiKey, secret, token). These should be set via environment variables only.');
      }

      config = parsed;
    } catch (err) {
      console.warn(`[CONFIG] Failed to load ${configPath}:`, err instanceof Error ? err.message : err);
    }
  }

  // Apply environment overrides
  if (process.env.ROADIE_DRY_RUN === '1') {
    config.dryRun = true;
  }
  if (process.env.ROADIE_MAX_RETRIES) {
    config.maxRetries = parseInt(process.env.ROADIE_MAX_RETRIES, 10);
  }
  if (process.env.ROADIE_LOG_LEVEL) {
    if (!config.logging) config.logging = {};
    config.logging.level = process.env.ROADIE_LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error';
  }
  if (process.env.ROADIE_DEFAULT_TIER) {
    if (!config.models) config.models = {};
    config.models.defaultTier = process.env.ROADIE_DEFAULT_TIER as 'free' | 'standard' | 'premium';
  }
  if (process.env.ROADIE_TIMEOUT_MS) {
    if (!config.models) config.models = {};
    config.models.timeoutMs = parseInt(process.env.ROADIE_TIMEOUT_MS, 10);
  }

  // Validate and apply defaults
  return RoadieConfigSchema.parse(config);
}

/** Global config singleton instance. */
let globalConfig: RoadieConfig | null = null;

/**
 * Get the loaded configuration (lazy-loaded singleton).
 */
export function getConfig(): RoadieConfig {
  if (!globalConfig) {
    globalConfig = loadConfig();
  }
  return globalConfig;
}

/**
 * Reset config singleton (for testing).
 */
export function resetConfig(): void {
  globalConfig = null;
}
