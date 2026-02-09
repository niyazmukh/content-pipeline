import type { AppConfig } from '../../shared/config';
import type { Logger } from '../obs/logger';
import { randomId } from '../../shared/crypto';
import { TopicAnalysisService } from '../services/topicAnalysisService';
import { fetchGoogleCandidates } from '../retrieval/connectors/google';
import { fetchGoogleNewsRssCandidates } from '../retrieval/connectors/googleNewsRss';
import { fetchNewsApiCandidates } from '../retrieval/connectors/newsapi';
import { fetchEventRegistryCandidates } from '../retrieval/connectors/eventRegistry';
import {
  normalizeGoogleLikeQuery,
  normalizeNewsApiQuery,
  normalizeEventRegistryKeywords,
} from '../retrieval/queryUtils';
import type { ConnectorResult, ConnectorArticle, ProviderName } from '../retrieval/types';
import type { RetrievalCandidate, RetrievalProviderMetrics } from '../../shared/types';

export interface RetrieveCandidatesArgs {
  runId?: string;
  topic: string;
  recencyHoursOverride?: number;
  config: AppConfig;
  logger: Logger;
  signal?: AbortSignal;
}

export interface RetrieveCandidatesResult {
  runId: string;
  recencyHours: number;
  mainQuery: string;
  candidateCount: number;
  candidates: RetrievalCandidate[];
  perProvider: RetrievalProviderMetrics[];
}

interface CandidateRecord extends ConnectorArticle {
  provider: ProviderName;
}

const uniquenessKey = (url: string): string => {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.search = '';
    return parsed.toString().toLowerCase();
  } catch {
    return url.toLowerCase();
  }
};

const minifyProviderData = (provider: ProviderName, value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  const maxLen = 5000;

  if (provider === 'eventregistry') {
    const body =
      (data as any).body ??
      (data as any).articleBody ??
      (data as any).content ??
      null;
    if (!body) return null;
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return { body: text.slice(0, maxLen) };
  }

  if (provider === 'newsapi') {
    const content = (data as any).content ?? (data as any).description ?? null;
    if (!content) return null;
    const text = typeof content === 'string' ? content : JSON.stringify(content);
    return { content: text.slice(0, maxLen) };
  }

  return null;
};

const initProviderMetrics = (): Map<ProviderName, RetrievalProviderMetrics> => {
  const map = new Map<ProviderName, RetrievalProviderMetrics>();
  (['google', 'googlenews', 'newsapi', 'eventregistry'] as ProviderName[]).forEach((provider) => {
    map.set(provider, {
      provider,
      returned: 0,
      preFiltered: 0,
      extractionAttempts: 0,
      accepted: 0,
      missingPublishedAt: 0,
      extractionErrors: [],
    });
  });
  return map;
};

export const retrieveCandidates = async ({
  runId: providedRunId,
  topic,
  recencyHoursOverride,
  config,
  logger,
  signal,
}: RetrieveCandidatesArgs): Promise<RetrieveCandidatesResult> => {
  const runId = providedRunId && providedRunId.trim().length ? providedRunId.trim() : randomId();
  const recencyHours = recencyHoursOverride ?? config.recencyHours;

  let searchQuery: string | { google?: string; newsapi?: string; eventregistry?: string[]; main?: string } = topic;
  try {
    const analysisService = new TopicAnalysisService(config, logger);
    const analysis = await analysisService.analyze(topic, signal);
    searchQuery = analysis.queries;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('Topic analysis failed; using raw topic', { runId, error: message });
    searchQuery = topic;
  }

  const mainQuery =
    typeof searchQuery === 'string'
      ? searchQuery
      : (searchQuery.main ||
          searchQuery.google ||
          searchQuery.newsapi ||
          (searchQuery.eventregistry && searchQuery.eventregistry.length ? searchQuery.eventregistry.join(' ') : topic));

  const rawGoogleQuery = typeof searchQuery === 'string' ? searchQuery : (searchQuery.google || mainQuery);
  const rawNewsApiQuery = typeof searchQuery === 'string' ? searchQuery : (searchQuery.newsapi || mainQuery);
  const rawEventRegistryQuery =
    typeof searchQuery === 'string'
      ? [searchQuery]
      : (searchQuery.eventregistry && searchQuery.eventregistry.length ? searchQuery.eventregistry : [mainQuery]);

  const googleQuery = normalizeGoogleLikeQuery(rawGoogleQuery);
  const newsApiQuery = normalizeNewsApiQuery(rawNewsApiQuery);
  const eventRegistryQuery = normalizeEventRegistryKeywords(rawEventRegistryQuery);

  const safeFetchConnector = async (
    provider: ProviderName,
    runner: () => Promise<ConnectorResult>,
    providerQuery: string | string[],
  ): Promise<ConnectorResult> => {
    try {
      return await runner();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('Connector fetch failed', { runId, provider, error: message });
      return {
        provider,
        fetchedAt: new Date().toISOString(),
        query: Array.isArray(providerQuery) ? providerQuery.join(' OR ') : providerQuery,
        items: [],
        metrics: {
          failed: true,
          error: message,
        },
      };
    }
  };

  const connectorResults = await Promise.all([
    safeFetchConnector('google', () => fetchGoogleCandidates(googleQuery, config, { signal, recencyHours }), googleQuery),
    safeFetchConnector(
      'googlenews',
      () => fetchGoogleNewsRssCandidates(googleQuery, config, { signal, recencyHours }),
      googleQuery,
    ),
    safeFetchConnector('newsapi', () => fetchNewsApiCandidates(newsApiQuery, config, { signal, recencyHours }), newsApiQuery),
    safeFetchConnector(
      'eventregistry',
      () => fetchEventRegistryCandidates(eventRegistryQuery, config, { signal, recencyHours }),
      eventRegistryQuery,
    ),
  ]);

  const providerMetrics = initProviderMetrics();
  const allCandidates: CandidateRecord[] = [];
  for (const result of connectorResults) {
    const bucket = providerMetrics.get(result.provider);
    if (bucket) {
      bucket.query = result.query;
      const raw = result.metrics as any;
      bucket.disabled = Boolean(raw?.disabled);
      bucket.failed = Boolean(raw?.failed);
      bucket.error = typeof raw?.error === 'string' ? raw.error : null;
    }

    for (const item of result.items) {
      allCandidates.push({ ...item, provider: result.provider });
      const m = providerMetrics.get(result.provider);
      if (m) m.returned += 1;
    }
  }

  const seenUrls = new Set<string>();
  const uniqueCandidates: CandidateRecord[] = [];
  const dedupedCounts = new Map<ProviderName, number>([
    ['google', 0],
    ['googlenews', 0],
    ['newsapi', 0],
    ['eventregistry', 0],
  ]);
  for (const c of allCandidates) {
    const key = uniquenessKey(c.url);
    if (!seenUrls.has(key)) {
      seenUrls.add(key);
      uniqueCandidates.push(c);
    } else {
      dedupedCounts.set(c.provider, (dedupedCounts.get(c.provider) ?? 0) + 1);
    }
  }

  const uniqueCounts = new Map<ProviderName, number>([
    ['google', 0],
    ['googlenews', 0],
    ['newsapi', 0],
    ['eventregistry', 0],
  ]);
  for (const c of uniqueCandidates) {
    uniqueCounts.set(c.provider, (uniqueCounts.get(c.provider) ?? 0) + 1);
  }

  for (const provider of ['google', 'googlenews', 'newsapi', 'eventregistry'] as ProviderName[]) {
    const bucket = providerMetrics.get(provider);
    if (!bucket) continue;
    bucket.deduped = dedupedCounts.get(provider) ?? 0;
    bucket.unique = uniqueCounts.get(provider) ?? 0;
    bucket.queued = bucket.unique;
    bucket.skipped = 0;
  }

  const candidates: RetrievalCandidate[] = uniqueCandidates.map((c) => ({
    id: c.id,
    provider: c.provider,
    title: c.title,
    url: c.url,
    sourceName: c.sourceName ?? null,
    publishedAt: c.publishedAt ?? null,
    snippet: c.snippet ?? null,
    providerData: minifyProviderData(c.provider, c.providerData),
  }));

  return {
    runId,
    recencyHours,
    mainQuery,
    candidateCount: allCandidates.length,
    candidates,
    perProvider: Array.from(providerMetrics.values()),
  };
};
