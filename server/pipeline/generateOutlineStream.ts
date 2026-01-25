import type { AppConfig } from '../../shared/config';
import type { SseStream } from '../../shared/sse';
import { makeStageEmitter } from './stageEmitter';
import { createLogger } from '../obs/logger';
import { generateOutlineFromClusters } from './outline';
import type { ArtifactStore } from '../../shared/artifacts';
import type { StoryCluster } from '../retrieval/types';

export interface GenerateOutlineStreamArgs {
  body: unknown;
  config: AppConfig;
  stream: SseStream;
  store: ArtifactStore;
  signal?: AbortSignal;
}

type RequestBody = {
  runId: string;
  topic: string;
  recencyHours?: number;
  clusters: StoryCluster[];
};

const isRequestBody = (value: unknown): value is RequestBody =>
  Boolean(value) &&
  typeof (value as RequestBody).runId === 'string' &&
  typeof (value as RequestBody).topic === 'string' &&
  Array.isArray((value as RequestBody).clusters);

export const handleGenerateOutlineStream = async ({
  body,
  config,
  stream,
  store,
  signal,
}: GenerateOutlineStreamArgs): Promise<void> => {
  if (!isRequestBody(body)) {
    stream.sendJson('fatal', { error: 'Invalid payload for outline generation' });
    stream.close();
    return;
  }

  const logger = createLogger(config);
  const stage = makeStageEmitter(body.runId, 'outline', (event) => stream.send(event));

  try {
    stage.start({ message: 'Generating thesis and outline' });

    const recencyHoursOverride =
      typeof body.recencyHours === 'number' && Number.isFinite(body.recencyHours) && body.recencyHours > 0
        ? body.recencyHours
        : undefined;
    const effectiveRecencyHours = recencyHoursOverride ?? config.recencyHours;

    const outlineResult = await generateOutlineFromClusters({
      runId: body.runId,
      topic: body.topic,
      clusters: body.clusters,
      recencyHours: effectiveRecencyHours,
      config,
      logger,
      signal,
    });
    await store.ensureLayout();
    await store.saveRunArtifact(body.runId, 'outline', outlineResult);

    stage.success({
      data: {
        runId: body.runId,
        recencyHours: effectiveRecencyHours,
        outline: outlineResult.outline,
      },
    });

    stream.sendJson('outline-result', {
      runId: body.runId,
      recencyHours: effectiveRecencyHours,
      outline: outlineResult.outline,
    });
    stream.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Outline generation failed', { runId: body.runId, error: message });
    stage.failure(error);
    stream.sendJson('fatal', { error: message });
    stream.close();
  }
};

