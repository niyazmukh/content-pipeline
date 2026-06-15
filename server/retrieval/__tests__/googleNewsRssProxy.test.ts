import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../../shared/config';
import { fetchGoogleNewsRssCandidates } from '../connectors/googleNewsRss';

const baseConfig = {
  recencyHours: 168,
  retrieval: { userAgent: 'test-agent', fetchTimeoutMs: 8000 },
  connectors: {
    googleNewsRss: {
      enabled: true,
      hl: 'en-US',
      gl: 'US',
      ceid: 'US:en',
      maxResults: 10,
      proxies: ['https://relay.test/get?url={url}'],
    },
  },
} as unknown as AppConfig;

const recentFeedXml = `<?xml version="1.0" encoding="UTF-8"?>
  <rss version="2.0"><channel>
  <item>
    <title>B2B ecommerce market grows as enterprise buyers shift online - Example News</title>
    <link>https://www.example-news.com/article/b2b-ecommerce-grows</link>
    <description>Enterprise B2B ecommerce adoption accelerates across distributors.</description>
    <pubDate>Sun, 14 Jun 2026 08:00:00 GMT</pubDate>
    <source url="https://www.example-news.com">Example News</source>
  </item>
  </channel></rss>`;

describe('Google News RSS relay fallback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('ingests Google News RSS via a relay when Google blocks the direct request', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-15T12:00:00.000Z'));

    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('relay.test')) {
        // Relay returns the real Google News RSS XML.
        return new Response(recentFeedXml, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
      }
      // Direct Google request is blocked with the automated-query page.
      return new Response('<html><title>Sorry...</title> ...automated queries... </html>', {
        status: 503,
        statusText: 'Service Unavailable',
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchGoogleNewsRssCandidates('b2b ecommerce', baseConfig);

    expect(result.items.length).toBe(1);
    expect(result.items[0].url).toBe('https://www.example-news.com/article/b2b-ecommerce-grows');
    expect((result.metrics as any).via).toBe('proxy');
    const relayCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('relay.test'));
    expect(relayCall).toBeTruthy();
    expect(String(relayCall?.[0])).toContain(encodeURIComponent('news.google.com'));
  });

  it('treats an HTTP 200 automated-query HTML page as a block and falls back to the relay', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-15T12:00:00.000Z'));

    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('relay.test')) {
        return new Response(recentFeedXml, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
      }
      // 200 OK but an HTML "sorry" block page, not RSS.
      return new Response('<!doctype html><html><body>Sorry, automated queries detected.</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchGoogleNewsRssCandidates('b2b ecommerce', baseConfig);

    expect(result.items.length).toBe(1);
    expect((result.metrics as any).via).toBe('proxy');
  });
});
