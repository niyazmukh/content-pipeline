import type { NormalizedArticle } from './types';
import type { QueryIntent } from './queryIntent';
import { tokenizeForRelevance } from './queryUtils';

export interface EvidenceQualityResult {
  score: number;
  anchorCoverage: number;
  facetCoverage: number;
  entityCoverage: number;
  factualDensity: number;
  bodyQuality: number;
  reasons: string[];
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const articleText = (article: NormalizedArticle): string =>
  `${article.title}\n${article.excerpt}\n${article.body || ''}`.toLowerCase();

const phraseCoverage = (text: string, phrases: string[]): number => {
  if (!phrases.length) return 1;
  const hits = phrases.filter((phrase) => text.includes(phrase.toLowerCase())).length;
  return Number((hits / phrases.length).toFixed(3));
};

const alternativePhraseCoverage = (text: string, phrases: string[]): number => {
  if (!phrases.length) return 1;
  return phrases.some((phrase) => text.includes(phrase.toLowerCase())) ? 1 : 0;
};

const tokenCoverage = (text: string, values: string[]): number => {
  const tokens = new Set(tokenizeForRelevance(text, { maxTokens: 256 }));
  const wanted = values.flatMap((value) => tokenizeForRelevance(value, { maxTokens: 12 }));
  const uniqueWanted = Array.from(new Set(wanted));
  if (!uniqueWanted.length) return 1;
  const hits = uniqueWanted.filter((token) => tokens.has(token)).length;
  return Number((hits / uniqueWanted.length).toFixed(3));
};

const computeFactualDensity = (article: NormalizedArticle): number => {
  const text = articleText(article);
  const dates = text.match(/\b20\d{2}(?:-\d{2}-\d{2})?\b/g)?.length ?? 0;
  const money = text.match(/(?:\$|€|£)\s?\d+(?:\.\d+)?|\b\d+(?:\.\d+)?\s?(?:million|billion|percent|%)\b/gi)?.length ?? 0;
  const namedEntities = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g)?.length ?? 0;
  return clamp01((Math.min(dates, 3) * 0.25) + (Math.min(money, 3) * 0.25) + (Math.min(namedEntities, 4) * 0.125));
};

const computeBodyQuality = (article: NormalizedArticle): number => {
  const wordScore = clamp01(article.quality.wordCount / 800);
  const uniqueScore = clamp01(article.quality.uniqueWordCount / 250);
  const extractedBonus = article.hasExtractedBody ? 0.2 : 0;
  return Number(clamp01(wordScore * 0.45 + uniqueScore * 0.35 + extractedBonus).toFixed(3));
};

export const scoreEvidenceQuality = (
  article: NormalizedArticle,
  intent?: QueryIntent,
): EvidenceQualityResult => {
  const text = articleText(article);
  const anchorCoverage = intent ? alternativePhraseCoverage(text, intent.subjectPhrases) : 1;
  const entityCoverage = intent ? phraseCoverage(text, intent.requiredEntities) : 1;
  const facetCoverage = intent ? tokenCoverage(text, intent.facets) : 1;
  const factualDensity = computeFactualDensity(article);
  const bodyQuality = computeBodyQuality(article);

  const score = Number(
    clamp01(
      anchorCoverage * 0.32 +
        facetCoverage * 0.2 +
        entityCoverage * 0.12 +
        factualDensity * 0.18 +
        bodyQuality * 0.18,
    ).toFixed(4),
  );

  return {
    score,
    anchorCoverage,
    facetCoverage,
    entityCoverage,
    factualDensity,
    bodyQuality,
    reasons: [
      `anchorCoverage=${anchorCoverage}`,
      `facetCoverage=${facetCoverage}`,
      `entityCoverage=${entityCoverage}`,
      `factualDensity=${Number(factualDensity.toFixed(3))}`,
      `bodyQuality=${bodyQuality}`,
      `hasExtractedBody=${article.hasExtractedBody ? 1 : 0}`,
    ],
  };
};
