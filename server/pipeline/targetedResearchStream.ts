import type { AppConfig } from '../../shared/config';
import type { SseStream } from '../../shared/sse';
import { makeStageEmitter } from './stageEmitter';
import { createLogger } from '../obs/logger';
import { performTargetedResearch } from './targetedResearch';
import type { ArtifactStore } from '../../shared/artifacts';
import type { EvidenceItem } from './types';

export interface TargetedResearchStreamArgs {
  body: unknown;
  config: AppConfig;
  stream: SseStream;
  store: ArtifactStore;
  signal?: AbortSignal;
}

type RequestBody = {
  runId: string;
  topic: string;
  outlineIndex: number;
  point: string;
  summary?: string;
  recencyHours?: number;
};

const isRequestBody = (value: unknown): value is RequestBody =>
  Boolean(value) &&
  typeof (value as RequestBody).runId === 'string' &&
  typeof (value as RequestBody).topic === 'string' &&
  typeof (value as RequestBody).outlineIndex === 'number' &&
  Number.isFinite((value as RequestBody).outlineIndex) &&
  typeof (value as RequestBody).point === 'string' &&
  ((value as RequestBody).summary == null || typeof (value as RequestBody).summary === 'string');

export const handleTargetedResearchStream = async ({
  body,
  config,
  stream,
  store,
  signal,
}: TargetedResearchStreamArgs): Promise<void> => {
  if (!isRequestBody(body)) {
    stream.sendJson('fatal', { error: 'Invalid payload for targeted research' });
    stream.close();
    return;
  }

  const logger = createLogger(config);
  const stage = makeStageEmitter(body.runId, 'targetedResearch', (event) => stream.send(event));

  try {
    stage.start({ message: `Researching outline point ${body.outlineIndex + 1}` });

    const recencyHoursOverride =
      typeof body.recencyHours === 'number' && Number.isFinite(body.recencyHours) && body.recencyHours > 0
        ? body.recencyHours
        : undefined;

    const result = await performTargetedResearch({
      runId: body.runId,
      outlinePoint: { index: body.outlineIndex, text: body.point, summary: body.summary },
      topic: body.topic,
      recencyHoursOverride,
      config,
      logger,
      store,
      signal,
    });

    const evidence: EvidenceItem = {
      outlineIndex: body.outlineIndex,
      point: body.point,
      digest: result.digest,
      citations: result.citations.map((c) => ({
        id: c.id,
        title: c.title,
        url: c.url,
        publishedAt: c.publishedAt,
        source: c.source,
      })),
    };

    // Avoid emitting "success" here, because the UI runs multiple point calls and
    // should control the overall targetedResearch stage status.
    stage.progress({ message: `Completed outline point ${body.outlineIndex + 1}` });
    stream.sendJson('targeted-research-result', evidence);
    stream.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Targeted research failed', {
      runId: body.runId,
      outlineIndex: body.outlineIndex,
      error: message,
    });
    stage.failure(error);
    stream.sendJson('fatal', { error: message });
    stream.close();
  }
};
