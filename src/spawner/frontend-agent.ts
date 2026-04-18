/**
 * @module frontend-agent
 * @description Generates React components, forms, hooks, and types.
 *   Input: requirements + apiSpec
 *   Output: pagesTSX + formsTSX + useApiTS + typesTS
 *   Prompt: <350 tokens. shadcn/ui + Tailwind + useState only.
 * @inputs requirements: string, apiSpec: string
 * @outputs FrontendOutput { pagesTSX, formsTSX, useApiTS, typesTS }
 * @depends-on ModelProvider, ProgressReporter
 */

import type { ModelProvider, ProgressReporter } from '../providers';

/**
 * Output structure for frontend agent.
 */
export interface FrontendOutput {
  pagesTSX: string;
  formsTSX: string;
  useApiTS: string;
  typesTS: string;
}

/**
 * FrontendAgent: generates React pages, forms, API hooks, and types.
 * Uses concise prompt (<350 tokens) focused on component generation.
 */
export class FrontendAgent {
  private modelProvider: ModelProvider;
  private progress: ProgressReporter;

  constructor(modelProvider: ModelProvider, progress: ProgressReporter) {
    this.modelProvider = modelProvider;
    this.progress = progress;
  }

  /**
   * Generate React components (pages, forms, hooks, types).
   * @param requirements Natural language UI requirements
   * @param apiSpec API endpoint specification
   * @returns Promise<FrontendOutput> with pages, forms, hook, types
   */
  async generate(requirements: string, apiSpec: string): Promise<FrontendOutput> {
    this.progress.report('Generating frontend components...');

    const prompt = this.buildPrompt(requirements, apiSpec);
    const response = await this.callModel(prompt);

    const output = this.parseResponse(response);
    return output;
  }

  /**
   * Build concise prompt for React component generation.
   * Token budget: <350 tokens.
   */
  private buildPrompt(requirements: string, apiSpec: string): string {
    return `Generate React pages, forms, useApi hook, and types. Use shadcn/ui.

Requirements:
${requirements}

API Spec:
${apiSpec}

Output FOUR blocks:

1. \`\`\`typescript
// pages/UserPage.tsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useApi } from '@/hooks/useApi';
import { UserForm } from './UserForm';

export function UserPage() {
  const { data: users, loading, error } = useApi('/users');
  const [open, setOpen] = useState(false);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Users</h1>
      <Button onClick={() => setOpen(true)} className="mb-4">Create User</Button>
      {open && <UserForm onClose={() => setOpen(false)} />}
      <div className="space-y-2">
        {users?.map(u => <div key={u.id}>{u.email}</div>)}
      </div>
    </div>
  );
}
\`\`\`

2. \`\`\`typescript
// forms/UserForm.tsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useApi } from '@/hooks/useApi';

export function UserForm({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { mutate, loading, error } = useApi('/users', 'POST');

  const handleSubmit = async () => {
    try {
      await mutate({ email, password });
      onClose();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center">
      <div className="bg-white p-6 rounded-lg space-y-4">
        <h2>Create User</h2>
        <Input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
        <Input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
        {error && <div className="text-red-500">{error}</div>}
        <Button onClick={handleSubmit} disabled={loading}>{loading ? 'Creating...' : 'Create'}</Button>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}
\`\`\`

3. \`\`\`typescript
// hooks/useApi.ts
import { useState, useEffect } from 'react';
import type { ApiResponse } from '@/types';

export function useApi<T>(endpoint: string, method: string = 'GET') {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch_data = async () => {
    setLoading(true);
    try {
      const res = await fetch(endpoint, { method });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const mutate = async (body: any) => {
    setLoading(true);
    try {
      const res = await fetch(endpoint, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setData(json);
      setError(null);
      return json;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (method === 'GET') fetch_data();
  }, [endpoint]);

  return { data, loading, error, mutate };
}
\`\`\`

4. \`\`\`typescript
// types/index.ts
export interface User {
  id: number;
  email: string;
}

export interface ApiResponse<T> {
  data: T;
  error?: string;
}
\`\`\`

Rules:
- Use shadcn/ui buttons, inputs, tables (no custom CSS)
- Tailwind for layout (p-6, text-2xl, mb-4, space-y-2, etc.)
- useState only (no Zustand/Redux)
- useApi hook for all fetch calls (GET/POST/PUT/DELETE)
- NO comments in code
- Minimal, production-ready`;
  }

  /**
   * Call LLM with prompt.
   */
  private async callModel(prompt: string): Promise<string> {
    const messages = [
      {
        role: 'system' as const,
        content:
          'You are a React expert. Generate clean, production-ready components using shadcn/ui and Tailwind CSS.',
      },
      {
        role: 'user' as const,
        content: prompt,
      },
    ];

    const response = await this.modelProvider.sendRequest('claude-opus-4-1', messages, {});
    return response.text;
  }

  /**
   * Parse response: extract four code blocks (pages, forms, hook, types).
   */
  private parseResponse(text: string): FrontendOutput {
    const blocks = this.extractCodeBlocks(text);

    if (blocks.length < 4) {
      throw new Error(
        `Expected 4 code blocks (pages, forms, hook, types), got ${blocks.length}`,
      );
    }

    return {
      pagesTSX: blocks[0],
      formsTSX: blocks[1],
      useApiTS: blocks[2],
      typesTS: blocks[3],
    };
  }

  /**
   * Extract all code blocks from markdown response.
   */
  private extractCodeBlocks(text: string): string[] {
    const regex = /```(?:\w+)?\n([\s\S]*?)\n```/g;
    const blocks: string[] = [];
    let match;

    while ((match = regex.exec(text)) !== null) {
      blocks.push(match[1].trim());
    }

    return blocks;
  }
}
