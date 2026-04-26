/**
 * @module context7-client
 * @description Client for the Context7 API to fetch live library documentation.
 * This enables Roadie to bridge the gap between local project knowledge
 * and the latest external API standards.
 */

export interface LibraryResult {
  libraryId: string;
  relevance: number;
  description?: string;
}

export interface DocsResult {
  content: string;
  sourceUrl?: string;
}

export class Context7Client {
  private readonly baseUrl = 'https://mcp.context7.com';

  /**
   * Resolves a library name (e.g. "supabase") into a Context7 library ID.
   */
  async resolveLibraryId(libraryName: string, query: string): Promise<LibraryResult[]> {
    try {
      const response = await fetch(`${this.baseUrl}/resolve`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'User-Agent': 'Roadie-MCP-Server/0.11.0'
        },
        body: JSON.stringify({ libraryName, query }),
      });

      if (!response.ok) {
        throw new Error(`Context7 Resolve Error: ${response.statusText}`);
      }

      return await response.json() as LibraryResult[];
    } catch (error) {
      return [];
    }
  }

  /**
   * Fetches specific documentation for a resolved library ID.
   */
  async queryDocs(libraryId: string, query: string): Promise<DocsResult> {
    try {
      const response = await fetch(`${this.baseUrl}/query`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'User-Agent': 'Roadie-MCP-Server/0.11.0'
        },
        body: JSON.stringify({ libraryId, query }),
      });

      if (!response.ok) {
        throw new Error(`Context7 Query Error: ${response.statusText}`);
      }

      return await response.json() as DocsResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: `Error fetching documentation: ${message}` };
    }
  }
}
