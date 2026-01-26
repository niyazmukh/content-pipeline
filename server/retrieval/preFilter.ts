/**
 * Light pre-filtering utilities for connector results.
 * Apply cheap heuristics to exclude low-quality candidates early.
 */

import { tokenizeForRelevance } from './queryUtils';

/**
 * Banned URL path patterns that typically don't contain article content.
 */
const BANNED_PATH_PATTERNS = [
  /\/about\b/i,
  /\/contact\b/i,
  /\/pricing\b/i,
  /\/careers\b/i,
  /\/jobs\b/i,
  /\/docs?\b/i,
  /\/documentation\b/i,
  /\/privacy\b/i,
  /\/terms\b/i,
  /\/legal\b/i,
  /\/api\b/i,
  /\/login\b/i,
  /\/signup\b/i,
  /\/register\b/i,
  /\/cart\b/i,
  /\/checkout\b/i,
  /\/support\b/i,
  /\/help\b/i,
  /\/faq\b/i,
  /\/category\b/i,
  /\/tag\b/i,
  /\/author\b/i,
  /\/search\b/i,
];

/**
 * Banned URL fragments that indicate non-article pages.
 */
const BANNED_FRAGMENTS = [
  'utm_',
  '#comment',
  '#respond',
  '/feed',
  '/rss',
  '/atom',
];

/**
 * Minimum lengths for title and snippet.
 */
const MIN_TITLE_LENGTH = 15;
const MIN_SNIPPET_LENGTH = 30;

/**
 * Quick relevance check: compute token overlap between query and content.
 */
const computeQuickRelevance = (query: string, title: string, snippet: string | null): number => {
  const queryTokens = tokenizeForRelevance(query, { maxTokens: 24 });

  // If the query is too short (0-1 meaningful tokens), the overlap signal is too noisy.
  // Don't reject candidates based on relevance in that case.
  if (queryTokens.length < 2) {
    return 1.0;
  }

  const contentTokens = new Set(tokenizeForRelevance(`${title} ${snippet || ''}`, { maxTokens: 128 }));

  let matches = 0;
  for (const token of queryTokens) {
    if (contentTokens.has(token)) {
      matches += 1;
    }
  }

  return matches / queryTokens.length;
};

export interface PreFilterResult {
  pass: boolean;
  reason?: string;
}

/**
 * Apply light pre-filtering to a candidate article.
 * Returns { pass: true } if the item should be kept, or { pass: false, reason } if it should be filtered.
 */
export const applyPreFilter = (
  url: string,
  title: string | null,
  snippet: string | null,
  query: string,
): PreFilterResult => {
  // Check URL
  if (!url || url.trim().length === 0) {
    return { pass: false, reason: 'empty_url' };
  }

  // Check banned path patterns
  for (const pattern of BANNED_PATH_PATTERNS) {
    if (pattern.test(url)) {
      return { pass: false, reason: 'banned_path' };
    }
  }

  // Check banned fragments
  for (const fragment of BANNED_FRAGMENTS) {
    if (url.includes(fragment)) {
      return { pass: false, reason: 'banned_fragment' };
    }
  }

  // Check title length
  const titleText = (title || '').trim();
  if (titleText.length < MIN_TITLE_LENGTH) {
    return { pass: false, reason: 'title_too_short' };
  }

  // Check snippet length
  const snippetText = (snippet || '').trim();
  if (snippetText.length < MIN_SNIPPET_LENGTH) {
    return { pass: false, reason: 'snippet_too_short' };
  }

  // Quick relevance check
  const relevance = computeQuickRelevance(query, titleText, snippetText);
  if (relevance < 0.1) {
    return { pass: false, reason: 'low_relevance' };
  }

  return { pass: true };
};
