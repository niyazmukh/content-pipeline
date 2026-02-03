import type { AppConfig } from '../../shared/config';
import type { Logger } from '../obs/logger';
import type { StoryCluster, RetrievalBatch } from '../retrieval/types';
import { retrieveUnified } from '../retrieval/orchestrator';
import type { ArtifactStore } from '../../shared/artifacts';
import { TopicAnalysisService } from '../services/topicAnalysisService';
import { tokenizeForRelevance } from '../retrieval/queryUtils';

export interface TargetedResearchArgs {
  runId: string;
  outlinePoint: {
    index: number;
    text: string;
    summary?: string;
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
    lines.push(`${published} - ${rep.sourceName ?? rep.sourceHost}: ${rep.title} (${rep.canonicalUrl})\nKey points: ${rep.excerpt}`);
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

const countIntersection = (haystack: Set<string>, needles: Set<string>): number => {
  let hits = 0;
  for (const token of needles) {
    if (haystack.has(token)) hits += 1;
  }
  return hits;
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
  const baselineQuery = [topic, outlinePoint.text, outlinePoint.summary]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim() || topic.trim() || outlinePoint.text;
  logger.info('Running targeted research', { runId, outlineIndex: outlinePoint.index, point: outlinePoint.text });

  const analysisService = new TopicAnalysisService(config, logger);
  const analysis = await analysisService.analyze(baselineQuery, signal);
  const queryMap = {
    main: baselineQuery,
    google: analysis.queries.google || baselineQuery,
    newsapi: analysis.queries.newsapi || baselineQuery,
    eventregistry:
      Array.isArray(analysis.queries.eventregistry) && analysis.queries.eventregistry.length
        ? analysis.queries.eventregistry
        : [baselineQuery],
  };

  const retrievalResult = await retrieveUnified(runId, queryMap, config, {
    signal,
    minAccepted: Math.min(6, config.retrieval.minAccepted),
    maxAttempts: Math.min(18, config.retrieval.maxAttempts),
    maxCandidates: 36,
    recencyHoursOverride,
    logger,
    store,
  });

  const rankedClusters = retrievalResult.clusters.slice().sort((a, b) => b.score - a.score);
  const baselineTokens = new Set(tokenizeForRelevance(baselineQuery, { maxTokens: 24 }));
  const topicTokens = new Set(tokenizeForRelevance(topic, { maxTokens: 12 }));
  const keywordTokens = new Set(
    tokenizeForRelevance((analysis.keywords || []).filter(Boolean).join(' '), { maxTokens: 16 }),
  );

  const baselineSize = baselineTokens.size;
  const baselineMinHits = baselineSize <= 4 ? 1 : baselineSize <= 8 ? 2 : 3;

  const passesStrictGate = (cluster: StoryCluster): boolean => {
    const repText = `${cluster.representative.title} ${cluster.representative.excerpt || ''}`;
    const repTokens = new Set(tokenizeForRelevance(repText, { maxTokens: 128 }));

    const baselineHits = countIntersection(repTokens, baselineTokens);
    const topicHits = topicTokens.size ? countIntersection(repTokens, topicTokens) : 0;
    const keywordHits = keywordTokens.size ? countIntersection(repTokens, keywordTokens) : 0;

    if (topicTokens.size && topicHits === 0) return false;
    if (baselineHits < baselineMinHits) return false;
    if (keywordTokens.size && keywordHits === 0) return false;
    return true;
  };

  const passesFallbackGate = (cluster: StoryCluster): boolean => {
    const repText = `${cluster.representative.title} ${cluster.representative.excerpt || ''}`;
    const repTokens = new Set(tokenizeForRelevance(repText, { maxTokens: 128 }));

    const baselineHits = countIntersection(repTokens, baselineTokens);
    const topicHits = topicTokens.size ? countIntersection(repTokens, topicTokens) : 0;

    if (topicTokens.size && topicHits === 0) return false;
    return baselineHits >= Math.max(1, Math.min(2, baselineMinHits));
  };

  const strictClusters = rankedClusters.filter(passesStrictGate);
  const topClusters = (strictClusters.length ? strictClusters : rankedClusters.filter(passesFallbackGate)).slice(0, 8);

  if (logger && typeof logger.info === 'function') {
    logger.info('Targeted research cluster gating', {
      runId,
      outlineIndex: outlinePoint.index,
      totalClusters: rankedClusters.length,
      strictAccepted: strictClusters.length,
      finalAccepted: topClusters.length,
    });
  }

  if (!topClusters.length) {
    logger.warn('Targeted research returned no recent clusters', {
      runId,
      outlineIndex: outlinePoint.index,
      point: outlinePoint.text,
    });
  }

  const { digest, citations } = formatDigest(topClusters, effectiveRecencyHours);

  return {
    outlineIndex: outlinePoint.index,
    prompt: queryMap.main,
    batch: retrievalResult.batch,
    clusters: topClusters,
    digest,
    citations,
  };
};

