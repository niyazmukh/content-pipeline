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

const parseDateValue = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  const date = new Date(parsed);
  return Number.isNaN(date.getTime()) ? null : date;
};

const inferDateMention = (text: string): Date | null => {
  const sample = (text || '').slice(0, 5000);
  if (!sample) return null;

  const cueRe = /\b(published|posted|updated|last updated|posted on|published on|date)\b/i;
  const candidates: Array<{ date: Date; score: number }> = [];

  const maybePush = (raw: string, idx: number, baseScore: number) => {
    const date = parseDateValue(raw);
    if (!date) return;
    const year = date.getUTCFullYear();
    if (year < 2000 || year > new Date().getUTCFullYear() + 1) return;
    let score = baseScore;
    const start = Math.max(0, idx - 60);
    const end = Math.min(sample.length, idx + 80);
    if (cueRe.test(sample.slice(start, end))) score += 0.35;
    if (idx < 1200) score += 0.1;
    candidates.push({ date, score });
  };

  const isoRe = /\b20\d{2}-\d{2}-\d{2}\b/g;
  let isoMatch: RegExpExecArray | null;
  while ((isoMatch = isoRe.exec(sample)) !== null) {
    maybePush(isoMatch[0], isoMatch.index, 0.45);
  }

  const monthRe =
    /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},\s+20\d{2}\b/g;
  let monthMatch: RegExpExecArray | null;
  while ((monthMatch = monthRe.exec(sample)) !== null) {
    maybePush(monthMatch[0], monthMatch.index, 0.35);
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score || b.date.getTime() - a.date.getTime());
  return candidates[0].score >= 0.65 ? candidates[0].date : null;
};

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
    const inferred = inferDateMention(`${article.title}\n${article.excerpt}\n${article.body || ''}`);
    if (inferred) {
      const inferredAgeMs = now - inferred.getTime();
      // Slightly looser than explicit publishedAt to avoid over-rejecting borderline cases.
      if (inferredAgeMs > recencyMs * 1.25) {
        reasons.push('too_old_inferred');
      } else {
        warnings.push('missing_published_at');
      }
    } else {
      warnings.push('missing_published_at');
    }
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
