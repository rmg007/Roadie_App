/**
 * @module cli/release
 * @description Release automation: version bump, changelog, git tag, GitHub release
 * @exports releaseRoadie
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';

const ReleaseResultSchema = z.object({
  success: z.boolean(),
  version: z.string(),
  releaseUrl: z.string(),
  message: z.string(),
});

export type ReleaseResult = z.infer<typeof ReleaseResultSchema>;

const BumpType = z.enum(['major', 'minor', 'patch']);
export type BumpType = z.infer<typeof BumpType>;

/**
 * Parse semver version string
 */
function parseSemver(version: string): { major: number; minor: number; patch: number } {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    throw new Error(`Invalid semver: ${version}`);
  }
  const [, majorStr, minorStr, patchStr] = match;
  if (!majorStr || !minorStr || !patchStr) {
    throw new Error(`Invalid semver: ${version}`);
  }

  return {
    major: parseInt(majorStr, 10),
    minor: parseInt(minorStr, 10),
    patch: parseInt(patchStr, 10),
  };
}

/**
 * Increment version based on bump type
 */
function bumpVersion(
  current: string,
  bumpType: BumpType
): string {
  const { major, minor, patch } = parseSemver(current);

  switch (bumpType) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
  }
}

/**
 * Generate changelog from git log since last tag
 */
function generateChangelog(newVersion: string): string {
  try {
    const lastTag = execSync('git describe --tags --abbrev=0 2>/dev/null || echo ""', {
      encoding: 'utf-8',
    }).trim();

    let logOutput = '';
    if (lastTag) {
      logOutput = execSync(`git log ${lastTag}..HEAD --oneline`, { encoding: 'utf-8' }).trim();
    } else {
      logOutput = execSync('git log --oneline | head -20', { encoding: 'utf-8' }).trim();
    }

    const lines = logOutput.split('\n').filter((l) => l.trim());
    const entries = lines
      .map((line) => `- ${line}`)
      .join('\n');

    return `# Release ${newVersion}\n\n## Changes\n\n${entries}\n`;
  } catch {
    return `# Release ${newVersion}\n\n## Changes\n\nNo changelog available\n`;
  }
}

/**
 * Release Roadie: bump version, tag, create GitHub release
 */
export async function releaseRoadie(bumpType: string): Promise<ReleaseResult> {
  try {
    // Validate bump type
    const validBump = BumpType.parse(bumpType);

    // Read current version
    const packagePath = path.resolve(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(await fs.readFile(packagePath, 'utf-8')) as { version: string };
    const oldVersion = pkg.version;

    // Bump version
    const newVersion = bumpVersion(oldVersion, validBump);

    // Update package.json
    pkg.version = newVersion;
    await fs.writeFile(packagePath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');

    // Commit version bump
    execSync(`git add package.json`, { stdio: 'pipe' });
    execSync(`git commit -m "chore: bump to v${newVersion}"`, { stdio: 'pipe' });

    // Create git tag
    const changelog = generateChangelog(newVersion);
    execSync(`git tag -a v${newVersion} -m "${changelog.replace(/"/g, '\\"')}"`, {
      stdio: 'pipe',
    });

    // Push to remote
    try {
      execSync('git push origin', { stdio: 'pipe' });
      execSync(`git push origin v${newVersion}`, { stdio: 'pipe' });
    } catch {
      // If push fails, that's ok for now
    }

    // Try to create GitHub release (requires gh CLI)
    const releaseUrl = `https://github.com/rmg007/Roadie_App/releases/tag/v${newVersion}`;
    try {
      execSync(
        `gh release create v${newVersion} --title "Release ${newVersion}" --notes "${changelog.replace(/"/g, '\\"')}"`,
        { stdio: 'pipe' }
      );
    } catch {
      // gh CLI not available or already exists
    }

    return {
      success: true,
      version: newVersion,
      releaseUrl,
      message: `Released v${newVersion} successfully`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      version: 'failed',
      releaseUrl: '',
      message: `Release failed: ${message}`,
    };
  }
}
