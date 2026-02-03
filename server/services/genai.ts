import { GoogleGenAI } from '@google/genai';
import type { AppConfig } from '../../shared/config';
import { sleep } from '../utils/async';
import { Semaphore } from '../utils/concurrency';

type KeyState = {
  client: GoogleGenAI;
  requestTimestamps: number[];
  rateLimitMutex: Semaphore;
  lastUsedAt: number;
};

const stateByApiKey = new Map<string, KeyState>();
const MAX_KEYS = 32;

const trimStateCache = () => {
  if (stateByApiKey.size <= MAX_KEYS) {
    return;
  }
  let oldestKey: string | null = null;
  let oldestTs = Infinity;
  for (const [key, state] of stateByApiKey.entries()) {
    if (state.lastUsedAt < oldestTs) {
      oldestTs = state.lastUsedAt;
      oldestKey = key;
    }
  }
  if (oldestKey) {
    stateByApiKey.delete(oldestKey);
  }
};

const getStateForApiKey = (apiKey: string): KeyState => {
  const existing = stateByApiKey.get(apiKey);
  if (existing) {
    existing.lastUsedAt = Date.now();
    return existing;
  }

  const created: KeyState = {
    client: new GoogleGenAI({ apiKey }),
    requestTimestamps: [],
    rateLimitMutex: new Semaphore(1),
    lastUsedAt: Date.now(),
  };
  stateByApiKey.set(apiKey, created);
  trimStateCache();
  return created;
};

const parseRetryDelayMs = (error: unknown): number | null => {
  try {
    const details = (error as any)?.error?.details || (error as any)?.details || [];
    for (const detail of details) {
      if (!detail || typeof detail !== 'object') {
        continue;
      }
      const infoType = (detail['@type'] ?? '') as string;
      if (infoType.includes('RetryInfo') && detail.retryDelay) {
        const match = String(detail.retryDelay).match(/([0-9.]+)s/);
        if (match) {
          return Math.ceil(Number(match[1]) * 1000);
        }
      }
      if (typeof detail.retryDelay === 'string') {
        const match = detail.retryDelay.match(/([0-9.]+)s/);
        if (match) {
          return Math.ceil(Number(match[1]) * 1000);
        }
      }
    }
  } catch (err) {
    // ignore parse failures
  }
  return null;
};

export const isTransientError = (error: unknown): boolean => {
  const code = (error as any)?.status ?? (error as any)?.error?.code ?? null;
  if (code === 429 || code === 503) {
    return true;
  }
  const message = String((error as any)?.message ?? '').toLowerCase();
  return /quota|unavailable|overload|temporar/.test(message);
};

export interface GenerateContentParams {
  model: string;
  contents: unknown;
  config?: Record<string, unknown>;
  /**
   * Convenience abort signal; mapped to `config.abortSignal` for @google/genai.
   * (GenerateContentParameters does not accept a top-level signal.)
   */
  signal?: AbortSignal;
}

export const rateLimitedGenerateContent = async <T>(
  config: AppConfig,
  params: GenerateContentParams,
): Promise<T> => {
  const apiKey = config.llm.apiKey;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY missing');
  }
  const state = getStateForApiKey(apiKey);
  const ai = state.client;
  const requestTimestamps = state.requestTimestamps;
  const rateLimitMutex = state.rateLimitMutex;
  const windowMs = 60_000;
  // Hard cap: never exceed 10 RPM regardless of config
  const rpm = Math.max(1, Math.min(10, Number(config.llm.requestsPerMinute) || 10));

  const maxAttempts = 5;
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt += 1;

    try {
      if (params.signal?.aborted) {
        throw new Error('Aborted');
      }

      // Rate limit gate: make check+reserve atomic under concurrent calls.
      while (true) {
        const release = await rateLimitMutex.acquire(params.signal);
        let waitMs = 0;
        try {
          const now = Date.now();
          while (requestTimestamps.length > 0 && now - requestTimestamps[0] > windowMs) {
            requestTimestamps.shift();
          }

          if (requestTimestamps.length < rpm) {
            requestTimestamps.push(now);
            waitMs = 0;
          } else {
            const oldest = requestTimestamps[0];
            waitMs = Math.max(0, oldest + windowMs - now);
          }
        } finally {
          release();
        }

        if (waitMs <= 0) {
          break;
        }
        await sleep(waitMs, params.signal);
      }

      const reqConfig: Record<string, unknown> = { ...(params.config ?? {}) };
      if (params.signal && reqConfig.abortSignal == null) {
        reqConfig.abortSignal = params.signal;
      }

      const response = await ai.models.generateContent({
        model: params.model,
        contents: params.contents as any,
        config: reqConfig as any,
      } as any);
      return response as unknown as T;
    } catch (error) {
      if (error instanceof Error && /aborted/i.test(error.message)) {
        throw error;
      }
      if (!isTransientError(error)) {
        throw error instanceof Error ? error : new Error(String(error));
      }
      if (attempt >= maxAttempts) {
        throw error instanceof Error ? error : new Error(String(error));
      }
      const retryDelayMs = parseRetryDelayMs(error);
      const backoff = retryDelayMs ?? (Math.min(60_000, 1_000 * 2 ** attempt) + Math.floor(Math.random() * 1_000));
      await sleep(backoff, params.signal);
    }
  }

  throw new Error('Failed to generate content after retries');
};

/**
 * Best-effort extractor for the textual payload from Google GenAI generateContent responses.
 * Handles multiple SDK shapes and mime-types, including inlineData for application/json.
 */
export const extractGenerateContentText = (response: any): string | undefined => {
  const decodeBase64 = (value: string): string | null => {
    try {
      const g = globalThis as typeof globalThis & { atob?: (v: string) => string; Buffer?: typeof Buffer };
      if (typeof g.atob === 'function') {
        const binary = g.atob(value);
        const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
        return new TextDecoder().decode(bytes);
      }
      if (g.Buffer) {
        return g.Buffer.from(value, 'base64').toString('utf8');
      }
    } catch {
      return null;
    }
    return null;
  };
  try {
    // Newer SDK: response.response.text()
    const maybeTextFn = (response as any)?.response?.text;
    if (typeof maybeTextFn === 'function') {
      const text = maybeTextFn.call((response as any).response);
      if (typeof text === 'string' && text.trim()) return text;
    }
  } catch {
    // ignore
  }

  // Common convenience shapes
  const candidates: Array<string | undefined> = [
    typeof (response as any)?.text === 'string' ? (response as any).text : undefined,
    typeof (response as any)?.outputText === 'string' ? (response as any).outputText : undefined,
    typeof (response as any)?.output === 'string' ? (response as any).output : undefined,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c;
  }

  // Inspect candidates/parts (older/newer shapes)
  const partsFrom = (obj: any): any[] => {
    if (!obj) return [];
    const cands = obj.response?.candidates ?? obj.candidates ?? [];
    const out: any[] = [];
    for (const cand of cands) {
      const parts = cand?.content?.parts ?? [];
      for (const p of parts) out.push(p);
    }
    return out;
  };

  const parts = partsFrom(response);
  if (parts.length) {
    const chunks: string[] = [];
    for (const p of parts) {
      if (typeof p?.text === 'string') {
        chunks.push(p.text);
        continue;
      }
      const inline = (p as any)?.inlineData;
      if (inline && typeof inline?.data === 'string') {
        const decoded = decodeBase64(inline.data);
        if (decoded && decoded.trim()) chunks.push(decoded);
        continue;
      }
      // Structured args (function calls) – stringify for diagnostics
      if ((p as any)?.functionCall?.args && typeof (p as any).functionCall.args === 'object') {
        try {
          chunks.push(JSON.stringify((p as any).functionCall.args));
        } catch {
          // ignore
        }
      }
    }
    const joined = chunks.join("\n").trim();
    if (joined) return joined;
  }

  return undefined;
};

