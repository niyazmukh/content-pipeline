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

  it('continues to fallback variants when the first query is thin', async () => {
    const fetchMock = vi
      .fn(async (input: unknown) => {
        const requestUrl = new URL(String(input));
        const q = requestUrl.searchParams.get('q') || '';
        const articles = q.includes('market report')
          ? [
              {
                title: 'B2B ecommerce market report highlights distributor investment',
                url: 'https://example.com/report',
                description: 'Distributor ecommerce investment accelerates.',
                publishedAt: '2026-06-10T00:00:00Z',
                source: { name: 'Example' },
              },
              {
                title: 'B2B ecommerce case study shows wholesale portal adoption',
                url: 'https://example.com/case-study',
                description: 'Wholesale buyers shift to a new portal.',
                publishedAt: '2026-06-10T00:00:00Z',
                source: { name: 'Example' },
              },
            ]
          : [
              {
                title: 'B2B ecommerce regulation update',
                url: 'https://example.com/regulation',
                description: 'Regulatory update for ecommerce platforms.',
                publishedAt: '2026-06-10T00:00:00Z',
                source: { name: 'Example' },
              },
            ];
        return new Response(JSON.stringify({ status: 'ok', totalResults: articles.length, articles }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchNewsApiCandidates(
      ['("b2b ecommerce") AND ("regulation")', '("b2b ecommerce") AND ("market report")'],
      config,
      { maxPages: 1, minResultsBeforeFallback: 2 },
    );

    expect(result.items.map((item) => item.url)).toEqual([
      'https://example.com/regulation',
      'https://example.com/report',
      'https://example.com/case-study',
    ]);
    expect((result.metrics?.queryVariants as any[]).filter((variant) => variant.used).length).toBeGreaterThan(1);
  });
});
