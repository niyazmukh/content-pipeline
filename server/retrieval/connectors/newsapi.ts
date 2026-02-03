import type { AppConfig } from '../../../shared/config';
import { hashString, randomId } from '../../../shared/crypto';
import type { ConnectorResult, ConnectorArticle } from '../types';
import { applyPreFilter } from '../preFilter';
import { deriveLooseTerms } from '../queryUtils';

const NEWS_API_ENDPOINT = 'https://newsapi.org/v2/everything';

export interface NewsApiConnectorOptions {
  maxPages?: number;
  pageSize?: number;
  signal?: AbortSignal;
  recencyHours?: number;
}

const trunc = (value: string | null | undefined) =>
  value == null ? null : value.length > 600 ? `${value.slice(0, 597)}...` : value;

export const fetchNewsApiCandidates = async (
  query: string,
  config: AppConfig,
  options: NewsApiConnectorOptions = {},
): Promise<ConnectorResult> => {
  // Only sanitize if it looks like a raw natural language query (no operators)
  const isStructured = /\b(AND|OR|NOT)\b/.test(query);
  
  const sanitizeForNewsApi = (value: string): string => {
    if (isStructured) return value.trim();
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
      query,
      items: [],
      metrics: { disabled: true },
    };
  }

  const apiKey = config.connectors.newsApi.apiKey;
  if (!apiKey) {
    return {
      provider: 'newsapi',
      fetchedAt: new Date().toISOString(),
      query,
      items: [],
      metrics: { disabled: true },
    };
  }

  const pageSize = Math.min(Math.max(options.pageSize ?? config.connectors.newsApi.pageSize ?? 20, 1), 100);
  const maxPages = Math.min(Math.max(options.maxPages ?? 2, 1), 5);

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

  const attemptFetch = async (searchQuery: string) => {
    const items: ConnectorArticle[] = [];
    let page = 1;
    while (page <= maxPages) {
      const params = new URLSearchParams({
        q: searchQuery,
        sortBy: 'publishedAt',
        language: 'en',
        pageSize: pageSize.toString(),
        page: page.toString(),
        from,
        to,
      });

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

      const filteredPageItems = pageItems.filter((article) => {
        const decision = applyPreFilter(article.url, article.title, article.snippet ?? null, searchQuery);
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
      query: searchQuery,
    };
  };

  let primaryQuery: string;
  let fallbackQuery: string;

  if (isStructured) {
    primaryQuery = sanitizeForNewsApi(query);
    // Fallback: try to extract keywords and use implicit AND
    const rawTerms = deriveLooseTerms(query, { maxTerms: 8, maxTokensPerTerm: 6 });
    const cleanedTerms = rawTerms.map(sanitizeForNewsApi).filter(Boolean);
    fallbackQuery = cleanedTerms.slice(0, 3).join(' ');
  } else {
    // Variant 1: full sanitized string (lets NewsAPI decide how to interpret it).
    primaryQuery = sanitizeForNewsApi(query);

    // Variant 2: OR of a few extracted terms/phrases (helps for "A vs B", "A with a hint of B", etc.).
    const rawTerms = deriveLooseTerms(query, { maxTerms: 8, maxTokensPerTerm: 6 });
    const cleanedTerms = rawTerms.map(sanitizeForNewsApi).filter(Boolean);
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

  const queryVariants = Array.from(new Set([primaryQuery, fallbackQuery].filter(Boolean)));

  let lastError: Error | null = null;
  try {
    for (let i = 0; i < queryVariants.length; i += 1) {
      const variant = queryVariants[i];
      try {
        const result = await attemptFetch(variant);
        // If we got zero results and have another variant to try, keep going.
        if (result.items.length === 0 && i < queryVariants.length - 1) {
          continue;
        }
        return {
          provider: 'newsapi',
          fetchedAt: new Date().toISOString(),
          query: result.query,
          items: result.items,
          metrics: {
            pagesFetched: result.pagesFetched,
            totalCandidates: result.items.length,
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
    throw new Error('NewsAPI fetch failed unexpectedly');
  } finally {
    if (abortListener && options.signal) {
      options.signal.removeEventListener('abort', abortListener);
    }
  }
};

