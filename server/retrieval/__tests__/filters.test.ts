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

  it('rejects extracted articles that match excluded entities or locations', () => {
    const entityDecision = evaluateArticle(
      buildArticle({
        title: 'BigCommerce releases new B2B ecommerce data',
        body: 'This article discusses current B2B platform trends with no explicit publication date.',
      }),
      { ...baseOptions, excludeEntities: ['BigCommerce'] },
    );
    const locationDecision = evaluateArticle(
      buildArticle({
        canonicalUrl: 'https://publisher.in/news/2026/04/26/b2b-ecommerce',
        sourceHost: 'publisher.in',
        body: 'This article discusses current B2B platform trends with no explicit publication date.',
      }),
      { ...baseOptions, excludeLocations: ['India'] },
    );

    expect(entityDecision.accept).toBe(false);
    expect(entityDecision.reasons).toContain('excluded_entity');
    expect(locationDecision.accept).toBe(false);
    expect(locationDecision.reasons).toContain('excluded_location');
  });

  it('does not reject global market reports for body-only excluded company or country mentions', () => {
    const decision = evaluateArticle(
      buildArticle({
        title: 'B2B ecommerce market report tracks global platform adoption',
        canonicalUrl: 'https://example.com/reports/b2b-ecommerce-market',
        sourceHost: 'example.com',
        excerpt: 'A global market research report covers B2B ecommerce growth, regulation, and platform adoption.',
        body: [
          'The report covers global B2B ecommerce market research, regulation, case studies, and acquisitions.',
          'Regional segmentation includes North America, Europe, China, India, Bangladesh, and Pakistan.',
          'The vendor appendix lists Adobe, Salesforce, Shopify, BigCommerce, and other platform providers.',
        ].join(' '),
      }),
      { ...baseOptions, excludeEntities: ['BigCommerce', 'Shopify'], excludeLocations: ['India', 'Bangladesh', 'Pakistan'] },
    );

    expect(decision.accept).toBe(true);
    expect(decision.reasons).not.toContain('excluded_entity');
    expect(decision.reasons).not.toContain('excluded_location');
  });

  it('rejects excluded companies and countries when they are the article focus', () => {
    const companyDecision = evaluateArticle(
      buildArticle({
        title: 'Shopify expands B2B ecommerce platform for enterprise sellers',
        body: 'Shopify announced new B2B ecommerce features for enterprise sellers.',
      }),
      { ...baseOptions, excludeEntities: ['Shopify'] },
    );
    const countryDecision = evaluateArticle(
      buildArticle({
        title: 'India B2B ecommerce regulation changes procurement rules',
        canonicalUrl: 'https://example.com/news/india-b2b-ecommerce-regulation',
        sourceHost: 'example.com',
        body: 'India regulators changed B2B ecommerce procurement rules this week.',
      }),
      { ...baseOptions, excludeLocations: ['India'] },
    );

    expect(companyDecision.accept).toBe(false);
    expect(companyDecision.reasons).toContain('excluded_entity');
    expect(countryDecision.accept).toBe(false);
    expect(countryDecision.reasons).toContain('excluded_location');
  });
});

