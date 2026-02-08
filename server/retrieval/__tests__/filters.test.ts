import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { NormalizedArticle } from '../types';
import { evaluateArticle } from '../filters';

const baseOptions = {
  recencyHours: 24 * 7,
  minWordCount: 10,
  minUniqueWords: 5,
  minRelevance: 0.1,
  bannedHostPatterns: [] as RegExp[],
  maxPromoPhraseMatches: 3,
};

const buildArticle = (overrides: Partial<NormalizedArticle> = {}): NormalizedArticle => ({
  id: 'a1',
  title: 'B2B platform update',
  canonicalUrl: 'https://example.com/news/update',
  sourceHost: 'example.com',
  sourceName: 'Example',
  sourceLabel: 'Example',
  publishedAt: null,
  modifiedAt: null,
  excerpt: 'A recent update for B2B platform operators.',
  body: 'Published on 2026-01-20. New release announced.',
  hasExtractedBody: true,
  quality: {
    wordCount: 200,
    uniqueWordCount: 120,
    relevanceScore: 0.7,
  },
  provenance: {
    provider: 'google',
    providerId: '1',
  },
  ...overrides,
});

describe('evaluateArticle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-08T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects clearly old explicit publishedAt', () => {
    const article = buildArticle({
      publishedAt: '2025-11-01T00:00:00.000Z',
    });
    const decision = evaluateArticle(article, baseOptions);
    expect(decision.accept).toBe(false);
    expect(decision.reasons).toContain('too_old');
  });

  it('rejects undated articles when inferred date is stale', () => {
    const article = buildArticle({
      publishedAt: null,
      body: 'Published on 2025-10-01. Announcement details here.',
    });
    const decision = evaluateArticle(article, baseOptions);
    expect(decision.accept).toBe(false);
    expect(decision.reasons).toContain('too_old_inferred');
  });

  it('keeps undated articles when no reliable date can be inferred', () => {
    const article = buildArticle({
      publishedAt: null,
      body: 'This article discusses current B2B platform trends with no explicit publication date.',
    });
    const decision = evaluateArticle(article, baseOptions);
    expect(decision.accept).toBe(true);
    expect(decision.warnings).toContain('missing_published_at');
  });
});

