import JSON5 from 'json5';
import type { AppConfig } from '../../shared/config';
import type { Logger } from '../obs/logger';
import { LLMService } from '../services/llmService';
import { extractJson, extractJsonRobust } from '../utils/jsonExtract';
import { sleep } from '../utils/async';

export interface TopicQueryRewriteArgs {
  rawTopic: string;
  config: AppConfig;
  logger?: Logger;
  signal?: AbortSignal;
}

const STOPWORDS = new Set([
  'the',
  'and',
  'or',
  'for',
  'with',
  'from',
  'that',
  'this',
  'are',
  'was',
  'were',
  'will',
  'would',
  'could',
  'should',
  'a',
  'an',
  'of',
  'to',
  'in',
  'on',
  'by',
  'at',
  'as',
  'is',
  'it',
  'be',
  'has',
  'have',
  'had',
  'not',
  'but',
  'about',
  'into',
  'latest',
  'recent',
  'news',
  'updates',
  'update',
  'trends',
  'trend',
  'insights',
  'overview',
  'report',
  'reports',
  'state',
  'industry',
  'sector',
]);

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));

const buildBaselinePhrases = (topic: string): string[] => {
  const tokens = tokenize(topic);
  if (!tokens.length) {
    const trimmed = topic.trim();
    return trimmed ? [trimmed] : [];
  }
  const phrases = new Set<string>();
  const trimmedTokens = tokens.slice(0, 24);
  const chunkSize = Math.max(3, Math.min(5, Math.floor(trimmedTokens.length / 3) || 3));
  for (let index = 0; index < trimmedTokens.length && phrases.size < 6; index += chunkSize) {
    const chunk = trimmedTokens.slice(index, index + chunkSize).join(' ').trim();
    if (chunk.length >= 3) {
      phrases.add(chunk);
    }
  }
  const leading = trimmedTokens.slice(0, Math.min(6, trimmedTokens.length)).join(' ').trim();
  if (leading.length >= 3) {
    phrases.add(leading);
  }
  if (trimmedTokens.length > 6) {
    const trailing = trimmedTokens.slice(-Math.min(6, trimmedTokens.length)).join(' ').trim();
    if (trailing.length >= 3) {
      phrases.add(trailing);
    }
  }
  return Array.from(phrases);
};

const buildQueryFromPhrases = (phrases: string[]): string => {
  const seen = new Set<string>();
  const cleaned = [];
  for (const phrase of phrases) {
    const normalized = phrase.replace(/"/g, ' ').replace(/\s+/g, ' ').trim();
    if (normalized.length < 3 || normalized.length > 80) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    cleaned.push(normalized);
  }
  if (!cleaned.length) {
    return '';
  }
  return cleaned.map((p) => `"${p}"`).join(' OR ');
};

const extractPhrasesFromQuery = (query: string): string[] => {
  const phrases: string[] = [];
  const re = /"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(query)) !== null) {
    const text = match[1].trim();
    if (text) {
      phrases.push(text);
    }
  }
  return phrases;
};

interface TopicQueryRewritePayload {
  query?: string;
  phrases?: string[];
}

const buildPrompt = (topic: string): string =>
  [
    '# Topic Query Optimization',
    '',
    'You turn a freeform topic into one Google-style query composed of quoted key phrases joined with OR.',
    '',
    'Input topic:',
    '"""',
    topic,
    '"""',
    '',
    'Requirements:',
    '- Return ONLY valid JSON, no prose.',
    '- Format exactly:',
    '  {',
    '    "query": "\\"phrase 1\\" OR \\"phrase 2\\" OR \\"phrase 3\\"",',
    '    "phrases": ["phrase 1", "phrase 2", "phrase 3"]',
    '  }',
    '- Provide 3-6 phrases, each 3-8 words, covering different facets (entities, geographies, actions, data points).',
    '- The "query" field must contain only those phrases joined by the literal string ` OR ` (space-OR-space).',
    '- Do NOT emit operators such as site:, filetype:, -, AND, or parentheses.',
    '- Avoid promotional or sales language; keep phrases descriptive and neutral.',
    '- Focus strictly on the supplied topic—no assumptions about industries unless stated.',
  ].join('\n');

export const rewriteTopicToQuery = async ({
  rawTopic,
  config,
  logger,
  signal,
}: TopicQueryRewriteArgs): Promise<string> => {
  const cleaned = rawTopic.replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return '';
  }

  const prompt = buildPrompt(cleaned);
  const llmService = new LLMService(config, logger as Logger);

  try {
    const parsed = await llmService.generateAndParse<TopicQueryRewritePayload>(prompt, {
      model: config.llm.flashLiteModel || config.llm.flashModel,
      temperature: Math.max(0.1, Math.min(config.llm.temperature, 0.5)),
      maxOutputTokens: Math.min(512, config.llm.maxOutputTokens),
      signal,
    });

    const queryRaw = typeof parsed.query === 'string' ? parsed.query.trim() : '';
    const phrasesRaw = Array.isArray(parsed.phrases) ? parsed.phrases : [];

    let phrases = phrasesRaw
      .map((value) => String(value || '').trim())
      .filter((value) => value.length >= 3 && value.length <= 80);

    if (!phrases.length && queryRaw) {
      phrases = extractPhrasesFromQuery(queryRaw);
    }

    if (!phrases.length) {
      phrases = buildBaselinePhrases(cleaned);
    }

    if (phrases.length < 2) {
      phrases = [...phrases, ...buildBaselinePhrases(cleaned)];
    }

    phrases = phrases.slice(0, 6);

    if (phrases.length < 2) {
      const seed = phrases[0]?.replace(/"/g, ' ').trim() || cleaned;
      const fallbackSeed = seed || 'global developments';
      phrases = [fallbackSeed, `${fallbackSeed} outlook`];
    }

    const query = buildQueryFromPhrases(phrases);
    if (!query) {
      throw new Error('Topic rewrite produced empty query');
    }

    if (logger && typeof logger.debug === 'function') {
      logger.debug('Topic rewritten via Gemini', {
        rawTopic: cleaned,
        query,
        phrases,
      });
    }

    return query;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    
    const fallbackPhrases = buildBaselinePhrases(cleaned);
    if (fallbackPhrases.length < 2) {
      const seed = fallbackPhrases[0]?.replace(/"/g, ' ').trim() || cleaned || 'global developments';
      fallbackPhrases.push(`${seed} insights`);
    }
    const fallbackQuery = buildQueryFromPhrases(fallbackPhrases) || `"${cleaned.replace(/"/g, ' ').trim()}"`;

    if (logger && typeof logger.warn === 'function') {
      logger.warn('Topic rewrite failed; using heuristic fallback', {
        rawTopic: cleaned,
        fallbackQuery,
        error: message,
      });
    }

    return fallbackQuery;
  }
};

