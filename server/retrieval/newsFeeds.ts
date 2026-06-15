/**
 * Official publisher RSS feeds.
 *
 * Decision grounded in official sources: Google's official News API was
 * deprecated (turndown completed Feb 2016) with no official replacement, the
 * Google News RSS endpoint is unofficial and "never designed for data pipelines",
 * and Google's policy (https://support.google.com/websearch/answer/86640) blocks
 * automated queries by design. Therefore the dependable, sanctioned way to ingest
 * news is each publisher's OWN RSS feed, which they publish for syndication. These
 * are fast, CDN-served, return real article URLs, and are not IP-blocked.
 *
 * Override with GOOGLE_NEWS_RSS_FEEDS (comma-separated).
 */
export const DEFAULT_PUBLISHER_RSS_FEEDS: string[] = [
  'https://feeds.bbci.co.uk/news/business/rss.xml',
  'https://feeds.bbci.co.uk/news/technology/rss.xml',
  'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml',
  'https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml',
  'https://www.theguardian.com/uk/business/rss',
  'https://finance.yahoo.com/news/rssindex',
  'https://techcrunch.com/feed/',
];

export const deriveFeedSourceName = (feedUrl: string): string => {
  try {
    return new URL(feedUrl).hostname.toLowerCase().replace(/^(www|feeds|rss|feed)\./, '');
  } catch {
    return 'rss';
  }
};
