import { ConfigSchema, RFC1918_CIDRS, type AppConfig } from '../../shared/config';

export interface WorkerEnv {
  GEMINI_API_KEY?: string;
  GEMINI_REQUESTS_PER_MINUTE?: string;
  GOOGLE_CSE_API_KEY?: string;
  GOOGLE_CSE_CX?: string;
  NEWS_API_KEY?: string;
  EVENT_REGISTRY_API_KEY?: string;
}

const numberOr = (value: string | null, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const headerValue = (headers: Headers, name: string): string => headers.get(name) || '';

export interface RequestKeys {
  geminiApiKey: string;
  googleCseApiKey: string;
  googleCseCx: string;
  newsApiKey: string;
  eventRegistryApiKey: string;
  rpm?: number;
}

export const getRequestKeys = (request: Request): RequestKeys => {
  const headers = request.headers;
  const rpmHeader = headers.get('x-gemini-rpm');
  return {
    geminiApiKey: headerValue(headers, 'x-gemini-api-key').trim(),
    googleCseApiKey: headerValue(headers, 'x-google-cse-api-key').trim(),
    googleCseCx: headerValue(headers, 'x-google-cse-cx').trim(),
    newsApiKey: headerValue(headers, 'x-newsapi-key').trim(),
    eventRegistryApiKey: headerValue(headers, 'x-eventregistry-api-key').trim(),
    rpm: rpmHeader ? numberOr(rpmHeader, 6) : undefined,
  };
};

export const buildWorkerConfig = (keys: RequestKeys, env: WorkerEnv = {}): AppConfig => {
  const {
    geminiApiKey,
    googleCseApiKey,
    googleCseCx,
    newsApiKey,
    eventRegistryApiKey,
    rpm: rpmFromHeader,
  } = keys;

  const rpmFromEnv = numberOr(env.GEMINI_REQUESTS_PER_MINUTE ?? null, 6);
  const resolvedRpm = rpmFromHeader ?? rpmFromEnv;

  const resolvedGeminiKey = geminiApiKey || env.GEMINI_API_KEY || '';
  const resolvedGoogleKey = googleCseApiKey || env.GOOGLE_CSE_API_KEY || '';
  const resolvedGoogleCx = googleCseCx || env.GOOGLE_CSE_CX || '';
  const resolvedNewsKey = newsApiKey || env.NEWS_API_KEY || '';
  const resolvedEventRegistryKey = eventRegistryApiKey || env.EVENT_REGISTRY_API_KEY || '';

  const config: AppConfig = {
    environment: 'production',
    server: {
      port: 1,
      heartbeatIntervalMs: 15_000,
    },
    recencyHours: 168,
    retrieval: {
      // Workers have a strict subrequest (fetch) budget per invocation.
      // Keep these conservative so we still have room for Gemini calls.
      minAccepted: 12,
      maxAttempts: 22,
      globalConcurrency: 2,
      perHostConcurrency: 2,
      fetchTimeoutMs: 30_000,
      totalBudgetMs: 45_000,
      cacheTtlMs: 15 * 60 * 1000,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
      blockedCidrs: RFC1918_CIDRS,
      clusterThreshold: 0.65,
      attachThreshold: 0.55,
    },
    connectors: {
      googleCse: {
        apiKey: resolvedGoogleKey || undefined,
        searchEngineId: resolvedGoogleCx || undefined,
        enabled: Boolean(resolvedGoogleKey && resolvedGoogleCx),
      },
      newsApi: {
        apiKey: resolvedNewsKey || undefined,
        pageSize: 20,
        enabled: Boolean(resolvedNewsKey),
      },
      eventRegistry: {
        apiKey: resolvedEventRegistryKey || undefined,
        lookbackHours: 168,
        maxEvents: 25,
        enabled: Boolean(resolvedEventRegistryKey),
      },
    },
    llm: {
      apiKey: resolvedGeminiKey || 'missing',
      proModel: 'gemini-2.5-pro',
      flashModel: 'gemini-2.5-flash',
      flashLiteModel: 'gemini-2.5-flash-lite',
      temperature: 0.2,
      maxOutputTokens: 4096,
      requestsPerMinute: Math.max(1, Math.min(10, resolvedRpm)),
    },
    persistence: {
      mode: 'none',
      rootDir: 'disabled',
      rawProviderDir: 'disabled',
      extractDir: 'disabled',
      normalizedDir: 'disabled',
      outputsDir: 'disabled',
    },
    observability: {
      logLevel: 'info',
      metricsEnabled: false,
    },
  };

  return ConfigSchema.parse(config);
};
