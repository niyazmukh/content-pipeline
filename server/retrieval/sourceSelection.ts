import type { RetrievalQualityReport } from '../../shared/types';
import type { QueryIntent } from './queryIntent';
import type { RankedArticle } from './ranking';

export interface SourceSelectionOptions {
  minSources?: number;
  maxSources?: number;
  minEvidenceScore?: number;
  minAnchorCoverage?: number;
}

export interface SourceSelectionResult {
  selected: RankedArticle[];
  rejected: Array<{
    article: RankedArticle;
    reasons: string[];
  }>;
  coverage: {
    sourceCount: number;
    providerCount: number;
    anchorCoverage: number;
    averageEvidenceScore: number;
    facets: Record<string, number>;
    warnings: string[];
    readyForSynthesis: boolean;
  };
  report: RetrievalQualityReport;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const normalize = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const facetKey = (facet: string): string => normalize(facet).replace(/[-\s]+/g, '_');

const articleText = (article: RankedArticle): string =>
  normalize([article.title, article.excerpt, article.body ?? '', article.sourceName ?? ''].join(' '));

const hasPhrase = (text: string, phrase: string): boolean => {
  const normalizedPhrase = normalize(phrase);
  if (!normalizedPhrase) return false;
  return text.includes(normalizedPhrase);
};

const facetAliases = (facet: string): string[] => {
  const normalizedFacet = normalize(facet);
  const aliases = new Set([normalizedFacet]);
  if (normalizedFacet.endsWith('ies')) aliases.add(`${normalizedFacet.slice(0, -3)}y`);
  if (normalizedFacet.endsWith('s')) aliases.add(normalizedFacet.slice(0, -1));
  if (normalizedFacet === 'reports') aliases.add('report');
  if (normalizedFacet === 'case studies') aliases.add('case study');
  if (normalizedFacet === 'acquisitions') aliases.add('acquisition');
  return Array.from(aliases).filter(Boolean);
};

const computeAnchorCoverage = (selected: RankedArticle[], intent: QueryIntent): number => {
  const anchors = intent.subjectPhrases.length ? intent.subjectPhrases : [intent.originalTopic];
  if (!anchors.length || !selected.length) return selected.length ? 1 : 0;
  const covered = selected.filter((article) => {
    const text = articleText(article);
    return anchors.some((anchor) => hasPhrase(text, anchor));
  }).length;
  return clamp01(covered / selected.length);
};

const computeFacetCoverage = (selected: RankedArticle[], intent: QueryIntent): Record<string, number> => {
  const coverage: Record<string, number> = {};
  for (const facet of intent.facets) {
    const key = facetKey(facet);
    if (!key) continue;
    const aliases = facetAliases(facet);
    const count = selected.filter((article) => {
      const text = articleText(article);
      return aliases.some((alias) => hasPhrase(text, alias));
    }).length;
    coverage[key] = count;
  }
  return coverage;
};

const rejectionReasonsFor = (
  article: RankedArticle,
  intent: QueryIntent,
  options: Required<Pick<SourceSelectionOptions, 'minEvidenceScore' | 'minAnchorCoverage'>>,
): string[] => {
  const reasons: string[] = [];
  const evidenceScore = article.quality.evidenceScore ?? 0;
  const text = articleText(article);
  const anchors = intent.subjectPhrases.length ? intent.subjectPhrases : [intent.originalTopic];
  const hasAnchor = anchors.length === 0 || anchors.some((anchor) => hasPhrase(text, anchor));

  if (evidenceScore < options.minEvidenceScore) reasons.push('weak_evidence');
  if (!hasAnchor && options.minAnchorCoverage > 0) reasons.push('missing_topic_anchor');
  if ((article.quality.wordCount ?? 0) < 250) reasons.push('thin_article');

  return reasons;
};

const domainKey = (article: RankedArticle): string => {
  try {
    return new URL(article.canonicalUrl).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return article.sourceHost.toLowerCase().replace(/^www\./, '');
  }
};

export const selectQualitySources = (
  ranked: RankedArticle[],
  intent: QueryIntent,
  options: SourceSelectionOptions = {},
): SourceSelectionResult => {
  const minSources = Math.max(1, options.minSources ?? 6);
  const maxSources = Math.max(minSources, options.maxSources ?? 12);
  const minEvidenceScore = options.minEvidenceScore ?? 0.35;
  const minAnchorCoverage = options.minAnchorCoverage ?? 0.5;

  const selected: RankedArticle[] = [];
  const rejected: SourceSelectionResult['rejected'] = [];
  const selectedDomains = new Set<string>();

  for (const article of ranked) {
    const reasons = rejectionReasonsFor(article, intent, { minEvidenceScore, minAnchorCoverage });
    const sourceDomain = domainKey(article);
    const duplicateDomain = selectedDomains.has(sourceDomain);
    const keepForDiversity = selected.length < minSources || !duplicateDomain;

    if (reasons.length || !keepForDiversity) {
      rejected.push({
        article,
        reasons: reasons.length ? reasons : ['source_diversity_duplicate'],
      });
      continue;
    }

    selected.push(article);
    selectedDomains.add(sourceDomain);
    if (selected.length >= maxSources) {
      break;
    }
  }

  if (selected.length < minSources) {
    for (const article of ranked) {
      if (selected.some((item) => item.id === article.id)) continue;
      const existingRejected = rejected.find((entry) => entry.article.id === article.id);
      const reasons = existingRejected?.reasons ?? [];
      if (reasons.some((reason) => ['weak_evidence', 'missing_topic_anchor', 'thin_article'].includes(reason))) continue;
      selected.push(article);
      if (selected.length >= minSources || selected.length >= maxSources) break;
    }
  }

  const providerCount = new Set(selected.map((article) => article.provenance.provider)).size;
  const anchorCoverage = computeAnchorCoverage(selected, intent);
  const facets = computeFacetCoverage(selected, intent);
  const averageEvidenceScore = selected.length
    ? selected.reduce((sum, article) => sum + (article.quality.evidenceScore ?? 0), 0) / selected.length
    : 0;
  const warnings: string[] = [];
  if (selected.length < minSources) warnings.push('source_count_below_minimum');
  if (anchorCoverage < minAnchorCoverage) warnings.push('topic_anchor_coverage_low');
  if (providerCount < 2 && selected.length >= 2) warnings.push('provider_diversity_low');
  const requestedFacets = intent.facets.map(facetKey).filter(Boolean);
  const coveredFacetCount = requestedFacets.filter((key) => (facets[key] ?? 0) > 0).length;
  if (requestedFacets.length > 0 && coveredFacetCount < requestedFacets.length) {
    warnings.push('facet_coverage_incomplete');
  }

  const readyForSynthesis =
    selected.length >= minSources &&
    anchorCoverage >= minAnchorCoverage &&
    (requestedFacets.length === 0 || coveredFacetCount >= Math.min(2, requestedFacets.length));

  const roundedAverageEvidenceScore = Number(averageEvidenceScore.toFixed(3));
  const roundedAnchorCoverage = Number(anchorCoverage.toFixed(3));
  const report: RetrievalQualityReport = {
    selectedSourceCount: selected.length,
    rejectedSourceCount: rejected.length,
    providerCount,
    anchorCoverage: roundedAnchorCoverage,
    averageEvidenceScore: roundedAverageEvidenceScore,
    readyForSynthesis,
    warnings,
    facets,
    selectedSourceIds: selected.map((article) => article.id),
    rejected: rejected.slice(0, 20).map((entry) => ({
      id: entry.article.id,
      title: entry.article.title,
      sourceHost: entry.article.sourceHost,
      reasons: entry.reasons,
    })),
  };

  return {
    selected,
    rejected,
    coverage: {
      sourceCount: selected.length,
      providerCount,
      anchorCoverage: roundedAnchorCoverage,
      averageEvidenceScore: roundedAverageEvidenceScore,
      facets,
      warnings,
      readyForSynthesis,
    },
    report,
  };
};
