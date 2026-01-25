import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig } from '../../shared/config';
import type { ArtifactStore } from '../../shared/artifacts';

const sanitizeSegment = (value: string): string =>
  value.replace(/[^a-z0-9_\-]/gi, '_').slice(0, 80) || 'artifact';

const ensureDir = async (dir: string) => {
  await fs.mkdir(dir, { recursive: true });
};

const guardPath = (root: string, target: string) => {
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Attempted to write outside of persistence root: ${target}`);
  }
};

export const createFsArtifactStore = (config: AppConfig): ArtifactStore => {
  const ensureLayout = async () => {
    await ensureDir(config.persistence.rootDir);
    await ensureDir(config.persistence.rawProviderDir);
    await ensureDir(config.persistence.extractDir);
    await ensureDir(config.persistence.normalizedDir);
    await ensureDir(config.persistence.outputsDir);
  };

  const saveRawProviderSnapshot = async (provider: string, runId: string, data: unknown) => {
    const dir = path.join(config.persistence.rawProviderDir, sanitizeSegment(provider));
    await ensureDir(dir);
    const filename = `${sanitizeSegment(runId)}_${Date.now()}.json`;
    const target = path.join(dir, filename);
    guardPath(config.persistence.rootDir, target);
    await fs.writeFile(target, JSON.stringify(data, null, 2), 'utf-8');
    return target;
  };

  const saveNormalizedArticle = async (articleId: string, data: unknown) => {
    const filename = `${sanitizeSegment(articleId)}.json`;
    const target = path.join(config.persistence.normalizedDir, filename);
    guardPath(config.persistence.rootDir, target);
    await fs.writeFile(target, JSON.stringify(data, null, 2), 'utf-8');
    return target;
  };

  const saveRunArtifact = async (runId: string, kind: string, data: unknown) => {
    const dir = path.join(config.persistence.outputsDir, sanitizeSegment(runId));
    await ensureDir(dir);
    const filename = `${sanitizeSegment(kind)}.json`;
    const target = path.join(dir, filename);
    guardPath(config.persistence.rootDir, target);
    await fs.writeFile(target, JSON.stringify(data, null, 2), 'utf-8');
    return target;
  };

  return {
    ensureLayout,
    saveRawProviderSnapshot,
    saveNormalizedArticle,
    saveRunArtifact,
  };
};

