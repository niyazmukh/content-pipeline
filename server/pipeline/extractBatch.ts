import type { AppConfig } from '../../shared/config';
import type { Logger } from '../obs/logger';
import { Semaphore } from '../utils/concurrency';
import { extractArticle } from '../retrieval/extraction';
import { evaluateArticle } from '../retrieval/filters';
import { tokenizeForRelevance } from '../retrieval/queryUtils';
import type { ProviderName, NormalizedArticle } from '../retrieval/types';
import type { RetrievalCandidate, RetrievalProviderMetrics } from '../../shared/types';

export interface ExtractBatchArgs {
  runId: string;
  mainQuery: string;
  recencyHours: number;
  candidates: RetrievalCandidate[];
  config: AppConfig;
  logger: Logger;
  signal?: AbortSignal;
}

export interface ExtractBatchResult {
  accepted: NormalizedArticle[];
  perProvider: RetrievalProviderMetrics[];
  extractionErrors: Array<{ url: string; error: string; provider: ProviderName }>;
}

const initProviderMetrics = (): Map<ProviderName, RetrievalProviderMetrics> => {
  const map = new Map<ProviderName, RetrievalProviderMetrics>();
  (['google', 'newsapi', 'eventregistry'] as ProviderName[]).forEach((provider) => {
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

export const extractBatch = async ({
  runId,
  mainQuery,
  recencyHours,
  candidates,
  config,
  logger,
  signal,
}: ExtractBatchArgs): Promise<ExtractBatchResult> => {
  const queryTokens = tokenizeForRelevance(mainQuery, { maxTokens: 24 });
  const filterOptions = {
    recencyHours,
    minWordCount: 150,
    minUniqueWords: 80,
    minRelevance: 0.1,
    bannedHostPatterns: [] as RegExp[],
    maxPromoPhraseMatches: 2,
  };

  const providerMetrics = initProviderMetrics();
  const accepted: NormalizedArticle[] = [];
  const extractionErrors: Array<{ url: string; error: string; provider: ProviderName }> = [];

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
    if (existing) return existing;
    const created = new Semaphore(perHostLimit);
    hostSemaphores.set(key, created);
    return created;
  };

  const workerCount = Math.min(candidates.length, Math.max(1, config.retrieval.globalConcurrency || 1));
  let nextIndex = 0;

  const workers = new Array(workerCount).fill(null).map(async () => {
    while (true) {
      const idx = nextIndex;
      nextIndex += 1;
      if (idx >= candidates.length) break;

      const candidate = candidates[idx];
      const provider = candidate.provider as ProviderName;
      const bucket = providerMetrics.get(provider);
      if (bucket) bucket.extractionAttempts += 1;

      const host = getHost(candidate.url);
      const releaseGlobal = await globalSemaphore.acquire(signal);
      const releaseHost = await getHostSemaphore(host).acquire(signal);
      try {
        const outcome = await extractArticle(
          {
            id: candidate.id,
            title: candidate.title,
            url: candidate.url,
            sourceName: candidate.sourceName ?? null,
            publishedAt: candidate.publishedAt ?? null,
            snippet: candidate.snippet ?? null,
            providerData: candidate.providerData ?? null,
          },
          provider,
          { config, queryTokens, signal },
        );

        if (outcome.article) {
          const decision = evaluateArticle(outcome.article, filterOptions);
          if (decision.warnings.includes('missing_published_at') && provider !== 'google') {
            if (bucket) bucket.missingPublishedAt += 1;
          }

          if (decision.accept) {
            accepted.push(outcome.article);
            if (bucket) bucket.accepted += 1;
          } else {
            if (bucket) bucket.preFiltered += 1;
            if (bucket && decision.reasons.length) {
              bucket.rejectionReasons = bucket.rejectionReasons ?? {};
              for (const reason of decision.reasons) {
                bucket.rejectionReasons[reason] = (bucket.rejectionReasons[reason] ?? 0) + 1;
              }
            }
          }
        } else if (outcome.error) {
          const msg = outcome.error;
          extractionErrors.push({ url: candidate.url, error: msg, provider });
          if (bucket) bucket.extractionErrors.push({ url: candidate.url, error: msg });
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        extractionErrors.push({ url: candidate.url, error: msg, provider });
        if (bucket) bucket.extractionErrors.push({ url: candidate.url, error: msg });
      } finally {
        releaseHost();
        releaseGlobal();
      }
    }
  });

  await Promise.all(workers);

  logger.info('Batch extraction complete', {
    runId,
    candidates: candidates.length,
    accepted: accepted.length,
    errors: extractionErrors.length,
  });

  return {
    accepted,
    perProvider: Array.from(providerMetrics.values()),
    extractionErrors,
  };
};
