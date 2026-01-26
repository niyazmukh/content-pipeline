import type { AppConfig } from '../../shared/config';
import type { Logger } from '../obs/logger';
import { sleep } from '../utils/async';
import { fetchGoogleCandidates } from './connectors/google';
import { fetchNewsApiCandidates } from './connectors/newsapi';
import { fetchEventRegistryCandidates } from './connectors/eventRegistry';
import { extractArticle } from './extraction';
import { evaluateArticle } from './filters';
import { deduplicateArticles } from './dedup';
import { rankAndClusterArticles } from './ranking';
import { Semaphore } from '../utils/concurrency';
import { tokenizeForRelevance } from './queryUtils';
import type { ArtifactStore } from '../../shared/artifacts';
import type {
  ProviderName,
  ConnectorArticle,
  ConnectorResult,
  RetrievalOrchestratorResult,
  NormalizedArticle,
  RetrievalBatch,
  ProviderRetrievalMetrics,
} from './types';

export interface RetrievalOrchestratorOptions {
  signal?: AbortSignal;
  minAccepted?: number;
  maxAttempts?: number;
  maxCandidates?: number;
  logger?: Logger;
  recencyHoursOverride?: number;
  store: ArtifactStore;
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

export const retrieveUnified = async (
  runId: string,
  query: string | { main?: string; google?: string; newsapi?: string; eventregistry?: string[] },
  config: AppConfig,
  options: RetrievalOrchestratorOptions,
): Promise<RetrievalOrchestratorResult> => {
  const startedAt = Date.now();
  const deadlineAt = startedAt + (config.retrieval.totalBudgetMs ?? 0);
  const recencyHours = options.recencyHoursOverride ?? config.recencyHours;
  const minAccepted = options.minAccepted ?? config.retrieval.minAccepted;
  const maxAttempts = options.maxAttempts ?? config.retrieval.maxAttempts;
  const maxCandidates = options.maxCandidates ?? maxAttempts * 2;
  const controller = new AbortController();
  const logger = options.logger;
  const store = options.store;
  let abortListener: (() => void) | null = null;
  if (options.signal) {
    if (options.signal.aborted) {
      throw new Error('Aborted');
    }
    abortListener = () => controller.abort();
    options.signal.addEventListener('abort', abortListener, { once: true });
  }

  // Determine specific queries for each provider.
  // Use a representative query string for logging/metadata if we have a map.
  // If a provider-specific query is missing, fall back to this string so we don't accidentally
  // disable a connector by passing an empty query (common with LLM-built query maps).
  const mainQueryString =
    typeof query === 'string'
      ? query
      : (query.main ||
          query.google ||
          query.newsapi ||
          (query.eventregistry && query.eventregistry.length ? query.eventregistry.join(' ') : 'multi-provider-query'));

  const googleQuery = typeof query === 'string' ? query : (query.google || mainQueryString);
  const newsApiQuery = typeof query === 'string' ? query : (query.newsapi || mainQueryString);
  const eventRegistryQuery =
    typeof query === 'string' ? [query] : (query.eventregistry && query.eventregistry.length ? query.eventregistry : [mainQueryString]);
  const queryTokens = tokenizeForRelevance(mainQueryString, { maxTokens: 24 });

  const filterOptions = {
    recencyHours,
    minWordCount: 150,
    minUniqueWords: 80,
    minRelevance: 0.1,
    bannedHostPatterns: [] as RegExp[],
    maxPromoPhraseMatches: 2,
  };

  try {
    const safeFetchConnector = async (
      provider: ProviderName,
      runner: () => Promise<ConnectorResult>,
      providerQuery: string | string[],
    ): Promise<ConnectorResult> => {
      try {
        return await runner();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger?.warn('Connector fetch failed', { runId, provider, error: message });
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

    const [google, newsapi, eventRegistry] = await Promise.all([
      safeFetchConnector('google', () =>
        fetchGoogleCandidates(googleQuery, config, { signal: controller.signal, recencyHours }), googleQuery
      ),
      safeFetchConnector('newsapi', () =>
        fetchNewsApiCandidates(newsApiQuery, config, { signal: controller.signal, recencyHours }), newsApiQuery
      ),
      safeFetchConnector('eventregistry', () =>
        fetchEventRegistryCandidates(eventRegistryQuery, config, { signal: controller.signal, recencyHours }), eventRegistryQuery
      ),
    ]);

    const connectorResults = [google, newsapi, eventRegistry];
    
    // Persist raw snapshots
    await Promise.all(
      connectorResults.map(async (result) => {
        if (result.metrics?.disabled) {
          return;
        }
        try {
          await store.saveRawProviderSnapshot(result.provider, runId, result);
        } catch (error) {
          logger?.warn('Failed to persist provider snapshot', {
            runId,
            provider: result.provider,
            error: String(error),
          });
        }
      }),
    );

    const allCandidates: CandidateRecord[] = [];
    for (const result of connectorResults) {
      for (const item of result.items) {
        allCandidates.push({ ...item, provider: result.provider });
      }
    }

    // Initialize provider metrics
    const providerMetrics = new Map<ProviderName, ProviderRetrievalMetrics>();
    (['google', 'newsapi', 'eventregistry'] as ProviderName[]).forEach((p) => {
      providerMetrics.set(p, {
        provider: p,
        returned: 0,
        preFiltered: 0,
        extractionAttempts: 0,
        accepted: 0,
        missingPublishedAt: 0,
        extractionErrors: [],
      });
    });

    const extractedArticles: NormalizedArticle[] = [];
    const extractionErrors: Array<{ url: string; error: string; provider: ProviderName }> = [];

    // Attach connector metadata to provider metrics and surface connector-level failures
    // in the same error channel used by the UI.
    for (const result of connectorResults) {
      const bucket = providerMetrics.get(result.provider);
      if (bucket) {
        bucket.query = result.query;
        const raw = result.metrics as any;
        bucket.disabled = Boolean(raw?.disabled);
        bucket.failed = Boolean(raw?.failed);
        bucket.error = typeof raw?.error === 'string' ? raw.error : null;
      }

      const metrics = result.metrics as any;
      const failed = Boolean(metrics?.failed);
      const error = typeof metrics?.error === 'string' ? metrics.error : null;
      if (failed && error) {
        extractionErrors.push({ url: `connector:${result.provider}`, error, provider: result.provider });
        providerMetrics.get(result.provider)?.extractionErrors.push({ url: `connector:${result.provider}`, error });
      }
    }

    // Update returned counts
    for (const c of allCandidates) {
      const m = providerMetrics.get(c.provider);
      if (m) m.returned++;
    }

    // Simple URL deduplication
    const seenUrls = new Set<string>();
    const uniqueCandidates: CandidateRecord[] = [];
    for (const c of allCandidates) {
      const key = uniquenessKey(c.url);
      if (!seenUrls.has(key)) {
        seenUrls.add(key);
        uniqueCandidates.push(c);
      }
    }

    // Extract and evaluate
    // NOTE: If we simply take the first N candidates, earlier providers (e.g. Google) can consume the entire
    // extraction budget, leaving later providers with `returned > 0` but `extractionAttempts = 0`.
    // To avoid starving providers and to improve source diversity, we select candidates in a provider round-robin.
    const attemptBudget = Math.max(0, Math.floor(maxAttempts));
    const providerQueues = new Map<ProviderName, CandidateRecord[]>([
      ['google', []],
      ['newsapi', []],
      ['eventregistry', []],
    ]);
    for (const candidate of uniqueCandidates) {
      providerQueues.get(candidate.provider)?.push(candidate);
    }

    const candidatesToTry: CandidateRecord[] = [];
    while (candidatesToTry.length < attemptBudget) {
      let progressed = false;
      for (const provider of ['google', 'newsapi', 'eventregistry'] as ProviderName[]) {
        if (candidatesToTry.length >= attemptBudget) break;
        const queue = providerQueues.get(provider);
        const next = queue?.shift();
        if (!next) continue;
        candidatesToTry.push(next);
        progressed = true;
      }
      if (!progressed) break;
    }
    const globalSemaphore = new Semaphore(Math.max(1, config.retrieval.globalConcurrency || 1));
    const perHostLimit = Math.max(1, config.retrieval.perHostConcurrency || 1);
    const hostSemaphores = new Map<string, Semaphore>();

    const getHost = (url: string): string => {
      try {
        return new URL(url).hostname.toLowerCase();
      } catch {
        return 'unknown';
      }
    };

    const getHostSemaphore = (host: string): Semaphore => {
      const key = host || 'unknown';
      const existing = hostSemaphores.get(key);
      if (existing) {
        return existing;
      }
      const created = new Semaphore(perHostLimit);
      hostSemaphores.set(key, created);
      return created;
    };

    const shouldStop = () => {
      if (controller.signal.aborted) return true;
      if (extractedArticles.length >= minAccepted) return true;
      if (Number.isFinite(deadlineAt) && deadlineAt > 0 && Date.now() >= deadlineAt) return true;
      return false;
    };

    const workerCount = Math.min(candidatesToTry.length, Math.max(1, config.retrieval.globalConcurrency || 1));
    let nextCandidateIndex = 0;

    const workers = new Array(workerCount).fill(null).map(async () => {
      while (true) {
        if (shouldStop()) {
          if (!controller.signal.aborted && Number.isFinite(deadlineAt) && deadlineAt > 0 && Date.now() >= deadlineAt) {
            controller.abort();
          }
          break;
        }

        const idx = nextCandidateIndex;
        nextCandidateIndex += 1;
        if (idx >= candidatesToTry.length) {
          break;
        }

        const candidate = candidatesToTry[idx];
        const m = providerMetrics.get(candidate.provider);
        if (m) m.extractionAttempts++;

        const host = getHost(candidate.url);
        const releaseGlobal = await globalSemaphore.acquire(controller.signal);
        const releaseHost = await getHostSemaphore(host).acquire(controller.signal);
        try {
          if (shouldStop()) {
            continue;
          }

          const outcome = await extractArticle(candidate, candidate.provider, {
            config,
            queryTokens,
            signal: controller.signal,
          });

          if (outcome.article) {
            const decision = evaluateArticle(outcome.article, filterOptions);
            // Google CSE often lacks reliable publishedAt metadata; don't treat that as a meaningful "missing date"
            // signal in metrics, as it can confuse users and doesn't imply extraction failure.
            if (decision.warnings.includes('missing_published_at') && candidate.provider !== 'google') {
              if (m) m.missingPublishedAt++;
            }

            if (decision.accept) {
              extractedArticles.push(outcome.article);
              if (m) m.accepted++;
            } else {
              if (m) m.preFiltered++;
            }
          } else if (outcome.error) {
            const msg = outcome.error;
            extractionErrors.push({ url: candidate.url, error: msg, provider: candidate.provider });
            if (m) m.extractionErrors.push({ url: candidate.url, error: msg });
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          extractionErrors.push({ url: candidate.url, error: msg, provider: candidate.provider });
          if (m) m.extractionErrors.push({ url: candidate.url, error: msg });
        } finally {
          releaseHost();
          releaseGlobal();
        }
      }
    });

    await Promise.all(workers);

    // Semantic Deduplication
    const dedupResult = deduplicateArticles(extractedArticles);
    const uniqueArticles = dedupResult.unique;

    // Rank and Cluster
    const { ranked, clusters } = rankAndClusterArticles(uniqueArticles, {
        recencyHours,
        maxClusters: 5,
        clusterThreshold: 0.65,
        attachThreshold: 0.55
    });

    const topArticles = ranked.slice(0, maxCandidates);

    // Save normalized articles
    await Promise.all(
      topArticles.map((article) => store.saveNormalizedArticle(article.id, article)),
    );

    const providerSummaries = Array.from(providerMetrics.values());

    const attemptedExtractions = providerSummaries.reduce(
      (sum, entry) => sum + (typeof entry.extractionAttempts === 'number' ? entry.extractionAttempts : 0),
      0,
    );

    const rejectedAfterExtraction = providerSummaries.reduce(
      (sum, entry) => sum + (typeof entry.preFiltered === 'number' ? entry.preFiltered : 0),
      0,
    );

    const urlDeduped = allCandidates.length - uniqueCandidates.length;

    const now = Date.now();
    const publishedAges = extractedArticles
      .map((article) => {
        if (!article.publishedAt) return null;
        const ms = Date.parse(article.publishedAt);
        if (Number.isNaN(ms)) return null;
        return Math.max(0, (now - ms) / (60 * 60 * 1000));
      })
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

    const newestArticleHours = publishedAges.length ? Math.min(...publishedAges) : null;
    const oldestArticleHours = publishedAges.length ? Math.max(...publishedAges) : null;

    const metrics: RetrievalBatch['metrics'] = {
      candidateCount: allCandidates.length,
      preFiltered: urlDeduped + rejectedAfterExtraction,
      attemptedExtractions,
      accepted: extractedArticles.length,
      duplicatesRemoved: extractedArticles.length - uniqueArticles.length,
      newestArticleHours: newestArticleHours == null ? null : Number(newestArticleHours.toFixed(2)),
      oldestArticleHours: oldestArticleHours == null ? null : Number(oldestArticleHours.toFixed(2)),
      perProvider: providerSummaries,
      extractionErrors,
    };

    return {
      batch: {
        runId,
        query: mainQueryString,
        recencyHours,
        fetchedAt: new Date().toISOString(),
        articles: topArticles,
        metrics,
      },
      clusters,
      providerSummaries,
    };
  } finally {
    if (abortListener && options.signal) {
      options.signal.removeEventListener('abort', abortListener);
    }
  }
};

