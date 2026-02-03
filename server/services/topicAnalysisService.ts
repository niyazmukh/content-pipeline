import type { AppConfig } from '../../shared/config';
import type { Logger } from '../obs/logger';
import { LLMService } from './llmService';
import { scrapeMetadata } from './urlScraper';
import { loadPrompt } from '../prompts/loader';

export interface TopicAnalysisResult {
  originalInput: string;
  isUrl: boolean;
  mainTopic: string;
  keywords: string[];
  dateRange?: {
    start?: string;
    end?: string;
  };
  queries: {
    google: string;
    newsapi: string;
    eventregistry: string[];
  };
}

export class TopicAnalysisService {
  private llm: LLMService;

  constructor(
    private config: AppConfig,
    private logger: Logger,
  ) {
    this.llm = new LLMService(config, logger);
  }

  private isUrl(text: string): boolean {
    try {
      const url = new URL(text);
      return ['http:', 'https:'].includes(url.protocol);
    } catch {
      return false;
    }
  }

  async analyze(input: string, signal?: AbortSignal): Promise<TopicAnalysisResult> {
    const isUrl = this.isUrl(input.trim());
    let contextText = input;

    if (isUrl) {
      try {
        this.logger.info('Detected URL input, scraping metadata', { url: input });
        const metadata = await scrapeMetadata(input.trim());
        contextText = `URL: ${metadata.url}\nTitle: ${metadata.title}\nDescription: ${metadata.description}\nContent Snippet: ${metadata.content}`;
      } catch (error) {
        this.logger.warn('Failed to scrape URL, falling back to raw string', { error: (error as Error).message });
      }
    }

    const template = loadPrompt('topic_analysis.md');
    const prompt = template
      .replace('{INPUT_TEXT}', contextText)
      .replace('{CURRENT_DATE}', new Date().toISOString().split('T')[0]);

    try {
      const result = await this.llm.generateAndParse<Omit<TopicAnalysisResult, 'originalInput' | 'isUrl'>>(prompt, {
        model: this.config.llm.flashModel,
        temperature: 0.1,
        signal,
      });

      // Normalize keys in case LLM ignores casing instructions
      const queries = result.queries as any;
      if (queries.newsApi && !queries.newsapi) {
        queries.newsapi = queries.newsApi;
      }
      if (queries.eventRegistry && !queries.eventregistry) {
        queries.eventregistry = queries.eventRegistry;
      }

      return {
        originalInput: input,
        isUrl,
        ...result,
      };
    } catch (error) {
      this.logger.error('Topic analysis failed', { error: (error as Error).message });
      // Fallback to basic keyword extraction if LLM fails
      return {
        originalInput: input,
        isUrl,
        mainTopic: input.slice(0, 50),
        keywords: input.split(' ').slice(0, 5),
        queries: {
          google: input,
          newsapi: input,
          eventregistry: [input],
        },
      };
    }
  }
}

