import type { AppConfig } from '../../../shared/config';
import { hashString, randomId } from '../../../shared/crypto';
import type { ConnectorResult, ConnectorArticle } from '../types';
import { applyPreFilter } from '../preFilter';

const EVENT_REGISTRY_ENDPOINT = 'https://eventregistry.org/api/v1/article/getArticles';

const pickString = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'object') {
    const candidate = (value as Record<string, unknown>).eng;
    if (typeof candidate === 'string') {
      return candidate.trim() || null;
    }
    const first = Object.values(value as Record<string, unknown>).find((v) => typeof v === 'string' && v.trim());
    return typeof first === 'string' ? first.trim() : null;
  }
  return null;
};

export interface EventRegistryConnectorOptions {
  maxArticles?: number;
  signal?: AbortSignal;
  recencyHours?: number;
}

const normalizeKeywords = (rawQuery: string): string[] => {
  if (!rawQuery) {
    return [];
  }
  const cleaned = rawQuery
    .replace(/[()]/g, ' ')
    .split(/\s+OR\s+/) // treat uppercase OR as operator; lowercase "or" is usually natural language
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => segment.replace(/^"|"$/g, ''))
    .filter(Boolean);

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const keyword of cleaned) {
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(keyword);
  }
  return deduped.slice(0, 15); // EventRegistry basic plans allow up to 15 keywords
};

// More robust normalization that extracts quoted phrases, splits by common OR separators,
// dedupes case-insensitively.
const robustNormalizeKeywords = (rawQuery: string): string[] => {
  if (!rawQuery) return [];

  const input = String(rawQuery).replace(/[()]/g, ' ');

  // Extract quoted phrases first (treat each as a single keyword)
  const phrases: string[] = [];
  const usedRanges: Array<{ start: number; end: number }> = [];
  const quoteRegex = /"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = quoteRegex.exec(input)) !== null) {
    const text = m[1].trim();
    if (text) {
      phrases.push(`"${text}"`);
      usedRanges.push({ start: m.index, end: m.index + m[0].length });
    }
  }

  // Remove quoted segments and split the remainder
  let remainder = '';
  let last = 0;
  for (const r of usedRanges) {
    remainder += input.slice(last, r.start);
    last = r.end;
  }
  remainder += input.slice(last);

  const splitTokens = remainder
    .split(/\s+or\s+|\s+OR\s+|\s*\|\|\s*|\s*\|\s*|\s*,\s*/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const combined = [...phrases, ...splitTokens];
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const k of combined) {
    const key = k.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(k);
  }

  if (deduped.length === 0) {
    const single = input.trim();
    return single ? [single] : [];
  }

  return deduped.slice(0, 15);
};

// Build a keyword list that also respects a total token budget.
// EventRegistry can count individual tokens inside a multi-word keyword toward plan limits.
// We ensure the sum of token counts across keywords does not exceed the budget.
const buildKeywordsWithinBudget = (rawQuery: string, tokenBudget = 15): string[] => {
  // If the input is already a clean phrase (from an array input), preserve it as much as possible
  // without aggressive normalization that strips quotes or stopwords.
  const clean = rawQuery.trim();

  // Simple token count
  const tokens = clean.replace(/['"]/g, '').split(/\s+/).filter(Boolean);

  if (tokens.length <= tokenBudget) {
    return [clean];
  }

  // If it exceeds budget, fall back to robust normalization to try and salvage parts of it
  const base = robustNormalizeKeywords(rawQuery);
  if (base.length === 0) return [];

  const STOPWORDS = new Set([
    'the','and','or','for','with','from','that','this','are','was','were','will','would','could','should',
    'a','an','of','to','in','on','by','at','as','is','it','be','has','have','had','not','but','about','into',
  ]);
  const tokenize = (s: string): string[] =>
    (s.toLowerCase().match(/[a-z0-9]+/g) || []).filter((t) => t.length > 1 && !STOPWORDS.has(t));

  const compressPhrase = (phrase: string, maxTokens = 5): string => {
    // Drop stopwords and just limit length
    const toks = tokenize(phrase);
    if (toks.length === 0) return "";
    return toks.slice(0, maxTokens).join(' ');
  };

  // Prefer first entries (usually quoted phrases), but compress long phrases.
  const candidates: Array<{ text: string; tokens: string[] }> = [];
  for (const kw of base) {
    const isQuoted = kw.startsWith('"') && kw.endsWith('"');
    if (isQuoted) {
      const toks = tokenize(kw);
      if (toks.length === 0) continue;
      candidates.push({ text: kw, tokens: toks });
    } else {
      const compact = compressPhrase(kw, 5).trim();
      const toks = tokenize(compact);
      if (toks.length === 0) continue;
      candidates.push({ text: compact, tokens: toks });
    }
  }

  // De-duplicate by token sets to avoid redundancy.
  const seenSig = new Set<string>();
  const unique: Array<{ text: string; tokens: string[] }> = [];
  for (const c of candidates) {
    const sig = Array.from(new Set(c.tokens)).sort().join('+');
    if (seenSig.has(sig)) continue;
    seenSig.add(sig);
    unique.push(c);
  }

  const result: string[] = [];
  let used = 0;
  for (const c of unique) {
    const cost = c.tokens.length;
    if (cost <= 0) continue;
    if (used + cost > tokenBudget) {
      // Try shrinking to fit 1-2 tokens
      const shrunk = c.tokens.slice(0, Math.max(0, tokenBudget - used));
      if (shrunk.length >= 1) {
        result.push(shrunk.join(' '));
        used += shrunk.length;
      }
      break;
    }
    result.push(c.text);
    used += cost;
    if (used >= tokenBudget) break;
  }

  return result;
};

const isDegenerateKeyword = (value: string): boolean => {
  const text = String(value || '').trim();
  if (!text) return true;
  const lowered = text.toLowerCase();
  if (lowered === 'or' || lowered === 'and' || lowered === 'not') return true;
  // If it's only punctuation or quotes, skip
  if (!/[a-z0-9]/i.test(text)) return true;
  return false;
};

const buildRequestParams = (
  query: string | string[],
  config: AppConfig,
  maxArticles: number,
  keywordBudget: number = 15,
  recencyHoursOverride?: number,
): { params: URLSearchParams; keywordsUsed: number } => {
  const endDate = new Date();
  const recencyHours =
    typeof recencyHoursOverride === 'number' && recencyHoursOverride > 0
      ? recencyHoursOverride
      : config.connectors.eventRegistry.lookbackHours || config.recencyHours;
  const lookbackMs = recencyHours * 60 * 60 * 1000;
  const startDate = new Date(endDate.getTime() - lookbackMs);

  const dateEnd = endDate.toISOString().split('T')[0];
  const dateStart = startDate.toISOString().split('T')[0];

  let keywordPayload: string[];
  if (Array.isArray(query)) {
    // If we already have a list of keywords, ensure we respect the token budget
    // EventRegistry counts tokens (words) across all keywords against the limit
    // We process each keyword individually to preserve structure, but stop when budget is hit
    const result: string[] = [];
    let used = 0;
    
    for (const q of query) {
      // Treat each array item as a distinct phrase/keyword
      const keywords = buildKeywordsWithinBudget(q, keywordBudget - used);
      if (keywords.length > 0) {
        // buildKeywordsWithinBudget returns an array, but for a single input string it's usually 1 item
        // unless it was split. We take what fits.
        for (const k of keywords) {
           const cost = k.split(/\s+/).length; // Rough token count
           if (used + cost <= keywordBudget) {
             result.push(k);
             used += cost;
           }
        }
      }
      if (used >= keywordBudget) break;
    }
    keywordPayload = (result.length > 0 ? result : [query[0].trim()].filter(Boolean)) as string[];
  } else {
    const keywords = buildKeywordsWithinBudget(query, keywordBudget);
    keywordPayload = (keywords.length > 0 ? keywords : [query.trim()].filter(Boolean)) as string[];
  }

  keywordPayload = keywordPayload.map((k) => String(k || '').trim()).filter((k) => !isDegenerateKeyword(k));

  const params = new URLSearchParams();

  const addArray = (key: string, values: string[]) => {
    values.forEach((value) => params.append(key, value));
  };

  params.set('apiKey', String(config.connectors.eventRegistry.apiKey || '').trim());
  params.set('resultType', 'articles');
  addArray('keyword', keywordPayload);
  params.set('keywordLoc', 'body,title');
  addArray('lang', ['eng']);
  addArray('dataType', ['news']);
  params.set('dateStart', dateStart);
  params.set('dateEnd', dateEnd);
  params.set('articlesPage', '1');
  params.set('articlesCount', String(maxArticles));
  params.set('articlesSortBy', 'date');
  params.set('articlesSortByAsc', 'false');
  params.set('articleBodyLen', '-1');
  params.set('includeArticleTitle', 'true');
  params.set('includeArticleBasicInfo', 'true');
  params.set('includeArticleBody', 'true');
  params.set('includeArticleSentiment', 'true');
  params.set('includeArticleCategories', 'true');
  params.set('includeArticleConcepts', 'true');

  if (Array.isArray(keywordPayload)) {
    params.set('keywordOper', 'or');
  }

  return { params, keywordsUsed: keywordPayload.length };
};

export const fetchEventRegistryCandidates = async (
  query: string | string[],
  config: AppConfig,
  options: EventRegistryConnectorOptions = {},
): Promise<ConnectorResult> => {
  const rawQueryString = Array.isArray(query) ? query.join(' OR ') : query;

  if (!config.connectors.eventRegistry.enabled) {
    return {
      provider: 'eventregistry',
      fetchedAt: new Date().toISOString(),
      query: rawQueryString,
      items: [],
      metrics: { disabled: true },
    };
  }

  const apiKey = config.connectors.eventRegistry.apiKey;
  if (!apiKey) {
    return {
      provider: 'eventregistry',
      fetchedAt: new Date().toISOString(),
      query: rawQueryString,
      items: [],
      metrics: { disabled: true },
    };
  }

  const keywords = Array.isArray(query) ? query : normalizeKeywords(query);
  if (!keywords.length) {
    return {
      provider: 'eventregistry',
      fetchedAt: new Date().toISOString(),
      query: rawQueryString,
      items: [],
      metrics: { emptyQuery: true },
    };
  }

  const maxArticles = Math.min(Math.max(options.maxArticles ?? config.connectors.eventRegistry.maxEvents ?? 25, 1), 100);
  const controller = new AbortController();
  let abortListener: (() => void) | null = null;
  if (options.signal) {
    if (options.signal.aborted) {
      throw new Error('Aborted');
    }
    abortListener = () => controller.abort();
    options.signal.addEventListener('abort', abortListener, { once: true });
  }

  try {
    const budgets = [15, 12, 10, 8];
    let lastErr: any = null;
    for (const budget of budgets) {
      const { params, keywordsUsed } = buildRequestParams(
        query,
        config,
        maxArticles,
        budget,
        options.recencyHours,
      );

      try {
        const response = await fetch(`${EVENT_REGISTRY_ENDPOINT}?${params.toString()}`, {
          method: 'GET',
          signal: controller.signal,
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`EventRegistry request failed: ${response.status} ${response.statusText} ${text}`);
        }

        const rawText = await response.text();
        let data: { articles?: { results?: Array<Record<string, unknown>> }; error?: unknown } | null = null;
        try {
          data = rawText ? (JSON.parse(rawText) as typeof data) : { articles: { results: [] } };
        } catch (err) {
          const snippet = rawText?.slice(0, 2000) ?? '';
          throw new Error(
            `EventRegistry JSON parse failed: ${String(err)}; rawLength=${rawText?.length ?? 0}; snippet=${snippet}`,
          );
        }

        if (data?.error) {
          const msg = typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
          if (msg && msg.toLowerCase().includes('too many keywords')) {
            lastErr = new Error(`EventRegistry responded with error: ${msg}`);
            continue;
          }
          throw new Error(`EventRegistry responded with error: ${msg}`);
        }

        const rawResults = data?.articles?.results ?? [];

        const items: ConnectorArticle[] =
          rawResults.map((raw) => {
            const article = raw as Record<string, unknown>;
            const urlRaw = (article as any).url ?? (article as any).uri ?? '';
            const url = String(urlRaw || '').trim();
            const source = (article as any)?.source;
            const sourceTitle = (article as any)?.sourceTitle;
            const sourceValue = (article as any)?.source;
            const title =
              pickString(
                (article as any).title ??
                  (article as any).titleEng ??
                  (article as any).titleShort ??
                  (article as any).titleFull,
              ) || url;
            
            let snippet =
              pickString((article as any).summary) ||
              pickString((article as any).description) ||
              pickString((article as any).snippet) ||
              null;
            if (!snippet) {
              const bodyText = pickString((article as any).body) || pickString((article as any).articleBody) || null;
              if (bodyText) {
                snippet = bodyText.slice(0, 800);
              }
            }
            const candidate: ConnectorArticle = {
              id: hashString(url || randomId()),
              title,
              url,
              sourceName:
                pickString(
                  source?.title ??
                    source?.name ??
                    (sourceTitle as string | undefined) ??
                    (sourceValue as string | undefined),
                ) ?? null,
              publishedAt:
                ((article as any).date ||
                  (article as any).dateTime ||
                  (article as any).dateTimePub ||
                  null),
              snippet,
              providerData: article,
            };

            if (!candidate.url) {
              return null;
            }

            const decision = applyPreFilter(candidate.url, candidate.title, candidate.snippet ?? null, rawQueryString);
            if (!decision.pass) {
              return null;
            }

            return candidate;
          }).filter((value): value is ConnectorArticle => Boolean(value));

        const metrics: Record<string, unknown> = {
          returned: items.length,
          keywordBudget: budget,
          keywordsUsed,
        };
        try {
          metrics.rawReturned = rawResults.length;
          if (rawResults.length > 0) {
            metrics.firstRawSnippet = JSON.stringify(rawResults[0]).slice(0, 2000);
          }
        } catch (e) {
          // ignore snippet errors
        }

        return {
          provider: 'eventregistry',
          fetchedAt: new Date().toISOString(),
          query: rawQueryString,
          items,
          metrics,
        };
      } catch (err) {
        const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
        if (msg.includes('too many keywords')) {
          lastErr = err;
          continue; // try with smaller budget
        }
        throw err;
      }
    }

    if (lastErr) {
      throw lastErr;
    }

    throw new Error('EventRegistry request failed unexpectedly');
  } finally {
    if (abortListener && options.signal) {
      options.signal.removeEventListener('abort', abortListener);
    }
  }
};

