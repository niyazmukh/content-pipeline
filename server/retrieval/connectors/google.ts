import type { AppConfig } from '../../../shared/config';
import { hashString, randomId } from '../../../shared/crypto';
import type { ConnectorResult, ConnectorArticle } from '../types';
import { applyPreFilter } from '../preFilter';

const GOOGLE_SEARCH_ENDPOINT = 'https://customsearch.googleapis.com/customsearch/v1';

export interface GoogleConnectorOptions {
  maxResults?: number;
  signal?: AbortSignal;
  recencyHours?: number;
}

const buildArticleId = (url: string) => hashString(url || randomId());

const NEWS_ONLY_BLOCKED_HOSTS = [
  'facebook.com',
  'instagram.com',
  'tiktok.com',
  'x.com',
  'twitter.com',
  't.co',
  'linkedin.com',
  'youtube.com',
  'youtu.be',
  'reddit.com',
  'old.reddit.com',
  'substack.com',
  'medium.com',
  'quora.com',
  'pinterest.com',
  'github.com',
  'gitlab.com',
  'huggingface.co',
  'wikipedia.org',
  'britannica.com',
] as const;

const isBlockedNewsOnlyHost = (rawUrl: string): boolean => {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return NEWS_ONLY_BLOCKED_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
  } catch {
    return false;
  }
};

const isClearlyNonNewsHost = (host: string): boolean => {
  const h = (host || '').toLowerCase();
  if (!h) return true;
  if (h.endsWith('.gov') || h.endsWith('.edu') || h.endsWith('.mil')) return true;
  if (/\b(?:forum|forums|community|support|docs|documentation|help|academy|education)\b/.test(h)) return true;
  return false;
};

const looksLikeNewsArticleUrl = (rawUrl: string): boolean => {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();

    // Exclude obvious non-news/non-publisher patterns.
    if (isClearlyNonNewsHost(host)) return false;

    // Many news publishers include dates in paths; accept those.
    const hasIsoDate = /\b20\d{2}-\d{2}-\d{2}\b/.test(rawUrl);
    const hasSlashDate = /\/20\d{2}\/(?:0?\d|1[0-2])\/(?:0?\d|[12]\d|3[01])\//.test(path);
    if (hasIsoDate || hasSlashDate) return true;

    // Section heuristics: accept common news sections.
    const sectionSignals = [
      '/news',
      '/business',
      '/technology',
      '/tech',
      '/markets',
      '/finance',
      '/economy',
      '/world',
      '/politics',
      '/retail',
      '/ecommerce',
      '/supply-chain',
      '/logistics',
      '/press',
      '/press-release',
    ];
    if (sectionSignals.some((seg) => path.includes(seg))) return true;

    return false;
  } catch {
    return false;
  }
};

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
    return {
      provider: 'google',
      fetchedAt: new Date().toISOString(),
      query,
      items: [],
      metrics: { disabled: true },
    };
  }

  // Google CSE can return many "almost relevant" results; fetching a few more pages
  // improves the chance that our extractor finds enough high-quality, readable articles.
  const maxResults = Math.min(Math.max(options.maxResults ?? 40, 1), 50);
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
          if (config.connectors.googleCse.newsOnly) {
            let host = '';
            try {
              host = new URL(article.url).hostname.toLowerCase();
            } catch {
              return false;
            }
            if (isClearlyNonNewsHost(host)) return false;
            if (isBlockedNewsOnlyHost(article.url)) return false;
            if (config.connectors.googleCse.allowedHosts?.length) {
              const allowed = config.connectors.googleCse.allowedHosts.some(
                (h) => host === h.toLowerCase() || host.endsWith(`.${h.toLowerCase()}`),
              );
              if (!allowed) return false;
            }
          }
          if (config.connectors.googleCse.newsOnly && !article.publishedAt && !looksLikeNewsArticleUrl(article.url)) {
            return false;
          }
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

