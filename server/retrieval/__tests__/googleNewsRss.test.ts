import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../../shared/config';
import { fetchGoogleNewsRssCandidates } from '../connectors/googleNewsRss';

const configStub = {
  recencyHours: 168,
  connectors: {
    googleNewsRss: {
      enabled: true,
      hl: 'en-US',
      gl: 'US',
      ceid: 'US:en',
      maxResults: 10,
    },
  },
} as unknown as AppConfig;

describe('fetchGoogleNewsRssCandidates', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('returns wrapper URL candidates without decoding during retrieval', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-02-06T12:00:00.000Z'));

    const wrapperUrl =
      'https://news.google.com/rss/articles/CBMiZkFVX3lxTE9vLWxRM0lHTWZRenhWcno4aE1uQUYwMXA3TUhfQlFFMW93OEJhak0yRjcybEh6RTQxWks1S05ndUtyVWlZNXpKX0IyaTdjOG1DTmxiT3NJR3dJQVk2OGwxeE53d1ZuZw?oc=5';
    const feedXml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss><channel>
      <item>
        <title>Latest B2B Ecommerce news, research and case studies - Digital Commerce 360</title>
        <link>${wrapperUrl}</link>
        <pubDate>Fri, 06 Feb 2026 08:00:00 GMT</pubDate>
        <description>&lt;a href="${wrapperUrl}"&gt;Latest B2B Ecommerce news, research and case studies&lt;/a&gt;</description>
        <source url="https://www.digitalcommerce360.com">Digital Commerce 360</source>
      </item>
      </channel></rss>`;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(feedXml, { status: 200, headers: { 'content-type': 'application/rss+xml' } }));

    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchGoogleNewsRssCandidates('b2b ecommerce news', configStub);
    expect(result.items.length).toBe(1);
    expect(result.items[0].url).toContain('https://news.google.com/rss/articles/');
    expect((result.metrics as any).wrapperCandidates).toBe(1);
  });

  it('tries the next query variant when earlier variants have no recent items', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-02-06T12:00:00.000Z'));

    const staleWrapperUrl =
      'https://news.google.com/rss/articles/CBMiStale?oc=5';
    const recentWrapperUrl =
      'https://news.google.com/rss/articles/CBMiRecent?oc=5';
    const staleFeedXml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss><channel>
      <item>
        <title>Old B2B ecommerce report - Example</title>
        <link>${staleWrapperUrl}</link>
        <pubDate>Fri, 01 Jan 2026 08:00:00 GMT</pubDate>
        <description>&lt;a href="${staleWrapperUrl}"&gt;Old B2B ecommerce report with enough text&lt;/a&gt;</description>
        <source url="https://example.com">Example</source>
      </item>
      </channel></rss>`;
    const recentFeedXml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss><channel>
      <item>
        <title>Fresh B2B ecommerce acquisition report - Example</title>
        <link>${recentWrapperUrl}</link>
        <pubDate>Fri, 06 Feb 2026 08:00:00 GMT</pubDate>
        <description>&lt;a href="${recentWrapperUrl}"&gt;Fresh B2B ecommerce acquisition report with enough text&lt;/a&gt;</description>
        <source url="https://example.com">Example</source>
      </item>
      </channel></rss>`;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(staleFeedXml, { status: 200, headers: { 'content-type': 'application/rss+xml' } }))
      .mockResolvedValueOnce(new Response(recentFeedXml, { status: 200, headers: { 'content-type': 'application/rss+xml' } }));

    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchGoogleNewsRssCandidates(['narrow stale query', 'b2b ecommerce'], configStub);

    expect(result.items.length).toBe(1);
    expect(result.query).toBe('b2b ecommerce');
    expect((result.metrics as any).queryVariants).toEqual([
      expect.objectContaining({ query: 'narrow stale query', rawReturned: 1, afterRecency: 0, afterPreFilter: 0, used: false }),
      expect.objectContaining({ query: 'b2b ecommerce', rawReturned: 1, afterRecency: 1, afterPreFilter: 1, used: true }),
    ]);
  });

  it('rides out a soft 503 block by retrying the direct request with a rotated UA', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-02-06T12:00:00.000Z'));

    const recentWrapperUrl = 'https://news.google.com/rss/articles/CBMiRecentRetry?oc=5';
    const recentFeedXml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss><channel>
      <item>
        <title>Fresh B2B ecommerce technology report - Example</title>
        <link>${recentWrapperUrl}</link>
        <pubDate>Fri, 06 Feb 2026 08:00:00 GMT</pubDate>
        <description>&lt;a href="${recentWrapperUrl}"&gt;Fresh B2B ecommerce technology report&lt;/a&gt;</description>
        <source url="https://example.com">Example</source>
      </item>
      </channel></rss>`;
    const blockPage = () =>
      new Response('<html><title>Sorry...</title> automated queries </html>', { status: 503, statusText: 'Service Unavailable' });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(blockPage())
      .mockResolvedValueOnce(blockPage())
      .mockResolvedValueOnce(new Response(recentFeedXml, { status: 200, headers: { 'content-type': 'application/rss+xml' } }));

    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchGoogleNewsRssCandidates('b2b ecommerce technology', configStub);

    expect(result.items.length).toBe(1);
    expect(result.query).toBe('b2b ecommerce technology');
    expect((result.metrics as any).via).toBe('direct');
    // two blocked attempts, then success on the third
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][1]?.headers?.['User-Agent']).toContain('Mozilla/5.0');
    // User-Agent rotates between retries
    expect(fetchMock.mock.calls[1][1]?.headers?.['User-Agent']).not.toBe(
      fetchMock.mock.calls[0][1]?.headers?.['User-Agent'],
    );
  });
});
