import type { AppConfig } from '../../shared/config';
import type {
  ImagePromptDetailLevel,
  ImagePromptFocus,
  ImagePromptPreferences,
  ImagePromptSlide,
  ImagePromptStyle,
  SourceCatalogEntry,
} from '../../shared/types';
import { loadPrompt } from '../prompts/loader';
import { LLMService } from '../services/llmService';
import type { Logger } from '../obs/logger';
import JSON5 from 'json5';
import { extractJson, extractJsonRobust } from '../utils/jsonExtract';
import { replacePlaceholders } from '../utils/promptHydration';

export interface ImagePromptArgs {
  runId: string;
  article: string;
  sourceCatalog?: SourceCatalogEntry[];
  preferences?: ImagePromptPreferences;
  config: AppConfig;
  logger: Logger;
  signal?: AbortSignal;
}

export interface ImagePromptResult {
  slides: ImagePromptSlide[];
  rawResponse: string;
}

type ImagePromptJson = { slides?: unknown };

const FOCUS_VALUES = ['automatic', 'infographic', 'conceptual', 'technical', 'on_the_scene'] as const;
const STYLE_VALUES = ['editorial', 'flat_minimalist', 'isometric_3d', 'classic_blueprint'] as const;
const DETAIL_VALUES = ['balanced', 'high_precision'] as const;

const isOneOf = <T extends string>(value: unknown, allowed: readonly T[]): value is T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value);

export const normalizeImagePromptPreferences = (preferences: unknown): Required<ImagePromptPreferences> => {
  const raw = preferences && typeof preferences === 'object' ? (preferences as Record<string, unknown>) : {};
  const focus: ImagePromptFocus = isOneOf(raw.focus, FOCUS_VALUES) ? raw.focus : 'automatic';
  const style: ImagePromptStyle = isOneOf(raw.style, STYLE_VALUES) ? raw.style : 'editorial';
  const detailLevel: ImagePromptDetailLevel = isOneOf(raw.detailLevel, DETAIL_VALUES) ? raw.detailLevel : 'balanced';
  return { focus, style, detailLevel };
};

const FOCUS_INSTRUCTIONS: Record<ImagePromptFocus, string> = {
  automatic: 'Pick the most relevant visual strategy for each slide.',
  infographic:
    'Prioritize data visualization. Use clean charts, timelines, or process flows that translate the article numbers or steps into visual form. Focus on clarity and data-grounding.',
  conceptual:
    'Use sophisticated visual metaphors to represent abstract ideas. Avoid literal "dashboards". Use industrial or natural elements as metaphors for market or technical dynamics.',
  technical:
    'Focus on the "how it works". Show precise details of machinery, circuit boards, laboratory equipment, or architectural sections. Use cold, clinical, high-tech lighting.',
  on_the_scene:
    'Visualize the "where and who". Show events as they happen: a high-stakes meeting, a bustling port at dawn, a factory floor in motion. Focus on the human element and environmental detail.',
};

const STYLE_GUIDELINES: Record<ImagePromptStyle, string> = {
  editorial:
    'Photorealistic, editorial photography style. Cinematic lighting, shallow depth of field, natural colors, professional color grading.',
  flat_minimalist:
    'Clean, 2D vector illustration. Flat colors, bold shapes, minimalist aesthetic, no gradients or shadows. Modern professional illustration.',
  isometric_3d:
    '3D rendered isometric view. Soft clay-like materials or high-gloss plastic. Clean, toy-like but professional aesthetic. Good for representing systems.',
  classic_blueprint:
    'Blueprint or technical drawing style. White lines on blue background or black ink on architectural vellum. Highly detailed technical annotations.',
};

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

const buildSourceContext = (sourceCatalog: SourceCatalogEntry[] | undefined): string => {
  const sources = (sourceCatalog || []).slice(0, 12);
  if (!sources.length) {
    return 'No source catalog supplied. Use only concrete entities, places, and metrics present in the article.';
  }
  return sources
    .map((source) => {
      const date = source.publishedAt ? source.publishedAt.split('T')[0] : 'Undated';
      return `[${source.id}] ${date} - ${source.source}: ${source.title} (${source.url})`;
    })
    .join('\n');
};

// Gemini `responseSchema` expects the uppercase OpenAPI 3.0 Type enum
// (https://ai.google.dev/gemini-api/docs/structured-output). The slides count is
// enforced in code (parseImagePrompt slices to 5) rather than via JSON-Schema
// minItems/maxItems, which the OpenAPI Schema type does not accept as numbers.
const IMAGE_PROMPT_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    slides: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          visualStrategy: { type: 'STRING' },
          layout: { type: 'STRING' },
          overlayText: { type: 'ARRAY', items: { type: 'STRING' } },
          prompt: { type: 'STRING' },
          negativePrompt: { type: 'STRING' },
        },
        required: ['title', 'visualStrategy', 'prompt'],
      },
    },
  },
  required: ['slides'],
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
  sourceCatalog,
  preferences,
  config,
  logger,
  signal,
}: ImagePromptArgs): Promise<ImagePromptResult> => {
  const template = loadPrompt('image_prompt.md');

  const normalizedPreferences = normalizeImagePromptPreferences(preferences);
  const { focus, style, detailLevel } = normalizedPreferences;

  const prefsDesc = `Focus: ${focus}, Style: ${style}, Detail Level: ${detailLevel}`;
  const focusInstr = FOCUS_INSTRUCTIONS[focus];
  const styleInstr = STYLE_GUIDELINES[style];
  const wordLimit = detailLevel === 'high_precision' ? '150' : '80';

  const hydrated = replacePlaceholders(template, {
    '{ARTICLE_CONTENT}': article,
    '{SOURCE_CONTEXT}': buildSourceContext(sourceCatalog),
    '{IMAGE_PREFERENCES}': prefsDesc,
    '{FOCUS_INSTRUCTIONS}': focusInstr,
    '{STYLE_GUIDELINES}': styleInstr,
    '{WORD_LIMIT}': wordLimit,
  });

  logger.info('Generating image prompt', { runId, focus, style, detailLevel });

  const llmService = new LLMService(config, logger);

  try {
    const raw = await llmService.generateWithRetry(hydrated, {
      model: config.llm.proModel,
      responseMimeType: 'application/json',
      responseSchema: IMAGE_PROMPT_RESPONSE_SCHEMA,
      temperature: Math.min(config.llm.temperature + 0.05, 0.35),
      maxOutputTokens: 2048,
      thinkingBudget: 0,
      signal,
    });

    const slides = parseImagePrompt(raw);
    return { slides, rawResponse: raw };
  } catch (err) {
    logger.error('Image prompt generation failed', { error: (err as Error).message });
    throw err;
  }
};

