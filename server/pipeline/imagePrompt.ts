import type { AppConfig } from '../../shared/config';
import type { ImagePromptSlide } from '../../shared/types';
import { loadPrompt } from '../prompts/loader';
import { LLMService } from '../services/llmService';
import type { Logger } from '../obs/logger';
import JSON5 from 'json5';
import { extractJson, extractJsonRobust } from '../utils/jsonExtract';

export interface ImagePromptArgs {
  runId: string;
  article: string;
  config: AppConfig;
  logger: Logger;
  signal?: AbortSignal;
}

export interface ImagePromptResult {
  slides: ImagePromptSlide[];
  rawResponse: string;
}

type ImagePromptJson = { slides?: unknown };

const normalizeSlide = (value: unknown): ImagePromptSlide | null => {
  if (!value || typeof value !== 'object') return null;
  const slide = value as Record<string, unknown>;

  const title = typeof slide.title === 'string' ? slide.title.trim() : '';
  const visualStrategy = typeof slide.visualStrategy === 'string' ? slide.visualStrategy.trim() : '';
  const layout = typeof slide.layout === 'string' ? slide.layout.trim() : undefined;
  const prompt = typeof slide.prompt === 'string' ? slide.prompt.trim() : '';
  const negativePrompt = typeof slide.negativePrompt === 'string' ? slide.negativePrompt.trim() : undefined;
  const overlayText = Array.isArray(slide.overlayText)
    ? slide.overlayText
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 5)
    : undefined;

  if (!title || !visualStrategy || !prompt) return null;

  return {
    title: title.slice(0, 120),
    visualStrategy: visualStrategy.slice(0, 64),
    layout: layout ? layout.slice(0, 240) : undefined,
    overlayText: overlayText?.length ? overlayText : undefined,
    prompt: prompt.slice(0, 2000),
    negativePrompt: negativePrompt ? negativePrompt.slice(0, 600) : undefined,
  };
};

const parseImagePrompt = (raw: string): ImagePromptSlide[] => {
  const extracted = extractJson(raw) || extractJsonRobust(raw);
  if (!extracted) {
    throw new Error('Image prompt: no JSON found in model response');
  }

  let parsed: ImagePromptJson;
  try {
    parsed = JSON5.parse(extracted) as ImagePromptJson;
  } catch (error) {
    throw new Error(`Image prompt: failed to parse JSON (${(error as Error).message})`);
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as any).slides)) {
    throw new Error('Image prompt: invalid JSON schema (missing slides array)');
  }

  const rawSlides = (parsed as any).slides as unknown[];
  const slides = rawSlides.map(normalizeSlide).filter((slide): slide is ImagePromptSlide => Boolean(slide)).slice(0, 5);

  if (slides.length === 0) {
    throw new Error('Image prompt: empty slides array after normalization');
  }

  return slides;
};

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
      responseMimeType: 'application/json',
      temperature: Math.min(config.llm.temperature + 0.35, 0.9),
      maxOutputTokens: config.llm.maxOutputTokens,
      signal,
    });

    const slides = parseImagePrompt(raw);
    return { slides, rawResponse: raw };
  } catch (err) {
    logger.error('Image prompt generation failed', { error: (err as Error).message });
    throw err;
  }
};

