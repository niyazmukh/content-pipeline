export interface ApiKeys {
  geminiApiKey: string;
  googleCseApiKey: string;
  googleCseCx: string;
  newsApiKey: string;
  eventRegistryApiKey: string;
  geminiRpm: string;
}

const STORAGE_KEY = 'gcp_pipeline_api_keys_v1';

const emptyKeys: ApiKeys = {
  geminiApiKey: '',
  googleCseApiKey: '',
  googleCseCx: '',
  newsApiKey: '',
  eventRegistryApiKey: '',
  geminiRpm: '',
};

export const loadApiKeys = (): ApiKeys => {
  if (typeof window === 'undefined') {
    return { ...emptyKeys };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...emptyKeys };
    const parsed = JSON.parse(raw) as Partial<ApiKeys>;
    return { ...emptyKeys, ...parsed };
  } catch {
    return { ...emptyKeys };
  }
};

export const saveApiKeys = (keys: ApiKeys) => {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
};

export const clearApiKeys = () => {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.removeItem(STORAGE_KEY);
};

export const buildAuthHeaders = (keys?: ApiKeys): Record<string, string> => {
  const k = keys ?? loadApiKeys();
  const headers: Record<string, string> = {};
  if (k.geminiApiKey) headers['X-Gemini-Api-Key'] = k.geminiApiKey;
  if (k.googleCseApiKey) headers['X-Google-Cse-Api-Key'] = k.googleCseApiKey;
  if (k.googleCseCx) headers['X-Google-Cse-Cx'] = k.googleCseCx;
  if (k.newsApiKey) headers['X-Newsapi-Key'] = k.newsApiKey;
  if (k.eventRegistryApiKey) headers['X-Eventregistry-Api-Key'] = k.eventRegistryApiKey;
  if (k.geminiRpm) headers['X-Gemini-Rpm'] = k.geminiRpm;
  return headers;
};
