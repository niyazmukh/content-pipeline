export interface ArtifactStore {
  ensureLayout: () => Promise<void>;
  saveRawProviderSnapshot: (provider: string, runId: string, data: unknown) => Promise<string>;
  saveNormalizedArticle: (articleId: string, data: unknown) => Promise<string>;
  saveRunArtifact: (runId: string, kind: string, data: unknown) => Promise<string>;
}

export const createNoopArtifactStore = (): ArtifactStore => ({
  ensureLayout: async () => {},
  saveRawProviderSnapshot: async () => '',
  saveNormalizedArticle: async () => '',
  saveRunArtifact: async () => '',
});
