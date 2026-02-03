import type { AppConfig } from '../../../shared/config';
import { hashString, randomId } from '../../../shared/crypto';
import type { ConnectorArticle, ConnectorResult } from '../types';
import { applyPreFilter } from '../preFilter';

const GOOGLE_NEWS_RSS_ENDPOINT = 'https://news.google.com/rss/search';

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
  const items: ConnectorArticle[] = [];

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

    const title = stripTags(decodeXmlEntities(titleRaw || url)) || url;
    const snippet = descRaw ? stripTags(decodeXmlEntities(descRaw)) : null;
    const publishedAt = parsePubDateToIso(pubDateRaw);

    const decision = applyPreFilter(url, title, snippet, query);
    if (!decision.pass) {
      continue;
    }

    items.push({
      id: buildArticleId(url),
      title,
      url,
      sourceName: source.name,
      publishedAt,
      snippet,
      providerData: {
        sourceName: source.name,
        sourceUrl: source.url,
        pubDate: pubDateRaw,
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
    },
  };
};

