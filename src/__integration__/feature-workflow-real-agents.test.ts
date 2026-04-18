/**
 * @module feature-workflow-real-agents
 * @description Integration test: requirements → database schema → backend API → frontend components
 *   Tests the full layer agent integration within the Feature workflow.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseAgent } from '../spawner/database-agent';
import { BackendAgent } from '../spawner/backend-agent';
import { FrontendAgent } from '../spawner/frontend-agent';
import type { ModelProvider, ProgressReporter, ChatMessage, ModelRequestOptions, ModelResponse, ModelSelector, ModelInfo } from '../providers';

/**
 * Mock ModelProvider that returns predictable responses for testing.
 */
class MockModelProvider implements ModelProvider {
  async selectModels(selector: ModelSelector): Promise<ModelInfo[]> {
    return [
      {
        id: 'claude-opus-4-1',
        name: 'Claude Opus 4.1',
        vendor: 'Anthropic',
        family: 'Claude',
        maxInputTokens: 200000,
      },
    ];
  }

  async sendRequest(
    modelId: string,
    messages: ChatMessage[],
    options: ModelRequestOptions,
  ): Promise<ModelResponse> {
    const lastMessage = messages[messages.length - 1].content;

    // Return realistic Prisma schema response for database agent
    if (lastMessage.includes('Generate Prisma schema')) {
      return {
        text: `# Database Schema

\`\`\`prisma
model User {
  id Int @id @default(autoincrement())
  email String @unique
  password String
  notes Note[]
  createdAt DateTime @default(now())
}

model Note {
  id Int @id @default(autoincrement())
  title String
  content String
  userId Int
  user User @relation(fields: [userId], references: [id])
  createdAt DateTime @default(now())
}
\`\`\`

\`\`\`typescript
export type User = {
  id: number;
  email: string;
  password: string;
  notes?: Note[];
  createdAt: Date;
};

export type Note = {
  id: number;
  title: string;
  content: string;
  userId: number;
  user?: User;
  createdAt: Date;
};
\`\`\``,
        toolCalls: [],
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    // Return realistic Express routes response for backend agent
    if (lastMessage.includes('Generate Express routes')) {
      return {
        text: `# Backend Implementation

\`\`\`typescript
import express from 'express';
import { auth } from './auth';
import { AppError } from './errors';

const router = express.Router();

router.post('/users', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) throw new AppError('INVALID_INPUT', 400, 'Email and password required');
    res.json({ id: 1, email, password });
  } catch (err) {
    next(err);
  }
});

router.get('/users/:id', auth, async (req, res, next) => {
  try {
    res.json({ id: parseInt(req.params.id), email: 'user@test.com' });
  } catch (err) {
    next(err);
  }
});

router.post('/notes', auth, async (req, res, next) => {
  try {
    const { title, content } = req.body;
    res.json({ id: 1, title, content, userId: 1, createdAt: new Date() });
  } catch (err) {
    next(err);
  }
});

export default router;
\`\`\`

\`\`\`typescript
import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'dev-secret';

export const auth = (req: any, res: any, next: any) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, SECRET) as any;
    req.user = decoded;
    next();
  } catch {
    res.status(403).json({ error: 'Invalid token' });
  }
};

export const sign = (payload: any) => jwt.sign(payload, SECRET, { expiresIn: '24h' });
\`\`\`

\`\`\`typescript
export class AppError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(message);
    this.name = 'AppError';
  }
}

export const errorHandler = (err: any, req: any, res: any, next: any) => {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  res.status(500).json({ error: 'Internal Server Error' });
};
\`\`\``,
        toolCalls: [],
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    // Return realistic React components response for frontend agent
    if (lastMessage.includes('Generate React pages')) {
      return {
        text: `# Frontend Implementation

\`\`\`typescript
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useApi } from '@/hooks/useApi';
import { NoteForm } from './NoteForm';

export function NotePage() {
  const { data: notes, loading, error } = useApi('/notes');
  const [open, setOpen] = useState(false);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">My Notes</h1>
      <Button onClick={() => setOpen(true)} className="mb-4">Create Note</Button>
      {open && <NoteForm onClose={() => setOpen(false)} />}
      <div className="space-y-2">
        {notes?.map(n => <div key={n.id} className="p-4 border rounded">{n.title}</div>)}
      </div>
    </div>
  );
}
\`\`\`

\`\`\`typescript
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useApi } from '@/hooks/useApi';

export function NoteForm({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const { mutate, loading, error } = useApi('/notes', 'POST');

  const handleSubmit = async () => {
    try {
      await mutate({ title, content });
      onClose();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center">
      <div className="bg-white p-6 rounded-lg space-y-4 w-96">
        <h2>Create Note</h2>
        <Input placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} />
        <Textarea placeholder="Content" value={content} onChange={e => setContent(e.target.value)} />
        {error && <div className="text-red-500">{error}</div>}
        <Button onClick={handleSubmit} disabled={loading}>{loading ? 'Creating...' : 'Create'}</Button>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}
\`\`\`

\`\`\`typescript
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

\`\`\`typescript
export interface User {
  id: number;
  email: string;
}

export interface Note {
  id: number;
  title: string;
  content: string;
  userId: number;
  createdAt: Date;
}

export interface ApiResponse<T> {
  data: T;
  error?: string;
}
\`\`\``,
        toolCalls: [],
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    // Default response
    return {
      text: '',
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}

/**
 * Mock ProgressReporter for testing.
 */
class MockProgressReporter implements ProgressReporter {
  private messages: string[] = [];

  report(message: string): void {
    this.messages.push(message);
  }

  reportMarkdown(markdown: string): void {
    this.messages.push(markdown);
  }

  getMessages(): string[] {
    return this.messages;
  }
}

describe('Feature Workflow Real Agents Integration', () => {
  let mockModelProvider: MockModelProvider;
  let mockProgress: MockProgressReporter;

  beforeEach(() => {
    mockModelProvider = new MockModelProvider();
    mockProgress = new MockProgressReporter();
  });

  afterEach(() => {
    // Cleanup if needed
  });

  it('should generate schema + api + components from requirements', async () => {
    const requirements = 'Web app for team notes with real-time collab';

    // 1. Database agent generates schema
    const dbAgent = new DatabaseAgent(mockModelProvider, mockProgress);
    const dbResult = await dbAgent.generate(requirements, []);

    expect(dbResult.schemaPrisma).toBeTruthy();
    expect(dbResult.schemaPrisma).toContain('model User');
    expect(dbResult.schemaPrisma).toContain('model Note');
    expect(dbResult.typesTS).toBeTruthy();
    expect(dbResult.typesTS).toContain('export type User');
    expect(dbResult.typesTS).toContain('export type Note');

    // 2. Backend agent generates API using database schema
    const beAgent = new BackendAgent(mockModelProvider, mockProgress);
    const beResult = await beAgent.generate(requirements, '', dbResult.schemaPrisma);

    expect(beResult.routesTS).toBeTruthy();
    expect(beResult.routesTS).toContain('router.post');
    expect(beResult.routesTS).toContain('router.get');
    expect(beResult.authTS).toBeTruthy();
    expect(beResult.authTS).toContain('JWT');
    expect(beResult.authTS).toContain('jwt.verify');
    expect(beResult.errorsTS).toBeTruthy();
    expect(beResult.errorsTS).toContain('AppError');

    // 3. Frontend agent generates components using API spec
    const feAgent = new FrontendAgent(mockModelProvider, mockProgress);
    const feResult = await feAgent.generate(requirements, beResult.routesTS);

    expect(feResult.pagesTSX).toBeTruthy();
    expect(feResult.pagesTSX).toContain('export function');
    expect(feResult.pagesTSX).toContain('useApi');
    expect(feResult.formsTSX).toBeTruthy();
    expect(feResult.formsTSX).toContain('export function');
    expect(feResult.useApiTS).toBeTruthy();
    expect(feResult.useApiTS).toContain('useEffect');
    expect(feResult.typesTS).toBeTruthy();
    expect(feResult.typesTS).toContain('export interface');
  });

  it('should handle database agent schema generation independently', async () => {
    const requirements = 'User authentication system';
    const dbAgent = new DatabaseAgent(mockModelProvider, mockProgress);

    const result = await dbAgent.generate(requirements, []);

    expect(result.schemaPrisma).toBeTruthy();
    expect(result.typesTS).toBeTruthy();
    expect(result.schemaPrisma).toContain('model');
    expect(result.typesTS).toContain('type');
  });

  it('should handle backend agent route generation independently', async () => {
    const requirements = 'REST API for user management';
    const schema = 'model User { id Int @id email String }';

    const beAgent = new BackendAgent(mockModelProvider, mockProgress);
    const result = await beAgent.generate(requirements, '', schema);

    expect(result.routesTS).toBeTruthy();
    expect(result.authTS).toBeTruthy();
    expect(result.errorsTS).toBeTruthy();
  });

  it('should handle frontend agent component generation independently', async () => {
    const requirements = 'User dashboard with CRUD forms';
    const apiSpec = 'GET /users, POST /users, DELETE /users/:id';

    const feAgent = new FrontendAgent(mockModelProvider, mockProgress);
    const result = await feAgent.generate(requirements, apiSpec);

    expect(result.pagesTSX).toBeTruthy();
    expect(result.formsTSX).toBeTruthy();
    expect(result.useApiTS).toBeTruthy();
    expect(result.typesTS).toBeTruthy();
  });

  it('should track progress through multiple agent calls', async () => {
    const requirements = 'Full stack notes app';

    const dbAgent = new DatabaseAgent(mockModelProvider, mockProgress);
    await dbAgent.generate(requirements, []);

    const beAgent = new BackendAgent(mockModelProvider, mockProgress);
    await beAgent.generate(requirements, '', '');

    const feAgent = new FrontendAgent(mockModelProvider, mockProgress);
    await feAgent.generate(requirements, '');

    const messages = mockProgress.getMessages();
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.some(m => m.includes('database'))).toBe(true);
    expect(messages.some(m => m.includes('backend'))).toBe(true);
    expect(messages.some(m => m.includes('frontend'))).toBe(true);
  });
});
