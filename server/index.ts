import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import type { Request, Response } from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { loadConfig, getPublicConfig } from './config/config';
import { createSseStream } from './http/sse';
import { handleRunOutlineStream } from './pipeline/runOutlineStream';
import { handleGenerateArticleStream } from './pipeline/generateArticleStream';
import { handleGenerateImagePromptStream } from './pipeline/generateImagePromptStream';
import { createFsArtifactStore } from './persistence/fsStore';
import { handleTargetedResearchStream } from './pipeline/targetedResearchStream';
import { createLogger } from './obs/logger';

const config = loadConfig();
const store = createFsArtifactStore(config);
const logger = createLogger(config);
logger.info('Config loaded', {
  environment: config.environment,
  recencyHours: config.recencyHours,
  connectors: {
    googleCse: {
      enabled: config.connectors.googleCse.enabled,
      hasApiKey: Boolean(config.connectors.googleCse.apiKey),
      hasSearchEngineId: Boolean(config.connectors.googleCse.searchEngineId),
    },
    newsApi: {
      enabled: config.connectors.newsApi.enabled,
      hasApiKey: Boolean(config.connectors.newsApi.apiKey),
    },
    eventRegistry: {
      enabled: config.connectors.eventRegistry.enabled,
      hasApiKey: Boolean(config.connectors.eventRegistry.apiKey),
    },
  },
});

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

if (config.observability.logLevel === 'debug') {
  app.use((req, res, next) => {
    const startedAt = Date.now();
    logger.debug('HTTP request', { method: req.method, path: req.originalUrl });
    let finished = false;
    res.on('finish', () => {
      finished = true;
      logger.debug('HTTP response', {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        elapsedMs: Date.now() - startedAt,
      });
    });
    res.on('close', () => {
      if (finished) return;
      logger.debug('HTTP closed early', {
        method: req.method,
        path: req.originalUrl,
        elapsedMs: Date.now() - startedAt,
      });
    });
    next();
  });
}

const headerValue = (req: Request, name: string): string => String(req.get(name) || '').trim();

const applyRequestConfigOverrides = (base: typeof config, req: Request): typeof config => {
  const geminiApiKey = headerValue(req, 'x-gemini-api-key');
  const rpmRaw = headerValue(req, 'x-gemini-rpm');
  const googleCseApiKey = headerValue(req, 'x-google-cse-api-key');
  const googleCseCx = headerValue(req, 'x-google-cse-cx');
  const newsApiKey = headerValue(req, 'x-newsapi-key');
  const eventRegistryApiKey = headerValue(req, 'x-eventregistry-api-key');

  const next = {
    ...base,
    llm: { ...base.llm },
    connectors: {
      ...base.connectors,
      googleCse: { ...base.connectors.googleCse },
      newsApi: { ...base.connectors.newsApi },
      eventRegistry: { ...base.connectors.eventRegistry },
    },
  };

  if (geminiApiKey) {
    next.llm.apiKey = geminiApiKey;
  }

  if (rpmRaw) {
    const parsed = Number(rpmRaw);
    if (Number.isFinite(parsed)) {
      next.llm.requestsPerMinute = Math.max(1, Math.min(10, Math.round(parsed)));
    }
  }

  if (googleCseApiKey) {
    next.connectors.googleCse.apiKey = googleCseApiKey;
  }
  if (googleCseCx) {
    next.connectors.googleCse.searchEngineId = googleCseCx;
  }
  if (googleCseApiKey || googleCseCx) {
    next.connectors.googleCse.enabled = Boolean(
      next.connectors.googleCse.apiKey && next.connectors.googleCse.searchEngineId,
    );
  }

  if (newsApiKey) {
    next.connectors.newsApi.apiKey = newsApiKey;
    next.connectors.newsApi.enabled = true;
  }

  if (eventRegistryApiKey) {
    next.connectors.eventRegistry.apiKey = eventRegistryApiKey;
    next.connectors.eventRegistry.enabled = true;
  }

  return next;
};

const parseRecencyHours = (value: unknown, fallback: number): number | undefined => {
  if (value == null) {
    return undefined;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return undefined;
  }
  const clamped = Math.max(6, Math.min(720, Math.round(n)));
  return clamped === fallback ? undefined : clamped;
};

app.get('/api/healthz', (_req: Request, res: Response) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.get('/api/config', (_req: Request, res: Response) => {
  res.json(getPublicConfig(config));
});

app.get('/api/run-agent-stream', async (req: Request, res: Response) => {
  const topic = String(req.query.topic ?? req.query.topicQuery ?? '').trim();
  const stream = createSseStream(res, {
    heartbeatMs: config.server.heartbeatIntervalMs,
    label: 'run-agent',
  });

  if (!topic) {
    stream.sendJson('fatal', { error: 'Missing topic query' });
    stream.close();
    return;
  }

  const recencyHoursOverride = parseRecencyHours(req.query.recencyHours, config.recencyHours);
  const requestConfig = applyRequestConfigOverrides(config, req);

  await handleRunOutlineStream({
    topic,
    recencyHoursOverride,
    config: requestConfig,
    stream,
    store,
    signal: stream.controller.signal,
  });
});

app.post('/api/targeted-research-stream', async (req: Request, res: Response) => {
  const stream = createSseStream(res, {
    heartbeatMs: config.server.heartbeatIntervalMs,
    label: 'targeted-research',
  });

  const requestConfig = applyRequestConfigOverrides(config, req);

  await handleTargetedResearchStream({
    body: req.body,
    config: requestConfig,
    stream,
    store,
    signal: stream.controller.signal,
  });
});

app.post('/api/generate-article-stream', async (req: Request, res: Response) => {
  const stream = createSseStream(res, {
    heartbeatMs: config.server.heartbeatIntervalMs,
    label: 'generate-article',
  });
  const requestConfig = applyRequestConfigOverrides(config, req);

  await handleGenerateArticleStream({
    body: req.body,
    config: requestConfig,
    stream,
    store,
    signal: stream.controller.signal,
  });
});

app.post('/api/generate-image-prompt-stream', async (req: Request, res: Response) => {
  const stream = createSseStream(res, {
    heartbeatMs: config.server.heartbeatIntervalMs,
    label: 'generate-image-prompt',
  });
  const requestConfig = applyRequestConfigOverrides(config, req);

  await handleGenerateImagePromptStream({
    body: req.body,
    config: requestConfig,
    stream,
    store,
    signal: stream.controller.signal,
  });
});

// Backward-compatible: treat :id as a runId and return the generated article artifact.
app.get('/api/article/:id', async (req: Request, res: Response) => {
  const runId = String(req.params.id || '').trim();
  if (!runId) {
    res.status(400).json({ error: 'Missing id' });
    return;
  }

  const filePath = path.join(config.persistence.outputsDir, runId, 'article.json');
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    res.type('application/json').send(content);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.status(500).json({ error: 'Failed to read article' });
  }
});

// Explicit run artifact endpoint: /api/runs/:runId/artifacts/:kind
// kind examples: retrieval_batch, retrieval_clusters, outline, targeted_research, article, image_prompt
app.get('/api/runs/:runId/artifacts/:kind', async (req: Request, res: Response) => {
  const runId = String(req.params.runId || '').trim();
  const kind = String(req.params.kind || '').trim();
  if (!runId || !kind) {
    res.status(400).json({ error: 'Missing runId or kind' });
    return;
  }
  const filePath = path.join(config.persistence.outputsDir, runId, `${kind}.json`);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    res.type('application/json').send(content);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.status(500).json({ error: 'Failed to read artifact' });
  }
});

// Normalized article endpoint: /api/normalized/:articleId
app.get('/api/normalized/:articleId', async (req: Request, res: Response) => {
  const articleId = String(req.params.articleId || '').trim();
  if (!articleId) {
    res.status(400).json({ error: 'Missing articleId' });
    return;
  }

  const filePath = path.join(config.persistence.normalizedDir, `${articleId}.json`);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    res.type('application/json').send(content);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.status(500).json({ error: 'Failed to read normalized article' });
  }
});

const port = config.server.port;

app.listen(port, () => {
  logger.info('Server listening', { url: `http://localhost:${port}` });
});


