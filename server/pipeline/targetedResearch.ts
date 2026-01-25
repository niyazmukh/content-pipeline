import type { AppConfig } from '../../shared/config';
import type { Logger } from '../obs/logger';
import type { StoryCluster, RetrievalBatch } from '../retrieval/types';
import { retrieveUnified } from '../retrieval/orchestrator';
import { generateSearchQueriesForPoint } from './searchQueries';
type RetrievalResult = ReturnType<typeof retrieveUnified> extends Promise<infer T> ? T : never;
import { rewriteTopicToQuery } from './topicQuery';
import type { ArtifactStore } from '../../shared/artifacts';

export interface TargetedResearchArgs {
  runId: string;
  outlinePoint: {
    index: number;
    text: string;
  };
  topic: string;
  recencyHoursOverride?: number;
  config: AppConfig;
  logger: Logger;
  store: ArtifactStore;
  signal?: AbortSignal;
}

export interface EvidenceSnippet {
  id: number;
  title: string;
  url: string;
  publishedAt?: string | null;
  source: string;
}

export interface TargetedResearchResult {
  outlineIndex: number;
  prompt: string;
  batch: RetrievalBatch;
  clusters: StoryCluster[];
  digest: string;
  citations: EvidenceSnippet[];
}

const rewriteCache = new Map<string, string>();
const rewriteInflight = new Map<string, Promise<string>>();

const trimCache = () => {
  const MAX_ENTRIES = 32;
  if (rewriteCache.size <= MAX_ENTRIES) {
    return;
  }
  const iterator = rewriteCache.keys();
  while (rewriteCache.size > MAX_ENTRIES) {
    const next = iterator.next();
    if (next.done) {
      break;
    }
    rewriteCache.delete(next.value);
  }
};

const normalizeQueryWithRewrite = async (
  rawQuery: string,
  {
    config,
    logger,
    signal,
  }: {
    config: AppConfig;
    logger: Logger;
    signal?: AbortSignal;
  },
): Promise<string> => {
  const cleaned = rawQuery.replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return '';
  }

  const cached = rewriteCache.get(cleaned);
  if (cached) {
    return cached;
  }

  let inflight = rewriteInflight.get(cleaned);
  if (!inflight) {
    inflight = rewriteTopicToQuery({
      rawTopic: cleaned,
      config,
      logger,
      signal,
    });
    rewriteInflight.set(cleaned, inflight);
  }

  try {
    const rewritten = (await inflight)?.replace(/\s+/g, ' ').trim() || '';
    rewriteInflight.delete(cleaned);
    if (rewritten) {
      rewriteCache.set(cleaned, rewritten);
    }
    trimCache();
    return rewritten;
  } catch (error) {
    rewriteInflight.delete(cleaned);
    logger.warn('Targeted query rewrite failed; using raw query', {
      query: cleaned,
      error: error instanceof Error ? error.message : String(error),
    });
    return cleaned;
  }
};

const formatDigest = (
  clusters: StoryCluster[],
  recencyHours: number,
): { digest: string; citations: EvidenceSnippet[] } => {
  if (!clusters.length) {
    const recencyDays = Math.max(1, Math.round(recencyHours / 24));
    return {
      digest: `No fresh evidence found within the last ${recencyDays} day${recencyDays === 1 ? '' : 's'}.`,
      citations: [],
    };
  }

  const lines: string[] = [];
  const citations: EvidenceSnippet[] = [];
  const topClusters = clusters.slice(0, 5);

  topClusters.forEach((cluster, idx) => {
    const citationId = idx + 1;
    const rep = cluster.representative;
    const published = rep.publishedAt ? rep.publishedAt.split('T')[0] : 'Unknown date';
    lines.push(
      `[${citationId}] ${published} - ${rep.sourceName ?? rep.sourceHost}: ${rep.title}. Key points: ${rep.excerpt}`,
    );
    citations.push({
      id: citationId,
      title: rep.title,
      url: rep.canonicalUrl,
      publishedAt: rep.publishedAt,
      source: rep.sourceName ?? rep.sourceHost,
    });
  });

  const digest = lines.join('\n');
  return { digest, citations };
};

export const performTargetedResearch = async ({
  runId,
  outlinePoint,
  topic,
  recencyHoursOverride,
  config,
  logger,
  store,
  signal,
}: TargetedResearchArgs): Promise<TargetedResearchResult> => {
  const effectiveRecencyHours = recencyHoursOverride ?? config.recencyHours;
  // Baseline query combines topic and point
  const baselineQuery =
    `${topic} ${outlinePoint.text}`.replace(/\s+/g, ' ').trim() || topic.trim() || outlinePoint.text;
  logger.info('Running targeted research', { runId, outlineIndex: outlinePoint.index, point: outlinePoint.text });

  // Try LLM-driven query expansion (proModel); fallback to baseline
  let queries: string[] = [];
  try {
    queries = await generateSearchQueriesForPoint({
      topic,
      point: outlinePoint.text,
      recencyHours: effectiveRecencyHours,
      config,
      logger,
      signal,
    });
  } catch (err) {
    logger.warn('Query expansion failed; falling back to baseline', { error: (err as Error).message });
  }
  if (!queries.length) {
    queries = [baselineQuery];
  } else {
    // Always include the baseline as a safety net
    queries = Array.from(new Set([baselineQuery, ...queries])).slice(0, 2);
  }

  const normalizedQueries: string[] = [];
  for (const raw of queries) {
    const normalized =
      (await normalizeQueryWithRewrite(raw, { config, logger, signal })) || raw.replace(/\s+/g, ' ').trim();
    const finalQuery = normalized || raw;
    if (!finalQuery || normalizedQueries.includes(finalQuery)) {
      continue;
    }
    normalizedQueries.push(finalQuery);
  }
  if (!normalizedQueries.length) {
    normalizedQueries.push(baselineQuery);
  }

  // Retrieve for each query (in parallel) and merge
  const mergedClusters: StoryCluster[] = [];
  const seenClusterIds = new Set<string>();
  const batches: RetrievalBatch[] = [];

  const retrievals = normalizedQueries.map((q, index) =>
    retrieveUnified(runId, q, config, {
      signal,
      minAccepted: Math.min(6, config.retrieval.minAccepted),
      maxAttempts: Math.min(18, config.retrieval.maxAttempts),
      maxCandidates: 36,
      recencyHoursOverride,
      logger,
      store,
    })
      .then((partial) => ({ index, partial }))
      .catch((error) => {
        logger.warn('Targeted query retrieval failed', {
          runId,
          query: q,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }),
  );

  const resolved = (await Promise.all(retrievals))
    .filter((entry): entry is { index: number; partial: RetrievalResult } => Boolean(entry))
    .sort((a, b) => a.index - b.index);

  for (const { partial } of resolved) {
    batches.push(partial.batch);
    for (const cluster of partial.clusters) {
      if (!seenClusterIds.has(cluster.clusterId)) {
        seenClusterIds.add(cluster.clusterId);
        mergedClusters.push(cluster);
      }
    }
  }

  // Keep a focused top set; representative.score already encapsulates ranking signals
  const topClusters = mergedClusters
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  if (!topClusters.length) {
    logger.warn('Targeted research returned no recent clusters', {
      runId,
      outlineIndex: outlinePoint.index,
      point: outlinePoint.text,
    });
  }

  const { digest, citations } = formatDigest(topClusters, effectiveRecencyHours);

  // Pick the first batch as reference for persistence/metrics; this is advisory-only for the UI
  const primaryBatch = batches[0] ?? ({
    runId,
    query: normalizedQueries[0] ?? baselineQuery,
    recencyHours: effectiveRecencyHours,
    fetchedAt: new Date().toISOString(),
    articles: [],
    metrics: {
      candidateCount: 0,
      preFiltered: 0,
      attemptedExtractions: 0,
      accepted: 0,
      duplicatesRemoved: 0,
      newestArticleHours: null,
      oldestArticleHours: null,
      perProvider: [],
      extractionErrors: [],
    },
  } as unknown as RetrievalBatch);

  return {
    outlineIndex: outlinePoint.index,
    prompt: normalizedQueries.join(' | '),
    batch: primaryBatch,
    clusters: topClusters,
    digest,
    citations,
  };
};

