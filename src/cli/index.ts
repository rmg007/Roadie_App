#!/usr/bin/env node

/**
 * @module cli/index
 * @description Main CLI entry point: route commands and output results
 * @exports main
 */

/* eslint-disable no-console -- CLI intentionally writes user-facing output to stdout/stderr. */

import { z } from 'zod';
import { installRoadie, type InstallResult } from './install.js';
import { upgradeRoadie, type UpgradeResult } from './upgrade.js';
import { releaseRoadie, type ReleaseResult } from './release.js';
import { runDoctor, type DoctorResult } from './doctor.js';

const CommandSchema = z.enum(['install', 'upgrade', 'doctor', 'release']);
type Command = z.infer<typeof CommandSchema>;
type CliResult = InstallResult | UpgradeResult | DoctorResult | ReleaseResult;

/**
 * Pretty-print result as JSON or human-readable text
 */
function printResult(
  command: Command,
  result: CliResult,
  options: { json?: boolean } = {}
): void {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    // Human-readable output
    if (command === 'doctor') {
      const doctorResult = result as DoctorResult;
      console.log(`\n  Status: ${doctorResult.status.toUpperCase()}`);
      console.log(`  ${doctorResult.message}\n`);
      for (const check of doctorResult.checks) {
        const icon =
          check.status === 'pass' ? '✓' : check.status === 'warning' ? '⚠' : '✗';
        console.log(`  ${icon} ${check.name}: ${check.details}`);
      }
      console.log();
    } else if (command === 'release') {
      const releaseResult = result as ReleaseResult;
      const icon = releaseResult.success ? '✓' : '✗';
      console.log(`\n  ${icon} ${releaseResult.message}`);
      if (releaseResult.success) {
        console.log(`  Version: ${releaseResult.version}`);
        console.log(`  URL: ${releaseResult.releaseUrl}`);
      }
      console.log();
    } else {
      const standardResult = result as InstallResult | UpgradeResult;
      const icon = standardResult.success ? '✓' : '✗';
      console.log(`\n  ${icon} ${standardResult.message}`);
      if ('host' in standardResult) console.log(`  Host: ${standardResult.host}`);
      if ('configPath' in standardResult) console.log(`  Config: ${standardResult.configPath}`);
      if ('oldVersion' in standardResult) console.log(`  Old: ${standardResult.oldVersion}`);
      if ('newVersion' in standardResult) console.log(`  New: ${standardResult.newVersion}`);
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
if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
