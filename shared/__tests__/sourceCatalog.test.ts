import { describe, expect, it } from 'vitest';
import { buildGlobalSourceCatalog } from '../sourceCatalog';
import type { EvidenceItem, NormalizedArticle, SourceCatalogEntry, StoryCluster } from '../types';

const makeArticle = (args: {
  id: string;
  url: string;
  title: string;
  sourceName?: string;
  publishedAt?: string | null;
}): NormalizedArticle => ({
  id: args.id,
  title: args.title,
  canonicalUrl: args.url,
  sourceHost: 'example.com',
  sourceName: args.sourceName ?? 'Example Source',
  publishedAt: args.publishedAt ?? null,
  excerpt: 'Summary text',
  quality: {
    wordCount: 120,
    uniqueWordCount: 90,
    relevanceScore: 0.8,
  },
});

describe('buildGlobalSourceCatalog', () => {
  it('merges provided catalog deterministically and keeps stable IDs', () => {
    const rep = makeArticle({
      id: 'a1',
      url: 'https://news.example/a',
      title: 'Much longer headline',
      sourceName: 'Associated Press',
      publishedAt: '2025-01-03T00:00:00Z',
    });
    const member = makeArticle({
      id: 'b1',
      url: 'https://news.example/b',
      title: 'Beta update',
      sourceName: 'Reuters',
      publishedAt: '2025-01-02T00:00:00Z',
    });

    const clusters: StoryCluster[] = [
      {
        clusterId: 'cluster-1',
        representative: rep,
        members: [member],
        score: 0.9,
        reasons: [],
        citations: [{ title: rep.title, url: rep.canonicalUrl }],
      },
    ];

    const evidence: EvidenceItem[] = [
      {
        outlineIndex: 0,
        point: 'Point',
        digest: 'Digest',
        citations: [
          {
            id: 99,
            title: 'Evidence headline',
            url: rep.canonicalUrl,
            source: 'Associated Press',
            publishedAt: '2025-01-03T00:00:00Z',
          },
        ],
      },
    ];

    const provided: SourceCatalogEntry[] = [
      {
        id: 2,
        title: 'Gamma headline',
        url: 'https://news.example/c',
        source: 'Other Source',
        publishedAt: null,
      },
      {
        id: 5,
        title: 'Short',
        url: rep.canonicalUrl,
        source: 'AP',
        publishedAt: '2025-01-01T00:00:00Z',
      },
    ];

    const first = buildGlobalSourceCatalog({
      clusters,
      evidence,
      maxSources: 80,
      provided,
    });
    const second = buildGlobalSourceCatalog({
      clusters,
      evidence,
      maxSources: 80,
      provided,
    });

    expect(second).toEqual(first);

    const byUrl = new Map(first.map((entry) => [entry.url, entry]));
    expect(byUrl.get(rep.canonicalUrl)?.id).toBe(5);
    expect(byUrl.get(rep.canonicalUrl)?.title).toBe('Much longer headline');
    expect(byUrl.get(rep.canonicalUrl)?.source).toBe('Associated Press');
    expect(byUrl.get(rep.canonicalUrl)?.publishedAt).toBe('2025-01-03T00:00:00Z');

    expect(byUrl.get(member.canonicalUrl)?.id).toBe(6);
    expect(byUrl.get('https://news.example/c')?.id).toBe(2);

    const urls = first.map((entry) => entry.url);
    expect(new Set(urls).size).toBe(urls.length);
  });
});
