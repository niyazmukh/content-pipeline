import { describe, expect, it } from 'vitest';
import { buildProviderQueryPlan } from '../providerQueryPlan';
import { buildQueryIntent } from '../queryIntent';

const b2bTopic =
  'Top B2B ecommerce news (focus on market research and reports, regulation, notable case studies and acquisitions).';

describe('query intent and provider query planning', () => {
  it('extracts anchored subject phrases and clean facets from natural-language topics', () => {
    const intent = buildQueryIntent(b2bTopic);

    expect(intent.subjectPhrases).toContain('b2b ecommerce');
    expect(intent.subjectPhrases).toContain('b2b e-commerce');
    expect(intent.facets).toEqual(expect.arrayContaining(['market research', 'reports', 'regulation', 'case studies', 'acquisitions']));
    expect(intent.facets).not.toContain('focus');
    expect(intent.facets).not.toContain('notable');
  });

  it('renders provider-specific anchored variants without unanchored generic OR terms', () => {
    const plan = buildProviderQueryPlan(buildQueryIntent(b2bTopic));

    expect(plan.newsapi[0]).toBe(
      '("b2b ecommerce" OR "b2b e-commerce") AND ("market research" OR "reports" OR "regulation" OR "case studies" OR "acquisitions")',
    );
    expect(plan.google[0]).toBe(
      '("b2b ecommerce" OR "b2b e-commerce") ("market research" OR "reports" OR "regulation" OR "case studies" OR "acquisitions")',
    );
    expect(plan.googlenews[0]).toBe('"b2b ecommerce" OR "b2b e-commerce"');
    expect(plan.eventregistry).toEqual(expect.arrayContaining(['b2b ecommerce', 'b2b e-commerce']));
    expect(plan.eventregistry).not.toContain('regulation');
    expect(plan.eventregistry).not.toContain('acquisitions');
  });

  it('does not promote quoted facet phrases from LLM boolean queries into anchors', () => {
    const intent = buildQueryIntent('"b2b ecommerce" OR "b2b e-commerce" OR "case studies"');
    const plan = buildProviderQueryPlan(intent);

    expect(intent.subjectPhrases).toEqual(['b2b ecommerce', 'b2b e-commerce']);
    expect(intent.facets).toContain('case studies');
    expect(plan.googlenews[0]).toBe('"b2b ecommerce" OR "b2b e-commerce"');
    expect(plan.googlenews[0]).not.toContain('case studies');
    expect(plan.newsapi[0]).toBe('("b2b ecommerce" OR "b2b e-commerce") AND ("case studies")');
  });

  it('uses LLM-provided core terms as anchors while keeping original-topic facets', () => {
    const intent = buildQueryIntent(
      'Top B2B ecommerce news (focus on market research and reports, regulation, notable case studies and acquisitions).',
      { coreTerms: ['b2b ecommerce', 'b2b e-commerce'] },
    );
    const plan = buildProviderQueryPlan(intent);

    expect(intent.subjectPhrases).toEqual(['b2b ecommerce', 'b2b e-commerce']);
    expect(intent.facets).toEqual(expect.arrayContaining(['market research', 'regulation', 'case studies', 'acquisitions']));
    expect(plan.googlenews[0]).toBe('"b2b ecommerce" OR "b2b e-commerce"');
    expect(plan.googlenews[0]).not.toContain('case studies');
    expect(plan.newsapi[0]).toContain('AND');
    expect(plan.newsapi[0]).toContain('"case studies"');
  });

  it('handles another domain without hard-coding B2B ecommerce as the only anchor', () => {
    const intent = buildQueryIntent('Top AI chip export control news, focus on regulation and Nvidia/AMD case studies.');
    const plan = buildProviderQueryPlan(intent);

    expect(intent.subjectPhrases).toContain('ai chip');
    expect(intent.requiredEntities).toEqual(expect.arrayContaining(['nvidia', 'amd']));
    expect(plan.newsapi[0]).toContain('("ai chip" OR "nvidia" OR "amd") AND');
    expect(plan.newsapi[0]).toContain('"export control"');
    expect(plan.googlenews[0]).toBe('"ai chip" OR "nvidia" OR "amd"');
  });

  it('keeps explicit negative constraints out of positive facets and renders provider exclusions', () => {
    const intent = buildQueryIntent(
      'Top B2B ecommerce news (focus on market research and regulation), ignore company BigCommerce and ignore news from India.',
    );
    const plan = buildProviderQueryPlan(intent);

    expect(intent.subjectPhrases).toEqual(['b2b ecommerce', 'b2b e-commerce']);
    expect(intent.excludeEntities).toContain('bigcommerce');
    expect(intent.excludeLocations).toContain('india');
    expect(intent.facets).not.toContain('bigcommerce');
    expect(intent.facets).not.toContain('india');
    expect(plan.google.join(' ')).not.toContain('-"bigcommerce"');
    expect(plan.google.join(' ')).not.toContain('-"india"');
    expect(plan.googlenews.join(' ')).not.toContain('-"bigcommerce"');
    expect(plan.newsapi.join(' ')).not.toContain('AND NOT ("bigcommerce" OR "india")');
    expect(plan.eventregistry).not.toContain('bigcommerce');
    expect(plan.eventregistry).not.toContain('india');
  });

  it('keeps original-topic facets when LLM core terms and colon-list exclusions are present', () => {
    const intent = buildQueryIntent(
      'Top B2B ecommerce news (focus on market research and reports, regulation, notable case studies and acquisitions). Ignore companies: BigCommerce, OroCommerce, Shopify. Ignore countries: India, Bangladesh, Pakistan.',
      { coreTerms: ['b2b ecommerce news', 'b2b ecommerce', 'b2b e-commerce'] },
    );
    const plan = buildProviderQueryPlan(intent);

    expect(intent.subjectPhrases).toEqual(['b2b ecommerce news', 'b2b ecommerce', 'b2b e-commerce']);
    expect(intent.facets).toEqual(expect.arrayContaining(['market research', 'reports', 'regulation', 'case studies', 'acquisitions']));
    expect(intent.excludeEntities).toEqual(expect.arrayContaining(['bigcommerce', 'orocommerce', 'shopify']));
    expect(intent.excludeLocations).toEqual(expect.arrayContaining(['india', 'bangladesh', 'pakistan']));
    expect(plan.google[0]).toContain('("b2b ecommerce news" OR "b2b ecommerce" OR "b2b e-commerce")');
    expect(plan.google[0]).toContain('("market research" OR "reports" OR "regulation" OR "case studies" OR "acquisitions")');
    expect(plan.google).toContain(
      '("b2b ecommerce news" OR "b2b ecommerce" OR "b2b e-commerce") ("market report" OR "market research" OR "report")',
    );
    expect(plan.newsapi[0]).toContain('AND ("market research" OR "reports" OR "regulation" OR "case studies" OR "acquisitions")');
    expect(plan.eventregistry).toEqual(expect.arrayContaining(['b2b ecommerce', 'b2b e-commerce']));
    expect(plan.eventregistry).not.toContain('regulation');
    expect(plan.eventregistry).not.toContain('acquisitions');
  });
});
