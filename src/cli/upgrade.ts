/**
 * @module cli/upgrade
 * @description Check and upgrade Roadie to latest version
 * @exports upgradeRoadie
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';

const UpgradeResultSchema = z.object({
  success: z.boolean(),
  oldVersion: z.string(),
  newVersion: z.string(),
  message: z.string(),
});

export type UpgradeResult = z.infer<typeof UpgradeResultSchema>;

/**
 * Get the current version from package.json
 */
async function getCurrentVersion(): Promise<string> {
  try {
    const packagePath = path.resolve(__dirname, '..', '..', 'package.json');
    const pkgRaw = await fs.readFile(packagePath, 'utf-8');
    const pkg = JSON.parse(pkgRaw) as { version?: string };
    return pkg.version || '0.0.0';
  } catch {
    // Fallback
  }
  return '0.0.0';
}

/**
 * Get the latest version from npm registry
 */
async function getLatestVersion(): Promise<string> {
  try {
    const output = execSync('npm view roadie version', { encoding: 'utf-8' }).trim();
    return output || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Upgrade Roadie to the latest version
 */
export async function upgradeRoadie(): Promise<UpgradeResult> {
  const oldVersion = await getCurrentVersion();

  try {
    const latestVersion = await getLatestVersion();

    if (latestVersion === 'unknown') {
      return {
        success: false,
        oldVersion,
        newVersion: latestVersion,
        message: 'Could not determine latest version from npm registry',
      };
    }

    if (oldVersion === latestVersion) {
      return {
        success: true,
        oldVersion,
        newVersion: latestVersion,
        message: `Already on latest version: ${latestVersion}`,
      };
    }

    // Attempt upgrade
    execSync('npm install -g roadie@latest', { stdio: 'inherit' });

    const newVersion = await getCurrentVersion();

    return {
      success: true,
      oldVersion,
      newVersion,
      message: `Upgraded from ${oldVersion} to ${newVersion}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      oldVersion,
      newVersion: 'failed',
      message: `Upgrade failed: ${message}`,
    };
  }
}
