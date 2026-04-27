import { describe, expect, it } from 'vitest';
import { applyPreFilter } from '../preFilter';

describe('applyPreFilter', () => {
  it('rejects section landing pages before extraction', () => {
    const decision = applyPreFilter(
      'https://example.com/news',
      'B2B ecommerce news and market research',
      'Recent B2B ecommerce updates and market research coverage.',
      'b2b ecommerce market research',
    );

    expect(decision).toEqual({ pass: false, reason: 'section_landing_page' });
  });

  it('keeps dated article URLs from publisher sections', () => {
    const decision = applyPreFilter(
      'https://example.com/news/2026/04/26/b2b-ecommerce-market-research-report',
      'B2B ecommerce market research report',
      'A new B2B ecommerce market research report covers enterprise purchasing.',
      'b2b ecommerce market research',
    );

    expect(decision.pass).toBe(true);
  });
});
