import path from 'node:path';
import { ConfigSchema, RFC1918_CIDRS, type AppConfig, type PublicConfig, getPublicConfig as getPublicConfigShared } from '../../shared/config';

const numberFromEnv = (value: string | undefined, fallback: number): number => {
  if (value == null || value.trim() === '') {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const booleanFromEnv = (value: string | undefined, fallback: boolean): boolean => {
  if (value == null || value.trim() === '') {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
};

const csvFromEnv = (value: string | undefined): string[] => {
  if (!value) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
};

export type { AppConfig, PublicConfig };

let cachedConfig: AppConfig | null = null;

const buildConfig = (): AppConfig => {
  const environment = (process.env.NODE_ENV || 'development').trim().toLowerCase();
  const rawRoot = process.env.RAW_DATA_ROOT || path.join(process.cwd(), 'raw_data');
  const rootDir = path.resolve(rawRoot);

  const rawConfig = {
    environment: environment === 'production' ? 'production' : environment === 'test' ? 'test' : 'development',
    server: {
      port: numberFromEnv(process.env.PORT, 3001),
      heartbeatIntervalMs: numberFromEnv(process.env.HEARTBEAT_INTERVAL_MS, 15_000),
    },
    recencyHours: numberFromEnv(process.env.RECENCY_HOURS, 168),
    retrieval: {
      minAccepted: numberFromEnv(process.env.RETRIEVAL_MIN_ACCEPTED, 30),
      maxAttempts: numberFromEnv(process.env.RETRIEVAL_MAX_ATTEMPTS, 120),
      globalConcurrency: numberFromEnv(process.env.RETRIEVAL_GLOBAL_CONCURRENCY, 6),
      perHostConcurrency: numberFromEnv(process.env.RETRIEVAL_PER_HOST_CONCURRENCY, 2),
      fetchTimeoutMs: numberFromEnv(process.env.RETRIEVAL_FETCH_TIMEOUT_MS, 30_000),
      totalBudgetMs: numberFromEnv(process.env.RETRIEVAL_TOTAL_BUDGET_MS, 60_000),
      cacheTtlMs: numberFromEnv(process.env.EXTRACTION_CACHE_TTL_MS, 12 * 60 * 60 * 1000),
      userAgent:
        process.env.RETRIEVAL_USER_AGENT?.trim() ||
        // Use a realistic browser UA by default to avoid 403s from some publishers
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
      blockedCidrs: RFC1918_CIDRS,
      clusterThreshold: Number.isFinite(Number(process.env.CLUSTER_THRESHOLD))
        ? Number(process.env.CLUSTER_THRESHOLD)
        : 0.65,
      attachThreshold: Number.isFinite(Number(process.env.ATTACH_THRESHOLD))
        ? Number(process.env.ATTACH_THRESHOLD)
        : 0.55,
    },
    connectors: {
      googleCse: {
        apiKey: process.env.GOOGLE_CSE_API_KEY || undefined,
        searchEngineId: process.env.GOOGLE_CSE_SEARCH_ENGINE_ID || process.env.GOOGLE_CSE_CX || undefined,
        enabled: booleanFromEnv(process.env.GOOGLE_CSE_ENABLED, true),
        newsOnly: booleanFromEnv(process.env.GOOGLE_CSE_NEWS_ONLY, true),
        allowedHosts: csvFromEnv(process.env.GOOGLE_CSE_ALLOWED_HOSTS),
      },
      newsApi: {
        apiKey: process.env.NEWS_API_KEY || process.env.NEWSAPI_KEY || undefined,
        pageSize: numberFromEnv(process.env.NEWSAPI_PAGE_SIZE, 20),
        enabled: booleanFromEnv(process.env.NEWS_API_ENABLED, true),
      },
      eventRegistry: {
        apiKey: process.env.EVENT_REGISTRY_API_KEY || process.env.EVENT_REGISTRY_KEY || undefined,
        lookbackHours: numberFromEnv(process.env.EVENT_REGISTRY_LOOKBACK_HOURS, 168),
        maxEvents: numberFromEnv(process.env.EVENT_REGISTRY_MAX_EVENTS, 25),
        enabled: booleanFromEnv(process.env.EVENT_REGISTRY_ENABLED, true),
      },
    },
    llm: {
      apiKey: process.env.GEMINI_API_KEY?.trim() || '',
      proModel: process.env.GEMINI_PRO_MODEL?.trim() || 'gemini-2.5-pro',
      flashModel: process.env.GEMINI_FLASH_MODEL?.trim() || 'gemini-2.5-flash',
      flashLiteModel: process.env.GEMINI_FLASH_LITE_MODEL?.trim() || 'gemini-2.5-flash-lite',
      temperature: Number.isFinite(Number(process.env.GEMINI_TEMPERATURE))
        ? Number(process.env.GEMINI_TEMPERATURE)
        : 0.2,
      maxOutputTokens: numberFromEnv(process.env.GEMINI_MAX_OUTPUT_TOKENS, 4096),
      // Hard cap: never exceed 10 RPM regardless of environment value
      requestsPerMinute: Math.max(
        1,
        Math.min(10, numberFromEnv(process.env.GEMINI_REQUESTS_PER_MINUTE, 10)),
      ),
    },
    persistence: {
      mode: 'fs',
      rootDir,
      rawProviderDir: path.join(rootDir, 'providers'),
      extractDir: path.join(rootDir, 'extract'),
      normalizedDir: path.join(rootDir, 'normalized'),
      outputsDir: path.join(rootDir, 'outputs'),
    },
    observability: {
      logLevel: (process.env.LOG_LEVEL || 'info').toLowerCase() as 'debug' | 'info' | 'warn' | 'error',
      metricsEnabled: booleanFromEnv(process.env.METRICS_ENABLED, true),
    },
  };

  return ConfigSchema.parse(rawConfig);
};

export const loadConfig = (): AppConfig => {
  if (cachedConfig) {
    return cachedConfig;
  }
  cachedConfig = buildConfig();
  return cachedConfig;
};

export const getPublicConfig = (config: AppConfig = loadConfig()): PublicConfig => getPublicConfigShared(config);

export const refreshConfig = (): AppConfig => {
  cachedConfig = null;
  return loadConfig();
};
