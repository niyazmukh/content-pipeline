import type { AppConfig } from '../../shared/config';
import { hashString } from '../../shared/crypto';
import type { ConnectorArticle, NormalizedArticle, ProviderName } from './types';
import { buildExcerpt } from '../utils/text';

export interface ExtractionOptions {
  config: AppConfig;
  queryTokens: string[];
  signal?: AbortSignal;
}

export interface ExtractionOutcome {
  article: NormalizedArticle | null;
  error?: string;
  meta: {
    fetchMs: number;
    parseMs: number;
    redirectedUrl?: string;
    cacheHit?: boolean;
  };
}

const TRUSTED_PROTOCOLS = new Set(['http:', 'https:']);

const PRIVATE_IP_RANGES = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
];

const PRIVATE_IPV6_PREFIXES = ['fc', 'fd', 'fe80', '::1'];

const isIpv4 = (value: string): boolean => /^(\d{1,3}\.){3}\d{1,3}$/.test(value);
const isIpv6 = (value: string): boolean => value.includes(':');

const isPrivateIp = (ip: string): boolean => {
  if (isIpv6(ip)) {
    const normalized = ip.toLowerCase();
    return PRIVATE_IPV6_PREFIXES.some((prefix) => normalized.startsWith(prefix));
  }
  return PRIVATE_IP_RANGES.some((pattern) => pattern.test(ip));
};

const assertUrlAllowed = async (rawUrl: string) => {
  const parsed = new URL(rawUrl);
  if (!TRUSTED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`);
  }

  if (parsed.hostname === 'localhost' || parsed.hostname.endsWith('.local')) {
    throw new Error(`Blocked hostname: ${parsed.hostname}`);
  }

  if ((isIpv4(parsed.hostname) || isIpv6(parsed.hostname)) && isPrivateIp(parsed.hostname)) {
    throw new Error(`Blocked IP address: ${parsed.hostname}`);
  }
};

const fetchWithTimeout = async (url: string, options: { timeoutMs: number; userAgent: string; signal?: AbortSignal }) => {
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
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': options.userAgent,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timer);
    if (abortListener && options.signal) {
      options.signal.removeEventListener('abort', abortListener);
    }
  }
};

const canonicalizeUrl = (rawUrl: string): string => {
  const url = new URL(rawUrl);
  const params = Array.from(url.searchParams.entries()).filter(([key]) => !key.toLowerCase().startsWith('utm_'));
  url.search = '';
  for (const [key, value] of params) {
    url.searchParams.append(key, value);
  }
  url.hash = '';
  return url.toString();
};

const metaDateKeys = [
  'article:published_time',
  'article:modified_time',
  'og:published_time',
  'og:updated_time',
  'datepublished',
  'datemodified',
  'dc.date',
  'dc.date.issued',
  'dc.date.published',
  'citation_publication_date',
  'parsely-pub-date',
  'sailthru.date',
  'publishdate',
  'pubdate',
  'updated',
  'lastmod',
];

const parseDateValue = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{10,13}$/.test(trimmed)) {
    const epoch = trimmed.length === 13 ? Number(trimmed) : Number(trimmed) * 1000;
    if (Number.isFinite(epoch)) {
      const date = new Date(epoch);
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    return null;
  }
  const date = new Date(parsed);
  return Number.isNaN(date.getTime()) ? null : date;
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const findMetaContent = (html: string, key: string): string | null => {
  const needle = escapeRegExp(key);
  const metaRe = new RegExp(
    `<meta[^>]+(?:property|name|itemprop)=[\"']${needle}[\"'][^>]*>`,
    'i',
  );
  const match = html.match(metaRe);
  if (!match) return null;
  const tag = match[0];
  const contentMatch = tag.match(/content=[\"']([^\"']+)[\"']/i);
  return contentMatch ? contentMatch[1] : null;
};

const findTimeValue = (html: string): string | null => {
  const attrMatch = html.match(/<time[^>]+(?:datetime|content)=[\"']([^\"']+)[\"'][^>]*>/i);
  if (attrMatch) return attrMatch[1];
  const bodyMatch = html.match(/<time[^>]*>([^<]{4,})<\/time>/i);
  return bodyMatch ? bodyMatch[1].trim() : null;
};

const extractDates = (html: string) => {
  const candidates: { date: Date; source: string }[] = [];
  for (const key of metaDateKeys) {
    const content = findMetaContent(html, key);
    const date = parseDateValue(content);
    if (date) candidates.push({ date, source: `meta:${key}` });
  }
  const timeValue = findTimeValue(html);
  const timeDate = parseDateValue(timeValue || undefined);
  if (timeDate) candidates.push({ date: timeDate, source: 'time' });

  if (!candidates.length) {
    return { published: null, modified: null };
  }

  candidates.sort((a, b) => b.date.getTime() - a.date.getTime());
  const latest = candidates[0];
  const earliest = candidates[candidates.length - 1];

  return {
    published: earliest.date,
    modified: latest.date,
  };
};

const stripTags = (html: string): string => {
  const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  const withoutStyles = withoutScripts.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  return withoutStyles.replace(/<[^>]+>/g, ' ');
};

const decodeEntities = (text: string): string => {
  const named: Record<string, string> = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&quot;': '"',
    '&#39;': "'",
    '&lt;': '<',
    '&gt;': '>',
  };
  let out = text;
  for (const [key, value] of Object.entries(named)) {
    out = out.replaceAll(key, value);
  }
  out = out.replace(/&#(\d+);/g, (_match, num) => {
    const code = Number(num);
    return Number.isFinite(code) ? String.fromCharCode(code) : '';
  });
  out = out.replace(/&#x([0-9a-f]+);/gi, (_match, hex) => {
    const code = Number.parseInt(hex, 16);
    return Number.isFinite(code) ? String.fromCharCode(code) : '';
  });
  return out;
};

const normalizeWhitespace = (text: string): string =>
  text.replace(/\s+/g, ' ').replace(/\u00a0/g, ' ').trim();

const extractTagBlock = (html: string, tag: string): string | null => {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = html.match(re);
  return match ? match[1] : null;
};

const extractTitle = (html: string): string | null => {
  const ogTitle = findMetaContent(html, 'og:title');
  if (ogTitle) return decodeEntities(ogTitle).trim();
  const titleMatch = html.match(/<title[^>]*>([^<]{3,})<\/title>/i);
  return titleMatch ? decodeEntities(titleMatch[1]).trim() : null;
};

const extractCanonicalLink = (html: string): string | null => {
  const match = html.match(/<link[^>]+rel=[\"']canonical[\"'][^>]+href=[\"']([^\"']+)[\"'][^>]*>/i);
  return match ? match[1] : null;
};

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

const expandHyphenVariants = (token: string): string[] => {
  const cleaned = token.trim();
  if (!cleaned) return [];
  if (!cleaned.includes('-')) return [cleaned];
  const parts = cleaned.split('-').map((p) => p.trim()).filter(Boolean);
  const joined = parts.join('');
  return [cleaned, joined, ...parts].filter(Boolean);
};

const computeRelevance = (tokens: string[], queryTokens: string[]): number => {
  if (!tokens.length || !queryTokens.length) {
    return 0;
  }

  const tokenSet = new Set<string>();
  for (const token of tokens) {
    for (const variant of expandHyphenVariants(token)) {
      tokenSet.add(variant);
    }
  }

  const seenQuery = new Set<string>();
  const normalizedQuery: string[] = [];
  for (const token of queryTokens) {
    for (const variant of expandHyphenVariants(token)) {
      const cleaned = variant.trim();
      if (!cleaned) continue;
      const key = cleaned.toLowerCase();
      if (seenQuery.has(key)) continue;
      seenQuery.add(key);
      normalizedQuery.push(cleaned);
    }
  }

  if (!normalizedQuery.length) {
    return 0;
  }

  const hits = normalizedQuery.reduce((count, token) => (tokenSet.has(token) ? count + 1 : count), 0);
  return Number((hits / normalizedQuery.length).toFixed(3));
};

interface CachedOutcome {
  outcome: ExtractionOutcome;
  expiresAt: number;
}

const extractionCache = new Map<string, CachedOutcome>();
let cacheSweepCounter = 0;

const normalizeCacheKey = (url: string): string => {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.search = '';
    return parsed.toString().toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
};

const cloneArticle = (article: NormalizedArticle): NormalizedArticle => ({
  ...article,
  quality: { ...article.quality },
  provenance: { ...article.provenance },
});

const cloneOutcome = (outcome: ExtractionOutcome, cacheHit: boolean): ExtractionOutcome => ({
  article: outcome.article ? cloneArticle(outcome.article) : null,
  error: outcome.error,
  meta: {
    ...outcome.meta,
    cacheHit,
  },
});

const getCachedOutcome = (key: string, now: number): ExtractionOutcome | null => {
  const entry = extractionCache.get(key);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt <= now) {
    extractionCache.delete(key);
    return null;
  }
  return cloneOutcome(entry.outcome, true);
};

const storeOutcome = (keys: string[], outcome: ExtractionOutcome, ttlMs: number, now: number) => {
  if (ttlMs <= 0 || !outcome.article) {
    return;
  }
  const expiresAt = now + ttlMs;
  const stored = cloneOutcome(outcome, false);
  for (const key of keys) {
    if (!key) {
      continue;
    }
    extractionCache.set(key, { outcome: stored, expiresAt });
  }
};

const sweepExpiredCacheEntries = (now: number) => {
  cacheSweepCounter += 1;
  if (cacheSweepCounter % 50 !== 0) {
    return;
  }
  for (const [key, entry] of extractionCache) {
    if (entry.expiresAt <= now) {
      extractionCache.delete(key);
    }
  }
};

export const extractArticle = async (
  input: ConnectorArticle,
  provider: ProviderName,
  options: ExtractionOptions,
): Promise<ExtractionOutcome> => {
  const started = Date.now();
  const cacheTtlMs = options.config.retrieval.cacheTtlMs ?? 0;
  const cacheKey = normalizeCacheKey(input.url);
  sweepExpiredCacheEntries(started);
  if (cacheTtlMs > 0) {
    const cached = getCachedOutcome(cacheKey, started);
    if (cached) {
      return cached;
    }
  }
  try {
    await assertUrlAllowed(input.url);
  } catch (error) {
    return {
      article: null,
      error: (error as Error).message,
      meta: { fetchMs: 0, parseMs: 0 },
    };
  }

  const fetchStart = Date.now();
  try {
    const response = await fetchWithTimeout(input.url, {
      timeoutMs: options.config.retrieval.fetchTimeoutMs,
      userAgent: options.config.retrieval.userAgent,
      signal: options.signal,
    });

    if (!response.ok) {
      // If blocked or non-success, attempt provider fallback where available (e.g., EventRegistry body)
      if (provider === 'eventregistry' && input.providerData) {
        const bodyText =
          (input.providerData as any).body ||
          (input.providerData as any).articleBody ||
          (input.providerData as any).content ||
          null;
        if (typeof bodyText === 'string' && bodyText.trim().length > 200) {
          const canonicalUrl = canonicalizeUrl(input.url);
          let host: string;
          try {
            host = new URL(canonicalUrl).hostname;
          } catch {
            host = canonicalUrl;
          }
          const textContent = String(bodyText).trim();
          const wordTokens = tokenize(textContent);
          const uniqueWordCount = new Set(wordTokens).size;
          const wordCount = wordTokens.length;
          const excerpt = buildExcerpt(textContent);
          const id = hashString(canonicalUrl);

          const article: NormalizedArticle = {
            id,
            title: input.title || canonicalUrl,
            canonicalUrl,
            sourceHost: host,
            sourceName: input.sourceName ?? host,
            sourceLabel: input.sourceName ?? null,
            publishedAt: input.publishedAt ?? null,
            modifiedAt: null,
            excerpt,
            body: textContent,
            hasExtractedBody: true,
            quality: {
              wordCount,
              uniqueWordCount,
              relevanceScore: computeRelevance(wordTokens, options.queryTokens),
            },
            provenance: {
              provider,
              providerId: input.id,
              rawRef: undefined,
            },
          };
          return {
            article,
            meta: { fetchMs: Date.now() - fetchStart, parseMs: 0 },
          };
        }
      }
      return {
        article: null,
        error: `HTTP ${response.status}`,
        meta: { fetchMs: Date.now() - fetchStart, parseMs: 0 },
      };
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      // Non-HTML. Attempt provider fallback where possible (EventRegistry body)
      if (provider === 'eventregistry' && input.providerData) {
        const bodyText =
          (input.providerData as any).body ||
          (input.providerData as any).articleBody ||
          (input.providerData as any).content ||
          null;
        if (typeof bodyText === 'string' && bodyText.trim().length > 200) {
          const canonicalUrl = canonicalizeUrl(input.url);
          let host: string;
          try {
            host = new URL(canonicalUrl).hostname;
          } catch {
            host = canonicalUrl;
          }
          const textContent = String(bodyText).trim();
          const wordTokens = tokenize(textContent);
          const uniqueWordCount = new Set(wordTokens).size;
          const wordCount = wordTokens.length;
          const excerpt = buildExcerpt(textContent);
          const id = hashString(canonicalUrl);

          const article: NormalizedArticle = {
            id,
            title: input.title || canonicalUrl,
            canonicalUrl,
            sourceHost: host,
            sourceName: input.sourceName ?? host,
            sourceLabel: input.sourceName ?? null,
            publishedAt: input.publishedAt ?? null,
            modifiedAt: null,
            excerpt,
            body: textContent,
            hasExtractedBody: true,
            quality: {
              wordCount,
              uniqueWordCount,
              relevanceScore: computeRelevance(wordTokens, options.queryTokens),
            },
            provenance: {
              provider,
              providerId: input.id,
              rawRef: undefined,
            },
          };
          return {
            article,
            meta: { fetchMs: Date.now() - fetchStart, parseMs: 0 },
          };
        }
      }
      return {
        article: null,
        error: `Unsupported content-type: ${contentType}`,
        meta: { fetchMs: Date.now() - fetchStart, parseMs: 0 },
      };
    }

    const html = await response.text();
    const fetchMs = Date.now() - fetchStart;

    const parseStart = Date.now();
    const canonicalLink = extractCanonicalLink(html) || response.url || input.url;

    const canonicalUrl = canonicalizeUrl(canonicalLink);
    const id = hashString(canonicalUrl);
    const sourceUrl = new URL(canonicalUrl);
    const title = extractTitle(html) || input.title || sourceUrl.href;
    let textContent = '';
    const articleBlock = extractTagBlock(html, 'article') || extractTagBlock(html, 'main') || extractTagBlock(html, 'body');
    if (articleBlock) {
      textContent = normalizeWhitespace(decodeEntities(stripTags(articleBlock)));
    }
    if (!textContent) {
      textContent = normalizeWhitespace(decodeEntities(stripTags(html)));
    }
    const parseMs = Date.now() - parseStart;
    // If Readability failed to extract meaningful text, attempt provider fallbacks
    if (textContent.length < 200 && input.providerData) {
      if (provider === 'eventregistry') {
        const fallback =
          (input.providerData as any).body ||
          (input.providerData as any).articleBody ||
          (input.providerData as any).content ||
          null;
        if (typeof fallback === 'string' && fallback.trim().length >= 200) {
          textContent = String(fallback).trim();
        }
      } else if (provider === 'newsapi') {
        const fallback = (input.providerData as any).content || (input.providerData as any).description || null;
        if (typeof fallback === 'string' && fallback.trim().length >= 200) {
          textContent = String(fallback).trim();
        }
      }
    }

    const wordTokens = tokenize(textContent);
    const uniqueWordCount = new Set(wordTokens).size;
    const wordCount = wordTokens.length;
    const excerpt = buildExcerpt(textContent);

    const dates = extractDates(html);
    const publishedAt = dates.published?.toISOString() ?? input.publishedAt ?? null;
    const modifiedAt = dates.modified?.toISOString() ?? null;

    const providerSourceName =
      input.providerData && typeof input.providerData === 'object' && 'source' in input.providerData
        ? ((input.providerData as any).source?.name ??
            (input.providerData as any).source?.title ??
            null)
        : null;

    const article: NormalizedArticle = {
      id,
      title,
      canonicalUrl,
      sourceHost: sourceUrl.hostname,
      sourceName: input.sourceName ?? providerSourceName ?? sourceUrl.hostname,
      sourceLabel: input.sourceName ?? null,
      publishedAt,
      modifiedAt,
      excerpt,
      body: textContent,
      hasExtractedBody: textContent.length > 0,
      quality: {
        wordCount,
        uniqueWordCount,
        relevanceScore: computeRelevance(wordTokens, options.queryTokens),
      },
      provenance: {
        provider,
        providerId: input.id,
        rawRef: undefined,
      },
    };

    const redirectedUrl = response.url && response.url !== input.url ? response.url : undefined;
    const outcome: ExtractionOutcome = {
      article,
      meta: {
        fetchMs,
        parseMs,
        redirectedUrl,
        cacheHit: false,
      },
    };

    if (cacheTtlMs > 0) {
      const keys = new Set<string>();
      if (cacheKey) {
        keys.add(cacheKey);
      }
      const canonicalKey = normalizeCacheKey(canonicalUrl);
      if (canonicalKey) {
        keys.add(canonicalKey);
      }
      if (redirectedUrl) {
        const redirectedKey = normalizeCacheKey(redirectedUrl);
        if (redirectedKey) {
          keys.add(redirectedKey);
        }
      }
      const storeTimestamp = Date.now();
      storeOutcome(Array.from(keys), outcome, cacheTtlMs, storeTimestamp);
    }

    return outcome;
  } catch (error) {
    return {
      article: null,
      error: error instanceof Error ? error.message : String(error),
      meta: { fetchMs: Date.now() - fetchStart, parseMs: 0 },
    };
  }
};

