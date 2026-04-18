import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { detectIDEs, isRunningUnderClaudeCodeHooks } from './ide-detector';

describe('IDE Detector', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('detectIDEs', () => {
    it('detects VS Code via VSCODE_PID', async () => {
      process.env.VSCODE_PID = '12345';
      const result = await detectIDEs('.');
      expect(result.isVSCode).toBe(true);
      expect(result.detectedIDEs).toContain('vscode');
    });

    it('returns empty when no IDEs detected', async () => {
      delete process.env.VSCODE_PID;
      // Use an empty temp dir so no IDE marker files exist
      const tmpDir = path.join(process.cwd(), '.test-tmp-empty-ide');
      await fs.mkdir(tmpDir, { recursive: true });
      try {
        const result = await detectIDEs(tmpDir);
        expect(result.detectedIDEs.length).toBe(0);
        expect(result.primaryIDE).toBeNull();
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('detects Claude Code when .mcp.json exists', async () => {
      // Create temp dir with .mcp.json
      const tmpDir = path.join(process.cwd(), '.test-tmp-mcp');
      try {
        await fs.mkdir(tmpDir, { recursive: true });
        await fs.writeFile(path.join(tmpDir, '.mcp.json'), '{}');
        const result = await detectIDEs(tmpDir);
        expect(result.isClaudeCode).toBe(true);
        expect(result.detectedIDEs).toContain('claude-code');
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('detects Claude Code when .claude dir exists', async () => {
      const tmpDir = path.join(process.cwd(), '.test-tmp-claude');
      try {
        await fs.mkdir(tmpDir, { recursive: true });
        await fs.mkdir(path.join(tmpDir, '.claude'), { recursive: true });
        const result = await detectIDEs(tmpDir);
        expect(result.isClaudeCode).toBe(true);
        expect(result.detectedIDEs).toContain('claude-code');
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('detects Cursor when .cursor dir exists', async () => {
      const tmpDir = path.join(process.cwd(), '.test-tmp-cursor');
      try {
        await fs.mkdir(tmpDir, { recursive: true });
        await fs.mkdir(path.join(tmpDir, '.cursor'), { recursive: true });
        const result = await detectIDEs(tmpDir);
        expect(result.isCursor).toBe(true);
        expect(result.detectedIDEs).toContain('cursor');
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('detects Windsurf when .windsurf dir exists', async () => {
      const tmpDir = path.join(process.cwd(), '.test-tmp-windsurf');
      try {
        await fs.mkdir(tmpDir, { recursive: true });
        await fs.mkdir(path.join(tmpDir, '.windsurf'), { recursive: true });
        const result = await detectIDEs(tmpDir);
        expect(result.isWindsurf).toBe(true);
        expect(result.detectedIDEs).toContain('windsurf');
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('detects multiple IDEs and returns null primaryIDE when ambiguous', async () => {
      const tmpDir = path.join(process.cwd(), '.test-tmp-multi');
      try {
        process.env.VSCODE_PID = '12345';
        await fs.mkdir(tmpDir, { recursive: true });
        await fs.mkdir(path.join(tmpDir, '.cursor'), { recursive: true });
        const result = await detectIDEs(tmpDir);
        expect(result.detectedIDEs.length).toBeGreaterThan(1);
        expect(result.primaryIDE).toBeNull();
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('returns primaryIDE when exactly one IDE is detected', async () => {
      const tmpDir = path.join(process.cwd(), '.test-tmp-primary');
      try {
        delete process.env.VSCODE_PID;
        await fs.mkdir(tmpDir, { recursive: true });
        await fs.mkdir(path.join(tmpDir, '.cursor'), { recursive: true });
        const result = await detectIDEs(tmpDir);
        expect(result.primaryIDE).toBe('cursor');
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('handles missing workspace gracefully', async () => {
      delete process.env.VSCODE_PID;
      const result = await detectIDEs('/nonexistent/path');
      expect(result.detectedIDEs.length).toBe(0);
      expect(result.primaryIDE).toBeNull();
    });
  });

  describe('isRunningUnderClaudeCodeHooks', () => {
    it('returns true when TOOL_USE_ID is set', () => {
      process.env.TOOL_USE_ID = 'abc123';
      expect(isRunningUnderClaudeCodeHooks()).toBe(true);
    });

    it('returns true when TRANSCRIPT_PATH is set', () => {
      process.env.TRANSCRIPT_PATH = '/path/to/transcript';
      expect(isRunningUnderClaudeCodeHooks()).toBe(true);
    });

    it('returns true when TOOL is set', () => {
      process.env.TOOL = 'Write';
      expect(isRunningUnderClaudeCodeHooks()).toBe(true);
    });

    it('returns true when FILE is set', () => {
      process.env.FILE = 'src/test.ts';
      expect(isRunningUnderClaudeCodeHooks()).toBe(true);
    });

    it('returns false when no hook env vars are set', () => {
      delete process.env.TOOL_USE_ID;
      delete process.env.TRANSCRIPT_PATH;
      delete process.env.TOOL;
      delete process.env.FILE;
      expect(isRunningUnderClaudeCodeHooks()).toBe(false);
    });
  });
});
