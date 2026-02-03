import type {
  ArticleProvenance,
  CandidateProvider,
  NormalizedArticle as SharedNormalizedArticle,
  RetrievalMetrics as SharedRetrievalMetrics,
  RetrievalProviderMetrics as SharedRetrievalProviderMetrics,
  StoryCluster as SharedStoryCluster,
} from '../../shared/types';

export type ProviderName = CandidateProvider;

export interface ConnectorArticle {
  id: string;
  title: string;
  url: string;
  sourceName?: string | null;
  publishedAt?: string | null;
  snippet?: string | null;
  providerData?: Record<string, unknown> | null;
}

export interface ConnectorResult {
  provider: ProviderName;
  fetchedAt: string;
  query: string;
  items: ConnectorArticle[];
  metrics?: Record<string, unknown>;
}

export type NormalizedArticle = SharedNormalizedArticle & {
  hasExtractedBody: boolean;
  provenance: ArticleProvenance;
};

export type ProviderRetrievalMetrics = SharedRetrievalProviderMetrics;
export type RetrievalMetrics = SharedRetrievalMetrics;

export interface RetrievalBatch {
  runId: string;
  query: string;
  recencyHours: number;
  fetchedAt: string;
  articles: NormalizedArticle[];
  metrics: RetrievalMetrics;
}

export type StoryCluster = SharedStoryCluster;

export interface RetrievalOrchestratorResult {
  batch: RetrievalBatch;
  clusters: StoryCluster[];
  providerSummaries: ProviderRetrievalMetrics[];
}
