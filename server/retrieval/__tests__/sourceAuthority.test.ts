import { describe, expect, it } from 'vitest';
import {
  getSourceAuthorityWeight,
  getSourceTier,
  isDeniedSource,
  registrableDomain,
} from '../sourceAuthority';

describe('sourceAuthority', () => {
  it('treats premier outlets and research firms as tier 1 with a positive boost', () => {
    for (const url of [
      'https://www.reuters.com/business/article',
      'https://www.bloomberg.com/news/x',
      'https://www.forbes.com/sites/x',
      'https://finance.yahoo.com/news/x',
      'https://www.mckinsey.com/insights/x',
      'https://www.gartner.com/en/x',
    ]) {
      expect(getSourceTier(url)).toBe(1);
      expect(getSourceAuthorityWeight(url)).toBeGreaterThan(0);
    }
  });

  it('treats reputable mainstream/regional outlets as tier 2 (still boosted)', () => {
    expect(getSourceTier('https://www.businessinsider.com/x')).toBe(2);
    expect(getSourceTier('https://www.thehindu.com/business/x')).toBe(2);
    expect(getSourceAuthorityWeight('https://www.businessinsider.com/x')).toBeGreaterThan(0);
  });

  it('denies and penalizes PR wires and SEO market-report mills', () => {
    for (const url of [
      'https://www.prnewswire.com/news-releases/x',
      'https://www.globenewswire.com/x',
      'https://www.einpresswire.com/x',
      'https://www.marketresearchfuture.com/reports/x',
      'https://www.mordorintelligence.com/industry-reports/x',
    ]) {
      expect(isDeniedSource(url)).toBe(true);
      expect(getSourceTier(url)).toBe(4);
      expect(getSourceAuthorityWeight(url)).toBeLessThan(0);
    }
  });

  it('leaves unknown domains neutral (no boost, no penalty, not denied)', () => {
    const url = 'https://example.com/some-article';
    expect(getSourceTier(url)).toBe(3);
    expect(getSourceAuthorityWeight(url)).toBe(0);
    expect(isDeniedSource(url)).toBe(false);
  });

  it('matches subdomains and strips www', () => {
    expect(registrableDomain('https://edition.reuters.com/x')).toBe('edition.reuters.com');
    expect(getSourceTier('https://edition.reuters.com/x')).toBe(1);
  });
});
