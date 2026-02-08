import type { AppConfig } from '../../../shared/config';
import { hashString, randomId } from '../../../shared/crypto';
import type { ConnectorArticle, ConnectorResult } from '../types';
import { applyPreFilter } from '../preFilter';

const GOOGLE_NEWS_RSS_ENDPOINT = 'https://news.google.com/rss/search';
const GOOGLE_NEWS_HOST = 'news.google.com';
const MAX_WRAPPER_DECODE_ATTEMPTS = 12;

export interface GoogleNewsRssConnectorOptions {
  maxResults?: number;
  signal?: AbortSignal;
  recencyHours?: number;
}

const buildArticleId = (url: string) => hashString(url || randomId());

const decodeXmlEntities = (value: string): string =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

const stripTags = (value: string): string => value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const extractTag = (xml: string, tag: string): string | null => {
  const cdata = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i');
  const m1 = xml.match(cdata);
  if (m1?.[1]) return m1[1].trim();
  const plain = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m2 = xml.match(plain);
  if (m2?.[1]) return m2[1].trim();
  return null;
};

const extractSource = (itemXml: string): { name: string | null; url: string | null } => {
  const m = itemXml.match(/<source[^>]*url="([^"]+)"[^>]*>([\s\S]*?)<\/source>/i);
  if (!m) return { name: null, url: null };
  const url = decodeXmlEntities((m[1] || '').trim());
  const name = stripTags(decodeXmlEntities((m[2] || '').trim()));
  return { name: name || null, url: url || null };
};

const parsePubDateToIso = (pubDate: string | null): string | null => {
  if (!pubDate) return null;
  const ms = Date.parse(pubDate);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
};

const base64UrlDecodeBinary = (value: string): string | null => {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
    return atob(normalized + padding);
  } catch {
    return null;
  }
};

const extractWrapperToken = (rawUrl: string): string | null => {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.hostname !== GOOGLE_NEWS_HOST) return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    if (parts.length >= 2 && parts[parts.length - 2] === 'articles') {
      return parts[parts.length - 1];
    }
    if (parts.length >= 3 && parts[parts.length - 3] === 'rss' && parts[parts.length - 2] === 'articles') {
      return parts[parts.length - 1];
    }
    if (parts.length >= 2 && parts[parts.length - 2] === 'read') {
      return parts[parts.length - 1];
    }
    return null;
  } catch {
    return null;
  }
};

const decodeDirectTokenUrl = (token: string): string | null => {
  const decoded = base64UrlDecodeBinary(token);
  if (!decoded) return null;

  let payload = decoded;
  const prefix = '\x08\x13\x22';
  const suffix = '\xD2\x01\x00';
  if (payload.startsWith(prefix)) payload = payload.slice(prefix.length);
  if (payload.endsWith(suffix)) payload = payload.slice(0, -suffix.length);
  if (!payload.length) return null;

  const bytes = Uint8Array.from(payload, (ch) => ch.charCodeAt(0));
  if (!bytes.length) return null;
  const length = bytes[0];
  const start = length >= 0x80 ? 2 : 1;
  const end = Math.min(payload.length, length + 1);
  if (end <= start) return null;
  const candidate = payload.slice(start, end);
  if (!/^https?:\/\//i.test(candidate)) return null;
  return candidate;
};

const fetchDecodingParams = async (
  token: string,
  signal?: AbortSignal,
): Promise<{ signature: string; timestamp: string } | null> => {
  const res = await fetch(`https://${GOOGLE_NEWS_HOST}/articles/${token}`, {
    method: 'GET',
    signal,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const signature = (html.match(/data-n-a-sg="([^"]+)"/) || [])[1] || '';
  const timestamp = (html.match(/data-n-a-ts="([^"]+)"/) || [])[1] || '';
  if (!signature || !timestamp) return null;
  return { signature, timestamp };
};

const decodeViaBatchExecute = async (
  token: string,
  params: { signature: string; timestamp: string },
  signal?: AbortSignal,
): Promise<string | null> => {
  const payload = [
    'Fbv4je',
    `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${token}",${params.timestamp},"${params.signature}"]`,
  ];
  const fReq = JSON.stringify([[payload]]);
  const body = new URLSearchParams({ 'f.req': fReq });
  const res = await fetch(`https://${GOOGLE_NEWS_HOST}/_/DotsSplashUi/data/batchexecute`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
    },
    body,
  });
  if (!res.ok) return null;
  const text = await res.text();
  const bodyPart = text.split('\n\n')[1];
  if (!bodyPart) return null;
  try {
    const parsed = JSON.parse(bodyPart);
    const raw = parsed?.[0]?.[2];
    if (typeof raw !== 'string') return null;
    const inner = JSON.parse(raw);
    const decodedUrl = Array.isArray(inner) ? inner[1] : null;
    if (typeof decodedUrl !== 'string' || !/^https?:\/\//i.test(decodedUrl)) return null;
    return decodedUrl;
  } catch {
    return null;
  }
};

const resolveGoogleWrapperUrl = async (rawUrl: string, signal?: AbortSignal): Promise<string | null> => {
  const token = extractWrapperToken(rawUrl);
  if (!token) return rawUrl;

  const direct = decodeDirectTokenUrl(token);
  if (direct) return direct;

  const params = await fetchDecodingParams(token, signal);
  if (!params) return null;
  return decodeViaBatchExecute(token, params, signal);
};

export const fetchGoogleNewsRssCandidates = async (
  query: string,
  config: AppConfig,
  options: GoogleNewsRssConnectorOptions = {},
): Promise<ConnectorResult> => {
  if (!config.connectors.googleNewsRss.enabled) {
    return {
      provider: 'googlenews',
      fetchedAt: new Date().toISOString(),
      query,
      items: [],
      metrics: { disabled: true },
    };
  }

  const maxResults = Math.min(Math.max(options.maxResults ?? config.connectors.googleNewsRss.maxResults ?? 40, 1), 100);
  const recencyHours = options.recencyHours ?? config.recencyHours;
  const recencyDays = Math.max(1, Math.min(31, Math.ceil(recencyHours / 24)));

  // Google News RSS supports the same "when:Xd" operator in the query string.
  // If user already included a recency operator, don't duplicate it.
  const hasWhen = /\bwhen:\d+[hdwmy]\b/i.test(query);
  const effectiveQuery = hasWhen ? query : `${query} when:${recencyDays}d`;

  const params = new URLSearchParams({
    q: effectiveQuery,
    hl: config.connectors.googleNewsRss.hl,
    gl: config.connectors.googleNewsRss.gl,
    ceid: config.connectors.googleNewsRss.ceid,
  });

  const response = await fetch(`${GOOGLE_NEWS_RSS_ENDPOINT}?${params.toString()}`, {
    method: 'GET',
    signal: options.signal,
    headers: {
      Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1',
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Google News RSS request failed: ${response.status} ${response.statusText} ${text}`);
  }

  const xml = await response.text();
  const parts = xml.split(/<item\b[^>]*>/i);
  const parsedItems: Array<{
    title: string;
    url: string;
    sourceName: string | null;
    sourceUrl: string | null;
    publishedAt: string | null;
    snippet: string | null;
    pubDateRaw: string | null;
  }> = [];

  for (let i = 1; i < parts.length; i += 1) {
    const chunk = parts[i];
    const end = chunk.search(/<\/item>/i);
    if (end < 0) continue;
    const itemXml = chunk.slice(0, end);

    const titleRaw = extractTag(itemXml, 'title');
    const linkRaw = extractTag(itemXml, 'link');
    const pubDateRaw = extractTag(itemXml, 'pubDate');
    const descRaw = extractTag(itemXml, 'description');
    const source = extractSource(itemXml);

    const url = decodeXmlEntities((linkRaw || '').trim());
    if (!url) continue;
    const canonicalUrl = url.replace(`https://${GOOGLE_NEWS_HOST}/rss/articles/`, `https://${GOOGLE_NEWS_HOST}/articles/`);

    const title = stripTags(decodeXmlEntities(titleRaw || canonicalUrl)) || canonicalUrl;
    const snippet = descRaw ? stripTags(decodeXmlEntities(descRaw)) : null;
    const publishedAt = parsePubDateToIso(pubDateRaw);
    parsedItems.push({
      title,
      url: canonicalUrl,
      sourceName: source.name,
      sourceUrl: source.url,
      publishedAt,
      snippet,
      pubDateRaw,
    });
  }

  const resolvedByIndex = new Map<number, string | null>();
  let decodeAttempts = 0;
  for (let i = 0; i < parsedItems.length && decodeAttempts < MAX_WRAPPER_DECODE_ATTEMPTS; i += 1) {
    const item = parsedItems[i];
    if (!item.url.includes(`${GOOGLE_NEWS_HOST}/articles/`)) continue;
    decodeAttempts += 1;
    const resolved = await resolveGoogleWrapperUrl(item.url, options.signal);
    resolvedByIndex.set(i, resolved);
  }

  const items: ConnectorArticle[] = [];
  let droppedWrappedUnresolved = 0;
  for (let i = 0; i < parsedItems.length; i += 1) {
    const item = parsedItems[i];
    const resolved = resolvedByIndex.has(i) ? resolvedByIndex.get(i) : item.url;
    const finalUrl = resolved ?? item.url;
    const isWrapper = finalUrl.includes(`${GOOGLE_NEWS_HOST}/articles/`) || finalUrl.includes(`${GOOGLE_NEWS_HOST}/rss/articles/`);
    if (isWrapper) {
      droppedWrappedUnresolved += 1;
      continue;
    }

    const decision = applyPreFilter(finalUrl, item.title, item.snippet, query);
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

  return {
    provider: 'googlenews',
    fetchedAt: new Date().toISOString(),
    query: effectiveQuery,
    items,
    metrics: {
      used: items.length,
      totalReturned: Math.max(0, parts.length - 1),
      droppedWrappedUnresolved,
      decodeAttempts,
    },
  };
};
