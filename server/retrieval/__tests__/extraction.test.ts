import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../../shared/config';
import { extractArticle } from '../extraction';
import { GOOGLE_NEWS_WRAPPER_SKIP_ERROR } from '../extraction';

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

  it('resolves Google News wrapper URL before extraction', async () => {
    const wrapperUrl =
      'https://news.google.com/articles/CBMiZkFVX3lxTE9vLWxRM0lHTWZRenhWcno4aE1uQUYwMXA3TUhfQlFFMW93OEJhak0yRjcybEh6RTQxWks1S05ndUtyVWlZNXpKX0IyaTdjOG1DTmxiT3NJR3dJQVk2OGwxeE53d1ZuZw?oc=5';
    const decodePageHtml = `<html><body><c-wiz><div jscontroller="x" data-n-a-sg="sig123" data-n-a-ts="1770550734"></div></c-wiz></body></html>`;
    const batchText =
      `)]}'\n\n` +
      `[["wrb.fr","Fbv4je","[\\"garturlres\\",\\"https://www.digitalcommerce360.com/topic/b2b-ecommerce/\\",1]",null,null,null,""]]`;
    const articleHtml = `
      <html>
        <head>
          <title>B2B RSS Story</title>
          <link rel="canonical" href="https://www.digitalcommerce360.com/topic/b2b-ecommerce/" />
        </head>
        <body><main><p>Published on 2026-02-01. Market update.</p></main></body>
      </html>
    `;
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(decodePageHtml, { status: 200, headers: { 'content-type': 'text/html' } }))
        .mockResolvedValueOnce(new Response(batchText, { status: 200, headers: { 'content-type': 'text/plain' } }))
        .mockResolvedValueOnce(new Response(articleHtml, { status: 200, headers: { 'content-type': 'text/html' } })),
    );

    const outcome = await extractArticle(
      {
        id: '2',
        title: 'Wrapper story',
        url: wrapperUrl,
        sourceName: 'Google News',
        publishedAt: null,
        snippet: 'snippet',
        providerData: null,
      },
      'googlenews',
      { config: configStub, queryTokens: ['b2b', 'news'] },
    );

    expect(outcome.article).not.toBeNull();
    expect(outcome.article?.canonicalUrl).toContain('digitalcommerce360.com');
  });

  it('returns skip marker when wrapper decode is unavailable', async () => {
    const wrapperUrl =
      'https://news.google.com/articles/CBMiZkFVX3lxTE9vLWxRM0lHTWZRenhWcno4aE1uQUYwMXA3TUhfQlFFMW93OEJhak0yRjcybEh6RTQxWks1S05ndUtyVWlZNXpKX0IyaTdjOG1DTmxiT3NJR3dJQVk2OGwxeE53d1ZuZw?oc=5';
    const wrapperHtml = `
      <html>
        <head><title>Google News wrapper</title></head>
        <body><main><p>Wrapper page content fallback.</p></main></body>
      </html>
    `;
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        // decode param attempts fail
        .mockResolvedValue(new Response('not useful', { status: 200, headers: { 'content-type': 'text/html' } }))
        // extraction fetch of wrapper succeeds
        .mockResolvedValueOnce(new Response('not useful', { status: 200, headers: { 'content-type': 'text/html' } }))
        .mockResolvedValueOnce(new Response('not useful', { status: 200, headers: { 'content-type': 'text/html' } }))
        .mockResolvedValueOnce(new Response('not useful', { status: 200, headers: { 'content-type': 'text/html' } }))
        .mockResolvedValueOnce(new Response('not useful', { status: 200, headers: { 'content-type': 'text/html' } }))
        .mockResolvedValueOnce(new Response(wrapperHtml, { status: 200, headers: { 'content-type': 'text/html' } })),
    );

    const outcome = await extractArticle(
      {
        id: '3',
        title: 'Wrapper unresolved',
        url: wrapperUrl,
        sourceName: 'Google News',
        publishedAt: null,
        snippet: null,
        providerData: null,
      },
      'googlenews',
      { config: configStub, queryTokens: ['b2b', 'news'] },
    );

    expect(outcome.article).toBeNull();
    expect(outcome.error).toBe(GOOGLE_NEWS_WRAPPER_SKIP_ERROR);
  });
});
