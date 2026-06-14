import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../../shared/config';
import { generateImagePrompt, normalizeImagePromptPreferences } from '../imagePrompt';
import { LLMService } from '../../services/llmService';

vi.mock('../../services/llmService', () => ({
  LLMService: vi.fn().mockImplementation(function MockLLMService() {
    return {
      generateWithRetry: vi.fn(async () =>
        JSON.stringify({
          slides: [
            {
              title: 'Supplier Risk Map',
              visualStrategy: 'market_dynamics',
              layout: 'Hero image with three source-grounded callouts',
              prompt: 'Editorial image of supplier risk scoring in an Acme procurement control room.',
            },
          ],
        }),
      ),
    };
  }),
}));

describe('normalizeImagePromptPreferences', () => {
  it('accepts known image prompt preferences', () => {
    expect(
      normalizeImagePromptPreferences({
        focus: 'infographic',
        style: 'isometric_3d',
        detailLevel: 'high_precision',
      }),
    ).toEqual({
      focus: 'infographic',
      style: 'isometric_3d',
      detailLevel: 'high_precision',
    });
  });

  it('falls back safely for unknown or malformed preferences', () => {
    expect(
      normalizeImagePromptPreferences({
        focus: 'sales_deck',
        style: '<script>',
        detailLevel: 9000,
      }),
    ).toEqual({
      focus: 'automatic',
      style: 'editorial',
      detailLevel: 'balanced',
    });
  });
});

describe('generateImagePrompt', () => {
  it('grounds prompts with source catalog context and uses precise Gemini settings', async () => {
    const config = {
      llm: {
        apiKey: 'test-key',
        proModel: 'gemini-2.5-pro',
        flashModel: 'gemini-2.5-flash',
        flashLiteModel: 'gemini-2.5-flash-lite',
        temperature: 0.2,
        maxOutputTokens: 4096,
        requestsPerMinute: 6,
      },
    } as AppConfig;
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    await generateImagePrompt({
      runId: 'run-image',
      article: 'Acme added supplier risk scoring to procurement approval workflows. [1]',
      sourceCatalog: [
        {
          id: 1,
          title: 'Acme adds supplier risk scoring to procurement suite',
          url: 'https://example.com/acme-supplier-risk',
          source: 'Example Industry News',
          publishedAt: '2026-06-10T00:00:00Z',
        },
      ],
      preferences: { focus: 'technical', style: 'editorial', detailLevel: 'high_precision' },
      config,
      logger,
    });

    const instance = vi.mocked(LLMService).mock.results.at(-1)?.value;
    const call = instance.generateWithRetry.mock.calls[0];
    expect(call[0]).toContain('Acme adds supplier risk scoring to procurement suite');
    expect(call[0]).toContain('Example Industry News');
    expect(call[0]).toContain('Visual Consistency Contract');
    expect(call[0]).toContain('Acme');
    expect(call[0]).toContain('supplier risk scoring');
    expect(call[1]).toMatchObject({
      model: 'gemini-2.5-pro',
      temperature: 0.25,
      maxOutputTokens: 2048,
      thinkingBudget: 0,
    });
  });
});
