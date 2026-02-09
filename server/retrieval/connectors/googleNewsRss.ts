import type { AppConfig } from '../../../shared/config';
import { hashString, randomId } from '../../../shared/crypto';
import type { ConnectorArticle, ConnectorResult } from '../types';
import { applyPreFilter } from '../preFilter';
import { isGoogleNewsWrapperUrl } from '../googleNewsWrapper';
const GOOGLE_NEWS_RSS_ENDPOINT = 'https://news.google.com/rss/search';
const GOOGLE_NEWS_HOST = 'news.google.com';

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
  const recencyCutoffMs = Date.now() - recencyHours * 60 * 60 * 1000;
  const effectiveQuery = query;

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
    const title = stripTags(decodeXmlEntities(titleRaw || url)) || url;
    const snippet = descRaw ? stripTags(decodeXmlEntities(descRaw)) : null;
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
      sourceName: source.name,
      sourceUrl: source.url,
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
      wrapperCandidates,
    },
  };
};
