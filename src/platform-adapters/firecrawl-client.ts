import FirecrawlApp from '@mendable/firecrawl-js';
import { CONSOLE_LOGGER, type Logger } from '../utils/logger';

export interface ScrapeResult {
  markdown: string;
  metadata?: any;
  success: boolean;
  error?: string;
}

export class FirecrawlClient {
  private app: FirecrawlApp | null = null;

  constructor(
    private apiKey: string | undefined = process.env.FIRECRAWL_API_KEY,
    private log: Logger = CONSOLE_LOGGER
  ) {
    if (this.apiKey) {
      this.app = new FirecrawlApp({ apiKey: this.apiKey });
    } else {
      this.log.debug('FirecrawlClient: No API key provided, client disabled.');
    }
  }

  public isEnabled(): boolean {
    return this.app !== null;
  }

  /**
   * Scrapes a single URL and returns clean markdown.
   */
  public async scrapeUrl(url: string): Promise<ScrapeResult> {
    if (!this.app) {
      return { markdown: '', success: false, error: 'Firecrawl API key missing.' };
    }

    try {
      this.log.info(`Firecrawl: Scraping ${url}...`);
      const response = await this.app.scrapeUrl(url, {
        formats: ['markdown'],
      });

      if (!response.success) {
        throw new Error(response.error || 'Unknown error during scrape');
      }

      return {
        markdown: response.markdown || '',
        metadata: response.metadata,
        success: true,
      };
    } catch (err: any) {
      this.log.error(`Firecrawl: Failed to scrape ${url}: ${err.message}`);
      return { markdown: '', success: false, error: err.message };
    }
  }

  /**
   * Searches for a technology's official documentation and scrapes it.
   */
  public async discoverAndScrape(techName: string): Promise<ScrapeResult> {
    if (!this.app) {
      return { markdown: '', success: false, error: 'Firecrawl API key missing.' };
    }

    try {
      this.log.info(`Firecrawl: Searching for ${techName} documentation...`);
      // We use the search capability of Firecrawl if available, or just a targeted URL guess
      // For now, let's assume we can use a google search and pick the first result,
      // but Firecrawl doesn't have a direct 'search' tool in the SDK usually, it expects a URL.
      // We can use their crawl feature or wait for a map.
      
      // Better: Use a known pattern: techName + " documentation" -> search -> scrape.
      // Since we don't have a search tool here, we'll expose this as a tool for the agent
      // to provide the URL.
      
      return { markdown: '', success: false, error: 'Search not implemented. Provide a direct URL.' };
    } catch (err: any) {
      return { markdown: '', success: false, error: err.message };
    }
  }
}
