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

const config = loadConfig();
const store = createFsArtifactStore(config);
console.log('[config] environment:', config.environment);
console.log('[config] recencyHours:', config.recencyHours);
console.log('[config] connectors.googleCse.enabled:', config.connectors.googleCse.enabled);
console.log(
  '[config] connectors.googleCse.apiKey present:',
  Boolean(config.connectors.googleCse.apiKey),
);
console.log(
  '[config] connectors.googleCse.searchEngineId present:',
  Boolean(config.connectors.googleCse.searchEngineId),
);
console.log('[config] connectors.newsApi.enabled:', config.connectors.newsApi.enabled);
console.log(
  '[config] connectors.newsApi.apiKey present:',
  Boolean(config.connectors.newsApi.apiKey),
);
console.log('[config] connectors.eventRegistry.enabled:', config.connectors.eventRegistry.enabled);
console.log(
  '[config] connectors.eventRegistry.apiKey present:',
  Boolean(config.connectors.eventRegistry.apiKey),
);

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.use((req, _res, next) => {
  const start = Date.now();
  resLog(`[${req.method}] ${req.originalUrl}`);
  // Avoid logging full headers to prevent leaking secrets; log UA only.
  try {
    const ua = req.headers['user-agent'] || '';
    resLog(`UA: ${JSON.stringify(ua)}`);
  } catch (_) {
    // ignore
  }
  let finished = false;
  _res.on('finish', () => {
    finished = true;
    const elapsed = Date.now() - start;
    resLog(`[${req.method}] ${req.originalUrl} finished ${_res.statusCode} after ${elapsed}ms`);
  });
  _res.on('close', () => {
    if (finished) return;
    const elapsed = Date.now() - start;
    resLog(`[${req.method}] ${req.originalUrl} closed early after ${elapsed}ms`);
  });
  next();
});

function resLog(message: string) {
  /* eslint-disable no-console */
  console.log(message);
  /* eslint-enable no-console */
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
  console.log(`Server listening on http://localhost:${port}`);
});


