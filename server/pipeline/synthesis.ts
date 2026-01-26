import type { AppConfig } from '../../shared/config';
import { loadPrompt } from '../prompts/loader';
import type { StoryCluster } from '../retrieval/types';
import { LLMService } from '../services/llmService';
import type { Logger } from '../obs/logger';
import { validateArticleBody, computeNoveltyScore, OutlinePayload, validatePromotionPolicy } from './validators';
import type { EvidenceItem } from './types';
import { describeRecencyWindow } from '../utils/text';

export interface ArticleSynthesisArgs {
  runId: string;
  topic: string;
  outline: OutlinePayload;
  retrievalClusters: StoryCluster[];
  evidence: EvidenceItem[];
  previousArticle?: string | null;
  recencyHours: number;
  config: AppConfig;
  logger: Logger;
  signal?: AbortSignal;
}

export interface ArticleSynthesisResult {
  article: {
    title: string;
    article: string;
    sources: Array<{ id: number; title: string; url: string }>;
    wordCount: number;
  };
  rawResponse: string;
  attempts: number;
  noveltyScore: number;
  warnings: string[];
}

interface SourceRecord {
  id: number;
  title: string;
  url: string;
  source: string;
  publishedAt?: string | null;
}

const toWordCount = (text: string): number => {
  if (!text) return 0;
  return (text.match(/\b\w+\b/g) || []).length;
};

const buildEvidenceDigest = (items: EvidenceItem[]): string =>
  items
    .map(
      (item, idx) =>
        `Outline point ${idx + 1}: ${item.point}\n${item.digest || 'No fresh evidence found.'}`,
    )
    .join('\n\n');

const buildSourceCatalog = (
  items: EvidenceItem[],
  clusters: StoryCluster[],
): SourceRecord[] => {
  const map = new Map<string, SourceRecord>();
  let idCounter = 1;

  const register = (title: string, url: string, source: string, publishedAt?: string | null) => {
    const key = url.trim();
    if (!key) {
      return;
    }
    if (!map.has(key)) {
      map.set(key, {
        id: idCounter,
        title,
        url,
        source,
        publishedAt: publishedAt ?? null,
      });
      idCounter += 1;
    }
  };

  items.forEach((entry) => {
    entry.citations.forEach((citation) => {
      register(citation.title, citation.url, citation.source, citation.publishedAt);
    });
  });

  clusters.forEach((cluster) => {
    const rep = cluster.representative;
    register(rep.title, rep.canonicalUrl, rep.sourceName ?? rep.sourceHost, rep.publishedAt);
    cluster.members.forEach((member) => {
      register(member.title, member.canonicalUrl, member.sourceName ?? member.sourceHost, member.publishedAt);
    });
  });

  return Array.from(map.values());
};

const buildRepairInstruction = (errors: string[]): string =>
  [
    'Previous article was invalid. Fix every issue below:',
    ...errors.map((error, index) => `${index + 1}. ${error}`),
  ].join('\n');

export const synthesizeArticle = async ({
  runId,
  topic,
  outline,
  retrievalClusters,
  evidence,
  recencyHours,
  previousArticle,
  config,
  logger,
  signal,
}: ArticleSynthesisArgs): Promise<ArticleSynthesisResult> => {
  const llmService = new LLMService(config, logger);
  const promptTemplate = await loadPrompt('final_article.md');
  const recencyWindow = describeRecencyWindow(recencyHours);
  const outlineJson = JSON.stringify(outline, null, 2);
  const clustersJson = JSON.stringify(
    retrievalClusters.map((cluster) => ({
      clusterId: cluster.clusterId,
      title: cluster.representative.title,
      publishedAt: cluster.representative.publishedAt,
      source: cluster.representative.sourceName ?? cluster.representative.sourceHost,
      summary: cluster.representative.excerpt,
      citations: cluster.citations,
    })),
    null,
    2,
  );
  const evidenceText = buildEvidenceDigest(evidence);
  const sourceCatalog = buildSourceCatalog(evidence, retrievalClusters);
  const sourcesJson = JSON.stringify(sourceCatalog, null, 2);
  const prevArticle = previousArticle || '';

  let attempt = 0;
  let rawResponse = '';
  let errors: string[] = [];
  let latestWarnings: string[] = [];

  // Coercion layer: tolerate mild schema drift from the model
  const normalizeArticlePayload = (raw: any) => {
    const pickString = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const pickDeepString = (obj: any, keys: string[]): string | null => {
      for (const k of keys) {
        const val = pickString(obj?.[k]);
        if (val) return val;
      }
      // shallow nested under common container keys
      for (const container of ['data', 'payload', 'result']) {
        const sub = obj?.[container];
        if (sub && typeof sub === 'object') {
          for (const k of keys) {
            const val = pickString(sub?.[k]);
            if (val) return val;
          }
        }
      }
      return null;
    };

    const title: string = pickDeepString(raw, ['title', 'headline']) || `Insight Briefing`;

    // Build body from multiple possible shapes
    let body: string =
      pickDeepString(raw, ['article', 'body', 'content', 'text', 'markdown']) || '';
    if (!body && Array.isArray(raw?.sections)) {
      const parts: string[] = [];
      for (const s of raw.sections as any[]) {
        if (typeof s === 'string' && s.trim()) parts.push(s.trim());
        else if (s && typeof s === 'object') {
          const seg = pickDeepString(s, ['text', 'content', 'body']);
          if (seg) parts.push(seg);
        }
      }
      if (parts.length) body = parts.join('\n\n');
    }

    let sourcesArr: Array<{ id: number; title: string; url: string }> | null = null;
    const rawSources =
      raw?.sources ?? raw?.citations ?? raw?.references ?? raw?.refs ?? raw?.sourceList ?? raw?.source_list ??
      raw?.data?.sources ?? raw?.data?.citations ?? null;
    if (Array.isArray(rawSources)) {
      const mapped = rawSources
        .map((s: any, idx: number) => {
          if (s && typeof s === 'object') {
            const id = typeof s.id === 'number' ? s.id : idx + 1;
            const title = typeof s.title === 'string' ? s.title : typeof s.url === 'string' ? s.url : `Source ${id}`;
            const url = typeof s.url === 'string' ? s.url : '';
            if (!url) return null;
            return { id, title, url };
          }
          if (typeof s === 'string') {
            const id = idx + 1;
            return { id, title: s, url: s };
          }
          return null;
        })
        .filter(Boolean) as Array<{ id: number; title: string; url: string }>;
      if (mapped.length) sourcesArr = mapped;
    }

    // If still missing, build from inline [n] citations matched to provided Source Catalog
    if ((!sourcesArr || !sourcesArr.length) && typeof body === 'string' && body) {
      const seen = new Set<number>();
      const ordered: number[] = [];
      const re = /\[(\d+)\]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(body)) !== null) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > 0 && !seen.has(n)) {
          seen.add(n);
          ordered.push(n);
        }
      }
      if (ordered.length) {
        const subset = ordered
          .map((n) => sourceCatalog.find((s) => s.id === n))
          .filter((s): s is SourceRecord => Boolean(s))
          .map((s) => ({ id: s.id, title: s.title, url: s.url }));
        if (subset.length) sourcesArr = subset;
      }
    }

    // Absolute fallback: take first N from catalog if body lacks citations
    if ((!sourcesArr || !sourcesArr.length) && Array.isArray(sourceCatalog) && sourceCatalog.length) {
      sourcesArr = sourceCatalog.slice(0, 10).map((s) => ({ id: s.id, title: s.title, url: s.url }));
    }

    const wordCount = typeof raw?.wordCount === 'number' && raw.wordCount > 0 ? raw.wordCount : toWordCount(body);
    return { title, article: body, sources: sourcesArr ?? [], wordCount };
  };

  while (attempt < 3) {
    attempt += 1;
    const prompt =
      attempt === 1
        ? promptTemplate
        : `${promptTemplate}\n\n${buildRepairInstruction(errors)}`;

    const hydratedPrompt = prompt
      .replaceAll('{RECENCY_WINDOW}', recencyWindow)
      .replace('{TOPIC}', topic)
      .replace('{OUTLINE}', outlineJson)
      .replace('{EVIDENCE}', evidenceText)
      .replace('{CLUSTERS}', clustersJson)
      .replace('{SOURCES}', sourcesJson)
      .replace('{PREVIOUS}', prevArticle);

    logger.info('Generating article', { runId, attempt });

    let parsed: any;
    try {
      parsed = await llmService.generateAndParse(hydratedPrompt, {
        fallbackToText: true,
        maxOutputTokens: 16384,
        parser: (text) => {
          rawResponse = text;
          return { article: text };
        },
        signal,
      });
      
      if (!rawResponse) {
          rawResponse = JSON.stringify(parsed);
      }

    } catch (err) {
      errors = [`Generation failed: ${(err as Error).message}`];
      logger.warn('Article generation failed', { runId, attempt, errors });
      if (attempt >= 3) throw err;
      continue;
    }

    const coerced = normalizeArticlePayload(parsed);
    if (!coerced.article || !coerced.sources || coerced.sources.length === 0) {
      errors = ['Missing `article` or `sources` fields'];
      if (attempt >= 3) {
        throw new Error(errors.join('; '));
      }
      continue;
    }

    const { errors: bodyErrors, warnings: bodyWarnings } = validateArticleBody(coerced.article, {
      minCitations: 8,
      minDistinctCitationIds: 6,
      minNarrativeDates: 3,
      requireKeyDevelopments: true,
      minKeyDevelopmentsBullets: 5,
      maxKeyDevelopmentsBullets: 7,
    });
    latestWarnings = bodyWarnings;

    // Enforce overall word count contract (matches prompt); include Key developments section but exclude sources list.
    const actualWordCount = toWordCount(coerced.article);
    coerced.wordCount = actualWordCount;
    const wordCountErrors: string[] = [];
    if (actualWordCount < 400 || actualWordCount > 600) {
      wordCountErrors.push(`Article length is ${actualWordCount} words; expected 400-600.`);
    }

    // Enforce that all citation IDs used exist in the provided Source Catalog.
    const catalogIds = new Set(sourceCatalog.map((s) => s.id));
    const catalogUrls = new Set(sourceCatalog.map((s) => s.url));
    const missingCatalogIds: number[] = [];
    const citationRe = /\[(\d+)]/g;
    const usedCitationIds = new Set<number>();
    let m: RegExpExecArray | null;
    while ((m = citationRe.exec(coerced.article)) !== null) {
      const n = Number(m[1]);
      if (!Number.isFinite(n) || n <= 0) {
        continue;
      }
      usedCitationIds.add(n);
      if (!catalogIds.has(n)) {
        missingCatalogIds.push(n);
        if (missingCatalogIds.length >= 3) break;
      }
    }
    const citationCatalogErrors =
      missingCatalogIds.length > 0 ? [`Article references citation IDs not in Source Catalog: ${missingCatalogIds.join(', ')}`] : [];

    const missingFromSourcesList = Array.from(usedCitationIds).filter(
      (id) => !coerced.sources.some((s) => s.id === id),
    );
    const sourcesListErrors =
      missingFromSourcesList.length > 0
        ? [`Returned sources list is missing cited IDs: ${missingFromSourcesList.slice(0, 5).join(', ')}`]
        : [];

    const keyDevLines = coerced.article.split(/\r?\n/);
    const keyDevIndex = keyDevLines.findIndex((line) => /^\s*key developments\b/i.test(line.trim()));
    const keyDevUrlErrors: string[] = [];
    if (keyDevIndex >= 0) {
      const bulletLines = keyDevLines
        .slice(keyDevIndex + 1)
        .filter((line) => /^\s*[-*]\s+/.test(line));
      const badUrls: string[] = [];
      for (const bulletLine of bulletLines) {
        const urlMatch = bulletLine.match(/\((https?:\/\/[^)]+)\)/);
        if (!urlMatch) {
          badUrls.push('missing-url');
          if (badUrls.length >= 2) break;
          continue;
        }
        const url = urlMatch[1].trim();
        if (!catalogUrls.has(url)) {
          badUrls.push(url);
          if (badUrls.length >= 2) break;
        }
      }
      if (badUrls.length) {
        keyDevUrlErrors.push(
          `Key developments contains URL(s) not present in Source Catalog: ${badUrls.join(', ')}`,
        );
      }
    }

    // Competitor brand guardrails: allow neutral, cited mentions; block promotion or uncited mentions
    const brandErrors = validatePromotionPolicy(`${coerced.title}\n${coerced.article}`);

    const fatalErrors = [
      ...bodyErrors,
      ...wordCountErrors,
      ...citationCatalogErrors,
      ...sourcesListErrors,
      ...keyDevUrlErrors,
      ...brandErrors,
    ];

    if (fatalErrors.length) {
      errors = fatalErrors;
      logger.warn('Article validation failed', { runId, attempt, errors });
      if (attempt >= 3) {
        throw new Error(`Article validation failed: ${errors.join('; ')}`);
      }
      continue;
    }

    if (bodyWarnings.length) {
      logger.warn('Article validation warnings', { runId, attempt, warnings: bodyWarnings });
    }

    const noveltyScore = computeNoveltyScore(previousArticle ?? null, coerced.article);
    return {
      article: coerced,
      rawResponse,
      attempts: attempt,
      noveltyScore,
      warnings: latestWarnings,
    };
  }

  throw new Error('Article synthesis failed after retries');
};





