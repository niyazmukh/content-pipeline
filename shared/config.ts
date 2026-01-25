import { z } from 'zod';

export const RFC1918_CIDRS = [
  '127.0.0.0/8',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16',
  '::1/128',
  'fc00::/7',
  'fe80::/10',
];

export const ConfigSchema = z.object({
  environment: z.enum(['development', 'test', 'production']),
  server: z.object({
    port: z.number().int().positive().max(65535),
    heartbeatIntervalMs: z.number().int().positive(),
  }),
  recencyHours: z.number().int().positive(),
  retrieval: z.object({
    minAccepted: z.number().int().positive(),
    maxAttempts: z.number().int().positive(),
    globalConcurrency: z.number().int().positive(),
    perHostConcurrency: z.number().int().positive(),
    fetchTimeoutMs: z.number().int().positive(),
    totalBudgetMs: z.number().int().positive(),
    cacheTtlMs: z.number().int().nonnegative(),
    userAgent: z.string().min(1),
    blockedCidrs: z.array(z.string().min(3)),
    clusterThreshold: z.number().min(0).max(1).optional(),
    attachThreshold: z.number().min(0).max(1).optional(),
  }),
  connectors: z.object({
    googleCse: z.object({
      apiKey: z.string().optional(),
      searchEngineId: z.string().optional(),
      enabled: z.boolean(),
    }),
    newsApi: z.object({
      apiKey: z.string().optional(),
      pageSize: z.number().int().positive(),
      enabled: z.boolean(),
    }),
    eventRegistry: z.object({
      apiKey: z.string().optional(),
      lookbackHours: z.number().int().positive(),
      maxEvents: z.number().int().positive(),
      enabled: z.boolean(),
    }),
  }),
  llm: z.object({
    apiKey: z.string().min(1),
    proModel: z.string().min(1),
    flashModel: z.string().min(1),
    flashLiteModel: z.string().min(1),
    temperature: z.number().min(0).max(2),
    maxOutputTokens: z.number().int().positive(),
    requestsPerMinute: z.number().int().positive(),
  }),
  persistence: z.object({
    mode: z.enum(['fs', 'none']),
    rootDir: z.string().min(1),
    rawProviderDir: z.string().min(1),
    extractDir: z.string().min(1),
    normalizedDir: z.string().min(1),
    outputsDir: z.string().min(1),
  }),
  observability: z.object({
    logLevel: z.enum(['debug', 'info', 'warn', 'error']),
    metricsEnabled: z.boolean(),
  }),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export interface PublicConfig {
  recencyHours: number;
  retrieval: {
    minAccepted: number;
    maxAttempts: number;
    globalConcurrency: number;
    perHostConcurrency: number;
    totalBudgetMs: number;
  };
}

export const getPublicConfig = (config: AppConfig): PublicConfig => ({
  recencyHours: config.recencyHours,
  retrieval: {
    minAccepted: config.retrieval.minAccepted,
    maxAttempts: config.retrieval.maxAttempts,
    globalConcurrency: config.retrieval.globalConcurrency,
    perHostConcurrency: config.retrieval.perHostConcurrency,
    totalBudgetMs: config.retrieval.totalBudgetMs,
  },
});
