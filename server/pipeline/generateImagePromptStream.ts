import type { AppConfig } from '../../shared/config';
import type { SseStream } from '../../shared/sse';
import { makeStageEmitter } from './stageEmitter';
import { generateImagePrompt } from './imagePrompt';
import { createLogger } from '../obs/logger';
import type { ArtifactStore } from '../../shared/artifacts';

export interface GenerateImagePromptStreamArgs {
  body: unknown;
  config: AppConfig;
  stream: SseStream;
  store: ArtifactStore;
  signal?: AbortSignal;
}

interface ImagePromptRequestBody {
  runId: string;
  article: string;
}

const isImagePromptRequest = (value: unknown): value is ImagePromptRequestBody =>
  !!value && typeof (value as ImagePromptRequestBody).runId === 'string' && typeof (value as ImagePromptRequestBody).article === 'string';

const renderSlideText = (slide: { title: string; visualStrategy: string; layout?: string; prompt: string; negativePrompt?: string }, idx: number): string => {
  const lines = [
    `Slide ${idx + 1}: ${slide.title}`,
    `Strategy: ${slide.visualStrategy}${slide.layout ? ` | Layout: ${slide.layout}` : ''}`,
    slide.prompt,
  ];
  if (slide.negativePrompt) {
    lines.push(`Negative: ${slide.negativePrompt}`);
  }
  return lines.join('\n');
};

export const handleGenerateImagePromptStream = async ({
  body,
  config,
  stream,
  store,
  signal,
}: GenerateImagePromptStreamArgs): Promise<void> => {
  if (!isImagePromptRequest(body)) {
    stream.sendJson('fatal', { error: 'Invalid payload for image prompt generation' });
    stream.close();
    return;
  }

  const logger = createLogger(config);
  const stage = makeStageEmitter(body.runId, 'imagePrompt', (event) => stream.send(event));

  try {
    stage.start({ message: 'Creating image prompt brief' });
    const result = await generateImagePrompt({
      runId: body.runId,
      article: body.article,
      config,
      logger,
      signal,
    });

    await store.saveRunArtifact(body.runId, 'image_prompt', result);

    const prompt = result.slides.map((slide, idx) => renderSlideText(slide, idx)).join('\n\n');
    stage.success({ data: { runId: body.runId, slides: result.slides, prompt } });
    stream.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Image prompt generation failed', { runId: body.runId, error: message });
    stage.failure(error);
    stream.sendJson('fatal', { error: message });
    stream.close();
  }
};

