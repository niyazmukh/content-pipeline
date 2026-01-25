import type { AppConfig } from '../../shared/config';
import type { SseStream } from '../../shared/sse';
import { makeStageEmitter, type StageEvent } from './stageEmitter';
import { retrieveUnified } from '../retrieval/orchestrator';
import { createLogger } from '../obs/logger';
import { randomId } from '../../shared/crypto';
import { TopicAnalysisService } from '../services/topicAnalysisService';
import type { ArtifactStore } from '../../shared/artifacts';
import type { RetrievalMetrics, StoryCluster } from '../retrieval/types';

export interface RunRetrievalStreamArgs {
  topic: string;
  recencyHoursOverride?: number;
  config: AppConfig;
  stream: SseStream;
  store: ArtifactStore;
  signal?: AbortSignal;
}

export interface RetrievalRunResult {
  runId: string;
  recencyHours: number;
  clusters: StoryCluster[];
  metrics: RetrievalMetrics;
}

const sendStageEvent = <T>(stream: SseStream, event: StageEvent<T>) => {
  stream.send(event);
};

export const handleRunRetrievalStream = async ({
  topic,
  recencyHoursOverride,
  config,
  stream,
  store,
  signal,
}: RunRetrievalStreamArgs): Promise<void> => {
  const runId = randomId();
  const logger = createLogger(config);
  await store.ensureLayout();
  const effectiveRecencyHours = recencyHoursOverride ?? config.recencyHours;

  const stageSender = <T>(event: StageEvent<T>) => sendStageEvent(stream, event);
  const retrievalStage = makeStageEmitter(runId, 'retrieval', stageSender);
  const rankingStage = makeStageEmitter(runId, 'ranking', stageSender);
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

    await store.saveRunArtifact(runId, 'retrieval_batch', retrievalResult.batch);
    await store.saveRunArtifact(runId, 'retrieval_clusters', retrievalResult.clusters);

    retrievalStage.success({
      message: `Accepted ${retrievalResult.batch.articles.length} articles`,
      data: retrievalResult.batch.metrics,
    });

    currentStage = rankingStage;
    rankingStage.start({ message: 'Clustering and scoring stories' });
    rankingStage.success({
      data: {
        clusters: retrievalResult.clusters,
      },
    });

    stream.sendJson('retrieval-result', {
      runId,
      recencyHours: effectiveRecencyHours,
      clusters: retrievalResult.clusters,
      metrics: retrievalResult.batch.metrics,
    } satisfies RetrievalRunResult);

    stream.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Retrieval pipeline failed', { runId, error: message });
    currentStage.failure(error);
    stream.sendJson('fatal', { error: message });
    stream.close();
  }
};

