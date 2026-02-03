import type { EvidenceItem, SourceCatalogEntry, StoryCluster } from './types';

type SourceLike = {
  title?: string | null;
  url?: string | null;
  source?: string | null;
  publishedAt?: string | null;
};

const normalizeUrl = (value: string): string => value.trim();

const pickBetterTitle = (prev: string, next: string): string => {
  const p = (prev || '').trim();
  const n = (next || '').trim();
  if (!p) return n;
  if (!n) return p;
  // Prefer non-URL-ish titles and longer ones.
  const pLooksLikeUrl = /^https?:\/\//i.test(p);
  const nLooksLikeUrl = /^https?:\/\//i.test(n);
  if (pLooksLikeUrl && !nLooksLikeUrl) return n;
  if (nLooksLikeUrl && !pLooksLikeUrl) return p;
  return n.length > p.length ? n : p;
};

const pickBetterSource = (prev: string, next: string): string => {
  const p = (prev || '').trim();
  const n = (next || '').trim();
  if (!p) return n;
  if (!n) return p;
  return n.length > p.length ? n : p;
};

const pickBetterPublishedAt = (prev: string | null | undefined, next: string | null | undefined): string | null => {
  const p = prev ?? null;
  const n = next ?? null;
  if (!p) return n;
  if (!n) return p;
  // Prefer parseable publishedAt. If both parse, prefer newer.
  const pMs = Date.parse(p);
  const nMs = Date.parse(n);
  const pOk = !Number.isNaN(pMs);
  const nOk = !Number.isNaN(nMs);
  if (pOk && !nOk) return p;
  if (nOk && !pOk) return n;
  if (pOk && nOk) return nMs >= pMs ? n : p;
  // If neither parses, prefer non-empty deterministically.
  return n.length > p.length ? n : p;
};

const mergeSourceLike = (existing: SourceCatalogEntry | null, next: SourceLike, fallback: { url: string }): SourceCatalogEntry => {
  const url = normalizeUrl(next.url || fallback.url);
  const title = (next.title || url).trim();
  const source = (next.source || 'Source').trim() || 'Source';
  const publishedAt = next.publishedAt ?? null;

  if (!existing) {
    return {
      id: 0,
      url,
      title,
      source,
      publishedAt,
    };
  }

  return {
    ...existing,
    url,
    title: pickBetterTitle(existing.title, title),
    source: pickBetterSource(existing.source, source),
    publishedAt: pickBetterPublishedAt(existing.publishedAt, publishedAt),
  };
};

const compareDescPublishedAt = (a: SourceCatalogEntry, b: SourceCatalogEntry): number => {
  const aMs = a.publishedAt ? Date.parse(a.publishedAt) : NaN;
  const bMs = b.publishedAt ? Date.parse(b.publishedAt) : NaN;
  const aOk = !Number.isNaN(aMs);
  const bOk = !Number.isNaN(bMs);
  if (aOk && bOk) return bMs - aMs;
  if (aOk) return -1;
  if (bOk) return 1;
  // deterministic secondary ordering
  const aKey = `${a.source} ${a.title} ${a.url}`.toLowerCase();
  const bKey = `${b.source} ${b.title} ${b.url}`.toLowerCase();
  return aKey.localeCompare(bKey);
};

export const buildGlobalSourceCatalog = (args: {
  clusters: StoryCluster[];
  evidence: EvidenceItem[];
  maxSources?: number;
}): SourceCatalogEntry[] => {
  const byUrl = new Map<string, SourceCatalogEntry>();

  const add = (record: SourceLike) => {
    const rawUrl = typeof record.url === 'string' ? record.url : '';
    const url = normalizeUrl(rawUrl);
    if (!url) return;
    const existing = byUrl.get(url) ?? null;
    const merged = mergeSourceLike(existing, record, { url });
    byUrl.set(url, merged);
  };

  for (const cluster of args.clusters || []) {
    const rep = cluster.representative;
    add({
      url: rep.canonicalUrl,
      title: rep.title,
      source: rep.sourceName ?? rep.sourceHost,
      publishedAt: rep.publishedAt ?? null,
    });

    for (const member of cluster.members || []) {
      add({
        url: member.canonicalUrl,
        title: member.title,
        source: member.sourceName ?? member.sourceHost,
        publishedAt: member.publishedAt ?? null,
      });
    }

    for (const citation of cluster.citations || []) {
      add({
        url: citation.url,
        title: citation.title,
        source: null,
        publishedAt: null,
      });
    }
  }

  for (const item of args.evidence || []) {
    for (const citation of item.citations || []) {
      add({
        url: citation.url,
        title: citation.title,
        source: citation.source,
        publishedAt: citation.publishedAt ?? null,
      });
    }
  }

  const entries = Array.from(byUrl.values()).sort(compareDescPublishedAt);

  const max = typeof args.maxSources === 'number' && Number.isFinite(args.maxSources)
    ? Math.max(1, Math.floor(args.maxSources))
    : null;
  const limited = max ? entries.slice(0, max) : entries;

  return limited.map((entry, idx) => ({ ...entry, id: idx + 1 }));
};

export const applySourceCatalogToEvidence = (
  evidence: EvidenceItem[],
  sourceCatalog: SourceCatalogEntry[],
): EvidenceItem[] => {
  const byUrl = new Map<string, SourceCatalogEntry>();
  for (const entry of sourceCatalog) {
    byUrl.set(normalizeUrl(entry.url), entry);
  }

  return evidence.map((item) => ({
    ...item,
    citations: (item.citations || [])
      .map((citation) => {
        const url = normalizeUrl(citation.url);
        const mapped = byUrl.get(url);
        if (!mapped) {
          // Keep the citation but ensure ID is non-zero and stable-ish.
          return { ...citation, id: citation.id || 0 };
        }
        return {
          id: mapped.id,
          title: mapped.title,
          url: mapped.url,
          source: mapped.source,
          publishedAt: mapped.publishedAt ?? null,
        };
      })
      .sort((a, b) => a.id - b.id),
  }));
};
