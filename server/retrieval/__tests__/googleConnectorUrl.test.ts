import { describe, expect, it } from 'vitest';
import { looksLikeNewsArticleUrl } from '../connectors/google';

describe('Google CSE URL acceptance heuristics', () => {
  it('accepts article and market-report URLs that may not expose publish metadata in CSE', () => {
    expect(
      looksLikeNewsArticleUrl('https://finance.yahoo.com/sectors/healthcare/articles/pharma-b2b-ecommerce-global-market-080200870.html'),
    ).toBe(true);
    expect(looksLikeNewsArticleUrl('https://www.marketreportsworld.com/market-reports/b2b-e-commerce-market-14722445')).toBe(true);
    expect(looksLikeNewsArticleUrl('https://www.fortunebusinessinsights.com/ecommerce-platform-market-111994')).toBe(true);
  });
});
