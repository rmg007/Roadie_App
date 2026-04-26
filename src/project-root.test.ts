import { describe, expect, it } from 'vitest';
import { resolveProjectRoot } from './project-root';

describe('resolveProjectRoot', () => {
  it('prefers --project argument', () => {
    expect(resolveProjectRoot(['--project', 'C:/target'], 'C:/cwd')).toBe('C:\\target');
  });

  it('uses positional path when present', () => {
    expect(resolveProjectRoot(['C:/positional'], 'C:/cwd')).toBe('C:\\positional');
  });

  it('falls back to env project root', () => {
    expect(resolveProjectRoot([], 'C:/cwd', 'C:/env-root')).toBe('C:\\env-root');
  });
});