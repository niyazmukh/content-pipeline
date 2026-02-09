import { describe, expect, it } from 'vitest';
import {
  normalizeGoogleLikeQuery,
  normalizeNewsApiQuery,
  normalizeEventRegistryKeywords,
} from '../queryUtils';

describe('queryUtils provider normalization', () => {
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
});

