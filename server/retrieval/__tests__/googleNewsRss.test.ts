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
  });

  it('returns wrapper URL candidates without decoding during retrieval', async () => {
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
});
