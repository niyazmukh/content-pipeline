export type ProviderName = 'google' | 'googlenews' | 'newsapi' | 'eventregistry';

import type {
  RetrievalMetrics as SharedRetrievalMetrics,
  RetrievalProviderMetrics as SharedRetrievalProviderMetrics,
  StoryCluster as SharedStoryCluster,
} from '../../shared/types';

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

export interface NormalizedArticle {
  id: string;
  title: string;
  canonicalUrl: string;
  sourceHost: string;
  sourceName?: string | null;
  sourceLabel?: string | null;
  publishedAt?: string | null;
  modifiedAt?: string | null;
  excerpt: string;
  body?: string | null;
  hasExtractedBody: boolean;
  quality: {
    wordCount: number;
    uniqueWordCount: number;
    relevanceScore: number;
  };
  provenance: {
    provider: ProviderName;
    providerId?: string | null;
    rawRef?: string | null;
  };
}

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
