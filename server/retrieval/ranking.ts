import type { NormalizedArticle, StoryCluster } from './types';
import { computeSimilarity } from '../utils/text';

export interface RankingOptions {
  recencyHours: number;
  maxClusters: number;
  clusterThreshold?: number;
  attachThreshold?: number;
}

/**
 * Domain reputation weights for ranking.
 * PR wires and low-quality sources get negative adjustments.
 */
const DOMAIN_WEIGHTS: Record<string, number> = {
  'globenewswire.com': -0.2,
  'prnewswire.com': -0.2,
  'businesswire.com': -0.2,
  'prweb.com': -0.15,
  'marketwatch.com': -0.1,
  // Down-rank low-credibility sources
  'naturalnews.com': -0.4,
};

const getDomainWeight = (url: string): number => {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    for (const [domain, weight] of Object.entries(DOMAIN_WEIGHTS)) {
      if (hostname.includes(domain)) {
        return weight;
      }
    }
  } catch {
    // invalid URL
  }
  return 0;
};

export interface RankedArticle extends NormalizedArticle {
  score: number;
  reasons: string[];
}

const computeScore = (article: NormalizedArticle, options: RankingOptions): RankedArticle => {
  const now = Date.now();
  const publishedMs = article.publishedAt ? Date.parse(article.publishedAt) : NaN;
  const hoursOld = Number.isNaN(publishedMs) ? options.recencyHours : Math.max(0, (now - publishedMs) / (60 * 60 * 1000));
  const recencyScore = Number((1 - Math.min(hoursOld / options.recencyHours, 1)).toFixed(3));
  const qualityScore = Number(Math.min(article.quality.wordCount / 1200, 1).toFixed(3));
  const relevanceScore = Number(article.quality.relevanceScore.toFixed(3));
  const domainWeight = getDomainWeight(article.canonicalUrl);

  const baseScore = recencyScore * 0.4 + relevanceScore * 0.35 + qualityScore * 0.25;
  const score = Number(Math.max(0, baseScore + domainWeight).toFixed(4));
  const reasons = [
    `recency=${recencyScore}`,
    `relevance=${relevanceScore}`,
    `quality=${qualityScore}`,
  ];
  if (domainWeight !== 0) {
    reasons.push(`domain=${domainWeight}`);
  }

  return {
    ...article,
    score,
    reasons,
  };
};

export const rankAndClusterArticles = (
  articles: NormalizedArticle[],
  options: RankingOptions,
): { clusters: StoryCluster[]; ranked: RankedArticle[] } => {
  const ranked = articles.map((article) => computeScore(article, options));
  ranked.sort((a, b) => b.score - a.score);

  const clusters: StoryCluster[] = [];
  const clusterTexts: Array<{ cluster: StoryCluster; text: string }> = [];
  const similarityThreshold = options.clusterThreshold ?? 0.65;
  const attachThreshold = options.attachThreshold ?? 0.55;

  for (const article of ranked) {
    const articleText = `${article.title} ${article.excerpt}`.slice(0, 600);
    let assigned = false;
    let bestMatch: { entry: typeof clusterTexts[0]; similarity: number } | null = null;

    for (const entry of clusterTexts) {
      const sim = computeSimilarity(articleText, entry.text);
      if (sim >= similarityThreshold) {
        entry.cluster.members.push(article);
        entry.cluster.citations.push({ title: article.title, url: article.canonicalUrl });
        if (article.score > entry.cluster.score) {
          entry.cluster.representative = article;
          entry.cluster.score = Number(article.score.toFixed(4));
          entry.text = articleText;
        }
        entry.cluster.reasons = Array.from(new Set([...entry.cluster.reasons, ...article.reasons]));
        assigned = true;
        break;
      } else if (sim >= attachThreshold) {
        if (!bestMatch || sim > bestMatch.similarity) {
          bestMatch = { entry, similarity: sim };
        }
      }
    }

    if (!assigned) {
      if (bestMatch) {
        // Attach to best match if above attach threshold but below cluster threshold
        bestMatch.entry.cluster.members.push(article);
        bestMatch.entry.cluster.citations.push({ title: article.title, url: article.canonicalUrl });
        // Don't update representative or score for weak matches
      } else if (clusters.length < options.maxClusters) {
        // Create new cluster
        const newCluster: StoryCluster = {
          clusterId: crypto.randomUUID(),
          representative: article,
          members: [article],
          score: Number(article.score.toFixed(4)),
          reasons: article.reasons,
          citations: [{ title: article.title, url: article.canonicalUrl }],
        };
        clusters.push(newCluster);
        clusterTexts.push({ cluster: newCluster, text: articleText });
      }
    }
  }

  clusters.sort((a, b) => b.score - a.score);
  return { clusters, ranked };
};
