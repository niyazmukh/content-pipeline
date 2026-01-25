import type { NormalizedArticle } from './types';

export interface FilterOptions {
  recencyHours: number;
  minWordCount: number;
  minUniqueWords: number;
  minRelevance: number;
  bannedHostPatterns: RegExp[];
  maxPromoPhraseMatches: number;
}

export interface FilterDecision {
  accept: boolean;
  reasons: string[];
  warnings: string[];
}

const countPromoPhrases = (text: string): number => {
  const phrases = [
    'subscribe now',
    'sign up',
    'limited time offer',
    'sponsored content',
    'press release',
    'click here',
  ];
  const lower = text.toLowerCase();
  return phrases.reduce((count, phrase) => (lower.includes(phrase) ? count + 1 : count), 0);
};

export const evaluateArticle = (article: NormalizedArticle, options: FilterOptions): FilterDecision => {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const now = Date.now();
  const recencyMs = options.recencyHours * 60 * 60 * 1000;

  if (article.publishedAt) {
    const publishedMs = Date.parse(article.publishedAt);
    if (!Number.isNaN(publishedMs)) {
      const ageMs = now - publishedMs;
      if (ageMs > recencyMs) {
        reasons.push('too_old');
      }
    }
  } else {
    warnings.push('missing_published_at');
  }

  const wordCount = article.quality.wordCount;
  if (wordCount < options.minWordCount) {
    reasons.push('too_short');
  }

  if (article.quality.uniqueWordCount < options.minUniqueWords) {
    reasons.push('insufficient_unique_words');
  }

  if (article.quality.relevanceScore < options.minRelevance) {
    reasons.push('low_relevance');
  }

  if (article.canonicalUrl) {
    const host = article.sourceHost.toLowerCase();
    if (options.bannedHostPatterns.some((regex) => regex.test(host))) {
      reasons.push('banned_source');
    }
  }

  if (article.body) {
    const promoMatches = countPromoPhrases(article.body);
    if (promoMatches > options.maxPromoPhraseMatches) {
      reasons.push('promo_content');
    }
  }

  return {
    accept: reasons.length === 0,
    reasons,
    warnings,
  };
};
