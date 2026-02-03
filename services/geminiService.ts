import type {
  StageEvent,
  ArticleGenerationResult,
  OutlinePayload,
  StoryCluster,
  EvidenceItem,
  ImagePromptGenerationResult,
  ApiConfigResponse,
  ApiHealthResponse,
  RetrievalMetrics,
  RetrievalProviderMetrics,
  RetrievalCandidate,
} from '../shared/types';
import { streamSseRequest } from './sseClient';
import { buildAuthHeaders } from './apiKeys';

export const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE || 'https://niyazm.niyazm.workers.dev/api';

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

type RetrievalRunResult = {
  runId: string;
  recencyHours: number;
  clusters: StoryCluster[];
  metrics?: RetrievalMetrics;
};

type RetrieveCandidatesResponse = {
  runId: string;
  recencyHours: number;
  mainQuery: string;
  candidateCount: number;
  candidates: RetrievalCandidate[];
  perProvider: RetrievalProviderMetrics[];
};

type ExtractBatchResponse = {
  accepted: any[];
  perProvider: RetrievalProviderMetrics[];
  extractionErrors: Array<{ url: string; error: string; provider: RetrievalProviderMetrics['provider'] }>;
};

type ClusterArticlesResponse = {
  clusters: StoryCluster[];
  duplicatesRemoved: number;
  uniqueCount: number;
};

const nowIso = () => new Date().toISOString();

const emitStage = (args: {
  runId: string;
  stage: StageEvent['stage'];
  status: StageEvent['status'];
  message?: string;
  data?: unknown;
  onStageEvent?: (event: StageEvent<unknown>) => void;
}) => {
  args.onStageEvent?.({
    runId: args.runId,
    stage: args.stage,
    status: args.status,
    message: args.message,
    data: args.data,
    ts: nowIso(),
  });
};

const computeAgeHours = (iso: string): number | null => {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return Math.max(0, (Date.now() - ms) / (60 * 60 * 1000));
};

const runPipelineToClusters = async ({ topic, recencyHours, onStageEvent }: RunAgentOptions): Promise<RetrievalRunResult> => {
  const runId = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`).toString();

  emitStage({ runId, stage: 'retrieval', status: 'start', message: `Preparing queries for "${topic}"`, onStageEvent });

  try {
    const params = new URLSearchParams();
    params.set('topic', topic);
    params.set('runId', runId);
    if (typeof recencyHours === 'number' && Number.isFinite(recencyHours)) {
      params.set('recencyHours', String(recencyHours));
    }

    const candidatesRes = await fetch(`${API_BASE_URL}/retrieve-candidates?${params.toString()}`, {
      method: 'GET',
      headers: buildAuthHeaders(),
    });
    if (!candidatesRes.ok) {
      const text = await candidatesRes.text().catch(() => '');
      throw new Error(text || `Failed to retrieve candidates (${candidatesRes.status})`);
    }
    const candidatesJson = (await candidatesRes.json()) as RetrieveCandidatesResponse;
    const mainQuery = candidatesJson.mainQuery || topic;
    const totalUnique = Array.isArray(candidatesJson.candidates) ? candidatesJson.candidates.length : 0;
    const totalReturned = Number.isFinite(candidatesJson.candidateCount) ? candidatesJson.candidateCount : totalUnique;

    emitStage({
      runId,
      stage: 'retrieval',
      status: 'progress',
      message: `Fetched ${totalUnique} unique URLs (${totalReturned} returned); extracting all...`,
      onStageEvent,
    });

    const perProvider = new Map<RetrievalProviderMetrics['provider'], RetrievalProviderMetrics>(
      (candidatesJson.perProvider || []).map((p) => [p.provider, { ...p, preFiltered: 0, extractionAttempts: 0, accepted: 0, extractionErrors: [] }]),
    );

    const allErrors: Array<{ url: string; error: string; provider: RetrievalProviderMetrics['provider'] }> = [];
    const acceptedArticles: any[] = [];

    // Keep batch size low enough to stay under Workers subrequest limits (Free: 50 per request).
    const batchSize = 12;
    const candidates = candidatesJson.candidates || [];
    const totalBatches = Math.max(1, Math.ceil(candidates.length / batchSize));

    for (let i = 0; i < totalBatches; i += 1) {
      const start = i * batchSize;
      const batch = candidates.slice(start, start + batchSize);
      emitStage({
        runId,
        stage: 'retrieval',
        status: 'progress',
        message: `Extracting ${Math.min(start + batch.length, candidates.length)}/${candidates.length} URLs (batch ${i + 1}/${totalBatches})`,
        onStageEvent,
      });

      const res = await fetch(`${API_BASE_URL}/extract-batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...buildAuthHeaders(),
        },
        body: JSON.stringify({
          runId,
          mainQuery,
          recencyHours: candidatesJson.recencyHours,
          candidates: batch,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `Batch extraction failed (${res.status})`);
      }

      const json = (await res.json()) as ExtractBatchResponse;
      if (Array.isArray(json.accepted)) {
        acceptedArticles.push(...json.accepted);
      }
      if (Array.isArray(json.extractionErrors)) {
        allErrors.push(...json.extractionErrors);
      }
      if (Array.isArray(json.perProvider)) {
        for (const delta of json.perProvider) {
          const prev = perProvider.get(delta.provider);
          if (!prev) {
            perProvider.set(delta.provider, delta);
            continue;
          }
          prev.extractionAttempts += delta.extractionAttempts || 0;
          prev.accepted += delta.accepted || 0;
          prev.preFiltered += delta.preFiltered || 0;
          prev.missingPublishedAt += delta.missingPublishedAt || 0;
          prev.extractionErrors = [...(prev.extractionErrors || []), ...(delta.extractionErrors || [])];
          if (delta.rejectionReasons) {
            prev.rejectionReasons = prev.rejectionReasons ?? {};
            for (const [k, v] of Object.entries(delta.rejectionReasons)) {
              prev.rejectionReasons[k] = (prev.rejectionReasons[k] ?? 0) + (v ?? 0);
            }
          }
        }
      }
    }

    emitStage({ runId, stage: 'ranking', status: 'start', message: 'Clustering and scoring stories', onStageEvent });

    const clusterRes = await fetch(`${API_BASE_URL}/cluster-articles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildAuthHeaders(),
      },
      body: JSON.stringify({
        runId,
        recencyHours: candidatesJson.recencyHours,
        articles: acceptedArticles,
      }),
    });
    if (!clusterRes.ok) {
      const text = await clusterRes.text().catch(() => '');
      throw new Error(text || `Clustering failed (${clusterRes.status})`);
    }
    const clustered = (await clusterRes.json()) as ClusterArticlesResponse;

    const publishedAges = acceptedArticles
      .map((article) => (article?.publishedAt ? computeAgeHours(String(article.publishedAt)) : null))
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const newestArticleHours = publishedAges.length ? Math.min(...publishedAges) : null;
    const oldestArticleHours = publishedAges.length ? Math.max(...publishedAges) : null;

    const providerSummaries = (['google', 'newsapi', 'eventregistry'] as RetrievalProviderMetrics['provider'][]).map((p) => {
      const baseline = perProvider.get(p);
      return (
        baseline ?? {
          provider: p,
          returned: 0,
          preFiltered: 0,
          extractionAttempts: 0,
          accepted: 0,
          missingPublishedAt: 0,
          extractionErrors: [],
        }
      );
    });

    const totalAttempts = providerSummaries.reduce((sum, p) => sum + (p.extractionAttempts || 0), 0);
    const totalAccepted = providerSummaries.reduce((sum, p) => sum + (p.accepted || 0), 0);
    const totalRejected = providerSummaries.reduce((sum, p) => sum + (p.preFiltered || 0), 0);
    const urlDeduped = providerSummaries.reduce((sum, p) => sum + (p.deduped || 0), 0);

    const metrics: RetrievalMetrics = {
      candidateCount: totalReturned,
      preFiltered: urlDeduped + totalRejected,
      attemptedExtractions: totalAttempts,
      accepted: totalAccepted,
      duplicatesRemoved: clustered.duplicatesRemoved ?? 0,
      newestArticleHours: newestArticleHours == null ? null : Number(newestArticleHours.toFixed(2)),
      oldestArticleHours: oldestArticleHours == null ? null : Number(oldestArticleHours.toFixed(2)),
      perProvider: providerSummaries,
      extractionErrors: allErrors.map((e) => ({ ...e, provider: e.provider as any })),
    };

    emitStage({
      runId,
      stage: 'retrieval',
      status: 'success',
      message: `Accepted ${totalAccepted} articles`,
      data: metrics,
      onStageEvent,
    });
    emitStage({
      runId,
      stage: 'ranking',
      status: 'success',
      message: '',
      onStageEvent,
    });

    return {
      runId: candidatesJson.runId || runId,
      recencyHours: candidatesJson.recencyHours,
      clusters: clustered.clusters,
      metrics,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitStage({ runId, stage: 'retrieval', status: 'failure', message, onStageEvent });
    throw error;
  }
};

const generateOutlineFromClusters = async (args: {
  runId: string;
  topic: string;
  clusters: StoryCluster[];
  recencyHours: number;
  onStageEvent?: (event: StageEvent<unknown>) => void;
}): Promise<{ runId: string; recencyHours: number; outline: OutlinePayload }> => {
  const url = `${API_BASE_URL}/generate-outline-stream`;
  return streamSseRequest<{ runId: string; recencyHours: number; outline: OutlinePayload }>({
    url,
    body: {
      runId: args.runId,
      topic: args.topic,
      recencyHours: args.recencyHours,
      clusters: args.clusters,
    },
    headers: buildAuthHeaders(),
    mapResult: (event, payload) => {
      if (event === 'outline-result' && payload && typeof payload === 'object') {
        const data = payload as any;
        if (typeof data.runId === 'string' && typeof data.recencyHours === 'number' && data.outline) {
          return { runId: data.runId, recencyHours: data.recencyHours, outline: data.outline as OutlinePayload };
        }
      }
      return undefined;
    },
    onStageEvent: (payload) => {
      if (args.onStageEvent && isStageEvent(payload)) {
        args.onStageEvent(payload);
      }
    },
  });
};

export const runPipelineToOutline = async ({
  topic,
  recencyHours,
  onStageEvent,
}: RunAgentOptions): Promise<OutlineRunResult> => {
  const retrieval = await runPipelineToClusters({ topic, recencyHours, onStageEvent });
  const outline = await generateOutlineFromClusters({
    runId: retrieval.runId,
    topic,
    clusters: retrieval.clusters,
    recencyHours: retrieval.recencyHours,
    onStageEvent,
  });

  return {
    runId: outline.runId,
    recencyHours: outline.recencyHours,
    outline: outline.outline,
    clusters: retrieval.clusters,
  };
};

interface TargetedResearchPayload {
  runId: string;
  topic: string;
  outlineIndex: number;
  point: string;
  summary?: string;
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
  return streamSseRequest<ImagePromptGenerationResult>({
    url,
    body: { runId: payload.runId, article: payload.article },
    headers: buildAuthHeaders(),
    mapResult: (event, value) => {
      if (event === 'stage-event' && isStageEvent(value)) {
        if (value.stage === 'imagePrompt' && value.status === 'success' && value.data) {
          const data = value.data as any;
          const runId = typeof data.runId === 'string' ? data.runId : payload.runId;
          if (Array.isArray(data.slides)) {
            return {
              runId,
              slides: data.slides as any,
              prompt: typeof data.prompt === 'string' ? data.prompt : undefined,
            };
          }
          if (typeof data.prompt === 'string') {
            return {
              runId,
              slides: [
                {
                  title: 'Slide 1',
                  visualStrategy: 'legacy',
                  prompt: data.prompt,
                },
              ],
              prompt: data.prompt,
            };
          }
          throw new Error('Image prompt result missing slides');
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

export const fetchHealth = async (options: { probeNewsApi?: boolean } = {}): Promise<ApiHealthResponse> => {
  const suffix = options.probeNewsApi ? '?probe=1' : '';
  const res = await fetch(`${API_BASE_URL}/healthz${suffix}`);
  if (!res.ok) {
    throw new Error(`Failed to load health (${res.status})`);
  }
  return res.json();
};
