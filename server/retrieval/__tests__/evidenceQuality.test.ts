import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { NormalizedArticle } from '../types';
import { scoreEvidenceQuality } from '../evidenceQuality';
import { rankAndClusterArticles } from '../ranking';
import { buildQueryIntent } from '../queryIntent';

const article = (overrides: Partial<NormalizedArticle>): NormalizedArticle => ({
  id: 'article',
  title: 'B2B ecommerce acquisition report',
  canonicalUrl: 'https://example.com/news/b2b-ecommerce-acquisition',
  sourceHost: 'example.com',
  sourceName: 'Example',
  sourceLabel: 'Example',
  publishedAt: '2026-02-06T08:00:00.000Z',
  modifiedAt: null,
  excerpt: 'B2B ecommerce companies reported an acquisition with market research and regulatory implications.',
  body: 'On 2026-02-06, Acme acquired Beta for $120 million. Analysts cited B2B ecommerce growth, market research, regulatory review, and case study evidence from merchants.',
  hasExtractedBody: true,
  quality: {
    wordCount: 700,
    uniqueWordCount: 220,
    relevanceScore: 0.45,
  },
  provenance: { provider: 'google' },
  ...overrides,
});

describe('evidence quality scoring', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-08T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rewards articles that match query anchors and facets with dense factual evidence', () => {
    const intent = buildQueryIntent(
      'Top B2B ecommerce news (focus on market research and reports, regulation, notable case studies and acquisitions).',
    );
    const high = article({});
    const low = article({
      id: 'low',
      title: 'Regulation update',
      canonicalUrl: 'https://generic.example.com/regulation',
      sourceHost: 'generic.example.com',
      excerpt: 'A regulation update discusses broad policy trends.',
      body: 'This update has general commentary and little detail.',
      hasExtractedBody: false,
      quality: {
        wordCount: 180,
        uniqueWordCount: 90,
        relevanceScore: 0.7,
      },
    });

    const highScore = scoreEvidenceQuality(high, intent);
    const lowScore = scoreEvidenceQuality(low, intent);

    expect(highScore.score).toBeGreaterThan(lowScore.score);
    expect(highScore.reasons).toEqual(expect.arrayContaining(['anchorCoverage=1', 'hasExtractedBody=1']));
    expect(lowScore.reasons).toContain('anchorCoverage=0');
  });

  it('uses evidence quality in ranking so dense anchored evidence outranks generic high-relevance content', () => {
    const intent = buildQueryIntent(
      'Top B2B ecommerce news (focus on market research and reports, regulation, notable case studies and acquisitions).',
    );
    const dense = article({
      id: 'dense',
      quality: {
        wordCount: 650,
        uniqueWordCount: 210,
        relevanceScore: 0.4,
      },
    });
    const generic = article({
      id: 'generic',
      title: 'Regulation update',
      canonicalUrl: 'https://example.com/news/regulation-update',
      sourceHost: 'example.com',
      excerpt: 'Regulation regulation regulation update for policy watchers.',
      body: 'Regulation news with little topical connection.',
      hasExtractedBody: false,
      quality: {
        wordCount: 900,
        uniqueWordCount: 250,
        relevanceScore: 0.95,
      },
    });

    const { ranked } = rankAndClusterArticles([generic, dense], {
      recencyHours: 168,
      maxClusters: 5,
      queryIntent: intent,
    });

    expect(ranked[0].id).toBe('dense');
    expect(ranked[0].reasons.some((reason) => reason.startsWith('evidence='))).toBe(true);
  });
});
