import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../../shared/config';
import { LLMService } from '../llmService';
import { rateLimitedGenerateContent } from '../genai';

vi.mock('../genai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../genai')>();
  return {
    ...actual,
    rateLimitedGenerateContent: vi.fn(async () => ({
      text: '{"ok":true}',
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"ok":true}' }] } }],
    })),
  };
});

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

describe('LLMService Gemini controls', () => {
  it('passes responseSchema and thinkingConfig to Gemini JSON requests', async () => {
    vi.mocked(rateLimitedGenerateContent).mockClear();
    const service = new LLMService(config, logger);
    const responseSchema = {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
      },
      required: ['ok'],
    };

    await service.generateAndParse<{ ok: boolean }>('return ok', {
      responseSchema,
      thinkingBudget: 0,
    });

    const params = vi.mocked(rateLimitedGenerateContent).mock.calls[0][1];
    expect(params.config).toMatchObject({
      responseMimeType: 'application/json',
      responseSchema,
      thinkingConfig: { thinkingBudget: 0 },
    });
  });
});
