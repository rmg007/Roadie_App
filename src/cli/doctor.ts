/**
 * @module cli/doctor
 * @description Diagnostic health check: Node, npm, git, MCP config, LearningDatabase, logs
 * @exports runDoctor
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { z } from 'zod';

const CheckSchema = z.object({
  name: z.string(),
  status: z.enum(['pass', 'warning', 'fail']),
  details: z.string(),
});

export type Check = z.infer<typeof CheckSchema>;

const DoctorResultSchema = z.object({
  status: z.enum(['healthy', 'warning', 'error']),
  checks: z.array(CheckSchema),
  message: z.string(),
});

export type DoctorResult = z.infer<typeof DoctorResultSchema>;

/**
 * Check Node.js version
 */
function checkNode(): Check {
  try {
    const version = execSync('node --version', { encoding: 'utf-8' }).trim();
    const match = version.match(/v(\d+)\./);
    const majorToken = match?.[1];
    const major = majorToken ? parseInt(majorToken, 10) : 0;

    if (major >= 22) {
      return { name: 'Node.js', status: 'pass', details: `${version}` };
    }
    return { name: 'Node.js', status: 'warning', details: `${version} (requires >= 22)` };
  } catch {
    return { name: 'Node.js', status: 'fail', details: 'Not installed or not in PATH' };
  }
}

/**
 * Check npm version
 */
function checkNpm(): Check {
  try {
    const version = execSync('npm --version', { encoding: 'utf-8' }).trim();
    return { name: 'npm', status: 'pass', details: `${version}` };
  } catch {
    return { name: 'npm', status: 'fail', details: 'Not installed or not in PATH' };
  }
}

/**
 * Check git availability
 */
function checkGit(): Check {
  try {
    const version = execSync('git --version', { encoding: 'utf-8' }).trim();
    return { name: 'git', status: 'pass', details: `${version}` };
  } catch {
    return { name: 'git', status: 'fail', details: 'Not installed or not in PATH' };
  }
}

/**
 * Check MCP configuration presence
 */
async function checkMcpConfig(): Promise<Check> {
  const homeDir = os.homedir();
  const claudeConfigPath = path.join(homeDir, '.claude', 'claude_desktop_config.json');

  try {
    const content = await fs.readFile(claudeConfigPath, 'utf-8');
    const config = JSON.parse(content) as {
      mcpServers?: Record<string, unknown>;
      servers?: Record<string, unknown>;
      mcp?: Record<string, unknown>;
    };
    const hasRoadie =
      config.mcpServers?.roadie ||
      config.servers?.roadie ||
      config.mcp?.roadie;

    if (hasRoadie) {
      return {
        name: 'MCP Config',
        status: 'pass',
        details: 'Roadie MCP registered',
      };
    }
    return {
      name: 'MCP Config',
      status: 'warning',
      details: 'Claude config found, but Roadie not registered',
    };
  } catch {
    // If file does not exist, we treat as missing config.
    const exists = await fs.access(claudeConfigPath).then(() => true).catch(() => false);
    if (!exists) {
      return {
        name: 'MCP Config',
        status: 'warning',
        details: 'No Claude config found',
      };
    }

    return {
      name: 'MCP Config',
      status: 'warning',
      details: 'Claude config corrupted',
    };
  }
}

/**
 * Check LearningDatabase accessibility
 */
async function checkLearningDatabase(): Promise<Check> {
  try {
    const globalRoadieDir = path.join(os.homedir(), '.roadie');
    const dbPath = path.join(globalRoadieDir, 'global-model.db');

    // Check if .roadie directory is writable
    await fs.mkdir(globalRoadieDir, { recursive: true });

    // Try writing a temp file
    const testFile = path.join(globalRoadieDir, '.doctor-test');
    await fs.writeFile(testFile, 'test', 'utf-8');
    await fs.unlink(testFile);

    return {
      name: 'LearningDatabase',
      status: 'pass',
      details: `${dbPath}`,
    };
  } catch {
    return {
      name: 'LearningDatabase',
      status: 'fail',
      details: 'Cannot write to ~/.roadie directory',
    };
  }
}

/**
 * Check log file accessibility
 */
async function checkLogFiles(): Promise<Check> {
  try {
    const logDir = path.join(process.cwd(), '.');
    const testLog = path.join(logDir, '.doctor-test.log');

    await fs.writeFile(testLog, 'test\n', 'utf-8');
    await fs.unlink(testLog);

    return {
      name: 'Log Files',
      status: 'pass',
      details: `Writable at ${process.cwd()}`,
    };
  } catch {
    return {
      name: 'Log Files',
      status: 'warning',
      details: 'Cannot write logs to current directory',
    };
  }
}

/**
 * Run all diagnostic checks
 */
export async function runDoctor(): Promise<DoctorResult> {
  const checks = [
    checkNode(),
    checkNpm(),
    checkGit(),
    await checkMcpConfig(),
    await checkLearningDatabase(),
    await checkLogFiles(),
  ];

  const failures = checks.filter((c) => c.status === 'fail').length;
  const warnings = checks.filter((c) => c.status === 'warning').length;

  let status: 'healthy' | 'warning' | 'error' = 'healthy';
  let message = 'All systems operational';

  if (failures > 0) {
    status = 'error';
    message = `${failures} critical check(s) failed`;
  } else if (warnings > 0) {
    status = 'warning';
    message = `${warnings} warning(s) detected`;
  }

  return {
    status,
    checks,
    message,
  };
}
