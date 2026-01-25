import JSON5 from 'json5';
import type { AppConfig } from '../../shared/config';
import { loadPrompt } from '../prompts/loader';
import { LLMService } from '../services/llmService';
import type { Logger } from '../obs/logger';
import { describeRecencyWindow } from '../utils/text';

export interface QueryExpansionArgs {
  topic: string;
  point: string;
  recencyHours: number;
  config: AppConfig;
  logger?: Logger;
  signal?: AbortSignal;
}

export const generateSearchQueriesForPoint = async ({
  topic,
  point,
  recencyHours,
  config,
  logger,
  signal,
}: QueryExpansionArgs): Promise<string[]> => {
  const template = await loadPrompt('query_expansion.md');
  const recencyWindow = describeRecencyWindow(recencyHours);
  const hydrated = template
    .replace('{TOPIC}', topic)
    .replace('{POINT}', point)
    .replace('{RECENCY_WINDOW}', recencyWindow);

  logger?.debug?.('Generating targeted search queries', { topic, point });

  const llmService = new LLMService(config, logger as Logger);

  try {
    const parsed = await llmService.generateAndParse<{ queries?: string[] }>(hydrated, {
      model: config.llm.flashModel,
      temperature: Math.max(0.1, Math.min(config.llm.temperature, 0.5)),
      maxOutputTokens: Math.min(1024, config.llm.maxOutputTokens),
      signal,
    });

    const items = Array.isArray(parsed.queries) ? parsed.queries : [];
    const cleaned = items
      .map((q) => String(q || '').trim())
      .filter((q) => q.length >= 5 && q.length <= 120)
      .slice(0, 6);
    return cleaned;
  } catch (err) {
    logger?.warn?.('Query expansion failed', { error: (err as Error).message });
    return [];
  }
};

