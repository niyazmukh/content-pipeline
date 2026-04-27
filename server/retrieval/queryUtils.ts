export const BASE_STOPWORDS = new Set([
  'the',
  'and',
  'or',
  'for',
  'with',
  'from',
  'that',
  'this',
  'are',
  'was',
  'were',
  'will',
  'would',
  'could',
  'should',
  'a',
  'an',
  'of',
  'to',
  'in',
  'on',
  'by',
  'at',
  'as',
  'is',
  'it',
  'be',
  'has',
  'have',
  'had',
  'not',
  'but',
  'about',
  'into',
  'latest',
  'recent',
  'news',
  'update',
  'updates',
  'trend',
  'trends',
  'insights',
  'insight',
  'report',
  'reports',
  'analysis',
  'overview',
  'best',
  'top',
  'new',
  'breaking',
  'daily',
  'weekly',
  'monthly',
  'today',
  'focus',
  'focused',
  'notable',
]);

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

const dedupe = (tokens: string[], maxTokens: number): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of tokens) {
    const key = token.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(token);
    if (out.length >= maxTokens) break;
  }
  return out;
};

const expandHyphenVariants = (token: string): string[] => {
  const cleaned = token.trim();
  if (!cleaned) return [];
  if (!cleaned.includes('-')) return [cleaned];
  const parts = cleaned.split('-').map((p) => p.trim()).filter(Boolean);
  const joined = parts.join('');
  return [cleaned, joined, ...parts].filter(Boolean);
};

export const tokenizeForRelevance = (input: string, options: { maxTokens?: number } = {}): string[] => {
  const maxTokens = Math.max(1, Math.min(options.maxTokens ?? 24, 128));
  const raw = tokenize(input);

  const expanded = raw.flatMap(expandHyphenVariants);
  const filtered = expanded
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !BASE_STOPWORDS.has(t));

  const primary = dedupe(filtered, maxTokens);
  if (primary.length) {
    return primary;
  }

  // Fallback: if the query is mostly stopwords, keep a few tokens so the pipeline can still run.
  const fallback = dedupe(raw.filter((t) => t.length > 1), maxTokens);
  return fallback;
};

const cleanSegment = (segment: string, maxTokens: number): string | null => {
  const tokens = tokenize(segment);
  if (!tokens.length) {
    return null;
  }
  const filtered = tokens.filter((token) => !BASE_STOPWORDS.has(token));
  const chosen = dedupe(filtered.length ? filtered : tokens, maxTokens);
  const value = chosen.join(' ').trim();
  return value.length ? value : null;
};

const DOMAIN_PHRASES = [
  ['b2b', 'ecommerce'],
  ['b2b', 'e-commerce'],
  ['market', 'research'],
  ['case', 'study'],
  ['case', 'studies'],
] as const;

const extractDomainPhrases = (input: string, maxTerms: number): string[] => {
  const normalized = input.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ');
  const out: string[] = [];
  const seen = new Set<string>();

  for (const phrase of DOMAIN_PHRASES) {
    const pattern = new RegExp(`\\b${phrase.map((part) => part.replace('-', '[-\\s]?')).join('\\s+')}\\b`, 'i');
    if (!pattern.test(normalized)) continue;
    const text = phrase.join(' ');
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= maxTerms) return out;
  }

  return out;
};

const splitQuerySegments = (raw: string): string[] => {
  if (!raw) return [];
  const segments: string[] = [];

  const quoteRegex = /"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = quoteRegex.exec(raw)) !== null) {
    const text = match[1].trim();
    if (text) {
      segments.push(text);
    }
  }

  const remainder = raw.replace(/"[^"]+"/g, ' ');
  remainder
    .split(/\s+OR\s+|\s+or\s+|,\s*|\s*\|\|\s*|\s*\|\s*/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      // Extra splitting for common "two-topic" phrasing in natural language.
      // This helps fallbacks build sensible OR queries when the LLM rewrite fails.
      const further = part
        .split(/\bwith (?:a )?(?:hint|touch|dash|sprinkle) of\b/gi)
        .flatMap((chunk) => chunk.split(/\bversus\b|\bvs\.?\b/gi))
        .map((s) => s.trim())
        .filter(Boolean);
      if (further.length) {
        segments.push(...further);
      } else {
        segments.push(part);
      }
    });

  if (!segments.length) {
    segments.push(raw.trim());
  }

  return segments;
};

export const deriveLooseTerms = (
  query: string,
  options: { maxTerms?: number; maxTokensPerTerm?: number } = {},
): string[] => {
  const { maxTerms = 6, maxTokensPerTerm = 4 } = options;
  if (!query) return [];

  const segments = splitQuerySegments(query);
  const seen = new Set<string>();
  const results: string[] = extractDomainPhrases(query, maxTerms);
  results.forEach((term) => seen.add(term.toLowerCase()));

  for (const segment of segments) {
    const cleaned = cleanSegment(segment, maxTokensPerTerm);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(cleaned);
    if (results.length >= maxTerms) break;
  }

  if (!results.length) {
    const fallback = cleanSegment(query, maxTokensPerTerm);
    if (fallback) {
      results.push(fallback);
    }
  }

  return results;
};

const looksExactPhrase = (term: string): boolean => {
  // Keep quotes for likely proper nouns/acronyms, otherwise prefer broader matching.
  if (/[A-Z]{2,}/.test(term)) return true;
  if (/\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/.test(term)) return true;
  return false;
};

const quoteTerm = (term: string): string => {
  const clean = term.replace(/^"+|"+$/g, '').trim();
  return clean ? `"${clean}"` : '';
};

export const normalizeGoogleLikeQuery = (input: string, options: { maxTerms?: number } = {}): string => {
  const maxTerms = Math.max(2, Math.min(options.maxTerms ?? 6, 10));
  const terms = deriveLooseTerms(input, { maxTerms, maxTokensPerTerm: 4 });
  if (!terms.length) return String(input || '').trim();

  const normalized = terms.map(quoteTerm).filter(Boolean);

  if (!normalized.length) return String(input || '').trim();
  if (normalized.length === 1) return normalized[0];
  return normalized.join(' OR ');
};

export const normalizeNewsApiQuery = (input: string, options: { maxTerms?: number } = {}): string => {
  const maxTerms = Math.max(2, Math.min(options.maxTerms ?? 6, 10));
  const terms = deriveLooseTerms(input, { maxTerms, maxTokensPerTerm: 5 });
  if (!terms.length) return String(input || '').trim();

  const normalized = terms
    .map(quoteTerm)
    .filter(Boolean);

  if (!normalized.length) return String(input || '').trim();
  if (normalized.length === 1) return normalized[0];
  return normalized.join(' OR ');
};

export const normalizeEventRegistryKeywords = (input: string | string[], options: { maxTerms?: number } = {}): string[] => {
  const maxTerms = Math.max(3, Math.min(options.maxTerms ?? 8, 15));
  const raw = Array.isArray(input) ? input : [input];
  const out: string[] = [];
  const seen = new Set<string>();

  for (const segment of raw) {
    const terms = deriveLooseTerms(String(segment || ''), { maxTerms, maxTokensPerTerm: 4 });
    for (const term of terms) {
      const clean = term.replace(/^"+|"+$/g, '').trim();
      if (!clean) continue;
      const key = clean.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(clean);
      if (out.length >= maxTerms) {
        return out;
      }
    }
  }

  if (out.length) return out;
  const fallback = raw.map((value) => String(value || '').trim()).filter(Boolean);
  return fallback.slice(0, maxTerms);
};

