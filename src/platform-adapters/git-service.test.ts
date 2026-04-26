import { beforeEach, describe, expect, it, vi } from 'vitest';

const execSyncMock = vi.fn();
const errorMock = vi.fn();

vi.mock('child_process', () => ({
  execSync: execSyncMock,
}));

vi.mock('../platform-adapters', () => ({
  MCP_LOGGER: {
    error: errorMock,
  },
}));

describe('GitService.createCheckpoint', () => {
  beforeEach(() => {
    execSyncMock.mockReset();
    errorMock.mockReset();
  });

  it('skips checkpoint when HEAD is missing', async () => {
    execSyncMock
      .mockReturnValueOnce('true')
      .mockImplementationOnce(() => {
        const error = new Error('no head') as Error & { status?: number; stderr?: Buffer };
        error.status = 128;
        error.stderr = Buffer.from('fatal: Needed a single revision');
        throw error;
      });

    const { GitService } = await import('./git-service');
    const service = new GitService('C:/repo');

    await expect(service.createCheckpoint()).resolves.toEqual({
      status: 'skipped_no_head',
      reason: 'Git repository has no valid HEAD yet.',
    });
  });

  it('fails when tag creation fails', async () => {
    execSyncMock
      .mockReturnValueOnce('true')
      .mockReturnValueOnce('abc123')
      .mockReturnValueOnce('')
      .mockImplementationOnce(() => {
        const error = new Error('tag failed') as Error & { status?: number; stderr?: Buffer };
        error.status = 128;
        error.stderr = Buffer.from('fatal: Failed to resolve HEAD as a valid ref.');
        throw error;
      });

    const { GitService } = await import('./git-service');
    const service = new GitService('C:/repo');
    const result = await service.createCheckpoint();

    expect(result.status).toBe('failed');
    expect(result.reason).toContain('Failed to resolve HEAD');
  });

  it('returns created only when tag succeeds', async () => {
    execSyncMock
      .mockReturnValueOnce('true')
      .mockReturnValueOnce('abc123')
      .mockReturnValueOnce('')
      .mockReturnValueOnce('');

    const { GitService } = await import('./git-service');
    const service = new GitService('C:/repo');
    const result = await service.createCheckpoint();

    expect(result.status).toBe('created');
    expect(result.tagName).toMatch(/^roadie\/checkpoint-/);
  });

  it('skips checkpoint mutations in dry-run mode', async () => {
    const { GitService } = await import('./git-service');
    const service = new GitService('C:/repo', { dryRun: true, safeMode: false });

    await expect(service.createCheckpoint()).resolves.toEqual({
      status: 'skipped_runtime_mode',
      reason: 'Checkpoint creation disabled in dry-run.',
    });
    expect(execSyncMock).not.toHaveBeenCalled();
  });
});