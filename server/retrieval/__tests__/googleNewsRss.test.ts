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

  it('decodes Google wrapper URL to publisher URL and returns candidate', async () => {
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
    const articleHtml = `<html><body><c-wiz><div jscontroller="x" data-n-a-sg="sig123" data-n-a-ts="1770550734"></div></c-wiz></body></html>`;
    const batchText =
      `)]}'\n\n` +
      `[["wrb.fr","Fbv4je","[\\"garturlres\\",\\"https://www.digitalcommerce360.com/topic/b2b-ecommerce/\\",1]",null,null,null,""]]`;

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(feedXml, { status: 200, headers: { 'content-type': 'application/rss+xml' } }))
      .mockResolvedValueOnce(new Response(articleHtml, { status: 200, headers: { 'content-type': 'text/html' } }))
      .mockResolvedValueOnce(new Response(batchText, { status: 200, headers: { 'content-type': 'text/plain' } }));

    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchGoogleNewsRssCandidates('b2b ecommerce news', configStub);
    expect(result.items.length).toBe(1);
    expect(result.items[0].url).toBe('https://www.digitalcommerce360.com/topic/b2b-ecommerce/');
    expect((result.metrics as any).decodeAttempts).toBe(1);
    expect((result.metrics as any).droppedWrappedUnresolved).toBe(0);
  });
});

