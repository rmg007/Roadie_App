/**
 * Tests for Context7Client — mocks global fetch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Context7Client } from '../context7-client';

describe('Context7Client', () => {
  let client: Context7Client;

  beforeEach(() => {
    client = new Context7Client();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('resolveLibraryId', () => {
    it('returns parsed library results on success', async () => {
      const mockResults = [{ libraryId: '/supabase/supabase', relevance: 0.95, description: 'Supabase JS client' }];
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResults),
      }));

      const results = await client.resolveLibraryId('supabase', 'auth docs');
      expect(results).toHaveLength(1);
      expect(results[0].libraryId).toBe('/supabase/supabase');
      expect(results[0].relevance).toBe(0.95);
    });

    it('returns [] on HTTP error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Not Found',
      }));

      const results = await client.resolveLibraryId('nonexistent', 'query');
      expect(results).toEqual([]);
    });

    it('returns [] on network failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

      const results = await client.resolveLibraryId('supabase', 'query');
      expect(results).toEqual([]);
    });
  });

  describe('queryDocs', () => {
    it('returns docs content on success', async () => {
      const mockDocs = { content: '## Auth\n\nSupabase auth guide...', sourceUrl: 'https://supabase.io/docs/auth' };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockDocs),
      }));

      const docs = await client.queryDocs('/supabase/supabase', 'auth');
      expect(docs.content).toContain('Auth');
      expect(docs.sourceUrl).toBe('https://supabase.io/docs/auth');
    });

    it('returns error message on HTTP error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Service Unavailable',
      }));

      const docs = await client.queryDocs('/supabase/supabase', 'auth');
      expect(docs.content).toContain('Error');
    });

    it('returns error message on network failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Timeout')));

      const docs = await client.queryDocs('/supabase/supabase', 'auth');
      expect(docs.content).toContain('Timeout');
    });
  });
});
