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

  it('rejects candidates that mention excluded entities before extraction', () => {
    const decision = applyPreFilter(
      'https://example.com/news/2026/04/26/bigcommerce-market-update',
      'BigCommerce releases enterprise ecommerce report',
      'The report covers B2B ecommerce purchasing and market research trends.',
      'b2b ecommerce market research -"BigCommerce"',
      { excludeEntities: ['BigCommerce'] },
    );

    expect(decision).toEqual({ pass: false, reason: 'excluded_entity' });
  });

  it('rejects excluded locations using text and country-code host signals', () => {
    const textDecision = applyPreFilter(
      'https://example.com/news/2026/04/26/b2b-ecommerce-india-policy',
      'India updates B2B ecommerce rules',
      'Indian regulators discussed B2B ecommerce market rules this week.',
      'b2b ecommerce -"India"',
      { excludeLocations: ['India'] },
    );
    const hostDecision = applyPreFilter(
      'https://publisher.in/news/2026/04/26/b2b-ecommerce-policy',
      'B2B ecommerce market research report',
      'A new B2B ecommerce market research report covers enterprise purchasing.',
      'b2b ecommerce -"India"',
      { excludeLocations: ['India'] },
    );

    expect(textDecision).toEqual({ pass: false, reason: 'excluded_location' });
    expect(hostDecision).toEqual({ pass: false, reason: 'excluded_location' });
  });
});
