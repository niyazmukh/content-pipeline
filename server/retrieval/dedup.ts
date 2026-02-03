import type { NormalizedArticle } from './types';
import { computeSimilarity } from '../utils/text';

export interface DeduplicationResult {
  unique: NormalizedArticle[];
  duplicates: {
    article: NormalizedArticle;
    duplicateOf: string;
    reason: 'canonical' | 'similarity';
    score?: number;
  }[];
}

export const deduplicateArticles = (
  articles: NormalizedArticle[],
  options: { similarityThreshold?: number; enableSimilarity?: boolean } = {},
): DeduplicationResult => {
  const unique: NormalizedArticle[] = [];
  const duplicates: DeduplicationResult['duplicates'] = [];
  const byCanonical = new Map<string, NormalizedArticle>();
  const byFingerprint: Array<{ article: NormalizedArticle; text: string }> = [];
  // Lower threshold from 0.85 to 0.78 for better semantic grouping
  const threshold = options.similarityThreshold ?? 0.78;
  const enableSimilarity = options.enableSimilarity ?? true;

  for (const article of articles) {
    const canonicalKey = article.canonicalUrl.toLowerCase();
    if (byCanonical.has(canonicalKey)) {
      duplicates.push({
        article,
        duplicateOf: byCanonical.get(canonicalKey)!.id,
        reason: 'canonical',
      });
      continue;
    }

    if (enableSimilarity) {
      const combinedText = `${article.title} ${article.excerpt || ''}`.slice(0, 600);
      let matched = false;
      for (const fingerprint of byFingerprint) {
        const score = computeSimilarity(combinedText, fingerprint.text);
        if (score >= threshold) {
          duplicates.push({
            article,
            duplicateOf: fingerprint.article.id,
            reason: 'similarity',
            score,
          });
          matched = true;
          break;
        }
      }

      if (matched) {
        continue;
      }

      byFingerprint.push({ article, text: combinedText });
    }

    unique.push(article);
    byCanonical.set(canonicalKey, article);
  }

  return { unique, duplicates };
};
