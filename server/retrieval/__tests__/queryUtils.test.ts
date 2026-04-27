import { describe, expect, it } from 'vitest';
import {
  normalizeGoogleLikeQuery,
  normalizeNewsApiQuery,
  normalizeEventRegistryKeywords,
} from '../queryUtils';

describe('queryUtils provider normalization', () => {
  const b2bTopic =
    'Top B2B ecommerce news (focus on market research and reports, regulation, notable case studies and acquisitions).';

  it('builds broad Google-style OR queries without forcing non-proper-noun phrases', () => {
    const result = normalizeGoogleLikeQuery('"b2b ecommerce news" OR "b2b platform developments" OR "b2b online market"');
    expect(result).toContain('OR');
    expect(result.toLowerCase()).toContain('b2b ecommerce');
  });

  it('builds NewsAPI boolean query with OR-separated terms', () => {
    const result = normalizeNewsApiQuery('"retail media network" OR ecommerce platform');
    expect(result).toContain('OR');
    expect(result.toLowerCase()).toContain('ecommerce');
  });

  it('builds EventRegistry keyword arrays without boolean operators', () => {
    const result = normalizeEventRegistryKeywords('"b2b ecommerce" OR "wholesale online" OR platform');
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result.join(' ').toLowerCase()).not.toContain(' or ');
  });

  it('normalizes natural-language B2B ecommerce requests into short quoted OR phrases for Google-like sources', () => {
    const result = normalizeGoogleLikeQuery(b2bTopic);

    expect(result).toContain('"b2b ecommerce"');
    expect(result).toContain('OR');
    expect(result).not.toContain('focus');
    expect(result).not.toContain('notable');
    expect(result.split(/\s+OR\s+/).every((term) => /^"[^"]+"$/.test(term))).toBe(true);
  });

  it('normalizes natural-language B2B ecommerce requests into NewsAPI-safe quoted OR phrases', () => {
    const result = normalizeNewsApiQuery(b2bTopic);

    expect(result).toContain('"b2b ecommerce"');
    expect(result).toContain('OR');
    expect(result).not.toContain('focus');
    expect(result).not.toContain('notable');
    expect(result.split(/\s+OR\s+/).every((term) => /^"[^"]+"$/.test(term))).toBe(true);
  });
});

