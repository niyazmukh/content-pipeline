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

const exclusionsFor = (intent: QueryIntent): string[] =>
  unique([...intent.excludeEntities, ...intent.excludeLocations, ...intent.excludeTerms], 8);

const renderGoogleExclusions = (exclusions: string[]): string =>
  exclusions.length ? ` ${exclusions.map((value) => `-${quote(value)}`).join(' ')}` : '';

const renderNewsApiExclusions = (exclusions: string[]): string =>
  exclusions.length ? ` AND NOT (${renderOrGroup(exclusions)})` : '';

const renderGoogleQueries = (anchors: string[], facets: string[], exclusions: string[]): string[] => {
  const anchorGroup = renderOrGroup(anchors);
  const negative = renderGoogleExclusions(exclusions);
  if (!facets.length) return [`${anchorGroup}${negative}`];
  const facetGroup = renderOrGroup(facets);
  return unique([`(${anchorGroup}) (${facetGroup})${negative}`, `${anchorGroup}${negative}`], 3);
};

const renderGoogleNewsQueries = (anchors: string[], facets: string[], exclusions: string[]): string[] => {
  const anchorGroup = renderOrGroup(anchors);
  const negative = renderGoogleExclusions(exclusions);
  const variants = [`${anchorGroup}${negative}`];
  if (facets.length) {
    variants.push(`(${anchorGroup}) (${renderOrGroup(facets.slice(0, 3))})${negative}`);
  }
  return unique(variants, 3);
};

const renderNewsApiQueries = (anchors: string[], facets: string[], exclusions: string[]): string[] => {
  const anchorGroup = renderOrGroup(anchors);
  const negative = renderNewsApiExclusions(exclusions);
  if (!facets.length) return [`${anchorGroup}${negative}`];
  const facetGroup = renderOrGroup(facets);
  return unique([`(${anchorGroup}) AND (${facetGroup})${negative}`, `(${anchorGroup})${negative}`], 3);
};

export const buildProviderQueryPlan = (intentOrTopic: QueryIntent | string): ProviderQueryPlan => {
  const intent = typeof intentOrTopic === 'string' ? buildQueryIntent(intentOrTopic) : intentOrTopic;
  const anchors = anchorsFor(intent);
  const facets = facetsFor(intent);
  const exclusions = exclusionsFor(intent);
  const main = anchors.length ? anchors[0] : intent.originalTopic;

  return {
    main,
    google: renderGoogleQueries(anchors, facets, exclusions),
    googlenews: renderGoogleNewsQueries(anchors, facets, exclusions),
    newsapi: renderNewsApiQueries(anchors, facets, exclusions),
    eventregistry: normalizeEventRegistryKeywords([...anchors, ...facets], { maxTerms: 12 }),
  };
};
