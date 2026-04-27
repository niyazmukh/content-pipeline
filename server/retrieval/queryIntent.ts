import { BASE_STOPWORDS } from './queryUtils';

export interface QueryIntent {
  originalTopic: string;
  subjectPhrases: string[];
  requiredEntities: string[];
  facets: string[];
  excludeTerms: string[];
}

const INSTRUCTION_WORDS = new Set([
  ...BASE_STOPWORDS,
  'focus',
  'focused',
  'notable',
  'include',
  'including',
  'cover',
  'covering',
  'especially',
]);

const FACET_SYNONYMS = new Map<string, string>([
  ['market research', 'market research'],
  ['report', 'reports'],
  ['reports', 'reports'],
  ['regulation', 'regulation'],
  ['regulatory', 'regulation'],
  ['case study', 'case studies'],
  ['case studies', 'case studies'],
  ['acquisition', 'acquisitions'],
  ['acquisitions', 'acquisitions'],
  ['export control', 'export control'],
  ['export controls', 'export control'],
]);

const normalizePhrase = (value: string): string => value.toLowerCase().replace(/\s+/g, ' ').trim();

const knownFacetFor = (value: string): string | null => {
  const normalized = normalizePhrase(value);
  for (const [needle, facet] of FACET_SYNONYMS.entries()) {
    if (normalizePhrase(needle) === normalized) return facet;
  }
  return null;
};

const DOMAIN_PHRASE_PATTERNS: Array<{ pattern: RegExp; phrases: string[] }> = [
  { pattern: /\bb2b\s+e-?commerce\b/i, phrases: ['b2b ecommerce', 'b2b e-commerce'] },
  { pattern: /\bai\s+chips?\b/i, phrases: ['ai chip'] },
];

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

const addUnique = (target: string[], value: string, max = 12) => {
  const clean = value.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!clean || target.includes(clean) || target.length >= max) return;
  target.push(clean);
};

const extractQuotedPhrases = (topic: string): string[] => {
  const out: string[] = [];
  const quoteRegex = /"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = quoteRegex.exec(topic)) !== null) {
    addUnique(out, match[1], 8);
  }
  return out;
};

const extractEntities = (topic: string): string[] => {
  const entities: string[] = [];
  const slashPairs = topic.match(/\b[A-Z][A-Za-z0-9]+(?:\/[A-Z][A-Za-z0-9]+)+\b/g) ?? [];
  for (const pair of slashPairs) {
    pair.split('/').forEach((part) => addUnique(entities, part, 8));
  }

  const acronyms = topic.match(/\b[A-Z]{2,}(?:[A-Z0-9-]*[A-Z0-9])?\b/g) ?? [];
  for (const acronym of acronyms) {
    if (acronym.toLowerCase() === 'or') continue;
    addUnique(entities, acronym, 8);
  }

  return entities;
};

const extractDomainPhrases = (topic: string): string[] => {
  const phrases: string[] = [];
  for (const entry of DOMAIN_PHRASE_PATTERNS) {
    if (!entry.pattern.test(topic)) continue;
    entry.phrases.forEach((phrase) => addUnique(phrases, phrase, 10));
  }
  return phrases;
};

const extractFacets = (topic: string, subjects: string[], entities: string[]): string[] => {
  const facets: string[] = [];
  const lower = topic.toLowerCase();

  for (const [needle, normalized] of FACET_SYNONYMS.entries()) {
    const pattern = new RegExp(`\\b${needle.replace(/\s+/g, '\\s+')}\\b`, 'i');
    if (pattern.test(lower)) addUnique(facets, normalized, 10);
  }

  const blocked = new Set([...subjects, ...entities, ...facets].flatMap((value) => tokenize(value)));
  const tokens = tokenize(topic);
  for (const token of tokens) {
    if (token.length < 3) continue;
    if (INSTRUCTION_WORDS.has(token) || blocked.has(token)) continue;
    addUnique(facets, token, 10);
  }

  return facets;
};

const deriveFallbackSubject = (topic: string): string[] => {
  const tokens = tokenize(topic).filter((token) => token.length > 1 && !INSTRUCTION_WORDS.has(token));
  if (!tokens.length) return [];
  return [tokens.slice(0, Math.min(2, tokens.length)).join(' ')];
};

export const buildQueryIntent = (topic: string): QueryIntent => {
  const originalTopic = String(topic || '').trim();
  const quoted = extractQuotedPhrases(originalTopic);
  const domainPhrases = extractDomainPhrases(originalTopic);
  let requiredEntities = extractEntities(originalTopic);

  const subjectPhrases = [...domainPhrases];
  quoted.forEach((phrase) => {
    if (knownFacetFor(phrase)) return;
    addUnique(subjectPhrases, phrase, 10);
  });
  if (!subjectPhrases.length) {
    deriveFallbackSubject(originalTopic).forEach((phrase) => addUnique(subjectPhrases, phrase, 10));
  }
  const subjectTokens = new Set(subjectPhrases.flatMap(tokenize));
  requiredEntities = requiredEntities.filter((entity) => {
    const tokens = tokenize(entity);
    return !(tokens.length === 1 && subjectTokens.has(tokens[0]));
  });

  const facets = extractFacets(originalTopic, subjectPhrases, requiredEntities);

  return {
    originalTopic,
    subjectPhrases,
    requiredEntities,
    facets,
    excludeTerms: [],
  };
};
