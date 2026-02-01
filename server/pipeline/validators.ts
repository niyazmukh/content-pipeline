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
  const availableDates = new Set(
    clusters
      .map((cluster) => cluster.representative.publishedAt?.split('T')[0] || null)
      .filter((d): d is string => Boolean(d)),
  );
  const requiredUniqueDates = availableDates.size ? Math.min(3, availableDates.size) : 0;
  const usedDates = new Set<string>();
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
        } else {
          usedDates.add(date);
        }
      }
      if (requiredUniqueDates > 0 && point.dates.length === 0) {
        errors.push(`Outline item ${index + 1} missing dates`);
      }
    } else if (requiredUniqueDates > 0) {
      errors.push(`Outline item ${index + 1} missing dates`);
    }
  }

  if (usedIds.size < requiredDistinctClusters) {
    const label = requiredDistinctClusters === 1 ? 'cluster' : 'distinct clusters';
    errors.push(`Outline uses fewer than ${requiredDistinctClusters} ${label}`);
  }

  if (requiredUniqueDates > 0 && usedDates.size < requiredUniqueDates) {
    errors.push(`Outline includes ${usedDates.size} unique dates; expected at least ${requiredUniqueDates}`);
  }

  return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
};

export interface ArticleValidationOptions {
  minCitations: number;
  minDistinctCitationIds: number;
  minNarrativeDates: number;
  narrativeDatesPolicy: 'require' | 'warn' | 'off';
  keyDevelopmentsPolicy: 'require' | 'warn' | 'off';
  minKeyDevelopmentsBullets: number;
  maxKeyDevelopmentsBullets?: number;
}

export interface ArticleBodyValidationResult {
  errors: string[];
  warnings: string[];
}

export const validateArticleBody = (
  article: string,
  options: ArticleValidationOptions,
): ArticleBodyValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];

  const citationIds: number[] = [];
  const citationRe = /\[(\d+)]/g;
  let match: RegExpExecArray | null;
  while ((match = citationRe.exec(article)) !== null) {
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > 0) {
      citationIds.push(n);
    }
  }
  const distinctCitationIds = new Set(citationIds);

  if (citationIds.length < options.minCitations) {
    errors.push(`Article contains ${citationIds.length} citations; expected at least ${options.minCitations}`);
  }

  if (distinctCitationIds.size < options.minDistinctCitationIds) {
    errors.push(
      `Article uses ${distinctCitationIds.size} distinct sources; expected at least ${options.minDistinctCitationIds}`,
    );
  }

  const lines = article.split(/\r?\n/);
  const keyDevelopmentsLineIndex = lines.findIndex((line) => /^\s*key developments\b/i.test(line.trim()));

  const narrativeText = keyDevelopmentsLineIndex >= 0 ? lines.slice(0, keyDevelopmentsLineIndex).join('\n') : article;

  const narrativeDates = new Set((narrativeText.match(/\b\d{4}-\d{2}-\d{2}\b/g) || []).map((d) => d.trim()));
  if (options.narrativeDatesPolicy !== 'off' && narrativeDates.size < options.minNarrativeDates) {
    const message = `Article narrative contains ${narrativeDates.size} unique dates; expected at least ${options.minNarrativeDates}`;
    if (options.narrativeDatesPolicy === 'require') {
      errors.push(message);
    } else {
      warnings.push(message);
    }
  }

  // Narrative paragraph citation coverage (skip short headings)
  const narrativeParagraphs = narrativeText
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  for (const paragraph of narrativeParagraphs) {
    const wordCount = (paragraph.match(/\b\w+\b/g) || []).length;
    if (wordCount < 8) {
      continue;
    }
    if (!/\[\d+]/.test(paragraph)) {
      errors.push('Every narrative paragraph must include at least one inline citation like [1].');
      break;
    }
  }

  if (options.keyDevelopmentsPolicy !== 'off') {
    if (keyDevelopmentsLineIndex < 0) {
      const message = 'Missing "Key developments" section.';
      if (options.keyDevelopmentsPolicy === 'require') {
        errors.push(message);
      } else {
        warnings.push(message);
      }
    } else {
      const afterHeader = lines.slice(keyDevelopmentsLineIndex + 1);
      const isBulletLine = (line: string): boolean => {
        const trimmed = line.trim();
        if (!trimmed) return false;
        // Accept common bullet markers, but also tolerate "raw" one-line bullets without a marker.
        if (/^\s*[-*]\s+/.test(line)) return true;
        if (/^\d{4}-\d{2}-\d{2}\s*-\s+/.test(trimmed)) return true;
        if (/^undated\s*-\s+/i.test(trimmed)) return true;
        return false;
      };
      const bulletLines = afterHeader.filter(isBulletLine);

      if (bulletLines.length < options.minKeyDevelopmentsBullets) {
        const message = `Key developments contains ${bulletLines.length} bullets; expected at least ${options.minKeyDevelopmentsBullets}`;
        if (options.keyDevelopmentsPolicy === 'require') {
          errors.push(message);
        } else {
          warnings.push(message);
        }
      }
      if (
        typeof options.maxKeyDevelopmentsBullets === 'number' &&
        Number.isFinite(options.maxKeyDevelopmentsBullets) &&
        bulletLines.length > options.maxKeyDevelopmentsBullets
      ) {
        const message = `Key developments contains ${bulletLines.length} bullets; expected at most ${options.maxKeyDevelopmentsBullets}`;
        if (options.keyDevelopmentsPolicy === 'require') {
          errors.push(message);
        } else {
          warnings.push(message);
        }
      }

      const bulletIssues: string[] = [];
      for (const bulletLine of bulletLines) {
        const bullet = bulletLine.replace(/^\s*[-*]\s+/, '').trim();
        const hasDateStart = /^\d{4}-\d{2}-\d{2}\s*-\s+/.test(bullet) || /^undated\s*-\s+/i.test(bullet);
        const hasUrl = /\(https?:\/\/[^)]+\)/.test(bullet);
        const hasCitation = /\[\d+]/.test(bullet);
        if (!hasDateStart || !hasUrl || !hasCitation) {
          bulletIssues.push(bulletLine.trim());
          if (bulletIssues.length >= 2) break;
        }
      }
      if (bulletIssues.length) {
        const message =
          'Key developments bullets must follow: - YYYY-MM-DD - Source - Headline (URL) [n] (or - Undated - ...). Example invalid bullets: ' +
          bulletIssues.join(' | ');
        if (options.keyDevelopmentsPolicy === 'require') {
          errors.push(message);
        } else {
          warnings.push(message);
        }
      }
    }
  }

  if (!errors.length && (citationIds.length > 20 || distinctCitationIds.size > 12)) {
    warnings.push('Article uses many citations; consider focusing on the most relevant sources.');
  }

  return { errors, warnings };
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
