import type { AppConfig } from '../../shared/config';
import type { SseStream } from '../../shared/sse';
import type { SourceCatalogEntry } from '../../shared/types';
import type { StoryCluster } from '../retrieval/types';
import { makeStageEmitter } from './stageEmitter';
import type { EvidenceItem, OutlinePayload } from './types';
import { synthesizeArticle } from './synthesis';
import { createLogger } from '../obs/logger';
import type { ArtifactStore } from '../../shared/artifacts';

export interface GenerateArticleStreamArgs {
  body: unknown;
  config: AppConfig;
  stream: SseStream;
  store: ArtifactStore;
  signal?: AbortSignal;
}

interface ArticleRequestBody {
  runId: string;
  topic: string;
  outline: OutlinePayload;
  clusters: StoryCluster[];
  evidence: EvidenceItem[];
  sourceCatalog?: SourceCatalogEntry[];
  recencyHours?: number;
  previousArticle?: string | null;
}

const isArticleRequestBody = (value: unknown): value is ArticleRequestBody =>
  !!value &&
  typeof (value as ArticleRequestBody).runId === 'string' &&
  typeof (value as ArticleRequestBody).topic === 'string' &&
  typeof (value as ArticleRequestBody).outline === 'object' &&
  Array.isArray((value as ArticleRequestBody).clusters) &&
  Array.isArray((value as ArticleRequestBody).evidence) &&
  (((value as ArticleRequestBody).sourceCatalog == null) || Array.isArray((value as ArticleRequestBody).sourceCatalog));

export const handleGenerateArticleStream = async ({
  body,
  config,
  stream,
  store,
  signal,
}: GenerateArticleStreamArgs): Promise<void> => {
  if (!isArticleRequestBody(body)) {
    stream.sendJson('fatal', { error: 'Invalid payload for article generation' });
    stream.close();
    return;
  }

  const logger = createLogger(config);
  const stage = makeStageEmitter(body.runId, 'synthesis', (event) => stream.send(event));

  const clampRecencyHours = (value: unknown, fallback: number): number => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return fallback;
    }
    return Math.max(6, Math.min(720, Math.round(numeric)));
  };

  try {
    stage.start({ message: 'Generating final article' });

    const recencyHours = clampRecencyHours(body.recencyHours, config.recencyHours);

    const result = await synthesizeArticle({
      runId: body.runId,
      topic: body.topic,
      outline: body.outline,
      retrievalClusters: body.clusters,
      evidence: body.evidence,
      sourceCatalog: body.sourceCatalog,
      recencyHours,
      previousArticle: body.previousArticle,
      config,
      logger,
      signal,
    });

    if (result.sourceCatalog?.length) {
      await store.saveRunArtifact(body.runId, 'source_catalog', result.sourceCatalog);
    }
    await store.saveRunArtifact(body.runId, 'article', result);

    stage.success({
      data: {
        runId: body.runId,
        article: result.article,
        noveltyScore: result.noveltyScore,
        warnings: result.warnings,
        sourceCatalog: result.sourceCatalog,
      },
    });
    stream.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Article generation failed', { runId: body.runId, error: message });
    stage.failure(error);
    stream.sendJson('fatal', { error: message });
    stream.close();
  }
};

