import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../../shared/config';
import { extractArticle } from '../extraction';

const configStub = {
  retrieval: {
    fetchTimeoutMs: 5_000,
    userAgent: 'test-agent',
    cacheTtlMs: 0,
  },
} as unknown as AppConfig;

describe('extractArticle date inference', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-08T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('infers publishedAt from text when structured date attributes are absent', async () => {
    const html = `
      <html>
        <head><title>B2B Update</title></head>
        <body>
          <main>
            <p>Published on 2026-01-20. Acme launched a new marketplace workflow.</p>
          </main>
        </body>
      </html>
    `;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })),
    );

    const outcome = await extractArticle(
      {
        id: '1',
        title: 'B2B Update',
        url: 'https://example.com/news/acme-update',
        sourceName: 'Example',
        publishedAt: null,
        snippet: null,
        providerData: null,
      },
      'google',
      { config: configStub, queryTokens: ['b2b', 'marketplace'] },
    );

    expect(outcome.article).not.toBeNull();
    expect(outcome.article?.publishedAt).toContain('2026-01-20');
  });
});

