import type { AppConfig } from '../../shared/config';
import { loadPrompt } from '../prompts/loader';
import { LLMService } from '../services/llmService';
import type { Logger } from '../obs/logger';

export interface ImagePromptArgs {
  runId: string;
  article: string;
  config: AppConfig;
  logger: Logger;
  signal?: AbortSignal;
}

export interface ImagePromptResult {
  prompt: string;
  rawResponse: string;
}

const stripFence = (value: string): string =>
  value.replace(/^```(?:json|text)?\s*\r?\n?/, '').replace(/```[\s\r\n]*$/, '').trim();

export const generateImagePrompt = async ({
  runId,
  article,
  config,
  logger,
  signal,
}: ImagePromptArgs): Promise<ImagePromptResult> => {
  const template = await loadPrompt('image_prompt.md');
  const hydrated = template.replace('{ARTICLE_CONTENT}', article);

  logger.info('Generating image prompt', { runId });

  const llmService = new LLMService(config, logger);

  try {
    const raw = await llmService.generateWithRetry(hydrated, {
      model: config.llm.flashModel,
      responseMimeType: 'text/plain',
      temperature: Math.min(config.llm.temperature + 0.2, 0.9),
      maxOutputTokens: config.llm.maxOutputTokens,
      signal,
    });

    const prompt = stripFence(raw);
    return { prompt, rawResponse: raw };
  } catch (err) {
    logger.error('Image prompt generation failed', { error: (err as Error).message });
    throw err;
  }
};

