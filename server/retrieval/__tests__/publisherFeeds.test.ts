import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../../shared/config';
import { fetchGoogleNewsRssCandidates } from '../connectors/googleNewsRss';

const config = {
  recencyHours: 168,
  retrieval: { userAgent: 'test-agent', fetchTimeoutMs: 8000 },
  connectors: {
    googleNewsRss: {
      enabled: true,
      hl: 'en-US',
      gl: 'US',
      ceid: 'US:en',
      maxResults: 10,
      proxies: [],
      publisherFeeds: ['https://feeds.example-bbc.test/business/rss.xml'],
    },
  },
} as unknown as AppConfig;

const publisherXml = `<?xml version="1.0" encoding="UTF-8"?>
  <rss version="2.0"><channel>
  <item>
    <title><![CDATA[B2B ecommerce market grows as enterprise buyers move online]]></title>
    <link>https://www.bbc.com/news/articles/b2b-ecommerce-grows</link>
    <description><![CDATA[Enterprise B2B ecommerce procurement adoption accelerates across distributors.]]></description>
    <pubDate>Sun, 14 Jun 2026 08:00:00 GMT</pubDate>
  </item>
  </channel></rss>`;

describe('Google News RSS via official publisher feeds (reliable path)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('ingests from publisher feeds when Google blocks direct, with no relay needed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-15T12:00:00.000Z'));

    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('news.google.com')) {
        return new Response('<html><title>Sorry...</title> automated queries </html>', { status: 503, statusText: 'Service Unavailable' });
      }
      return new Response(publisherXml, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchGoogleNewsRssCandidates('b2b ecommerce', config);

    expect(result.items.length).toBe(1);
    expect(result.items[0].url).toBe('https://www.bbc.com/news/articles/b2b-ecommerce-grows');
    expect((result.metrics as any).via).toBe('feed');
    // publisher feed was fetched and provided the items
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('example-bbc'))).toBe(true);
    expect(Array.isArray((result.metrics as any).feeds)).toBe(true);
    // Success via publisher feeds must NOT be reported as a failure/error;
    // the expected Google block is surfaced as an informational note instead.
    expect((result.metrics as any).failed).toBeFalsy();
    expect((result.metrics as any).error).toBeUndefined();
    expect((result.metrics as any).note).toContain('Google News direct');
  });
});
