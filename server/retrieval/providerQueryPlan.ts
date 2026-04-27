import { buildQueryIntent, type QueryIntent } from './queryIntent';
import { normalizeEventRegistryKeywords } from './queryUtils';

export interface ProviderQueryPlan {
  main: string;
  google: string[];
  googlenews: string[];
  newsapi: string[];
  eventregistry: string[];
}

const quote = (value: string): string => `"${value.replace(/^"+|"+$/g, '').trim()}"`;

const unique = (values: string[], max: number): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const clean = value.replace(/\s+/g, ' ').trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= max) break;
  }
  return out;
};

const renderOrGroup = (values: string[]): string => values.map(quote).join(' OR ');

const anchorsFor = (intent: QueryIntent): string[] => {
  const anchors = unique([...intent.subjectPhrases, ...intent.requiredEntities], 6);
  if (anchors.length) return anchors;
  return unique([intent.originalTopic], 1);
};

const facetsFor = (intent: QueryIntent): string[] => unique(intent.facets, 6);

const renderGoogleQueries = (anchors: string[], facets: string[]): string[] => {
  const anchorGroup = renderOrGroup(anchors);
  if (!facets.length) return [anchorGroup];
  const facetGroup = renderOrGroup(facets);
  return unique([`(${anchorGroup}) (${facetGroup})`, anchorGroup], 3);
};

const renderGoogleNewsQueries = (anchors: string[], facets: string[]): string[] => {
  const anchorGroup = renderOrGroup(anchors);
  const variants = [anchorGroup];
  if (facets.length) {
    variants.push(`(${anchorGroup}) (${renderOrGroup(facets.slice(0, 3))})`);
  }
  return unique(variants, 3);
};

const renderNewsApiQueries = (anchors: string[], facets: string[]): string[] => {
  const anchorGroup = renderOrGroup(anchors);
  if (!facets.length) return [anchorGroup];
  const facetGroup = renderOrGroup(facets);
  return unique([`(${anchorGroup}) AND (${facetGroup})`, anchorGroup], 3);
};

export const buildProviderQueryPlan = (intentOrTopic: QueryIntent | string): ProviderQueryPlan => {
  const intent = typeof intentOrTopic === 'string' ? buildQueryIntent(intentOrTopic) : intentOrTopic;
  const anchors = anchorsFor(intent);
  const facets = facetsFor(intent);
  const main = anchors.length ? anchors[0] : intent.originalTopic;

  return {
    main,
    google: renderGoogleQueries(anchors, facets),
    googlenews: renderGoogleNewsQueries(anchors, facets),
    newsapi: renderNewsApiQueries(anchors, facets),
    eventregistry: normalizeEventRegistryKeywords([...anchors, ...facets], { maxTerms: 12 }),
  };
};
