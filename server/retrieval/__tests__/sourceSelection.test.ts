import { describe, expect, it } from 'vitest';
import type { RankedArticle } from '../ranking';
import { selectQualitySources } from '../sourceSelection';
import { buildQueryIntent } from '../queryIntent';

const article = (overrides: Partial<RankedArticle> & { id: string; title: string; url?: string }): RankedArticle => ({
  id: overrides.id,
  title: overrides.title,
  canonicalUrl: overrides.url ?? `https://example.com/${overrides.id}`,
  sourceHost: new URL(overrides.url ?? `https://example.com/${overrides.id}`).hostname,
  sourceName: overrides.sourceName ?? 'Example',
  sourceLabel: overrides.sourceLabel ?? overrides.sourceName ?? 'Example',
  publishedAt: overrides.publishedAt ?? '2026-04-26T12:00:00.000Z',
  modifiedAt: null,
  excerpt: overrides.excerpt ?? '',
  body: overrides.body ?? null,
  hasExtractedBody: overrides.hasExtractedBody ?? true,
  provenance: overrides.provenance ?? { provider: 'google' },
  quality: {
    wordCount: overrides.quality?.wordCount ?? 900,
    uniqueWordCount: overrides.quality?.uniqueWordCount ?? 500,
    relevanceScore: overrides.quality?.relevanceScore ?? 0.8,
    evidenceScore: overrides.quality?.evidenceScore ?? 0.8,
  },
  score: overrides.score ?? 0.8,
  reasons: overrides.reasons ?? [],
});

describe('selectQualitySources', () => {
  const intent = buildQueryIntent(
    'Top B2B ecommerce news, focus on market research and reports, regulation, notable case studies and acquisitions.',
  );

  it('prefers diverse, anchored evidence and reports facet coverage', () => {
    const sources = [
      article({
        id: 'market',
        title: 'B2B ecommerce market research report tracks enterprise buying',
        body: 'B2B ecommerce market research report says enterprise procurement teams increased digital purchasing.',
        provenance: { provider: 'google' },
        sourceName: 'Research Source',
      }),
      article({
        id: 'reg',
        title: 'Regulator updates B2B e-commerce compliance rules',
        body: 'New regulation affects B2B e-commerce platforms and marketplace compliance programs.',
        provenance: { provider: 'newsapi' },
        sourceName: 'Policy Source',
      }),
      article({
        id: 'case',
        title: 'Industrial distributor publishes B2B ecommerce case study',
        body: 'The case study describes B2B ecommerce checkout changes and acquisition integration work.',
        provenance: { provider: 'eventregistry' },
        sourceName: 'Trade Source',
      }),
      article({
        id: 'generic',
        title: 'Digital commerce keeps changing',
        body: 'Companies are investing in modern customer experiences and growth initiatives.',
        quality: { wordCount: 900, uniqueWordCount: 500, relevanceScore: 0.9, evidenceScore: 0.2 },
        score: 0.95,
        provenance: { provider: 'googlenews' },
      }),
    ];

    const result = selectQualitySources(sources, intent, { minSources: 3 });

    expect(result.selected.map((item) => item.id)).toEqual(['market', 'reg', 'case']);
    expect(result.rejected.some((entry) => entry.article.id === 'generic' && entry.reasons.includes('weak_evidence'))).toBe(true);
    expect(result.coverage.providerCount).toBe(3);
    expect(result.coverage.facets.market_research).toBeGreaterThan(0);
    expect(result.coverage.facets.regulation).toBeGreaterThan(0);
    expect(result.coverage.facets.case_studies).toBeGreaterThan(0);
    expect(result.coverage.readyForSynthesis).toBe(true);
  });

  it('flags low source count and missing facets as weak coverage', () => {
    const result = selectQualitySources(
      [
        article({
          id: 'only',
          title: 'B2B ecommerce report notes enterprise adoption',
          body: 'B2B ecommerce market research report details enterprise adoption.',
          provenance: { provider: 'google' },
        }),
      ],
      intent,
      { minSources: 3 },
    );

    expect(result.selected).toHaveLength(1);
    expect(result.coverage.readyForSynthesis).toBe(false);
    expect(result.coverage.warnings).toContain('source_count_below_minimum');
    expect(result.coverage.warnings).toContain('facet_coverage_incomplete');
  });
});
