/**
 * @module backend-agent
 * @description Generates Express endpoints, auth middleware, and error handlers.
 *   Input: requirements + apiSpec + Prisma schema
 *   Output: routesTS + authTS + errorsTS
 *   Prompt: <400 tokens. Inline validation, minimal comments.
 * @inputs requirements: string, apiSpec: string, schema: string
 * @outputs BackendOutput { routesTS, authTS, errorsTS }
 * @depends-on ModelProvider, ProgressReporter
 */

import type { ModelProvider, ProgressReporter } from '../providers';
import type { ProjectConventions } from '../types';

/**
 * Output structure for backend agent.
 */
export interface BackendOutput {
  routesTS: string;
  authTS: string;
  errorsTS: string;
}

/**
 * BackendAgent: generates Express routes, JWT auth, error handling.
 * Uses concise prompt (<400 tokens) focused on endpoint generation.
 */
export class BackendAgent {
  private modelProvider: ModelProvider;
  private progress: ProgressReporter;

  constructor(modelProvider: ModelProvider, progress: ProgressReporter) {
    this.modelProvider = modelProvider;
    this.progress = progress;
  }

  /**
   * Generate Express routes, auth middleware, and error handlers.
   * @param requirements Natural language API requirements
   * @param apiSpec OpenAPI/REST spec or endpoint list
   * @param schema Prisma schema string (for types reference)
   * @param conventions Project conventions from CLAUDE.md (optional)
   * @returns Promise<BackendOutput> with routes, auth, errors
   */
  async generate(
    requirements: string,
    apiSpec: string,
    schema: string,
    conventions?: ProjectConventions,
  ): Promise<BackendOutput> {
    this.progress.report('Generating backend endpoints...');

    const prompt = this.buildPrompt(requirements, apiSpec, schema, conventions);
    const response = await this.callModel(prompt);

    const output = this.parseResponse(response);
    return output;
  }

  /**
   * Build concise prompt for Express route generation.
   * Token budget: <400 tokens.
   */
  private buildPrompt(
    requirements: string,
    apiSpec: string,
    schema: string,
    conventions?: ProjectConventions,
  ): string {
    const conventionsContext = conventions
      ? `Use these naming conventions: ${conventions.namingConventions.join(', ')}\nForbidden: ${conventions.forbidden.join(', ')}`
      : '';
    return `Generate Express routes + JWT auth + error handlers.${conventionsContext ? '\n\n' + conventionsContext : ''}

Requirements:
${requirements}

API Spec:
${apiSpec}

Prisma Schema (reference):
${schema}

Output THREE blocks:

1. \`\`\`typescript
// routes.ts
import express from 'express';
import { auth } from './auth';
import { AppError } from './errors';

const router = express.Router();

router.post('/users', async (req, res, next) => {
  try {
    // Implementation
    res.json({ id: 1, email: 'user@test.com' });
  } catch (err) {
    next(err);
  }
});

router.get('/users/:id', auth, async (req, res, next) => {
  try {
    // Implementation
    res.json({ id: 1, email: 'user@test.com' });
  } catch (err) {
    next(err);
  }
});

export default router;
\`\`\`

2. \`\`\`typescript
// auth.ts
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

3. \`\`\`typescript
// errors.ts
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
\`\`\`

Parse req: endpoint paths, methods (GET/POST/PUT/DELETE), auth requirement, request/response types.
Use zod for validation: z.object({ email: z.string().email() }).parse(req.body).
Inline validation in route handlers (1-liner).
Error handling only (no logging).
JWT: simple token verify, no complex claims.
Return JSON always.
NO comments in code.`;
  }

  /**
   * Call LLM with prompt.
   */
  private async callModel(prompt: string): Promise<string> {
    const messages = [
      {
        role: 'system' as const,
        content: 'You are an Express.js backend expert. Generate production-ready code with proper error handling.',
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
   * Parse response: extract three code blocks (routes, auth, errors).
   */
  private parseResponse(text: string): BackendOutput {
    const blocks = this.extractCodeBlocks(text);

    if (blocks.length < 3) {
      throw new Error(`Expected 3 code blocks (routes, auth, errors), got ${blocks.length}`);
    }

    return {
      routesTS: blocks[0],
      authTS: blocks[1],
      errorsTS: blocks[2],
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
