import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../../shared/config';
import { fetchNewsApiCandidates } from '../connectors/newsapi';

const config = {
  recencyHours: 168,
  retrieval: {
    userAgent: 'test-agent',
  },
  connectors: {
    newsApi: {
      enabled: true,
      apiKey: 'news-key',
      pageSize: 10,
    },
  },
} as AppConfig;

describe('fetchNewsApiCandidates', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses documented precision parameters and server-side domain filters', async () => {
    const fetchMock = vi.fn(async (_input: unknown) =>
      new Response(
        JSON.stringify({
          status: 'ok',
          totalResults: 1,
          articles: [
            {
              title: 'Acme launches procurement system',
              url: 'https://example.com/news/acme-procurement',
              description: 'Acme expands procurement automation.',
              publishedAt: '2026-06-10T00:00:00Z',
              source: { name: 'Example' },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await fetchNewsApiCandidates('Acme procurement automation', config, {
      maxPages: 1,
      domains: ['example.com', 'industry.example'],
      excludeDomains: ['spam.example'],
    });

    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestUrl.searchParams.get('searchIn')).toBe('title,description');
    expect(requestUrl.searchParams.get('sortBy')).toBe('relevancy');
    expect(requestUrl.searchParams.get('domains')).toBe('example.com,industry.example');
    expect(requestUrl.searchParams.get('excludeDomains')).toBe('spam.example');
  });
});
