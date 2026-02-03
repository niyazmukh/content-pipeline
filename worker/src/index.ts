import type { SseStream } from '../../shared/sse';
import { getPublicConfig, parseRecencyHoursParam } from '../../shared/config';
import { createNoopArtifactStore } from '../../shared/artifacts';
import { handleRunOutlineStream } from '../../server/pipeline/runOutlineStream';
import { handleRunRetrievalStream } from '../../server/pipeline/runRetrievalStream';
import { handleGenerateOutlineStream } from '../../server/pipeline/generateOutlineStream';
import { handleGenerateArticleStream } from '../../server/pipeline/generateArticleStream';
import { handleGenerateImagePromptStream } from '../../server/pipeline/generateImagePromptStream';
import { handleTargetedResearchStream } from '../../server/pipeline/targetedResearchStream';
import { retrieveCandidates } from '../../server/pipeline/retrieveCandidates';
import { extractBatch } from '../../server/pipeline/extractBatch';
import { clusterArticles } from '../../server/pipeline/clusterArticles';
import { createLogger } from '../../server/obs/logger';
import { createWorkerSseStream } from './sse';
import { buildWorkerConfig, getRequestKeys, type WorkerEnv } from './config';

const withCors = (headers: Headers, origin: string) => {
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  headers.set(
    'Access-Control-Allow-Headers',
    [
      'Content-Type',
      'X-Gemini-Api-Key',
      'X-Gemini-RPM',
      'X-Google-Cse-Api-Key',
      'X-Google-Cse-Cx',
      'X-Newsapi-Key',
      'X-Eventregistry-Api-Key',
    ].join(', '),
  );
  headers.set('Access-Control-Max-Age', '86400');
};

const corsJsonResponse = (body: unknown, origin: string, init?: ResponseInit) => {
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  withCors(headers, origin);
  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
};

const sseHeaders = (origin: string) => {
  const headers = new Headers();
  headers.set('Content-Type', 'text/event-stream');
  headers.set('Cache-Control', 'no-cache');
  headers.set('Connection', 'keep-alive');
  withCors(headers, origin);
  return headers;
};

const ensureGeminiKey = (config: { llm: { apiKey: string } }, origin: string) => {
  if (!config.llm.apiKey || config.llm.apiKey === 'missing') {
    return corsJsonResponse(
      {
        error:
          'Gemini API key is not configured. Add a Worker secret (GEMINI_API_KEY) or provide X-Gemini-Api-Key from the client.',
      },
      origin,
      { status: 400 },
    );
  }
  return null;
};

const bindAbort = (request: Request, stream: SseStream) => {
  if (request.signal) {
    request.signal.addEventListener(
      'abort',
      () => {
        stream.close();
      },
      { once: true },
    );
  }
};

export default {
  async fetch(request: Request, env: WorkerEnv & { ALLOWED_ORIGIN?: string }) {
    const origin = env.ALLOWED_ORIGIN || '*';
    try {
      const url = new URL(request.url);

      if (request.method === 'OPTIONS') {
        const headers = new Headers();
        withCors(headers, origin);
        return new Response(null, { status: 204, headers });
      }

      if (!url.pathname.startsWith('/api/')) {
        return new Response('Not found', { status: 404 });
      }

      const keys = getRequestKeys(request);
      const config = buildWorkerConfig(keys, env);
      const store = createNoopArtifactStore();

    if (url.pathname === '/api/healthz') {
      const probe = url.searchParams.get('probe') === '1';
      let newsApiProbe: { ok: boolean; status?: number; totalResults?: number; error?: string } | undefined;
      if (probe && env.NEWS_API_KEY) {
        try {
          const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
          const to = new Date().toISOString();
          const params = new URLSearchParams({
            q: 'test',
            sortBy: 'publishedAt',
            language: 'en',
            pageSize: '1',
            page: '1',
            from,
            to,
          });
          const response = await fetch(`https://newsapi.org/v2/everything?${params.toString()}`, {
            headers: {
              'X-Api-Key': env.NEWS_API_KEY,
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
            },
          });
          const json = (await response.json().catch(() => null)) as any;
          newsApiProbe = {
            ok: response.ok && json?.status === 'ok',
            status: response.status,
            totalResults: typeof json?.totalResults === 'number' ? json.totalResults : undefined,
            error: typeof json?.message === 'string' ? json.message : undefined,
          };
        } catch (error) {
          newsApiProbe = { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      }

      return corsJsonResponse(
        {
          ok: true,
          ts: new Date().toISOString(),
          backendKeys: {
            gemini: Boolean(env.GEMINI_API_KEY),
            newsApi: Boolean(env.NEWS_API_KEY),
            eventRegistry: Boolean(env.EVENT_REGISTRY_API_KEY),
            googleCse: Boolean(env.GOOGLE_CSE_API_KEY && env.GOOGLE_CSE_CX),
            googleNewsRss: Boolean(config.connectors.googleNewsRss?.enabled),
          },
          ...(probe ? { probes: { newsApi: newsApiProbe } } : {}),
        },
        origin,
      );
    }

      if (url.pathname === '/api/config') {
        return corsJsonResponse(getPublicConfig(config), origin);
      }

    if (url.pathname === '/api/run-agent-stream' && request.method === 'GET') {
      const missing = ensureGeminiKey(config, origin);
      if (missing) return missing;

      const topic = String(url.searchParams.get('topic') || url.searchParams.get('topicQuery') || '').trim();
      if (!topic) {
        return corsJsonResponse({ error: 'Missing topic query' }, origin, { status: 400 });
      }

        const recencyHoursOverride = parseRecencyHoursParam(
          url.searchParams.get('recencyHours'),
          config.recencyHours,
        );

      const { stream, sse } = createWorkerSseStream({
        heartbeatMs: config.server.heartbeatIntervalMs,
        label: 'run-agent',
      });
      bindAbort(request, sse);

      handleRunOutlineStream({
        topic,
        recencyHoursOverride,
        config,
        stream: sse,
        store,
        signal: sse.controller.signal,
      }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        const isSubrequest = message.toLowerCase().includes('too many subrequests');
        sse.sendJson('fatal', {
          error: isSubrequest
            ? `${message} (Tip: refresh the UI; the pipeline now splits retrieval + outline into separate requests to avoid this Cloudflare limit.)`
            : message,
        });
        sse.close();
      });

      return new Response(stream, { headers: sseHeaders(origin) });
    }

    if (url.pathname === '/api/retrieve-stream' && request.method === 'GET') {
      const missing = ensureGeminiKey(config, origin);
      if (missing) return missing;

      const topic = String(url.searchParams.get('topic') || url.searchParams.get('topicQuery') || '').trim();
      if (!topic) {
        return corsJsonResponse({ error: 'Missing topic query' }, origin, { status: 400 });
      }

      const recencyHoursOverride = parseRecencyHoursParam(
        url.searchParams.get('recencyHours'),
        config.recencyHours,
      );

      const { stream, sse } = createWorkerSseStream({
        heartbeatMs: config.server.heartbeatIntervalMs,
        label: 'retrieve',
      });
      bindAbort(request, sse);

      handleRunRetrievalStream({
        topic,
        recencyHoursOverride,
        config,
        stream: sse,
        store,
        signal: sse.controller.signal,
      }).catch((error) => {
        sse.sendJson('fatal', { error: error instanceof Error ? error.message : String(error) });
        sse.close();
      });

      return new Response(stream, { headers: sseHeaders(origin) });
    }

    if (url.pathname === '/api/generate-outline-stream' && request.method === 'POST') {
      const missing = ensureGeminiKey(config, origin);
      if (missing) return missing;

      const body = await request.json().catch(() => null);
      const { stream, sse } = createWorkerSseStream({
        heartbeatMs: config.server.heartbeatIntervalMs,
        label: 'generate-outline',
      });
      bindAbort(request, sse);

      handleGenerateOutlineStream({
        body,
        config,
        stream: sse,
        store,
        signal: sse.controller.signal,
      }).catch((error) => {
        sse.sendJson('fatal', { error: error instanceof Error ? error.message : String(error) });
        sse.close();
      });

      return new Response(stream, { headers: sseHeaders(origin) });
    }

    if (url.pathname === '/api/targeted-research-stream' && request.method === 'POST') {
      const missing = ensureGeminiKey(config, origin);
      if (missing) return missing;

      const body = await request.json().catch(() => null);
      const { stream, sse } = createWorkerSseStream({
        heartbeatMs: config.server.heartbeatIntervalMs,
        label: 'targeted-research',
      });
      bindAbort(request, sse);

      handleTargetedResearchStream({
        body,
        config,
        stream: sse,
        store,
        signal: sse.controller.signal,
      }).catch((error) => {
        sse.sendJson('fatal', { error: error instanceof Error ? error.message : String(error) });
        sse.close();
      });

      return new Response(stream, { headers: sseHeaders(origin) });
    }

    if (url.pathname === '/api/retrieve-candidates' && request.method === 'GET') {
      const missing = ensureGeminiKey(config, origin);
      if (missing) return missing;

      const topic = String(url.searchParams.get('topic') || url.searchParams.get('topicQuery') || '').trim();
      if (!topic) {
        return corsJsonResponse({ error: 'Missing topic query' }, origin, { status: 400 });
      }

      const recencyHoursOverride = parseRecencyHoursParam(
        url.searchParams.get('recencyHours'),
        config.recencyHours,
      );
      const runId = String(url.searchParams.get('runId') || '').trim();

      const logger = createLogger(config);
      try {
        const result = await retrieveCandidates({
          runId: runId || undefined,
          topic,
          recencyHoursOverride,
          config,
          logger,
          signal: request.signal,
        });
        return corsJsonResponse(result, origin);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return corsJsonResponse({ error: message }, origin, { status: 500 });
      }
    }

    if (url.pathname === '/api/extract-batch' && request.method === 'POST') {
      const body = await request.json().catch(() => null);
      const logger = createLogger(config);

      const runId = typeof (body as any)?.runId === 'string' ? String((body as any).runId) : '';
      const mainQuery = typeof (body as any)?.mainQuery === 'string' ? String((body as any).mainQuery) : '';
      const candidates = Array.isArray((body as any)?.candidates) ? ((body as any).candidates as any[]) : [];
      const recencyHours = typeof (body as any)?.recencyHours === 'number' ? Number((body as any).recencyHours) : config.recencyHours;

      if (!runId || !mainQuery || !Array.isArray(candidates)) {
        return corsJsonResponse({ error: 'Invalid payload' }, origin, { status: 400 });
      }

      try {
        const result = await extractBatch({
          runId,
          mainQuery,
          recencyHours,
          candidates: candidates as any,
          config,
          logger,
          signal: request.signal,
        });
        return corsJsonResponse(result, origin);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return corsJsonResponse({ error: message }, origin, { status: 500 });
      }
    }

    if (url.pathname === '/api/cluster-articles' && request.method === 'POST') {
      const body = await request.json().catch(() => null);
      const logger = createLogger(config);

      const runId = typeof (body as any)?.runId === 'string' ? String((body as any).runId) : '';
      const articles = Array.isArray((body as any)?.articles) ? ((body as any).articles as any[]) : [];
      const recencyHours = typeof (body as any)?.recencyHours === 'number' ? Number((body as any).recencyHours) : config.recencyHours;

      if (!runId || !Array.isArray(articles)) {
        return corsJsonResponse({ error: 'Invalid payload' }, origin, { status: 400 });
      }

      try {
        const result = await clusterArticles({
          runId,
          articles: articles as any,
          recencyHours,
          config,
          logger,
        });
        return corsJsonResponse(result, origin);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return corsJsonResponse({ error: message }, origin, { status: 500 });
      }
    }

      if (url.pathname === '/api/generate-article-stream' && request.method === 'POST') {
        const missing = ensureGeminiKey(config, origin);
        if (missing) return missing;

        const body = await request.json().catch(() => null);
        const { stream, sse } = createWorkerSseStream({
          heartbeatMs: config.server.heartbeatIntervalMs,
          label: 'generate-article',
        });
        bindAbort(request, sse);

        handleGenerateArticleStream({
          body,
          config,
          stream: sse,
          store,
          signal: sse.controller.signal,
        }).catch((error) => {
          sse.sendJson('fatal', { error: error instanceof Error ? error.message : String(error) });
          sse.close();
        });

        return new Response(stream, { headers: sseHeaders(origin) });
      }

      if (url.pathname === '/api/generate-image-prompt-stream' && request.method === 'POST') {
        const missing = ensureGeminiKey(config, origin);
        if (missing) return missing;

        const body = await request.json().catch(() => null);
        const { stream, sse } = createWorkerSseStream({
          heartbeatMs: config.server.heartbeatIntervalMs,
          label: 'generate-image-prompt',
        });
        bindAbort(request, sse);

        handleGenerateImagePromptStream({
          body,
          config,
          stream: sse,
          store,
          signal: sse.controller.signal,
        }).catch((error) => {
          sse.sendJson('fatal', { error: error instanceof Error ? error.message : String(error) });
          sse.close();
        });

        return new Response(stream, { headers: sseHeaders(origin) });
      }

      return corsJsonResponse({ error: 'Not found' }, origin, { status: 404 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return corsJsonResponse({ error: message }, origin, { status: 500 });
    }
  },
};
