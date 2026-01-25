import type {
  StageEvent,
  ArticleGenerationResult,
  OutlinePayload,
  StoryCluster,
  EvidenceItem,
  ApiConfigResponse,
} from '../shared/types';
import { streamSseRequest } from './sseClient';
import { buildAuthHeaders } from './apiKeys';

const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE || 'https://niyazm.niyazm.workers.dev/api';

const isStageEvent = (value: unknown): value is StageEvent => {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'stage' in value &&
    'status' in value &&
    'runId' in value &&
    'ts' in value,
  );
};

interface RunAgentOptions {
  topic: string;
  recencyHours?: number;
  onStageEvent?: (event: StageEvent<unknown>) => void;
}

export interface OutlineRunResult {
  runId: string;
  recencyHours: number;
  outline: OutlinePayload;
  clusters: StoryCluster[];
}

export const runPipelineToOutline = async ({
  topic,
  recencyHours,
  onStageEvent,
}: RunAgentOptions): Promise<OutlineRunResult> => {
  const params = new URLSearchParams();
  params.set('topic', topic);
  if (typeof recencyHours === 'number' && Number.isFinite(recencyHours)) {
    params.set('recencyHours', String(recencyHours));
  }
  const url = `${API_BASE_URL}/run-agent-stream?${params.toString()}`;
  return streamSseRequest<OutlineRunResult>({
    url,
    method: 'GET',
    headers: buildAuthHeaders(),
    mapResult: (event, payload) => {
      if (event === 'stage-event' && isStageEvent(payload)) {
        if (payload.stage === 'outline' && payload.status === 'success') {
          const data = payload.data as Partial<OutlineRunResult> | undefined;
          if (data?.outline && Array.isArray(data.clusters) && typeof data.recencyHours === 'number') {
            return {
              runId: payload.runId,
              recencyHours: data.recencyHours,
              outline: data.outline,
              clusters: data.clusters,
            };
          }
        }
      }
      return undefined;
    },
    onStageEvent: (payload) => {
      if (onStageEvent && isStageEvent(payload)) {
        onStageEvent(payload);
      }
    },
  });
};

interface TargetedResearchPayload {
  runId: string;
  topic: string;
  outlineIndex: number;
  point: string;
  recencyHours: number;
}

export const runTargetedResearchPoint = async (
  payload: TargetedResearchPayload,
  onStageEvent?: (event: StageEvent<unknown>) => void,
): Promise<EvidenceItem> => {
  const url = `${API_BASE_URL}/targeted-research-stream`;
  return streamSseRequest<EvidenceItem>({
    url,
    body: payload,
    headers: buildAuthHeaders(),
    mapResult: (event, value) => {
      if (event === 'targeted-research-result') {
        return value as EvidenceItem;
      }
      if (event === 'stage-event' && isStageEvent(value)) {
        if (value.stage === 'targetedResearch' && value.status === 'failure') {
          throw new Error(value.message || 'Targeted research failed');
        }
      }
      return undefined;
    },
    onStageEvent: (value) => {
      if (onStageEvent && isStageEvent(value)) {
        onStageEvent(value);
      }
    },
  });
};

interface GenerateArticlePayload {
  runId: string;
  topic: string;
  outline: OutlinePayload;
  clusters: StoryCluster[];
  evidence: EvidenceItem[];
  recencyHours: number;
  previousArticle?: string | null;
}

export const generateArticle = async (payload: GenerateArticlePayload, onStageEvent?: (event: StageEvent<unknown>) => void) => {
  const url = `${API_BASE_URL}/generate-article-stream`;
  return streamSseRequest<ArticleGenerationResult>({
    url,
    body: payload,
    headers: buildAuthHeaders(),
    mapResult: (event, value) => {
      if (event === 'stage-event' && isStageEvent(value)) {
        if (value.stage === 'synthesis' && value.status === 'success') {
          return value.data as ArticleGenerationResult;
        }
        if (value.stage === 'synthesis' && value.status === 'failure') {
          throw new Error(value.message || 'Article synthesis failed');
        }
      }
      return undefined;
    },
    onStageEvent: (value) => {
      if (onStageEvent && isStageEvent(value)) {
        onStageEvent(value);
      }
    },
  });
};

interface ImagePromptPayload {
  runId: string;
  article: string;
}

export const generateImagePrompt = async (payload: ImagePromptPayload, onStageEvent?: (event: StageEvent<unknown>) => void) => {
  const url = `${API_BASE_URL}/generate-image-prompt-stream`;
  return streamSseRequest<{ runId: string; prompt: string }>({
    url,
    body: { runId: payload.runId, article: payload.article },
    headers: buildAuthHeaders(),
    mapResult: (event, value) => {
      if (event === 'stage-event' && isStageEvent(value)) {
        if (value.stage === 'imagePrompt' && value.status === 'success' && value.data) {
          const data = value.data as { prompt: string; runId: string };
          return { runId: data.runId ?? payload.runId, prompt: data.prompt };
        }
        if (value.stage === 'imagePrompt' && value.status === 'failure') {
          throw new Error(value.message || 'Image prompt generation failed');
        }
      }
      return undefined;
    },
    onStageEvent: (value) => {
      if (onStageEvent && isStageEvent(value)) {
        onStageEvent(value);
      }
    },
  });
};

export const fetchPublicConfig = async (): Promise<ApiConfigResponse> => {
  const res = await fetch(`${API_BASE_URL}/config`);
  if (!res.ok) {
    throw new Error(`Failed to load public config (${res.status})`);
  }
  return res.json();
};
