import type { AppConfig } from '../../../shared/config';
import { hashString, randomId } from '../../../shared/crypto';
import type { ConnectorResult, ConnectorArticle } from '../types';
import { applyPreFilter } from '../preFilter';
import { deriveLooseTerms } from '../queryUtils';
import type { QueryExclusions } from '../exclusions';

const NEWS_API_ENDPOINT = 'https://newsapi.org/v2/everything';

export interface NewsApiConnectorOptions {
  maxPages?: number;
  pageSize?: number;
  signal?: AbortSignal;
  recencyHours?: number;
  exclusions?: QueryExclusions;
  domains?: string[];
  excludeDomains?: string[];
  searchIn?: Array<'title' | 'description' | 'content'>;
  sortBy?: 'relevancy' | 'popularity' | 'publishedAt';
  minResultsBeforeFallback?: number;
}

const trunc = (value: string | null | undefined) =>
  value == null ? null : value.length > 600 ? `${value.slice(0, 597)}...` : value;

export const fetchNewsApiCandidates = async (
  query: string | string[],
  config: AppConfig,
  options: NewsApiConnectorOptions = {},
): Promise<ConnectorResult> => {
  const inputVariants = (Array.isArray(query) ? query : [query])
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const fallbackInput = inputVariants[0] || '';
  // Only sanitize if it looks like a raw natural language query (no operators)
  const isStructured = (value: string) => /\b(AND|OR|NOT)\b/.test(value);
  
  const sanitizeForNewsApi = (value: string, structured = isStructured(value)): string => {
    if (structured) return value.trim();
    return value
      .replace(/["]/g, ' ')
      .replace(/[^a-z0-9\s-]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  if (!config.connectors.newsApi.enabled) {
    return {
      provider: 'newsapi',
      fetchedAt: new Date().toISOString(),
      query: fallbackInput,
      items: [],
      metrics: { disabled: true },
    };
  }

  const apiKey = config.connectors.newsApi.apiKey;
  if (!apiKey) {
    return {
      provider: 'newsapi',
      fetchedAt: new Date().toISOString(),
      query: fallbackInput,
      items: [],
      metrics: { disabled: true },
    };
  }

  const pageSize = Math.min(Math.max(options.pageSize ?? config.connectors.newsApi.pageSize ?? 20, 1), 100);
  const maxPages = Math.min(Math.max(options.maxPages ?? 2, 1), 5);
  const minResultsBeforeFallback = Math.min(Math.max(options.minResultsBeforeFallback ?? 4, 1), 25);

  const recencyHours = options.recencyHours ?? config.recencyHours;
  const from = new Date(Date.now() - recencyHours * 60 * 60 * 1000).toISOString();
  const to = new Date().toISOString();

  const controller = new AbortController();
  let abortListener: (() => void) | null = null;
  if (options.signal) {
    if (options.signal.aborted) {
      throw new Error('Aborted');
    }
    abortListener = () => controller.abort();
    options.signal.addEventListener('abort', abortListener, { once: true });
  }

  const normalizeDomains = (domains: string[] | undefined): string | null => {
    const cleaned = Array.from(
      new Set(
        (domains || [])
          .map((domain) => domain.trim().toLowerCase())
          .filter((domain) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)),
      ),
    );
    return cleaned.length ? cleaned.slice(0, 20).join(',') : null;
  };

  const attemptFetch = async (searchQuery: string) => {
    const items: ConnectorArticle[] = [];
    let rawReturned = 0;
    let page = 1;
    while (page <= maxPages) {
      const params = new URLSearchParams({
        q: searchQuery.slice(0, 500),
        searchIn: (options.searchIn?.length ? options.searchIn : ['title', 'description']).join(','),
        sortBy: options.sortBy ?? 'relevancy',
        language: 'en',
        pageSize: pageSize.toString(),
        page: page.toString(),
        from,
        to,
      });
      const domains = normalizeDomains(options.domains);
      if (domains) {
        params.set('domains', domains);
      }
      const excludeDomains = normalizeDomains(options.excludeDomains);
      if (excludeDomains) {
        params.set('excludeDomains', excludeDomains);
      }

      const response = await fetch(`${NEWS_API_ENDPOINT}?${params.toString()}`, {
        method: 'GET',
        headers: {
          'X-Api-Key': apiKey,
          // NewsAPI rejects anonymous requests without a User-Agent.
          'User-Agent': config.retrieval.userAgent || 'content-pipeline/1.0',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`NewsAPI request failed: ${response.status} ${response.statusText} ${text}`);
      }

      const data = (await response.json()) as {
        status: string;
        totalResults?: number;
        articles?: Array<Record<string, any>>;
      };
      const pageItems = (data.articles || [])
        .map((article) => {
          const url = String(article.url || '').trim();
          const title = trunc(article.title) || url;
          const snippet = trunc(article.description || article.content || null);
          return {
            id: hashString(url || randomId()),
            title,
            url,
            sourceName: article.source?.name ?? null,
            publishedAt: article.publishedAt || null,
            snippet,
            providerData: article,
          } satisfies ConnectorArticle;
        })
        .filter((article) => Boolean(article.url));
      rawReturned += pageItems.length;

      const filteredPageItems = pageItems.filter((article) => {
        const decision = applyPreFilter(article.url, article.title, article.snippet ?? null, searchQuery, options.exclusions);
        return decision.pass;
      });

      items.push(...filteredPageItems);

      if (!data.totalResults || items.length >= data.totalResults) {
        break;
      }

      page += 1;
    }
    return {
      items,
      pagesFetched: Math.min(page, maxPages),
      rawReturned,
      query: searchQuery,
    };
  };

  const buildQueryVariants = (rawQuery: string): string[] => {
    let primaryQuery: string;
    let fallbackQuery: string;
    const structured = isStructured(rawQuery);

  if (structured) {
    primaryQuery = sanitizeForNewsApi(rawQuery, structured);
    // Fallback: try to extract keywords and use implicit AND
    const rawTerms = deriveLooseTerms(rawQuery, { maxTerms: 8, maxTokensPerTerm: 6 });
    const cleanedTerms = rawTerms.map((term) => sanitizeForNewsApi(term, false)).filter(Boolean);
    fallbackQuery = cleanedTerms
      .slice(0, 6)
      .map((term) => (/\s/.test(term) ? `"${term}"` : term))
      .join(' OR ');
  } else {
    // Variant 1: full sanitized string (lets NewsAPI decide how to interpret it).
    primaryQuery = sanitizeForNewsApi(rawQuery, structured);

    // Variant 2: OR of a few extracted terms/phrases (helps for "A vs B", "A with a hint of B", etc.).
    const rawTerms = deriveLooseTerms(rawQuery, { maxTerms: 8, maxTokensPerTerm: 6 });
    const cleanedTerms = rawTerms.map((term) => sanitizeForNewsApi(term, false)).filter(Boolean);
    const phraseOr = cleanedTerms
      .slice(0, 6)
      .map((term) => (/\s/.test(term) ? `"${term}"` : term))
      .filter(Boolean)
      .join(' OR ');

    // Variant 3: OR of individual tokens (broad fallback if the phrase version is too strict).
    const tokens = Array.from(
      new Set(
        cleanedTerms
          .flatMap((term) => term.split(/\s+/))
          .map((t) => t.trim())
          .filter((t) => t.length >= 3),
      ),
    ).slice(0, 12);
    const tokenOr = tokens.join(' OR ');

    fallbackQuery = phraseOr || tokenOr || primaryQuery;
  }

    return Array.from(new Set([primaryQuery, fallbackQuery].filter(Boolean)));
  };

  const queryVariants = Array.from(new Set(inputVariants.flatMap(buildQueryVariants)));
  const variantMetrics: Array<{ query: string; rawReturned: number; afterPreFilter: number; used: boolean }> = [];
  const mergedItems: ConnectorArticle[] = [];
  const seenUrls = new Set<string>();
  let pagesFetched = 0;

  let lastError: Error | null = null;
  try {
    for (let i = 0; i < queryVariants.length; i += 1) {
      const variant = queryVariants[i];
      try {
        const result = await attemptFetch(variant);
        const metric = {
          query: result.query,
          rawReturned: result.rawReturned,
          afterPreFilter: result.items.length,
          used: false,
        };
        variantMetrics.push(metric);
        pagesFetched += result.pagesFetched;
        for (const item of result.items) {
          const key = item.url.toLowerCase();
          if (seenUrls.has(key)) continue;
          seenUrls.add(key);
          mergedItems.push(item);
        }
        metric.used = result.items.length > 0;
        if (mergedItems.length < minResultsBeforeFallback && i < queryVariants.length - 1) {
          continue;
        }
        return {
          provider: 'newsapi',
          fetchedAt: new Date().toISOString(),
          query: variantMetrics.filter((entry) => entry.used).map((entry) => entry.query).join(' | ') || result.query,
          items: mergedItems,
          metrics: {
            pagesFetched,
            totalCandidates: mergedItems.length,
            queryVariants: variantMetrics,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        lastError = err instanceof Error ? err : new Error(message);
        const isQueryError =
          typeof message === 'string' &&
          message.toLowerCase().includes('unexpectederror') &&
          message.toLowerCase().includes('malformed');
        if (!isQueryError || variant === queryVariants[queryVariants.length - 1]) {
          throw err instanceof Error ? err : new Error(message);
        }
        // retry with next variant
      }
    }

    if (lastError) {
      throw lastError;
    }
    return {
      provider: 'newsapi',
      fetchedAt: new Date().toISOString(),
      query: variantMetrics.filter((entry) => entry.used).map((entry) => entry.query).join(' | ') || fallbackInput,
      items: mergedItems,
      metrics: {
        pagesFetched,
        totalCandidates: mergedItems.length,
        queryVariants: variantMetrics,
      },
    };
  } finally {
    if (abortListener && options.signal) {
      options.signal.removeEventListener('abort', abortListener);
    }
  }
};

