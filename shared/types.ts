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

export interface RetrievalProviderMetrics {
  provider: 'google' | 'newsapi' | 'eventregistry';
  query?: string;
  returned: number;
  preFiltered: number;
  extractionAttempts: number;
  accepted: number;
  missingPublishedAt: number;
  disabled?: boolean;
  failed?: boolean;
  error?: string | null;
  extractionErrors: Array<{ url: string; error: string }>;
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
