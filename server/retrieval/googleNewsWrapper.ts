const GOOGLE_NEWS_HOST = 'news.google.com';
const WRAPPER_DECODE_CACHE_TTL_MS = 10 * 60 * 1000;
const wrapperDecodeCache = new Map<string, { value: string | null; expiresAt: number }>();
const MAX_WRAPPER_CACHE_ENTRIES = 2000;

const setWrapperDecodeCache = (token: string, value: string | null, now: number) => {
  wrapperDecodeCache.set(token, { value, expiresAt: now + WRAPPER_DECODE_CACHE_TTL_MS });
  if (wrapperDecodeCache.size > MAX_WRAPPER_CACHE_ENTRIES) {
    const oldestKey = wrapperDecodeCache.keys().next().value;
    if (oldestKey) wrapperDecodeCache.delete(oldestKey);
  }
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
  rawUrl?: string,
  signal?: AbortSignal,
): Promise<{ signature: string; timestamp: string } | null> => {
  // Keep this list intentionally short: every extra path attempt is an extra subrequest,
  // and Workers have per-request subrequest limits.
  const paths: string[] = [];
  const seen = new Set<string>();
  const addPath = (path: string) => {
    if (!path || seen.has(path)) return;
    seen.add(path);
    paths.push(path);
  };
  // Prefer the exact incoming URL path/query first (can carry locale/edition parameters).
  if (rawUrl) {
    try {
      const u = new URL(rawUrl);
      if (u.hostname === GOOGLE_NEWS_HOST) {
        addPath(`${u.pathname}${u.search || ''}`);
      }
    } catch {
      // ignore
    }
  }
  // One deterministic fallback.
  addPath(`/articles/${token}`);
  const extractFromHtml = (html: string): { signature: string; timestamp: string } | null => {
    const sig =
      (html.match(/data-n-a-sg=["']([^"']+)["']/i) || [])[1] ||
      (html.match(/"data-n-a-sg"\s*:\s*"([^"]+)"/i) || [])[1] ||
      '';
    const ts =
      (html.match(/data-n-a-ts=["']([^"']+)["']/i) || [])[1] ||
      (html.match(/"data-n-a-ts"\s*:\s*"([^"]+)"/i) || [])[1] ||
      '';
    if (!sig || !ts) return null;
    return { signature: sig, timestamp: ts };
  };

  for (const p of paths) {
    const res = await fetch(`https://${GOOGLE_NEWS_HOST}${p}`, {
      method: 'GET',
      signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: `https://${GOOGLE_NEWS_HOST}/`,
      },
    });
    if (!res.ok) continue;
    const html = await res.text();
    const parsed = extractFromHtml(html);
    if (parsed) return parsed;
  }

  return null;
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
      Referer: `https://${GOOGLE_NEWS_HOST}/`,
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

export const isGoogleNewsWrapperUrl = (rawUrl: string): boolean => {
  const token = extractWrapperToken(rawUrl);
  return Boolean(token);
};

export const resolveGoogleNewsWrapperUrl = async (rawUrl: string, signal?: AbortSignal): Promise<string | null> => {
  const token = extractWrapperToken(rawUrl);
  if (!token) return rawUrl;
  const now = Date.now();
  const cached = wrapperDecodeCache.get(token);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const direct = decodeDirectTokenUrl(token);
  if (direct) {
    setWrapperDecodeCache(token, direct, now);
    return direct;
  }

  const params = await fetchDecodingParams(token, rawUrl, signal);
  if (!params) {
    setWrapperDecodeCache(token, null, now);
    return null;
  }
  const decoded = await decodeViaBatchExecute(token, params, signal);
  setWrapperDecodeCache(token, decoded ?? null, now);
  return decoded;
};
