const BASE_STOPWORDS = new Set([
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
]);

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

const cleanSegment = (segment: string, maxTokens: number): string | null => {
  const tokens = tokenize(segment);
  if (!tokens.length) {
    return null;
  }
  const filtered = tokens.filter((token) => !BASE_STOPWORDS.has(token));
  const dedupe = (input: string[]) => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const token of input) {
      if (seen.has(token)) continue;
      seen.add(token);
      out.push(token);
      if (out.length >= maxTokens) break;
    }
    return out;
  };

  const chosen = dedupe(filtered.length ? filtered : tokens);
  const value = chosen.join(' ').trim();
  return value.length ? value : null;
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
  const results: string[] = [];

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

export const buildLooseQueryString = (
  query: string,
  options: { maxTerms?: number; maxTokensPerTerm?: number; wrapMultiWord?: boolean } = {},
): string => {
  const { maxTerms = 6, maxTokensPerTerm = 4, wrapMultiWord = true } = options;
  const terms = deriveLooseTerms(query, { maxTerms, maxTokensPerTerm });
  if (!terms.length) {
    return query.replace(/"/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return terms
    .map((term) => {
      const trimmed = term.trim();
      if (!trimmed) return '';
      if (!wrapMultiWord || !/\s/.test(trimmed)) {
        return trimmed;
      }
      return `"${trimmed}"`;
    })
    .filter(Boolean)
    .join(' OR ');
};

