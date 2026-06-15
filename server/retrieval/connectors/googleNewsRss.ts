import type { AppConfig } from '../../../shared/config';
import { hashString, randomId } from '../../../shared/crypto';
import type { ConnectorArticle, ConnectorResult } from '../types';
import { applyPreFilter } from '../preFilter';
import { isGoogleNewsWrapperUrl } from '../googleNewsWrapper';
import type { QueryExclusions } from '../exclusions';
import { XMLParser } from 'fast-xml-parser';
import { buildProxiedUrl } from '../googleNewsProxies';
import { deriveFeedSourceName } from '../newsFeeds';
import { sleep } from '../../utils/async';

const GOOGLE_NEWS_RSS_ENDPOINT = 'https://news.google.com/rss/search';
const MAX_RELAYS = 2;
const MAX_PUBLISHER_FEEDS = 10;
// 503 "automated queries" is a soft/rate block, not a permanent ban, so a real
// browser header set + User-Agent rotation + retry-with-backoff rides it out.
const GOOGLE_DIRECT_ATTEMPTS = 3;
const GOOGLE_DIRECT_BACKOFF_MS = 400;
const SEC_CH_UA = '"Chromium";v="124", "Google Chrome";v="124", "Not.A/Brand";v="99"';
const GOOGLE_NEWS_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];

export interface GoogleNewsRssConnectorOptions {
  maxResults?: number;
  signal?: AbortSignal;
  recencyHours?: number;
  exclusions?: QueryExclusions;
}

const buildArticleId = (url: string) => hashString(url || randomId());
const stripTags = (value: string): string => value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true, cdataPropName: '#text' });

const parsePubDateToIso = (pubDate: string | null): string | null => {
  if (!pubDate) return null;
  const ms = Date.parse(pubDate);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
};

const textValue = (value: unknown): string | null => {
  if (value == null) return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const text = textValue(entry);
      if (text) return text;
    }
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value).trim();
    return text || null;
  }
  if (typeof value === 'object') return textValue((value as Record<string, unknown>)['#text']);
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
  const rawItems = parsed?.rss?.channel?.item ?? parsed?.feed?.entry;
  return Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
};

const looksLikeRss = (body: string): boolean => /<rss[\s>]|<feed[\s>]|<\/?channel[\s>]/i.test(body || '');

const sanitizeRssError = (status: number, statusText: string, body: string): string => {
  const automated = /sorry|automated queries|unusual traffic|not a robot/i.test(body || '');
  if (status === 503 || automated) {
    return `Google News RSS refused the request (HTTP ${status || 200} automated-query block) - Google has no official News API and blocks automated access by design; publisher RSS feeds are used as the reliable source.`;
  }
  return `Google News RSS request failed: HTTP ${status} ${statusText}`.trim();
};

const describeFetchError = (raw: string, timeoutMs: number): string => {
  if (raw === 'caller_aborted') return 'Google News RSS cancelled (overall retrieval budget/deadline reached).';
  if (raw.startsWith('timeout_') || /abort/i.test(raw)) return `Google News RSS timed out after ${Math.round(timeoutMs / 1000)}s (Google blocked direct access).`;
  return `Google News RSS fetch failed: ${raw}`;
};

const fetchWithTimeout = async (url: string, options: { signal?: AbortSignal; timeoutMs: number; headers: Record<string, string> }) => {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs);
  let abortListener: (() => void) | null = null;
  if (options.signal) {
    if (options.signal.aborted) { clearTimeout(timer); throw new Error('caller_aborted'); }
    abortListener = () => controller.abort();
    options.signal.addEventListener('abort', abortListener, { once: true });
  }
  try {
    return await fetch(url, { method: 'GET', signal: controller.signal, headers: options.headers });
  } catch (e) {
    if (timedOut) throw new Error(`timeout_${options.timeoutMs}ms`);
    if (options.signal?.aborted) throw new Error('caller_aborted');
    throw e instanceof Error ? e : new Error(String(e));
  } finally {
    clearTimeout(timer);
    if (abortListener && options.signal) options.signal.removeEventListener('abort', abortListener);
  }
};

// Full, current-Chrome header set. Sparse/odd headers are a primary bot tell for
// Google; presenting a complete, self-consistent browser fingerprint plus consent
// cookies materially lowers the chance of the 503 "automated queries" block.
const buildBrowserHeaders = (ua: string, hl: string): Record<string, string> => ({
  'User-Agent': ua,
  Accept: 'application/rss+xml, application/xml, application/atom+xml, text/html;q=0.9, */*;q=0.1',
  'Accept-Language': `${hl},en;q=0.9`,
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
  DNT: '1',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'sec-ch-ua': SEC_CH_UA,
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  Referer: 'https://news.google.com/',
  Cookie: 'CONSENT=YES+cb; SOCS=CAI',
});

// Fetch Google News RSS directly, retrying a soft 503/429/automated-query block
// with a rotated User-Agent and jittered backoff. Returns blocked=true if Google
// kept refusing (so the caller can stop hammering the same egress IP).
const fetchGoogleDirect = async (
  url: string,
  opts: { hl: string; timeoutMs: number; signal?: AbortSignal; attempts: number },
): Promise<{ xml: string | null; error?: string; blocked: boolean }> => {
  let error: string | undefined;
  let blocked = false;
  for (let attempt = 0; attempt < opts.attempts; attempt += 1) {
    if (opts.signal?.aborted) {
      error = 'Google News RSS cancelled (overall retrieval budget/deadline reached).';
      break;
    }
    const ua = GOOGLE_NEWS_USER_AGENTS[attempt % GOOGLE_NEWS_USER_AGENTS.length];
    try {
      const response = await fetchWithTimeout(url, { signal: opts.signal, timeoutMs: opts.timeoutMs, headers: buildBrowserHeaders(ua, opts.hl) });
      const body = await response.text().catch(() => '');
      if (response.ok && looksLikeRss(body)) return { xml: body, blocked: false };
      const automated = /sorry|automated queries|unusual traffic|not a robot/i.test(body);
      blocked = response.status === 503 || response.status === 429 || automated;
      error = sanitizeRssError(response.status, response.statusText, body);
      if (!blocked) return { xml: null, error, blocked: false }; // genuine, non-block failure: do not retry
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      error = describeFetchError(raw, opts.timeoutMs);
      if (raw === 'caller_aborted') {
        blocked = false;
        break;
      }
      blocked = true; // timeout: treat as a soft block worth one more try
    }
    if (attempt < opts.attempts - 1) {
      try {
        await sleep(GOOGLE_DIRECT_BACKOFF_MS * 2 ** attempt + Math.floor(Math.random() * 250), opts.signal);
      } catch {
        break; // aborted during backoff
      }
    }
  }
  return { xml: null, error, blocked };
};

interface BuiltItems { items: ConnectorArticle[]; rawReturned: number; afterRecency: number; wrapperCandidates: number; }

const buildItemsFromXml = (
  xml: string,
  opts: { query: string; exclusions?: QueryExclusions; recencyCutoffMs: number; maxResults: number; sourceNameOverride?: string },
): BuiltItems => {
  const rssItems = parseRssItems(xml);
  const items: ConnectorArticle[] = [];
  let afterRecency = 0;
  let wrapperCandidates = 0;
  for (const item of rssItems) {
    const titleRaw = textValue(item?.title);
    const linkRaw =
      textValue(item?.link) ||
      textValue(item?.link?.['@_href']) ||
      (Array.isArray(item?.link) ? textValue(item.link[0]?.['@_href']) : null);
    const pubDateRaw =
      textValue(item?.pubDate) || textValue(item?.['dc:date']) || textValue(item?.updated) || textValue(item?.published);
    const descRaw = textValue(item?.description) || textValue(item?.summary);
    const itemSource = textValue(item?.source);
    const sourceUrl = textValue(item?.source?.['@_url']);

    const url = (linkRaw || '').trim();
    if (!url) continue;
    const sourceName = itemSource ?? opts.sourceNameOverride ?? null;
    const title = stripGoogleNewsPublisherSuffix(titleRaw || url, itemSource) || url;
    const snippet = descRaw ? stripTags(descRaw) : null;
    const publishedAt = parsePubDateToIso(pubDateRaw);
    if (publishedAt) {
      const ms = Date.parse(publishedAt);
      if (!Number.isNaN(ms) && ms < opts.recencyCutoffMs) continue;
    }
    afterRecency += 1;
    if (isGoogleNewsWrapperUrl(url)) wrapperCandidates += 1;
    const decision = applyPreFilter(url, title, snippet, opts.query, opts.exclusions);
    if (!decision.pass) continue;
    items.push({
      id: buildArticleId(url),
      title,
      url,
      sourceName,
      publishedAt,
      snippet,
      providerData: { sourceName, sourceUrl, pubDate: pubDateRaw, rssUrl: url },
    });
    if (items.length >= opts.maxResults) break;
  }
  return { items, rawReturned: rssItems.length, afterRecency, wrapperCandidates };
};

const normalizeUrlKey = (url: string): string => {
  try {
    const u = new URL(url);
    u.hash = '';
    u.search = '';
    return u.toString().toLowerCase();
  } catch {
    return url.toLowerCase();
  }
};

export const fetchGoogleNewsRssCandidates = async (
  query: string | string[],
  config: AppConfig,
  options: GoogleNewsRssConnectorOptions = {},
): Promise<ConnectorResult> => {
  const queryVariants = (Array.isArray(query) ? query : [query]).map((v) => String(v || '').trim()).filter(Boolean);
  const fallbackQuery = queryVariants[0] || '';

  if (!config.connectors.googleNewsRss.enabled) {
    return { provider: 'googlenews', fetchedAt: new Date().toISOString(), query: fallbackQuery, items: [], metrics: { disabled: true } };
  }

  const maxResults = Math.min(Math.max(options.maxResults ?? config.connectors.googleNewsRss.maxResults ?? 40, 1), 100);
  const recencyHours = options.recencyHours ?? config.recencyHours;
  const recencyCutoffMs = Date.now() - recencyHours * 60 * 60 * 1000;
  const userAgent =
    config.retrieval?.userAgent ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';
  const timeoutMs = Math.min(Math.max(config.retrieval?.fetchTimeoutMs ?? 8_000, 1_000), 8_000);
  const proxies = (config.connectors.googleNewsRss.proxies ?? []).filter(Boolean).slice(0, MAX_RELAYS);
  const publisherFeeds = (config.connectors.googleNewsRss.publisherFeeds ?? []).filter(Boolean).slice(0, MAX_PUBLISHER_FEEDS);

  const hl = config.connectors.googleNewsRss.hl;
  // Cap per-attempt timeout so retries cannot blow the retrieval budget; Google's
  // 503 comes back fast, so retries are cheap.
  const directTimeoutMs = Math.min(timeoutMs, 6_000);

  const buildUrl = (q: string) =>
    `${GOOGLE_NEWS_RSS_ENDPOINT}?${new URLSearchParams({
      q,
      hl: config.connectors.googleNewsRss.hl,
      gl: config.connectors.googleNewsRss.gl,
      ceid: config.connectors.googleNewsRss.ceid,
    }).toString()}`;

  const variantMetrics: Array<{ query: string; rawReturned: number; afterRecency: number; afterPreFilter: number; used: boolean; via?: string; proxy?: string; error?: string }> = [];
  const feedMetrics: Array<{ feed: string; rawReturned: number; afterPreFilter: number; error?: string }> = [];
  const collected: ConnectorArticle[] = [];
  let wrapperCandidates = 0;
  let lastError: string | null = null;
  let usedVia: 'direct' | 'feed' | 'proxy' | undefined;
  let wonQuery = fallbackQuery;

  // --- Phase 1: Google News direct, with a 503 workaround (UA rotation + retry/backoff) ---
  const directVariants = queryVariants.length ? queryVariants : [fallbackQuery];
  for (let vi = 0; vi < directVariants.length; vi += 1) {
    if (options.signal?.aborted) break;
    const effectiveQuery = directVariants[vi];
    // Retry the first query to ride out a soft/rate 503; later variants get a single
    // attempt (same egress IP, so retrying each would only hammer Google).
    const attempts = vi === 0 ? GOOGLE_DIRECT_ATTEMPTS : 1;
    const res = await fetchGoogleDirect(buildUrl(effectiveQuery), { hl, timeoutMs: directTimeoutMs, signal: options.signal, attempts });
    if (!res.xml) {
      lastError = res.error ?? lastError;
      variantMetrics.push({ query: effectiveQuery, rawReturned: 0, afterRecency: 0, afterPreFilter: 0, used: false, via: 'direct', error: res.error });
      // A persistent block on the first query means the IP is throttled now; stop hammering.
      if (res.blocked || options.signal?.aborted) break;
      continue;
    }
    const built = buildItemsFromXml(res.xml, { query: effectiveQuery, exclusions: options.exclusions, recencyCutoffMs, maxResults });
    variantMetrics.push({ query: effectiveQuery, rawReturned: built.rawReturned, afterRecency: built.afterRecency, afterPreFilter: built.items.length, used: built.items.length > 0, via: 'direct' });
    if (built.items.length > 0) {
      collected.push(...built.items);
      wrapperCandidates += built.wrapperCandidates;
      usedVia = 'direct';
      wonQuery = effectiveQuery;
      break;
    }
  }

  // --- Phase 2: official publisher RSS feeds, the reliable source (parallel, fast) ---
  if (publisherFeeds.length && !options.signal?.aborted) {
    const results = await Promise.allSettled(
      publisherFeeds.map(async (feedUrl) => {
        const sourceName = deriveFeedSourceName(feedUrl);
        const response = await fetchWithTimeout(feedUrl, {
          signal: options.signal,
          timeoutMs,
          headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1', 'User-Agent': userAgent },
        });
        if (!response.ok) return { feedUrl, items: [] as ConnectorArticle[], rawReturned: 0, error: `HTTP ${response.status}` };
        const body = await response.text().catch(() => '');
        const built = buildItemsFromXml(body, { query: fallbackQuery, exclusions: options.exclusions, recencyCutoffMs, maxResults, sourceNameOverride: sourceName });
        return { feedUrl, items: built.items, rawReturned: built.rawReturned, error: undefined as string | undefined };
      }),
    );
    for (let i = 0; i < results.length; i += 1) {
      const r = results[i];
      if (r.status === 'fulfilled') {
        feedMetrics.push({ feed: r.value.feedUrl, rawReturned: r.value.rawReturned, afterPreFilter: r.value.items.length, error: r.value.error });
        if (r.value.items.length) {
          collected.push(...r.value.items);
          usedVia = usedVia ?? 'feed';
        }
      } else {
        const raw = r.reason instanceof Error ? r.reason.message : String(r.reason);
        feedMetrics.push({ feed: publisherFeeds[i] ?? 'unknown', rawReturned: 0, afterPreFilter: 0, error: describeFetchError(raw, timeoutMs) });
      }
    }
  }

  // --- Merge + dedup ---
  const seen = new Set<string>();
  let merged: ConnectorArticle[] = [];
  for (const item of collected) {
    const key = normalizeUrlKey(item.url);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
    if (merged.length >= maxResults) break;
  }

  // --- Phase 3: relay LAST RESORT (only if nothing else worked) ---
  if (merged.length === 0 && proxies.length && !options.signal?.aborted) {
    for (const proxy of proxies) {
      try {
        const response = await fetchWithTimeout(buildProxiedUrl(proxy, buildUrl(fallbackQuery)), {
          signal: options.signal,
          timeoutMs,
          headers: { Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1', 'User-Agent': userAgent },
        });
        const body = await response.text().catch(() => '');
        if (response.ok && looksLikeRss(body)) {
          const built = buildItemsFromXml(body, { query: fallbackQuery, exclusions: options.exclusions, recencyCutoffMs, maxResults });
          variantMetrics.push({ query: fallbackQuery, rawReturned: built.rawReturned, afterRecency: built.afterRecency, afterPreFilter: built.items.length, used: built.items.length > 0, via: 'proxy', proxy });
          if (built.items.length > 0) {
            merged = built.items.slice(0, maxResults);
            wrapperCandidates = built.wrapperCandidates;
            usedVia = 'proxy';
            break;
          }
        }
      } catch (e) {
        const raw = e instanceof Error ? e.message : String(e);
        lastError = describeFetchError(raw, timeoutMs);
        if (raw === 'caller_aborted') break;
      }
    }
  }

  // Distinguish a genuine empty result from a successful publisher-feed fallback.
  // A Google direct 503 is expected (Google blocks automated access) and must NOT
  // be reported as the provider error when publisher feeds delivered items.
  const empty = merged.length === 0;
  const note =
    !empty && lastError
      ? `Google News direct was blocked (expected); served ${merged.length} item(s) via ${usedVia}.`
      : undefined;
  let error: string | undefined;
  if (empty) {
    error = publisherFeeds.length
      ? 'Google News direct is blocked by Google (no official API) and publisher feeds returned nothing matching this query. Topic-specific coverage comes from the NewsApi/EventRegistry providers.'
      : (lastError ?? undefined);
  }
  return {
    provider: 'googlenews',
    fetchedAt: new Date().toISOString(),
    query: wonQuery,
    items: merged,
    metrics: {
      used: merged.length,
      wrapperCandidates,
      via: usedVia,
      failed: empty && (Boolean(lastError) || publisherFeeds.length > 0) ? true : undefined,
      error,
      note,
      queryVariants: variantMetrics,
      feeds: feedMetrics.length ? feedMetrics : undefined,
    },
  };
};
