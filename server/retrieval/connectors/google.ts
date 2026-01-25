import type { AppConfig } from '../../../shared/config';
import { hashString, randomId } from '../../../shared/crypto';
import type { ConnectorResult, ConnectorArticle } from '../types';
import { applyPreFilter } from '../preFilter';

const GOOGLE_SEARCH_ENDPOINT = 'https://www.googleapis.com/customsearch/v1';

export interface GoogleConnectorOptions {
  maxResults?: number;
  signal?: AbortSignal;
  recencyHours?: number;
}

const buildArticleId = (url: string) => hashString(url || randomId());

export const fetchGoogleCandidates = async (
  query: string,
  config: AppConfig,
  options: GoogleConnectorOptions = {},
): Promise<ConnectorResult> => {
  if (!config.connectors.googleCse.enabled) {
    return {
      provider: 'google',
      fetchedAt: new Date().toISOString(),
      query,
      items: [],
      metrics: { disabled: true },
    };
  }

  const apiKey = config.connectors.googleCse.apiKey;
  const searchEngineId = config.connectors.googleCse.searchEngineId;

  if (!apiKey || !searchEngineId) {
    console.warn('[google connector] Missing credentials, returning disabled', {
      hasApiKey: Boolean(apiKey),
      hasSearchEngineId: Boolean(searchEngineId),
    });
    return {
      provider: 'google',
      fetchedAt: new Date().toISOString(),
      query,
      items: [],
      metrics: { disabled: true },
    };
  }

  const maxResults = Math.min(Math.max(options.maxResults ?? 20, 1), 50);
  const recencyHours = options.recencyHours ?? config.recencyHours;
  const recencyCutoffMs = Date.now() - recencyHours * 60 * 60 * 1000;
  const recencyDays = Math.max(1, Math.min(31, Math.round(recencyHours / 24) || 1));

  const controller = new AbortController();
  let abortListener: (() => void) | null = null;
  if (options.signal) {
    if (options.signal.aborted) {
      throw new Error('Aborted');
    }
    abortListener = () => controller.abort();
    options.signal.addEventListener('abort', abortListener, { once: true });
  }

  const items: ConnectorArticle[] = [];
  let start = 1;
  let pagesFetched = 0;

  try {
    while (items.length < maxResults && start <= 91) {
      const pageSize = Math.min(10, maxResults - items.length);
      const params = new URLSearchParams({
        key: apiKey,
        cx: searchEngineId,
        q: query,
        num: String(pageSize),
        start: String(start),
        // Per Custom Search API docs, use `dateRestrict` to limit recency and `sort=date` for ordering.
        // https://developers.google.com/custom-search/v1/reference/rest/v1/cse/list
        dateRestrict: `d${recencyDays}`,
        sort: 'date',
        fields: 'items(title,link,snippet,displayLink,pagemap,formattedUrl,htmlSnippet)',
      });

      const response = await fetch(`${GOOGLE_SEARCH_ENDPOINT}?${params.toString()}`, {
        method: 'GET',
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 429) {
          console.warn('[google connector] Quota exceeded (429), skipping Google Search');
          return {
            provider: 'google',
            fetchedAt: new Date().toISOString(),
            query,
            items: [],
            metrics: { disabled: true, error: 'Quota exceeded' },
          };
        }
        const text = await response.text();
        throw new Error(`Google CSE request failed: ${response.status} ${response.statusText} ${text}`);
      }

      const data = (await response.json()) as { items?: Array<Record<string, any>> };

      if (config.observability.logLevel === 'debug') {
        console.log(`[google connector] Fetched ${data.items?.length || 0} items for query: "${query}"`);
      }

      const pageItems = (data.items || [])
        .map((item) => {
          const url = item.link || item.formattedUrl || '';
          const title = item.title || url;
          const snippet = item.snippet || item.htmlSnippet || null;
          
          // Try to extract date from pagemap metadata
          let publishedAt: string | null = null;
          const pagemap = item.pagemap;
          if (pagemap) {
            // Check common structured data fields
            const metatags = pagemap.metatags?.[0];
            if (metatags) {
              publishedAt =
                metatags['article:published_time'] ||
                metatags['datePublished'] ||
                metatags['publishdate'] ||
                metatags['og:article:published_time'] ||
                null;
            }
          }
          
          return {
            id: buildArticleId(url || randomId()),
            title,
            url,
            sourceName: item.displayLink || null,
            snippet,
            publishedAt,
            providerData: item,
          } satisfies ConnectorArticle;
        })
        .filter((article) => {
          if (!article.url) return false;
          // Keep only recency-conformant items when date known; otherwise keep
          if (article.publishedAt) {
            const publishedMs = Date.parse(article.publishedAt);
            if (!Number.isNaN(publishedMs) && publishedMs < recencyCutoffMs) {
              return false; // Too old
            }
          }
          const decision = applyPreFilter(article.url, article.title, article.snippet ?? null, query);
          if (!decision.pass) {
            return false;
          }
          return true;
        });

      items.push(...pageItems);
      pagesFetched += 1;

      if (!data.items || data.items.length < pageSize) {
        break;
      }
      start += pageSize;
    }

    return {
      provider: 'google',
      fetchedAt: new Date().toISOString(),
      query,
      items: items.slice(0, maxResults),
      metrics: {
        pagesFetched,
        totalReturned: items.length,
        used: Math.min(items.length, maxResults),
      },
    };
  } finally {
    if (abortListener && options.signal) {
      options.signal.removeEventListener('abort', abortListener);
    }
  }
};

