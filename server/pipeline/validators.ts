import type { StoryCluster } from '../retrieval/types';

export type { OutlinePayload, OutlinePoint } from '../../shared/types';

import type { OutlinePayload } from '../../shared/types';

export interface OutlineValidationResult {
  ok: boolean;
  errors: string[];
}

const isIsoDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/u.test(value);

export const validateOutline = (outline: OutlinePayload, clusters: StoryCluster[]): OutlineValidationResult => {
  const errors: string[] = [];
  if (!outline.thesis || outline.thesis.trim().length < 12) {
    errors.push('Thesis too short');
  }
  const clusterIds = new Set(clusters.map((cluster) => cluster.clusterId));
  const usedIds = new Set<string>();
  const totalClusters = clusters.length;
  const requiredPoints = Math.max(1, totalClusters >= 5 ? 5 : totalClusters);
  const requiredDistinctClusters = Math.max(1, Math.min(4, totalClusters));
  const outlineItems = Array.isArray(outline.outline) ? outline.outline : [];

  if (outlineItems.length !== requiredPoints) {
    const label = requiredPoints === 1 ? 'point' : 'points';
    errors.push(`Outline must contain exactly ${requiredPoints} ${label}`);
  }

  for (const [index, point] of outlineItems.entries()) {
    if (!point.point || point.point.trim().length < 8) {
      errors.push(`Outline item ${index + 1} text too short`);
    }
    if (!Array.isArray(point.supports) || point.supports.length === 0) {
      errors.push(`Outline item ${index + 1} missing supports`);
      continue;
    }
    for (const id of point.supports) {
      if (!clusterIds.has(id)) {
        errors.push(`Outline item ${index + 1} references unknown cluster ${id}`);
      } else {
        usedIds.add(id);
      }
    }
    if (Array.isArray(point.dates)) {
      for (const date of point.dates) {
        if (!isIsoDate(date)) {
          errors.push(`Outline item ${index + 1} has invalid date ${date}`);
        }
      }
    }
  }

  if (usedIds.size < requiredDistinctClusters) {
    const label = requiredDistinctClusters === 1 ? 'cluster' : 'distinct clusters';
    errors.push(`Outline uses fewer than ${requiredDistinctClusters} ${label}`);
  }

  return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
};

export interface ArticleValidationOptions {
  minCitations: number;
  minExplicitDates: number;
}

export interface ArticleBodyValidationResult {
  errors: string[];
  warnings: string[];
}

export const validateArticleBody = (
  article: string,
  options: ArticleValidationOptions,
): ArticleBodyValidationResult => {
  const citationMatches = article.match(/\[(\d+)]/g) || [];
  const dateMatches = article.match(/\b\d{4}-\d{2}-\d{2}\b/g) || [];
  const warnings: string[] = [];

  if (citationMatches.length < options.minCitations) {
    warnings.push(`Article contains ${citationMatches.length} citations; expected at least ${options.minCitations}`);
  }
  const uniqueDates = new Set(dateMatches);
  if (uniqueDates.size < options.minExplicitDates) {
    warnings.push(`Article contains ${uniqueDates.size} unique dates; expected at least ${options.minExplicitDates}`);
  }

  return { errors: [], warnings };
};

export const computeNoveltyScore = (previous: string | null | undefined, current: string): number => {
  if (!previous || !previous.trim()) {
    return 1;
  }
  const prevTokens = new Set(
    previous
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 3),
  );
  const currentTokens = new Set(
    current
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 3),
  );
  if (!currentTokens.size) {
    return 0;
  }
  let overlap = 0;
  for (const token of currentTokens) {
    if (prevTokens.has(token)) {
      overlap += 1;
    }
  }
  const ratio = overlap / currentTokens.size;
  return Number((1 - ratio).toFixed(3));
};

const PROMO_PATTERNS: RegExp[] = [
  /\bbuy now\b/i,
  /\bshop now\b/i,
  /\border now\b/i,
  /\bsign up\b/i,
  /\bsubscribe now\b/i,
  /\bget started\b/i,
  /\bbook (?:a )?demo\b/i,
  /\brequest (?:a )?demo\b/i,
  /\bstart your free trial\b/i,
  /\bexclusive offer\b/i,
  /\blimited[-\s]?time offer\b/i,
  /\bpromo code\b/i,
  /\bspecial deal\b/i,
  /\bflash sale\b/i,
  /\bclaim your\b/i,
  /\bbest deal\b/i,
  /\bbest price\b/i,
];

export const validatePromotionPolicy = (text: string): string[] => {
  if (!text || !text.trim()) return [];
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const errors: string[] = [];
  for (const sentence of sentences) {
    for (const pattern of PROMO_PATTERNS) {
      if (pattern.test(sentence)) {
        errors.push('Avoid promotional or call-to-action language; keep the tone analytical and reportorial.');
        break;
      }
    }
  }
  return errors;
};
