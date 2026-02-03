import type { AppConfig } from '../../shared/config';
import type { SourceCatalogEntry } from '../../shared/types';
import { applySourceCatalogToEvidence, buildGlobalSourceCatalog } from '../../shared/sourceCatalog';
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
  sourceCatalog?: SourceCatalogEntry[];
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
  sourceCatalog: SourceCatalogEntry[];
  warnings: string[];
}

type SourceRecord = SourceCatalogEntry;

const sanitizeSingleLine = (value: string): string =>
  value.replace(/\s+/g, ' ').replace(/[\r\n]+/g, ' ').trim();

const toWordCount = (text: string): number => {
  if (!text) return 0;
  return (text.match(/\b\w+\b/g) || []).length;
};

const buildEvidenceDigest = (items: EvidenceItem[]): string =>
  items
    .map(
      (item) =>
        `Outline point ${item.outlineIndex + 1}: ${item.point}\n${item.digest || 'No fresh evidence found.'}`,
    )
    .join('\n\n');

const buildRepairInstruction = (errors: string[]): string =>
  [
    'Previous article was invalid. Fix every issue below:',
    ...errors.map((error, index) => `${index + 1}. ${error}`),
  ].join('\n');

const buildKeyDevelopmentsSection = (sourceCatalog: SourceRecord[], options: { min: number; max: number }) => {
  const isoDateRe = /^\d{4}-\d{2}-\d{2}$/u;
  const sorted = [...sourceCatalog].sort((a, b) => {
    const ad = a.publishedAt ? Date.parse(a.publishedAt) : NaN;
    const bd = b.publishedAt ? Date.parse(b.publishedAt) : NaN;
    if (Number.isNaN(ad) && Number.isNaN(bd)) return 0;
    if (Number.isNaN(ad)) return 1;
    if (Number.isNaN(bd)) return -1;
    return bd - ad;
  });

  const bullets: string[] = [];
  for (const src of sorted) {
    if (!src.url || !src.id) continue;
    const date = src.publishedAt ? src.publishedAt.split('T')[0] : null;
    const dateLabel = date && isoDateRe.test(date) ? date : 'Undated';
    const sourceLabel = sanitizeSingleLine(src.source || 'Source').slice(0, 40);
    const title = sanitizeSingleLine(src.title || src.url).slice(0, 140);
    const url = sanitizeSingleLine(src.url);
    bullets.push(`- ${dateLabel} - ${sourceLabel} - ${title} (${url}) [${src.id}]`);
    if (bullets.length >= options.max) break;
  }

  // If we couldn't generate enough (e.g., missing URLs), fall back to whatever we have.

  return ['Key developments', ...bullets].join('\n');
};

const replaceOrAppendKeyDevelopments = (article: string, keyDevSection: string): string => {
  const lines = article.split(/\r?\n/);
  const idx = lines.findIndex((line) => /^\s*key developments\b/i.test(line.trim()));
  if (idx < 0) {
    return `${article.trim()}\n\n${keyDevSection}\n`;
  }
  const before = lines.slice(0, idx).join('\n').trimEnd();
  return `${before}\n\n${keyDevSection}\n`;
};

export const synthesizeArticle = async ({
  runId,
  topic,
  outline,
  retrievalClusters,
  evidence,
  sourceCatalog: sourceCatalogOverride,
  recencyHours,
  previousArticle,
  config,
  logger,
  signal,
}: ArticleSynthesisArgs): Promise<ArticleSynthesisResult> => {
  const llmService = new LLMService(config, logger);
  const promptTemplate = loadPrompt('final_article.md');
  const recencyWindow = describeRecencyWindow(recencyHours);
  const outlineJson = JSON.stringify(outline, null, 2);
  const resolvedCatalog = buildGlobalSourceCatalog({
    clusters: retrievalClusters,
    evidence,
    maxSources: 80,
    provided: sourceCatalogOverride,
  });
  const normalizedEvidence = applySourceCatalogToEvidence(evidence, resolvedCatalog);
  const orderedEvidence = normalizedEvidence.slice().sort((a, b) => a.outlineIndex - b.outlineIndex);
  const evidenceText = buildEvidenceDigest(orderedEvidence);
  const sourcesJson = JSON.stringify(resolvedCatalog, null, 2);
  const prevArticle = previousArticle || '';
  const isoDateRe = /^\d{4}-\d{2}-\d{2}$/u;
  const availableDates = Array.from(
    new Set(
      resolvedCatalog
        .map((s) => (s.publishedAt ? s.publishedAt.split('T')[0] : null))
        .filter((d): d is string => Boolean(d && isoDateRe.test(d))),
    ),
  )
    .sort()
    .reverse();
  const narrativeDateTarget = Math.min(3, availableDates.length);
  const distinctSourceTarget = Math.max(1, Math.min(6, resolvedCatalog.length));
  const availableDatesText = availableDates.length
    ? availableDates.slice(0, 12).map((d) => `- ${d}`).join('\n')
    : 'none';
  const keyDevMin = Math.max(1, Math.min(5, resolvedCatalog.length));
  const keyDevMax = Math.max(keyDevMin, Math.min(7, resolvedCatalog.length || 7));
  const keyDevelopmentsSection = buildKeyDevelopmentsSection(resolvedCatalog, { min: keyDevMin, max: keyDevMax });

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
          .map((n) => resolvedCatalog.find((s) => s.id === n))
          .filter((s): s is SourceRecord => Boolean(s))
          .map((s) => ({ id: s.id, title: s.title, url: s.url }));
        if (subset.length) sourcesArr = subset;
      }
    }

    // Absolute fallback: take first N from catalog if body lacks citations
    if ((!sourcesArr || !sourcesArr.length) && Array.isArray(resolvedCatalog) && resolvedCatalog.length) {
      sourcesArr = resolvedCatalog.slice(0, 10).map((s) => ({ id: s.id, title: s.title, url: s.url }));
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
      .replaceAll('{DATE_TARGET}', String(narrativeDateTarget))
      .replaceAll('{DISTINCT_SOURCE_TARGET}', String(distinctSourceTarget))
      .replace('{TOPIC}', topic)
      .replace('{OUTLINE}', outlineJson)
      .replace('{EVIDENCE}', evidenceText)
      .replace('{SOURCES}', sourcesJson)
      .replace('{AVAILABLE_DATES}', availableDatesText)
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

    // Always normalize Key developments from our Source Catalog to avoid model drift (missing header, bad URLs, invented sources).
    coerced.article = replaceOrAppendKeyDevelopments(coerced.article, keyDevelopmentsSection);

    const { errors: bodyErrors, warnings: bodyWarnings } = validateArticleBody(coerced.article, {
      minCitations: 8,
      minDistinctCitationIds: distinctSourceTarget,
      minNarrativeDates: narrativeDateTarget,
      narrativeDatesPolicy: 'warn',
      keyDevelopmentsPolicy: 'require',
      paragraphCitationsPolicy: 'warn',
      minKeyDevelopmentsBullets: keyDevMin,
      maxKeyDevelopmentsBullets: keyDevMax,
    });
    latestWarnings = bodyWarnings;

    // Enforce overall word count contract (matches prompt); include Key developments section but exclude sources list.
    const actualWordCount = toWordCount(coerced.article);
    coerced.wordCount = actualWordCount;
    if (actualWordCount < 350 || actualWordCount > 900) {
      // Soft constraint: don't fail the run for length drift (users care more about content than strict word budgeting).
      latestWarnings = [...latestWarnings, `Article length is ${actualWordCount} words (recommended 400-600).`];
    }

    // Enforce that all citation IDs used exist in the provided Source Catalog.
    const catalogIds = new Set(resolvedCatalog.map((s) => s.id));
    const catalogUrls = new Set(resolvedCatalog.map((s) => s.url));
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

    // Ensure the returned sources list fully covers cited IDs, including citations we inject in Key developments.
    // The model can drift and omit some cited IDs; we treat Source Catalog as the source of truth.
    if (usedCitationIds.size > 0) {
      const normalizedSources = Array.from(usedCitationIds)
        .sort((a, b) => a - b)
        .map((id) => resolvedCatalog.find((s) => s.id === id))
        .filter((s): s is SourceRecord => Boolean(s))
        .map((s) => ({ id: s.id, title: s.title, url: s.url }));

      if (normalizedSources.length) {
        coerced.sources = normalizedSources;
      }
    }

    // By construction, `coerced.sources` is derived from `usedCitationIds` against the Source Catalog.
    // Keep this as a warning only (debug signal) rather than failing the run.
    const missingFromSourcesList = Array.from(usedCitationIds).filter((id) => !coerced.sources.some((s) => s.id === id));
    if (missingFromSourcesList.length > 0) {
      latestWarnings = [
        ...latestWarnings,
        `Returned sources list was missing cited IDs (auto-repaired): ${missingFromSourcesList.slice(0, 5).join(', ')}`,
      ];
    }

    const keyDevLines = coerced.article.split(/\r?\n/);
    const keyDevIndex = keyDevLines.findIndex((line) => /^\s*key developments\b/i.test(line.trim()));
    if (keyDevIndex >= 0) {
      const isKeyDevBulletLine = (line: string): boolean => {
        const trimmed = line.trim();
        if (!trimmed) return false;
        if (/^\s*[-*]\s+/.test(line)) return true;
        if (/^\d{4}-\d{2}-\d{2}\s*-\s+/.test(trimmed)) return true;
        if (/^undated\s*-\s+/i.test(trimmed)) return true;
        return false;
      };
      const bulletLines = keyDevLines.slice(keyDevIndex + 1).filter(isKeyDevBulletLine);
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
        // Shouldn't happen because we overwrite Key developments from catalog, but keep as a warning just in case.
        latestWarnings = [...latestWarnings, `Key developments contains URL(s) not present in Source Catalog: ${badUrls.join(', ')}`];
      }
    }

    // Competitor brand guardrails: allow neutral, cited mentions; block promotion or uncited mentions
    const brandErrors = validatePromotionPolicy(`${coerced.title}\n${coerced.article}`);

    const fatalErrors = [
      ...bodyErrors,
      ...citationCatalogErrors,
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
      sourceCatalog: resolvedCatalog,
      warnings: latestWarnings,
    };
  }

  throw new Error('Article synthesis failed after retries');
};





