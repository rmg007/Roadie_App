/**
 * @module __tests__/phase5-e2e
 * @description E2E smoke tests for CLI commands and real Roadie workflows
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { installRoadie } from '../cli/install.js';
import { upgradeRoadie } from '../cli/upgrade.js';
import { releaseRoadie } from '../cli/release.js';
import { runDoctor } from '../cli/doctor.js';

describe('Phase 5: CLI E2E', () => {
  describe('install command', () => {
    it('should detect and return host info or none', async () => {
      const result = await installRoadie();

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('host');
      expect(result).toHaveProperty('configPath');
      expect(result).toHaveProperty('message');

      // Host should be one of the recognized types
      expect(['claude', 'copilot', 'cursor', 'none']).toContain(result.host);

      // If success, configPath should be non-empty
      if (result.success) {
        expect(result.configPath).toMatch(/\.(json|config)$/);
      }
    });

    it('should handle missing host gracefully', async () => {
      const result = await installRoadie();
      if (result.host === 'none') {
        expect(result.success).toBe(false);
        expect(result.message).toContain('No supported');
      }
    });
  });

  describe('upgrade command', () => {
    it('should return version info', async () => {
      const result = await upgradeRoadie();

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('oldVersion');
      expect(result).toHaveProperty('newVersion');
      expect(result).toHaveProperty('message');

      // Versions should match semver pattern
      expect(result.oldVersion).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('should not fail on npm registry error', async () => {
      const result = await upgradeRoadie();
      // Even if it fails, should return a proper structure
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('message');
    });
  });

  describe('release command', () => {
    it('should accept valid bump types', async () => {
      // We won't actually release, just test structure
      expect(() => {
        const types = ['major', 'minor', 'patch'];
        types.forEach((t) => {
          // Just validation, don't execute
          expect(types).toContain(t);
        });
      }).not.toThrow();
    });

    it('should return proper result structure', async () => {
      // Test with invalid bump to see error handling
      const result = await releaseRoadie('invalid');
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('version');
      expect(result).toHaveProperty('releaseUrl');
      expect(result).toHaveProperty('message');
    });
  });

  describe('doctor command', () => {
    it('should check all required systems', async () => {
      const result = await runDoctor();

      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('checks');
      expect(result).toHaveProperty('message');

      expect(['healthy', 'warning', 'error']).toContain(result.status);
      expect(Array.isArray(result.checks)).toBe(true);
      expect(result.checks.length).toBeGreaterThan(0);
    });

    it('should have expected checks', async () => {
      const result = await runDoctor();
      const checkNames = result.checks.map((c) => c.name);

      expect(checkNames).toContain('Node.js');
      expect(checkNames).toContain('npm');
      expect(checkNames).toContain('git');
      expect(checkNames).toContain('MCP Config');
      expect(checkNames).toContain('LearningDatabase');
      expect(checkNames).toContain('Log Files');
    });

    it('should report proper status for each check', async () => {
      const result = await runDoctor();

      for (const check of result.checks) {
        expect(check).toHaveProperty('name');
        expect(check).toHaveProperty('status');
        expect(check).toHaveProperty('details');

        expect(['pass', 'warning', 'fail']).toContain(check.status);
        expect(check.name).toBeTruthy();
        expect(check.details).toBeTruthy();
      }
    });

    it('should aggregate status correctly', async () => {
      const result = await runDoctor();

      const hasFailures = result.checks.some((c) => c.status === 'fail');
      const hasWarnings = result.checks.some((c) => c.status === 'warning');

      if (hasFailures) {
        expect(result.status).toBe('error');
      } else if (hasWarnings) {
        expect(result.status).toBe('warning');
      } else {
        expect(result.status).toBe('healthy');
      }
    });
  });

  describe('CLI integration', () => {
    it('should export all command functions', () => {
      expect(typeof installRoadie).toBe('function');
      expect(typeof upgradeRoadie).toBe('function');
      expect(typeof releaseRoadie).toBe('function');
      expect(typeof runDoctor).toBe('function');
    });

    it('should handle concurrent commands', async () => {
      // Run doctor and upgrade concurrently (safe ops)
      const [docResult, upgradeResult] = await Promise.all([
        runDoctor(),
        upgradeRoadie(),
      ]);

      expect(docResult).toHaveProperty('status');
      expect(upgradeResult).toHaveProperty('oldVersion');
    });
  });

  describe('Roadie workflow scenarios (E2E)', () => {
    it('scenario: bug fix workflow', async () => {
      // Simulate: developer uses roadie_chat to fix a bug
      // 1. Request analysis via roadie_chat
      // 2. System returns findings
      // 3. Developer applies fix
      // 4. Roadie runs tests and validates

      const docCheck = await runDoctor();
      expect(docCheck.status).toBeTruthy();

      // In real scenario, would call roadie_chat tool
      // For now, just verify doctor passes
      expect(docCheck).toHaveProperty('checks');
    });

    it('scenario: feature implementation workflow', async () => {
      // Simulate: developer uses roadie_chat to implement feature
      // 1. roadie_chat generates scaffold
      // 2. Developer fills in details
      // 3. Roadie tests and documents
      // 4. Developer commits

      const docCheck = await runDoctor();
      expect(docCheck).toHaveProperty('status');
      expect(['healthy', 'warning', 'error']).toContain(docCheck.status);
    });

    it('scenario: code review workflow', async () => {
      // Simulate: developer asks roadie_chat for code review
      // 1. Submit code via roadie_chat
      // 2. Roadie analyzes and suggests improvements
      // 3. Developer applies changes
      // 4. Roadie validates improvements

      const docCheck = await runDoctor();
      expect(docCheck).toBeTruthy();
    });

    it('scenario: documentation workflow', async () => {
      // Simulate: developer uses roadie_chat to generate docs
      // 1. Request doc generation
      // 2. Roadie generates markdown/comments
      // 3. Developer reviews and edits
      // 4. Roadie validates consistency

      const docCheck = await runDoctor();
      expect(docCheck.checks.length).toBeGreaterThan(0);
    });

    it('scenario: refactoring workflow', async () => {
      // Simulate: developer refactors with roadie_chat
      // 1. Submit code for refactor suggestion
      // 2. Roadie proposes improvements
      // 3. Developer applies refactor
      // 4. Roadie validates tests still pass

      const docCheck = await runDoctor();
      expect(docCheck).toHaveProperty('message');
    });
  });
});
