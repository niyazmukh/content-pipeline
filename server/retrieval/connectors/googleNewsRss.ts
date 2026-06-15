import type { AppConfig } from '../../../shared/config';
import { hashString, randomId } from '../../../shared/crypto';
import type { ConnectorArticle, ConnectorResult } from '../types';
import { applyPreFilter } from '../preFilter';
import { isGoogleNewsWrapperUrl } from '../googleNewsWrapper';
import type { QueryExclusions } from '../exclusions';
import { XMLParser } from 'fast-xml-parser';
const GOOGLE_NEWS_RSS_ENDPOINT = 'https://news.google.com/rss/search';

export interface GoogleNewsRssConnectorOptions {
  maxResults?: number;
  signal?: AbortSignal;
  recencyHours?: number;
  exclusions?: QueryExclusions;
}

const buildArticleId = (url: string) => hashString(url || randomId());

const stripTags = (value: string): string => value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  cdataPropName: '#text',
});

const parsePubDateToIso = (pubDate: string | null): string | null => {
  if (!pubDate) return null;
  const ms = Date.parse(pubDate);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
};

const textValue = (value: unknown): string | null => {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value).trim();
    return text || null;
  }
  if (typeof value === 'object') {
    const text = (value as Record<string, unknown>)['#text'];
    return textValue(text);
  }
  return null;
};

const stripGoogleNewsPublisherSuffix = (title: string, sourceName: string | null): string => {
  const clean = stripTags(title).trim();
  if (!sourceName) return clean;
  const suffix = ` - ${sourceName}`;
  return clean.endsWith(suffix) ? clean.slice(0, -suffix.length).trim() : clean;
};

const parseRssItems = (xml: string) => {
  const parsed = parser.parse(xml) as any;
  const rawItems = parsed?.rss?.channel?.item;
  return Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
};

const fetchWithTimeout = async (
  url: string,
  options: { signal?: AbortSignal; timeoutMs: number; headers: Record<string, string> },
) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  let abortListener: (() => void) | null = null;

  if (options.signal) {
    if (options.signal.aborted) {
      clearTimeout(timer);
      throw new Error('Aborted');
    }
    abortListener = () => controller.abort();
    options.signal.addEventListener('abort', abortListener, { once: true });
  }

  try {
    return await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: options.headers,
    });
  } finally {
    clearTimeout(timer);
    if (abortListener && options.signal) {
      options.signal.removeEventListener('abort', abortListener);
    }
  }
};

export const fetchGoogleNewsRssCandidates = async (
  query: string | string[],
  config: AppConfig,
  options: GoogleNewsRssConnectorOptions = {},
): Promise<ConnectorResult> => {
  const queryVariants = (Array.isArray(query) ? query : [query])
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const fallbackQuery = queryVariants[0] || '';

  if (!config.connectors.googleNewsRss.enabled) {
    return {
      provider: 'googlenews',
      fetchedAt: new Date().toISOString(),
      query: fallbackQuery,
      items: [],
      metrics: { disabled: true },
    };
  }

  const maxResults = Math.min(Math.max(options.maxResults ?? config.connectors.googleNewsRss.maxResults ?? 40, 1), 100);
  const recencyHours = options.recencyHours ?? config.recencyHours;
  const recencyCutoffMs = Date.now() - recencyHours * 60 * 60 * 1000;
  const userAgent =
    config.retrieval?.userAgent ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';
  const timeoutMs = Math.min(Math.max(config.retrieval?.fetchTimeoutMs ?? 8_000, 1_000), 8_000);
  const variantMetrics: Array<{
    query: string;
    rawReturned: number;
    afterRecency: number;
    afterPreFilter: number;
    used: boolean;
    error?: string;
  }> = [];

  let lastResult: ConnectorResult | null = null;
  let lastError: string | null = null;

  for (const effectiveQuery of queryVariants.length ? queryVariants : [fallbackQuery]) {
    const params = new URLSearchParams({
      q: effectiveQuery,
      hl: config.connectors.googleNewsRss.hl,
      gl: config.connectors.googleNewsRss.gl,
      ceid: config.connectors.googleNewsRss.ceid,
    });

    let response: Response;
    try {
      response = await fetchWithTimeout(`${GOOGLE_NEWS_RSS_ENDPOINT}?${params.toString()}`, {
        signal: options.signal,
        timeoutMs,
        headers: {
          Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1',
          'Accept-Language': `${config.connectors.googleNewsRss.hl},en;q=0.9`,
          'User-Agent': userAgent,
          Referer: 'https://news.google.com/',
        },
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      variantMetrics.push({
        query: effectiveQuery,
        rawReturned: 0,
        afterRecency: 0,
        afterPreFilter: 0,
        used: false,
        error: lastError,
      });
      continue;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      lastError = `Google News RSS request failed: ${response.status} ${response.statusText} ${text}`;
      variantMetrics.push({
        query: effectiveQuery,
        rawReturned: 0,
        afterRecency: 0,
        afterPreFilter: 0,
        used: false,
        error: lastError,
      });
      continue;
    }

    const xml = await response.text();
    const rssItems = parseRssItems(xml);
    const parsedItems: Array<{
    title: string;
    url: string;
    sourceName: string | null;
    sourceUrl: string | null;
    publishedAt: string | null;
    snippet: string | null;
    pubDateRaw: string | null;
  }> = [];

    for (const item of rssItems) {
      const titleRaw = textValue(item?.title);
      const linkRaw = textValue(item?.link);
      const pubDateRaw = textValue(item?.pubDate);
      const descRaw = textValue(item?.description);
      const sourceName = textValue(item?.source);
      const sourceUrl = textValue(item?.source?.['@_url']);

      const url = (linkRaw || '').trim();
      if (!url) continue;
      const title = stripGoogleNewsPublisherSuffix(titleRaw || url, sourceName) || url;
      const snippet = descRaw ? stripTags(descRaw) : null;
      const publishedAt = parsePubDateToIso(pubDateRaw);

      // Enforce recency from RSS metadata instead of relying on undocumented query operators.
      if (publishedAt) {
        const publishedMs = Date.parse(publishedAt);
        if (!Number.isNaN(publishedMs) && publishedMs < recencyCutoffMs) {
          continue;
        }
      }

      parsedItems.push({
        title,
        url,
        sourceName,
        sourceUrl,
        publishedAt,
        snippet,
        pubDateRaw,
      });
    }

    const items: ConnectorArticle[] = [];
    let wrapperCandidates = 0;
    for (let i = 0; i < parsedItems.length; i += 1) {
      const item = parsedItems[i];
      const finalUrl = item.url;
      if (isGoogleNewsWrapperUrl(finalUrl)) wrapperCandidates += 1;

      const decision = applyPreFilter(finalUrl, item.title, item.snippet, effectiveQuery, options.exclusions);
      if (!decision.pass) {
        continue;
      }

      items.push({
        id: buildArticleId(finalUrl),
        title: item.title,
        url: finalUrl,
        sourceName: item.sourceName,
        publishedAt: item.publishedAt,
        snippet: item.snippet,
        providerData: {
          sourceName: item.sourceName,
          sourceUrl: item.sourceUrl,
          pubDate: item.pubDateRaw,
          rssUrl: item.url,
        },
      });
      if (items.length >= maxResults) break;
    }

    const metric = {
      query: effectiveQuery,
      rawReturned: rssItems.length,
      afterRecency: parsedItems.length,
      afterPreFilter: items.length,
      used: false,
    };
    variantMetrics.push(metric);

    lastResult = {
      provider: 'googlenews',
      fetchedAt: new Date().toISOString(),
      query: effectiveQuery,
      items,
      metrics: {
        used: items.length,
        totalReturned: metric.rawReturned,
        afterRecency: metric.afterRecency,
        wrapperCandidates,
        queryVariants: variantMetrics,
      },
    };

    if (items.length > 0) {
      metric.used = true;
      return lastResult;
    }
  }

  return lastResult ?? {
    provider: 'googlenews',
    fetchedAt: new Date().toISOString(),
    query: fallbackQuery,
    items: [],
    metrics: {
      failed: Boolean(lastError),
      error: lastError ?? undefined,
      used: 0,
      totalReturned: 0,
      afterRecency: 0,
      wrapperCandidates: 0,
      queryVariants: variantMetrics,
    },
  };
};
