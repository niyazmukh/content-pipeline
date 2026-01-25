import type { SseStream } from '../../shared/sse';
import { getPublicConfig } from '../../shared/config';
import { createNoopArtifactStore } from '../../shared/artifacts';
import { handleRunAgentStream } from '../../server/pipeline/runAgentStream';
import { handleGenerateArticleStream } from '../../server/pipeline/generateArticleStream';
import { handleGenerateImagePromptStream } from '../../server/pipeline/generateImagePromptStream';
import { createWorkerSseStream } from './sse';
import { buildWorkerConfig, getRequestKeys, type WorkerEnv } from './config';

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

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

const sseHeaders = (origin: string) => {
  const headers = new Headers();
  headers.set('Content-Type', 'text/event-stream');
  headers.set('Cache-Control', 'no-cache');
  headers.set('Connection', 'keep-alive');
  withCors(headers, origin);
  return headers;
};

const ensureGeminiKey = (config: { llm: { apiKey: string } }) => {
  if (!config.llm.apiKey || config.llm.apiKey === 'missing') {
    return jsonResponse(
      {
        error:
          'Gemini API key is not configured. Add a Worker secret (GEMINI_API_KEY) or provide X-Gemini-Api-Key from the client.',
      },
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
        const headers = new Headers();
        withCors(headers, origin);
        return jsonResponse({ ok: true, ts: new Date().toISOString() }, { headers });
      }

      if (url.pathname === '/api/config') {
        const headers = new Headers();
        withCors(headers, origin);
        return jsonResponse(getPublicConfig(config), { headers });
      }

      if (url.pathname === '/api/run-agent-stream' && request.method === 'GET') {
        const missing = ensureGeminiKey(config);
        if (missing) return missing;

        const topic = String(url.searchParams.get('topic') || url.searchParams.get('topicQuery') || '').trim();
        if (!topic) {
          return jsonResponse({ error: 'Missing topic query' }, { status: 400 });
        }

        const recencyHoursRaw = url.searchParams.get('recencyHours');
        const recencyHoursOverride = recencyHoursRaw ? Number(recencyHoursRaw) : undefined;

        const { stream, sse } = createWorkerSseStream({
          heartbeatMs: config.server.heartbeatIntervalMs,
          label: 'run-agent',
        });
        bindAbort(request, sse);

        handleRunAgentStream({
          topic,
          recencyHoursOverride: Number.isFinite(recencyHoursOverride) ? recencyHoursOverride : undefined,
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

      if (url.pathname === '/api/generate-article-stream' && request.method === 'POST') {
        const missing = ensureGeminiKey(config);
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
        const missing = ensureGeminiKey(config);
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

      return jsonResponse({ error: 'Not found' }, { status: 404 });
    } catch (error) {
      const headers = new Headers();
      withCors(headers, origin);
      const message = error instanceof Error ? error.message : String(error);
      return jsonResponse({ error: message }, { status: 500, headers });
    }
  },
};
