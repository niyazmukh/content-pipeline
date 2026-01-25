import type { AppConfig } from '../../shared/config';
import type { SseStream } from '../../shared/sse';
import { makeStageEmitter, type StageEvent } from './stageEmitter';
import { retrieveUnified } from '../retrieval/orchestrator';
import { createLogger } from '../obs/logger';
import { randomId } from '../../shared/crypto';
import { generateOutlineFromClusters } from './outline';
import { TopicAnalysisService } from '../services/topicAnalysisService';
import type { ArtifactStore } from '../../shared/artifacts';
import type {
  ProviderName,
  ProviderRetrievalMetrics,
  RetrievalMetrics,
  NormalizedArticle,
  StoryCluster,
} from '../retrieval/types';

export interface RunOutlineStreamArgs {
  topic: string;
  recencyHoursOverride?: number;
  config: AppConfig;
  stream: SseStream;
  store: ArtifactStore;
  signal?: AbortSignal;
}

const sendStageEvent = <T>(stream: SseStream, event: StageEvent<T>) => {
  stream.send(event);
};

const PROVIDER_ORDER: ProviderName[] = ['google', 'newsapi', 'eventregistry'];

const buildProviderBaselines = (): Map<ProviderName, ProviderRetrievalMetrics> =>
  new Map(
    PROVIDER_ORDER.map((provider) => [
      provider,
      {
        provider,
        returned: 0,
        preFiltered: 0,
        extractionAttempts: 0,
        accepted: 0,
        missingPublishedAt: 0,
        extractionErrors: [],
      },
    ]),
  );

const mergeProviderSummaries = (
  summaries: ProviderRetrievalMetrics[] | undefined,
  articles: NormalizedArticle[],
): ProviderRetrievalMetrics[] => {
  const baseline = buildProviderBaselines();
  const acceptedProvided = new Set<ProviderName>();

  if (Array.isArray(summaries)) {
    for (const entry of summaries) {
      if (!entry) continue;
      const bucket = baseline.get(entry.provider);
      if (!bucket) continue;
      if (typeof entry.returned === 'number') {
        bucket.returned = entry.returned;
      }
      if (typeof entry.query === 'string') {
        bucket.query = entry.query;
      }
      if (typeof entry.preFiltered === 'number') {
        bucket.preFiltered = entry.preFiltered;
      }
      if (typeof entry.extractionAttempts === 'number') {
        bucket.extractionAttempts = entry.extractionAttempts;
      }
      if (typeof entry.accepted === 'number') {
        bucket.accepted = entry.accepted;
        if (entry.accepted > 0) {
          acceptedProvided.add(entry.provider);
        }
      }
      if (typeof entry.missingPublishedAt === 'number') {
        bucket.missingPublishedAt = entry.missingPublishedAt;
      }
      if (typeof entry.disabled === 'boolean') {
        bucket.disabled = entry.disabled;
      }
      if (typeof entry.failed === 'boolean') {
        bucket.failed = entry.failed;
      }
      if (typeof entry.error === 'string' || entry.error === null) {
        bucket.error = entry.error;
      }
      bucket.extractionErrors = Array.isArray(entry.extractionErrors) ? entry.extractionErrors : [];
    }
  }

  if (Array.isArray(articles) && articles.length > 0) {
    for (const article of articles) {
      const bucket = baseline.get(article.provenance.provider);
      if (!bucket) continue;
      if (!acceptedProvided.has(article.provenance.provider)) {
        bucket.accepted += 1;
      }
    }
  }

  return Array.from(baseline.values());
};

const ensureProviderMetrics = (
  metrics: RetrievalMetrics,
  summaries: ProviderRetrievalMetrics[] | undefined,
  articles: NormalizedArticle[],
): RetrievalMetrics => ({
  ...metrics,
  perProvider: mergeProviderSummaries(summaries, articles),
});

export const handleRunOutlineStream = async ({
  topic,
  recencyHoursOverride,
  config,
  stream,
  store,
  signal,
}: RunOutlineStreamArgs): Promise<void> => {
  const runId = randomId();
  const logger = createLogger(config);
  await store.ensureLayout();
  const effectiveRecencyHours = recencyHoursOverride ?? config.recencyHours;

  const stageSender = <T>(event: StageEvent<T>) => sendStageEvent(stream, event);
  const retrievalStage = makeStageEmitter(runId, 'retrieval', stageSender);
  const rankingStage = makeStageEmitter(runId, 'ranking', stageSender);
  const outlineStage = makeStageEmitter(runId, 'outline', stageSender);
  let currentStage = retrievalStage;

  try {
    let searchQuery: string | { google: string; newsapi: string; eventregistry: string[] } = topic;
    try {
      const analysisService = new TopicAnalysisService(config, logger);
      const analysis = await analysisService.analyze(topic, signal);
      searchQuery = analysis.queries;
      logger.info('Topic analysis result', { runId, analysis });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('Topic analysis failed; using raw topic', { runId, error: message });
      searchQuery = topic;
    }

    currentStage = retrievalStage;
    retrievalStage.start({ message: `Retrieving recent stories for "${topic}"` });
    const retrievalResult = await retrieveUnified(runId, searchQuery, config, {
      signal,
      logger,
      recencyHoursOverride,
      store,
    });

    const enrichedMetrics = ensureProviderMetrics(
      retrievalResult.batch.metrics,
      retrievalResult.providerSummaries,
      retrievalResult.batch.articles,
    );
    retrievalResult.batch.metrics = enrichedMetrics;
    await store.saveRunArtifact(runId, 'retrieval_batch', retrievalResult.batch);
    await store.saveRunArtifact(runId, 'retrieval_clusters', retrievalResult.clusters);

    retrievalStage.success({
      message: `Accepted ${retrievalResult.batch.articles.length} articles`,
      data: enrichedMetrics,
    });

    currentStage = rankingStage;
    rankingStage.start({ message: 'Clustering and scoring stories' });
    rankingStage.success({
      data: {
        clusters: retrievalResult.clusters,
      },
    });

    currentStage = outlineStage;
    outlineStage.start({ message: 'Generating thesis and outline' });
    const outlineResult = await generateOutlineFromClusters({
      runId,
      topic,
      clusters: retrievalResult.clusters,
      recencyHours: effectiveRecencyHours,
      config,
      logger,
      signal,
    });
    await store.saveRunArtifact(runId, 'outline', outlineResult);

    outlineStage.success({
      data: {
        runId,
        recencyHours: effectiveRecencyHours,
        outline: outlineResult.outline,
        clusters: retrievalResult.clusters,
      } satisfies { runId: string; recencyHours: number; outline: unknown; clusters: StoryCluster[] },
    });

    stream.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Outline pipeline failed', { runId, error: message });
    currentStage.failure(error);
    stream.sendJson('fatal', { error: message });
    stream.close();
  }
};
