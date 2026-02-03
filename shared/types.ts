export type StageName =
  | 'retrieval'
  | 'ranking'
  | 'outline'
  | 'targetedResearch'
  | 'synthesis'
  | 'imagePrompt';

export type StageStatus = 'start' | 'progress' | 'success' | 'failure';

export interface StageEvent<T = unknown> {
  runId: string;
  stage: StageName;
  status: StageStatus;
  message?: string;
  data?: T;
  ts: string;
}

export interface NormalizedArticle {
  id: string;
  title: string;
  canonicalUrl: string;
  sourceHost: string;
  sourceName?: string | null;
  publishedAt?: string | null;
  excerpt: string;
  quality: {
    wordCount: number;
    uniqueWordCount: number;
    relevanceScore: number;
  };
}

export type CandidateProvider = 'google' | 'newsapi' | 'eventregistry';

export interface RetrievalCandidate {
  id: string;
  provider: CandidateProvider;
  title: string;
  url: string;
  sourceName?: string | null;
  publishedAt?: string | null;
  snippet?: string | null;
  providerData?: Record<string, unknown> | null;
}

export interface RetrievalProviderMetrics {
  provider: CandidateProvider;
  query?: string;
  returned: number;
  /**
   * Candidates removed by URL de-duplication before extraction selection.
   * (Returned counts include duplicates; extraction operates on unique URLs.)
   */
  deduped?: number;
  /**
   * Unique candidates remaining after URL de-duplication.
   */
  unique?: number;
  /**
   * Candidates selected into the extraction queue (budgeted).
   */
  queued?: number;
  /**
   * Unique candidates skipped due to extraction budget or early stopping.
   */
  skipped?: number;
  preFiltered: number;
  extractionAttempts: number;
  accepted: number;
  missingPublishedAt: number;
  disabled?: boolean;
  failed?: boolean;
  error?: string | null;
  extractionErrors: Array<{ url: string; error: string }>;
  rejectionReasons?: Record<string, number>;
}

export interface RetrievalMetrics {
  candidateCount: number;
  preFiltered: number;
  attemptedExtractions: number;
  accepted: number;
  duplicatesRemoved: number;
  newestArticleHours: number | null;
  oldestArticleHours: number | null;
  perProvider: RetrievalProviderMetrics[];
  extractionErrors: Array<{ url: string; error: string; provider: 'google' | 'newsapi' | 'eventregistry' }>;
}

export interface StoryCluster {
  clusterId: string;
  representative: NormalizedArticle;
  members: NormalizedArticle[];
  score: number;
  reasons: string[];
  citations: { title: string; url: string }[];
  tags?: string[];
}

export interface OutlinePoint {
  point: string;
  summary?: string;
  supports: string[];
  dates?: string[];
}

export interface OutlinePayload {
  thesis: string;
  outline: OutlinePoint[];
  coverage?: {
    usedClusterIds?: string[];
    coverageRatio?: number;
  };
}

export interface EvidenceItem {
  outlineIndex: number;
  point: string;
  digest: string;
  citations: Array<{
    id: number;
    title: string;
    url: string;
    source: string;
    publishedAt?: string | null;
  }>;
}

export interface RunAgentSuccessPayload {
  runId: string;
  recencyHours: number;
  outline: OutlinePayload;
  evidence: EvidenceItem[];
  clusters: StoryCluster[];
}

export interface ArticleGenerationResult {
  runId: string;
  article: {
    title: string;
    article: string;
    sources: Array<{ id: number; title: string; url: string }>;
    wordCount: number;
  };
  noveltyScore: number;
  warnings?: string[];
}

export interface ImagePromptSlide {
  title: string;
  visualStrategy: string;
  layout?: string;
  overlayText?: string[];
  prompt: string;
  negativePrompt?: string;
}

export interface ImagePromptGenerationResult {
  runId: string;
  slides: ImagePromptSlide[];
  prompt?: string;
}

export interface ApiConfigResponse {
  recencyHours: number;
  retrieval: {
    minAccepted: number;
    maxAttempts: number;
    globalConcurrency: number;
    perHostConcurrency: number;
    totalBudgetMs: number;
  };
}

export interface ApiHealthResponse {
  ok: boolean;
  ts: string;
  backendKeys?: {
    gemini: boolean;
    newsApi: boolean;
    eventRegistry: boolean;
    googleCse: boolean;
  };
  probes?: {
    newsApi?: { ok: boolean; status?: number; totalResults?: number; error?: string };
  };
}
