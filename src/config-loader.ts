/**
 * @module config-loader
 * @description Loads and validates Roadie configuration from .roadie/config.json
 *   with environment variable overrides.
 * @inputs .roadie/config.json, environment variables
 * @outputs RoadieConfig singleton
 * @depends-on zod
 * @depended-on-by step-executor, workflow-engine
 */

/* eslint-disable no-restricted-syntax -- Config loading is intentionally synchronous so configuration is available during early startup. */

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
  safeMode: z.boolean().optional().default(false),
  autoApprove: z.array(z.string()).optional().default(['generate', 'analyze', 'document']),
  requireApproval: z.array(z.string()).optional().default(['force-push', 'schema-migrate', 'mass-delete']),
  telemetry: z.object({
    enabled: z.boolean().optional().default(false),
    profile: z.enum(['minimal', 'standard', 'maximum']).optional().default('standard'),
    retainDays: z.number().int().min(1).max(365).optional().default(30),
    capturePromptContent: z.boolean().optional().default(false),
    captureToolArguments: z.boolean().optional().default(true),
    maxEventBytes: z.number().int().min(1_024).max(1_048_576).optional().default(65_536),
  }).optional().default({}),
  models: z
    .object({
      primary: z.string().optional().default('opus-4-7'),
      fallback: z.array(z.string()).optional().default(['sonnet-4-6', 'haiku-4-5']),
      defaultTier: z.enum(['free', 'standard', 'premium']).optional().default('standard'),
      timeoutMs: z.number().int().min(1000).optional().default(30000),
    })
    .optional()
    .default({}),
  context7: z.object({
    enabled: z.boolean().optional().default(true),
    timeoutMs: z.number().int().min(100).optional().default(5000),
  }).optional().default({}),
  logging: z
    .object({
      level: z.enum(['debug', 'info', 'warn', 'error']).optional().default('info'),
      format: z.enum(['json', 'text']).optional().default('json'),
      rotate: z.object({
        maxBytes: z.number().int().optional().default(10 * 1024 * 1024),
        maxFiles: z.number().int().optional().default(5),
      }).optional().default({}),
      fileMaxSizeMb: z.number().int().min(1).optional().default(10),
      fileMaxCount: z.number().int().min(1).optional().default(10),
    })
    .optional()
    .default({}),
  syncIntervalMs: z.number().int().optional().default(1_800_000),
  heartbeatIntervalMs: z.number().int().optional().default(14_400_000),
}).strict();

export type RoadieConfig = z.infer<typeof RoadieConfigSchema>;

export interface RuntimeMode {
  dryRun: boolean;
  safeMode: boolean;
}

/**
 * Load configuration from disk and environment.
 * Loads from .roadie/config.json if it exists, then applies env overrides.
 * Warns if sensitive fields (passwords) are found.
 */
function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === '1' || value.toLowerCase() === 'true') return true;
  if (value === '0' || value.toLowerCase() === 'false') return false;
  return undefined;
}

function loadConfig(projectRoot: string): RoadieConfig {
  let config: Partial<RoadieConfig> = {};

  // Load from .roadie/config.json if present
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
        process.stderr.write('[CONFIG] Sensitive fields detected in config.json (password, apiKey, secret, token). Set these via environment variables only.\n');
      }

      config = parsed;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[CONFIG] Failed to load ${configPath}: ${message}\n`);
    }
  }

  // Apply environment overrides
  const dryRunOverride = parseBooleanEnv(process.env.ROADIE_DRY_RUN);
  const safeModeOverride = parseBooleanEnv(process.env.ROADIE_SAFE_MODE);

  if (dryRunOverride !== undefined) {
    config.dryRun = dryRunOverride;
  }
  if (safeModeOverride !== undefined) {
    config.safeMode = safeModeOverride;
  }
  if (process.env.ROADIE_MAX_RETRIES) {
    config.maxRetries = parseInt(process.env.ROADIE_MAX_RETRIES, 10);
  }
  if (process.env.ROADIE_LOG_LEVEL) {
    config.logging = {
      ...(config.logging ?? {} as RoadieConfig['logging']),
      level: process.env.ROADIE_LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error',
    } as RoadieConfig['logging'];
  }
  if (process.env.ROADIE_DEFAULT_TIER) {
    config.models = {
      ...(config.models ?? {} as RoadieConfig['models']),
      defaultTier: process.env.ROADIE_DEFAULT_TIER as 'free' | 'standard' | 'premium',
    } as RoadieConfig['models'];
  }
  if (process.env.ROADIE_TIMEOUT_MS) {
    config.models = {
      ...(config.models ?? {} as RoadieConfig['models']),
      timeoutMs: parseInt(process.env.ROADIE_TIMEOUT_MS, 10),
    } as RoadieConfig['models'];
  }
  if (process.env.ROADIE_TELEMETRY === '1') {
    config.telemetry = {
      ...(config.telemetry ?? {} as RoadieConfig['telemetry']),
      enabled: true,
    } as RoadieConfig['telemetry'];
  }
  if (process.env.ROADIE_TELEMETRY_PROFILE) {
    config.telemetry = {
      ...(config.telemetry ?? {} as RoadieConfig['telemetry']),
      profile: process.env.ROADIE_TELEMETRY_PROFILE as 'minimal' | 'standard' | 'maximum',
    } as RoadieConfig['telemetry'];
  }

  // Validate and apply defaults
  return RoadieConfigSchema.parse(config);
}

/** Global config singleton instance. */
const configCache = new Map<string, RoadieConfig>();
let activeProjectRoot: string | null = null;

export function initializeConfig(projectRoot: string): RoadieConfig {
  const resolvedRoot = path.resolve(projectRoot);
  activeProjectRoot = resolvedRoot;
  if (!configCache.has(resolvedRoot)) {
    configCache.set(resolvedRoot, loadConfig(resolvedRoot));
  }
  const config = configCache.get(resolvedRoot);
  if (!config) {
    throw new Error(`Failed to initialize config for root: ${resolvedRoot}`);
  }
  return config;
}

/**
 * Get the loaded configuration (lazy-loaded singleton).
 */
export function getConfig(projectRoot?: string): RoadieConfig {
  const resolvedRoot = path.resolve(projectRoot ?? activeProjectRoot ?? process.cwd());
  if (!configCache.has(resolvedRoot)) {
    configCache.set(resolvedRoot, loadConfig(resolvedRoot));
  }
  if (!activeProjectRoot) {
    activeProjectRoot = resolvedRoot;
  }
  const config = configCache.get(resolvedRoot);
  if (!config) {
    throw new Error(`Config not found for root: ${resolvedRoot}`);
  }
  return config;
}

export function getRuntimeMode(projectRoot?: string): RuntimeMode {
  const config = getConfig(projectRoot);
  return {
    dryRun: config.dryRun,
    safeMode: config.safeMode,
  };
}

/**
 * Check if a workflow step type requires user approval.
 * Consults the `requireApproval` list from config.
 */
export function requiresApproval(operationType: string): boolean {
  const cfg = getConfig();
  const required = cfg.requireApproval ?? [];
  return required.includes(operationType);
}

/**
 * Check if a workflow step type is auto-approved.
 */
export function isAutoApproved(operationType: string): boolean {
  const cfg = getConfig();
  const auto = cfg.autoApprove ?? [];
  return auto.includes(operationType);
}

/**
 * Reset config singleton (for testing).
 */
export function resetConfig(projectRoot?: string): void {
  if (projectRoot) {
    const resolvedRoot = path.resolve(projectRoot);
    configCache.delete(resolvedRoot);
    if (activeProjectRoot === resolvedRoot) {
      activeProjectRoot = null;
    }
    return;
  }

  configCache.clear();
  activeProjectRoot = null;
}
