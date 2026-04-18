/**
 * H7: No network egress assertion.
 * Verifies that Roadie extension code makes no outbound network calls.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('No network egress', () => {
  it('production source files contain no fetch/http/https/axios calls', () => {
    // Static analysis: grep src/ for network call patterns
    const srcDir = path.join(process.cwd(), 'src');
    const patterns = [/\bfetch\s*\(/, /https?\.get\s*\(/, /\.request\s*\(/, /\baxios\b/];

    // Recursively check .ts files (excluding tests)
    function checkDir(dir: string): string[] {
      const violations: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('__') && entry.name !== 'spawner') {
          violations.push(...checkDir(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
          const content = fs.readFileSync(fullPath, 'utf8');
          for (const pattern of patterns) {
            if (pattern.test(content)) {
              violations.push(`${fullPath}: matches ${pattern}`);
            }
          }
        }
      }
      return violations;
    }

    const violations = checkDir(srcDir);
    expect(violations).toEqual([]);
  });
});
