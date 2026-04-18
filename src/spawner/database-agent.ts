/**
 * @module database-agent
 * @description Generates Prisma schemas and TypeScript types from requirements.
 *   Input: requirements text + conversation turns
 *   Output: Prisma schema string + TS types string
 *   Prompt: <300 tokens. No comments, minimal prose.
 * @inputs requirements: string, transcript: ConversationTurn[]
 * @outputs DatabaseOutput { schemaPrisma, typesTS }
 * @depends-on ModelProvider, ProgressReporter
 */

import type { ConversationTurn, ProjectConventions } from '../types';
import type { ModelProvider, ProgressReporter } from '../providers';

/**
 * Output structure for database agent.
 */
export interface DatabaseOutput {
  schemaPrisma: string;
  typesTS: string;
}

/**
 * DatabaseAgent: generates Prisma schemas + TS types from requirements.
 * Uses concise prompt (<300 tokens) focused on entity extraction.
 */
export class DatabaseAgent {
  private modelProvider: ModelProvider;
  private progress: ProgressReporter;

  constructor(modelProvider: ModelProvider, progress: ProgressReporter) {
    this.modelProvider = modelProvider;
    this.progress = progress;
  }

  /**
   * Generate Prisma schema and TypeScript types from requirements.
   * @param requirements Natural language requirements (e.g., "User has email, password, posts")
   * @param transcript Interview conversation turns (optional context)
   * @param conventions Project conventions from CLAUDE.md (optional)
   * @returns Promise<DatabaseOutput> with schemaPrisma and typesTS
   */
  async generate(
    requirements: string,
    transcript: ConversationTurn[] = [],
    conventions?: ProjectConventions,
  ): Promise<DatabaseOutput> {
    this.progress.report('Generating database schema...');

    const prompt = this.buildPrompt(requirements, transcript, conventions);
    const response = await this.callModel(prompt);

    const output = this.parseResponse(response);
    return output;
  }

  /**
   * Build concise prompt for Prisma schema generation.
   * Token budget: <300 tokens including requirements.
   */
  private buildPrompt(requirements: string, transcript: ConversationTurn[], conventions?: ProjectConventions): string {
    const transcriptContext =
      transcript.length > 0
        ? `\nInterview context:\n${transcript.map((t) => `Q: ${t.question}\nA: ${t.answer}`).join('\n\n')}`
        : '';
    const conventionsContext = conventions
      ? `\nFollow schema conventions: ${conventions.codingStyle.join(', ')}`
      : '';

    return `Generate Prisma schema + TS types.${conventionsContext}

Requirements:
${requirements}${transcriptContext}

Output TWO blocks only:
1. \`\`\`prisma
model User {
  id Int @id @default(autoincrement())
  email String @unique
  password String
  posts Post[]
}
model Post {
  id Int @id @default(autoincrement())
  title String
  userId Int
  user User @relation(fields: [userId], references: [id])
}
\`\`\`

2. \`\`\`typescript
export type User = {
  id: number;
  email: string;
  password: string;
  posts?: Post[];
};
export type Post = {
  id: number;
  title: string;
  userId: number;
  user?: User;
};
\`\`\`

Parse req: entity names, fields (string/int/bool/enum), relations (one-to-many, many-to-many).
Enum for status/categories.
NO comments in schema or types.
Minimal, production-ready.`;
  }

  /**
   * Call LLM with prompt.
   */
  private async callModel(prompt: string): Promise<string> {
    const messages = [
      {
        role: 'system' as const,
        content: 'You are a database schema expert. Generate only valid Prisma and TypeScript.',
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
   * Parse response: extract two code blocks (prisma, typescript).
   * Robust parsing: handles markdown, indentation, whitespace.
   */
  private parseResponse(text: string): DatabaseOutput {
    const blocks = this.extractCodeBlocks(text);

    // Expect exactly 2 blocks: [0] prisma, [1] typescript
    const schemaPrisma = blocks.length > 0 ? blocks[0] : '';
    const typesTS = blocks.length > 1 ? blocks[1] : '';

    if (!schemaPrisma || !typesTS) {
      throw new Error('Failed to extract prisma and typescript blocks from response');
    }

    return {
      schemaPrisma,
      typesTS,
    };
  }

  /**
   * Extract all code blocks from markdown response.
   * Pattern: \`\`\`[language]?\n[content]\n\`\`\`
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
