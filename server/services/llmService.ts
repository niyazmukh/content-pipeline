import JSON5 from 'json5';
import type { AppConfig } from '../../shared/config';
import { rateLimitedGenerateContent, isTransientError, extractGenerateContentText } from './genai';
import { extractJson, extractJsonRobust } from '../utils/jsonExtract';
import { sleep } from '../utils/async';
import type { Logger } from '../obs/logger';

export interface GenerateOptions {
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: string;
  signal?: AbortSignal;
}

export interface GenerateAndParseOptions<T> extends GenerateOptions {
  fallbackToText?: boolean;
  parser?: (text: string) => T;
}

export class LLMService {
  constructor(
    private config: AppConfig,
    private logger: Logger,
  ) {}

  async generateWithRetry(
    prompt: string,
    options: GenerateOptions = {},
  ): Promise<string> {
    const primaryModel = options.model || this.config.llm.proModel;
    const fallbackModel = this.config.llm.flashModel;
    const flashLiteModel = this.config.llm.flashLiteModel;

    let currentModel = primaryModel;
    let attempt = 0;
    const maxAttempts = 3;
    const modelsTried: string[] = [];
    let lastErrorMessage: string | null = null;
    let lastErrorCode: number | null = null;
    let lastErrorWasTransient = false;

    // Permissive safety settings for news analysis
    const safetySettings = [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    ];

    while (attempt < maxAttempts) {
      attempt++;
      modelsTried.push(currentModel);
      try {
        const response = await rateLimitedGenerateContent(this.config, {
          model: currentModel,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: {
            temperature: options.temperature ?? this.config.llm.temperature,
            maxOutputTokens: options.maxOutputTokens ?? this.config.llm.maxOutputTokens,
            responseMimeType: options.responseMimeType,
            safetySettings,
          },
          signal: options.signal,
        });

        const text = extractGenerateContentText(response);
        if (text) return text;
        
        throw new Error('Empty response from LLM');

      } catch (error) {
        if (options.signal?.aborted) throw error;

        const isTransient = isTransientError(error);
        lastErrorWasTransient = isTransient;
        lastErrorMessage = error instanceof Error ? error.message : String(error);
        const maybeCode = (error as any)?.status ?? (error as any)?.error?.code ?? null;
        lastErrorCode = typeof maybeCode === 'number' && Number.isFinite(maybeCode) ? maybeCode : null;
        this.logger.warn('LLM generation error', {
          model: currentModel,
          attempt,
          error: lastErrorMessage,
          errorCode: lastErrorCode,
          isTransient,
        });

        if (!isTransient && attempt >= maxAttempts) throw error;

        // Model fallback logic
        if (isTransient || attempt >= 2) {
            if (currentModel === primaryModel && fallbackModel && fallbackModel !== primaryModel) {
                currentModel = fallbackModel;
                this.logger.info('Falling back to Flash model', { model: currentModel });
                continue;
            } else if (currentModel === fallbackModel && flashLiteModel && flashLiteModel !== fallbackModel) {
                 currentModel = flashLiteModel;
                 this.logger.info('Falling back to Flash Lite model', { model: currentModel });
                 continue;
            }
        }
         
        await sleep(Math.pow(2, attempt) * 1000, options.signal);
      }
    }

    const modelsSummary = Array.from(new Set(modelsTried)).join(' -> ');
    const codePart = lastErrorCode != null ? ` (code ${lastErrorCode})` : '';
    const lastPart = lastErrorMessage ? ` Last error: ${lastErrorMessage}${codePart}.` : '';
    const hint = lastErrorWasTransient
      ? ' This is usually a temporary Gemini issue or a quota/rate-limit (try again, lower RPM, or use your own key).'
      : '';
    throw new Error(`Failed to generate content after ${maxAttempts} attempts (models: ${modelsSummary}).${lastPart}${hint}`);
  }

  async generateAndParse<T>(
    prompt: string,
    options: GenerateAndParseOptions<T> = {},
  ): Promise<T> {
    const raw = await this.generateWithRetry(prompt, {
      ...options,
      responseMimeType: 'application/json',
    });

    try {
      const extracted = extractJson(raw) || extractJsonRobust(raw);
      if (!extracted) throw new Error('No JSON found in response');
      return JSON5.parse(extracted) as T;
    } catch (error) {
      if (options.fallbackToText && options.parser) {
        this.logger.warn('JSON parsing failed, falling back to text parser', { error: (error as Error).message });
        return options.parser(raw);
      }
      throw error;
    }
  }
}

