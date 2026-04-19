#!/usr/bin/env node

/**
 * @module cli/index
 * @description Main CLI entry point: route commands and output results
 * @exports main
 */

import { z } from 'zod';
import { installRoadie } from './install.js';
import { upgradeRoadie } from './upgrade.js';
import { releaseRoadie, BumpType } from './release.js';
import { runDoctor } from './doctor.js';

const CommandSchema = z.enum(['install', 'upgrade', 'doctor', 'release']);

/**
 * Pretty-print result as JSON or human-readable text
 */
function printResult(
  command: string,
  result: any,
  options: { json?: boolean } = {}
): void {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    // Human-readable output
    if (command === 'doctor') {
      console.log(`\n  Status: ${result.status.toUpperCase()}`);
      console.log(`  ${result.message}\n`);
      for (const check of result.checks) {
        const icon =
          check.status === 'pass' ? '✓' : check.status === 'warning' ? '⚠' : '✗';
        console.log(`  ${icon} ${check.name}: ${check.details}`);
      }
      console.log();
    } else if (command === 'release') {
      const icon = result.success ? '✓' : '✗';
      console.log(`\n  ${icon} ${result.message}`);
      if (result.success) {
        console.log(`  Version: ${result.version}`);
        console.log(`  URL: ${result.releaseUrl}`);
      }
      console.log();
    } else {
      const icon = result.success ? '✓' : '✗';
      console.log(`\n  ${icon} ${result.message}`);
      if (result.host) console.log(`  Host: ${result.host}`);
      if (result.configPath) console.log(`  Config: ${result.configPath}`);
      if (result.oldVersion) console.log(`  Old: ${result.oldVersion}`);
      if (result.newVersion) console.log(`  New: ${result.newVersion}`);
      console.log();
    }
  }
}

/**
 * Main CLI entry point
 */
export async function main(args: string[]): Promise<void> {
  const [command, ...cmdArgs] = args;

  try {
    const parsedCommand = CommandSchema.parse(command);
    const options = { json: cmdArgs.includes('--json') };

    switch (parsedCommand) {
      case 'install': {
        const result = await installRoadie();
        printResult('install', result, options);
        process.exit(result.success ? 0 : 1);
        break;
      }

      case 'upgrade': {
        const result = await upgradeRoadie();
        printResult('upgrade', result, options);
        process.exit(result.success ? 0 : 1);
        break;
      }

      case 'doctor': {
        const result = await runDoctor();
        printResult('doctor', result, options);
        process.exit(result.status === 'healthy' ? 0 : result.status === 'warning' ? 1 : 2);
        break;
      }

      case 'release': {
        const bumpType = cmdArgs[0];
        if (!bumpType) {
          console.error('\n  Error: release requires a bump type (major|minor|patch)\n');
          process.exit(1);
        }
        const result = await releaseRoadie(bumpType);
        printResult('release', result, options);
        process.exit(result.success ? 0 : 1);
        break;
      }
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      console.error('\n  Error: Invalid command');
      console.error('  Usage: roadie <install|upgrade|doctor|release [major|minor|patch]>\n');
      process.exit(1);
    }

    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n  Error: ${message}\n`);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
