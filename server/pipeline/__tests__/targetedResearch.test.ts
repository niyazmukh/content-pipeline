import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../../shared/config';
import type { StoryCluster } from '../../retrieval/types';
import { performTargetedResearch } from '../targetedResearch';
import { retrieveUnified } from '../../retrieval/orchestrator';
import { TopicAnalysisService } from '../../services/topicAnalysisService';

vi.mock('../../retrieval/orchestrator', () => ({
  retrieveUnified: vi.fn(),
}));

vi.mock('../../services/topicAnalysisService', () => ({
  TopicAnalysisService: vi.fn().mockImplementation(function MockTopicAnalysisService() {
    return {
    analyze: vi.fn(),
    };
  }),
}));

const config = {
  recencyHours: 168,
  retrieval: {
    minAccepted: 10,
    maxAttempts: 20,
  },
} as AppConfig;

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const store = {
  saveRunArtifact: vi.fn(),
  readRunArtifact: vi.fn(),
  listRunArtifacts: vi.fn(),
};

const makeCluster = (clusterId: string, title: string, body: string, score: number): StoryCluster => ({
  clusterId,
  representative: {
    id: clusterId,
    title,
    canonicalUrl: `https://example.com/${clusterId}`,
    sourceHost: 'example.com',
    sourceName: 'Example',
    sourceLabel: 'Example',
    publishedAt: '2026-06-10T00:00:00Z',
    modifiedAt: null,
    excerpt: body.slice(0, 120),
    body,
    hasExtractedBody: true,
    quality: {
      wordCount: body.split(/\s+/).length,
      uniqueWordCount: new Set(body.split(/\s+/)).size,
      relevanceScore: 1,
    },
    provenance: { provider: 'google', providerId: clusterId },
  },
  members: [],
  score,
  reasons: [],
  citations: [{ title, url: `https://example.com/${clusterId}` }],
});

describe('performTargetedResearch', () => {
  it('selects evidence from existing clusters without re-running LLM analysis or provider retrieval', async () => {
    vi.mocked(retrieveUnified).mockClear();
    vi.mocked(TopicAnalysisService).mockClear();

    const clusters = [
      makeCluster(
        'supplier-risk',
        'Acme adds supplier risk scoring',
        'Acme supplier risk scoring procurement automation approval routing manufacturing contract metadata audit exceptions.',
        9,
      ),
      makeCluster(
        'retail-payments',
        'Retail payment update',
        'Retail payment terminal rollout unrelated to supplier procurement.',
        2,
      ),
    ];

    const result = await performTargetedResearch({
      runId: 'run-1',
      outlinePoint: { index: 0, text: 'supplier risk scoring in procurement automation' },
      topic: 'procurement automation',
      existingClusters: clusters,
      config,
      logger,
      store: store as any,
    });

    expect(retrieveUnified).not.toHaveBeenCalled();
    expect(TopicAnalysisService).not.toHaveBeenCalled();
    expect(result.clusters.map((cluster) => cluster.clusterId)).toEqual(['supplier-risk']);
    expect(result.digest).toContain('supplier risk scoring');
  });
});
