import type { AppConfig } from '../../shared/config';
import type { Logger } from '../obs/logger';
import { deduplicateArticles } from '../retrieval/dedup';
import { rankAndClusterArticles } from '../retrieval/ranking';
import { buildQueryIntent } from '../retrieval/queryIntent';
import type { NormalizedArticle, StoryCluster } from '../retrieval/types';

export interface ClusterArticlesArgs {
  runId: string;
  mainQuery?: string;
  articles: NormalizedArticle[];
  recencyHours: number;
  config: AppConfig;
  logger: Logger;
}

export interface ClusterArticlesResult {
  clusters: StoryCluster[];
  duplicatesRemoved: number;
  uniqueCount: number;
}

export const clusterArticles = async ({
  runId,
  mainQuery,
  articles,
  recencyHours,
  config,
  logger,
}: ClusterArticlesArgs): Promise<ClusterArticlesResult> => {
  const dedupResult = deduplicateArticles(articles, { enableSimilarity: false });
  const uniqueArticles = dedupResult.unique;

  const { clusters } = rankAndClusterArticles(uniqueArticles, {
    recencyHours,
    maxClusters: 5,
    clusterThreshold: config.retrieval.clusterThreshold ?? 0.65,
    attachThreshold: config.retrieval.attachThreshold ?? 0.55,
    queryIntent: mainQuery ? buildQueryIntent(mainQuery) : undefined,
  });

  const duplicatesRemoved = articles.length - uniqueArticles.length;
  logger.info('Clustering complete', { runId, accepted: articles.length, unique: uniqueArticles.length, clusters: clusters.length });

  return { clusters, duplicatesRemoved, uniqueCount: uniqueArticles.length };
};

