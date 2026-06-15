/**
 * Fetch relays for Google News RSS.
 *
 * Google refuses automated RSS requests from datacenter/Cloudflare-Worker egress
 * IPs, returning an HTTP 503 "Sorry / automated queries" HTML page. There is no
 * official API and the egress IP of a Worker cannot be changed, so the robust way
 * to keep ingesting Google News RSS is to retry the SAME Google News URL through a
 * read-through relay whose IP Google does not block.
 *
 * Each entry is a URL template:
 *   {url}    -> URL-encoded Google News RSS URL
 *   {rawurl} -> raw (unencoded) Google News RSS URL
 *
 * Override with GOOGLE_NEWS_RSS_PROXIES (comma-separated). For guaranteed
 * reliability and privacy, point this at a relay you control (e.g. a tiny
 * companion Worker / serverless function that just proxies the request).
 * The default below is a public best-effort relay and may rate-limit.
 */
export const DEFAULT_GOOGLE_NEWS_PROXIES: string[] = [
  'https://api.allorigins.win/raw?url={url}',
];

export const buildProxiedUrl = (template: string, target: string): string => {
  if (template.includes('{url}')) return template.replace('{url}', encodeURIComponent(target));
  if (template.includes('{rawurl}')) return template.replace('{rawurl}', target);
  return `${template}${template.includes('?') ? '&' : '?'}url=${encodeURIComponent(target)}`;
};
