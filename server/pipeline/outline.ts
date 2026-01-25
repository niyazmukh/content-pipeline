import JSON5 from 'json5';
import type { AppConfig } from '../../shared/config';
import { loadPrompt } from '../prompts/loader';
import type { StoryCluster } from '../retrieval/types';
import { LLMService } from '../services/llmService';
import { sleep } from '../utils/async';
import type { Logger } from '../obs/logger';
import { validateOutline, OutlinePayload } from './validators';
import { describeRecencyWindow } from '../utils/text';

export interface OutlineGeneratorArgs {
  runId: string;
  topic: string;
  clusters: StoryCluster[];
  recencyHours: number;
  config: AppConfig;
  logger: Logger;
  signal?: AbortSignal;
}

export interface OutlineGeneratorResult {
  outline: OutlinePayload;
  rawResponse: string;
  attempts: number;
}

const serializeClusters = (clusters: StoryCluster[]) => {
  const listing = clusters.map((cluster, index) => ({
    alias: `C${String(index + 1).padStart(2, '0')}`,
    clusterId: cluster.clusterId,
    publishedAt: cluster.representative.publishedAt,
    publishedAtDate: cluster.representative.publishedAt?.split('T')[0] || null,
    headline: cluster.representative.title,
    source: cluster.representative.sourceName ?? cluster.representative.sourceHost,
    summary: cluster.representative.excerpt,
    citations: cluster.citations,
  }));
  return JSON.stringify(listing, null, 2);
};

const buildAliasMaps = (clusters: StoryCluster[]) => {
  const aliasToId = new Map<string, string>();
  const idToDate = new Map<string, string | null>();
  const aliasToDate = new Map<string, string | null>();
  clusters.forEach((cluster, index) => {
    const alias = `C${String(index + 1).padStart(2, '0')}`;
    aliasToId.set(alias, cluster.clusterId);
    const date = cluster.representative.publishedAt?.split('T')[0] || null;
    idToDate.set(cluster.clusterId, date);
    aliasToDate.set(alias, date);
  });
  const validIds = new Set(clusters.map((c) => c.clusterId));
  return { aliasToId, idToDate, aliasToDate, validIds };
};

const normalizeIsoDate = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // If full ISO, take the date part
  const tIndex = trimmed.indexOf('T');
  const dateOnly = tIndex > 0 ? trimmed.slice(0, tIndex) : trimmed;
  return /^\d{4}-\d{2}-\d{2}$/.test(dateOnly) ? dateOnly : null;
};

const mapAliasesAndDates = (
  parsed: OutlinePayload,
  clusters: StoryCluster[],
  requiredUniqueDates: number,
  requiredDistinctClusters: number,
): OutlinePayload => {
  const { aliasToId, idToDate, aliasToDate, validIds } = buildAliasMaps(clusters);
  const copy: OutlinePayload = JSON.parse(JSON.stringify(parsed));
  const globalDateSet = new Set<string>();

  // Map supports aliases -> clusterIds; normalize dates to YYYY-MM-DD
  for (const point of copy.outline || []) {
    const mappedSupports: string[] = [];
    for (const token of Array.isArray(point.supports) ? point.supports : []) {
      const trimmed = String(token).trim();
      const byAlias = aliasToId.get(trimmed);
      if (byAlias && validIds.has(byAlias)) {
        mappedSupports.push(byAlias);
        const d = idToDate.get(byAlias);
        if (d) globalDateSet.add(d);
        continue;
      }
      if (validIds.has(trimmed)) {
        mappedSupports.push(trimmed);
        const d = idToDate.get(trimmed);
        if (d) globalDateSet.add(d);
      }
      // Unknown tokens are dropped
    }
    point.supports = mappedSupports;

    const normalizedDates: string[] = [];
    for (const d of Array.isArray(point.dates) ? point.dates : []) {
      const iso = normalizeIsoDate(d);
      if (iso) {
        normalizedDates.push(iso);
        globalDateSet.add(iso);
      }
    }

    // If no dates provided, try to infer from supports
    if (normalizedDates.length === 0 && mappedSupports.length > 0) {
      for (const id of mappedSupports) {
        const d = idToDate.get(id);
        if (d) {
          normalizedDates.push(d);
          globalDateSet.add(d);
          break; // just one per point is fine; global set will enforce uniqueness across outline
        }
      }
    }
    point.dates = normalizedDates;
  }

  // Ensure we reach requiredUniqueDates globally by adding missing dates from other clusters
  if (requiredUniqueDates > 0 && globalDateSet.size < requiredUniqueDates) {
    const needed = requiredUniqueDates - globalDateSet.size;
    const availableDates: string[] = [];
    for (const [_, d] of idToDate) {
      const iso = normalizeIsoDate(d);
      if (iso) availableDates.push(iso);
    }
    for (const iso of availableDates) {
      if (globalDateSet.size >= requiredUniqueDates) break;
      if (!globalDateSet.has(iso)) {
        globalDateSet.add(iso);
        // add to the shortest dates array
        const target = (copy.outline || []).reduce<{ idx: number; len: number } | null>((acc, p, idx) => {
          const len = Array.isArray(p.dates) ? p.dates.length : 0;
          if (!acc || len < acc.len) return { idx, len };
          return acc;
        }, null);
        if (target && copy.outline[target.idx]) {
          copy.outline[target.idx].dates = [...(copy.outline[target.idx].dates || []), iso];
        }
      }
    }
  }
  // Ensure we reach the required number of distinct clusters by lightly augmenting supports
  const currentUsed = new Set<string>();
  for (const p of copy.outline || []) {
    for (const id of p.supports || []) currentUsed.add(id);
  }
  if (currentUsed.size < requiredDistinctClusters) {
    const missing = requiredDistinctClusters - currentUsed.size;
    const candidates = clusters.map((c) => c.clusterId).filter((id) => !currentUsed.has(id));
    let added = 0;
    let idx = 0;
    while (added < missing && idx < (copy.outline?.length || 0) && candidates.length > 0) {
      const point = copy.outline![idx];
      if (!Array.isArray(point.supports)) point.supports = [];
      const nextId = candidates.shift()!;
      point.supports.push(nextId);
      currentUsed.add(nextId);
      const d = idToDate.get(nextId);
      if (d) {
        const iso = normalizeIsoDate(d);
        if (iso) {
          point.dates = [...(point.dates || []), iso];
          globalDateSet.add(iso);
        }
      }
      added += 1;
      idx = (idx + 1) % (copy.outline!.length || 1);
    }
  }

  return copy;
};

const buildIsoDate = (isoOrNull: string | null | undefined): string[] => {
  const iso = isoOrNull?.split('T')[0] || null;
  return iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? [iso] : [];
};

const trimOrPadOutlinePoints = (
  outline: OutlinePayload,
  clusters: StoryCluster[],
  requiredPoints: number,
): OutlinePayload => {
  const copy: OutlinePayload = JSON.parse(JSON.stringify(outline));
  const points = Array.isArray(copy.outline) ? copy.outline.slice() : [];

  if (points.length > requiredPoints) {
    copy.outline = points.slice(0, requiredPoints);
    return copy;
  }

  if (points.length === requiredPoints) {
    return copy;
  }

  const usedIds = new Set<string>();
  for (const p of points) {
    for (const id of p.supports || []) usedIds.add(String(id));
  }
  const sorted = clusters
    .slice()
    .sort((a, b) => b.score - a.score)
    .filter((c) => !usedIds.has(c.clusterId));

  let idx = 0;
  while (points.length < requiredPoints && idx < sorted.length) {
    const c = sorted[idx++];
    const rep = c.representative;
    const dateArr = buildIsoDate(rep.publishedAt ?? null);
    points.push({
      point: rep.title?.slice(0, 180) || 'Recent development',
      summary: (rep.excerpt || '').slice(0, 240),
      supports: [c.clusterId],
      dates: dateArr,
    });
  }

  copy.outline = points;
  return copy;
};

const buildRepairInstruction = (errors: string[]): string =>
  [
    'The previous outline failed validation.',
    'Rewrite the ENTIRE outline and fix ALL issues below.',
    'Obey these constraints exactly: return only valid JSON; use exactly the requested number of points; every point must include one or more supports (clusterId values) and one or more YYYY-MM-DD dates; use clusterId values exactly as provided in the inputs.',
    ...errors.map((error, index) => `${index + 1}. ${error}`),
  ].join('\n');

export const generateOutlineFromClusters = async ({
  runId,
  topic,
  clusters,
  recencyHours,
  config,
  logger,
  signal,
}: OutlineGeneratorArgs): Promise<OutlineGeneratorResult> => {
  if (!clusters.length) {
    throw new Error('Cannot generate outline: no clusters provided');
  }

  const llmService = new LLMService(config, logger);
  const promptTemplate = await loadPrompt('outline_from_clusters.md');
  const distinctClusterCount = clusters.length;
  const requiredPoints = Math.max(1, distinctClusterCount >= 5 ? 5 : distinctClusterCount);
  const requiredClusterCoverage = Math.max(1, Math.min(4, distinctClusterCount));
  const requiredUniqueDates = 0;
  const recencyWindow = describeRecencyWindow(recencyHours);
  const basePrompt = promptTemplate
    .replaceAll('{TOPIC}', topic)
    .replaceAll('{RECENCY_WINDOW}', recencyWindow)
    .replaceAll('{CLUSTERS}', serializeClusters(clusters))
    .replaceAll('{POINT_TARGET}', requiredPoints.toString())
    .replaceAll('{CLUSTER_TARGET}', requiredClusterCoverage.toString())
    .replaceAll('{DATE_TARGET}', requiredUniqueDates.toString());

  let attempt = 0;
  let rawResponse = '';
  let errors: string[] = [];

  while (attempt < 3) {
    attempt += 1;
    const prompt = attempt === 1 ? basePrompt : `${basePrompt}\n\n${buildRepairInstruction(errors)}`;
    logger.info('Generating outline from clusters', { runId, attempt });

    let parsed: OutlinePayload;
    try {
      parsed = await llmService.generateAndParse<OutlinePayload>(prompt, {
        model: config.llm.flashModel,
        maxOutputTokens: 16384,
        signal,
      });
      rawResponse = JSON.stringify(parsed);
    } catch (err) {
      errors = [`Generation failed: ${(err as Error).message}`];
      logger.warn('Outline generation failed', { runId, attempt, errors });
      if (attempt >= 3) throw err;
      continue;
    }
    
    // Minimal normalization: ensure thesis has reasonable length
    if (!parsed.thesis || parsed.thesis.trim().length < 12) {
      const base = (parsed.thesis || '').trim();
      parsed.thesis = base ? `${base} - latest developments` : `Latest developments and key trends`;
    }

    // Map model-friendly aliases to actual cluster IDs and normalize dates before validation
    let mapped = mapAliasesAndDates(parsed, clusters, requiredUniqueDates, requiredClusterCoverage);
    // Ensure exact number of points by trimming or padding from available clusters
    mapped = trimOrPadOutlinePoints(mapped, clusters, requiredPoints);
    const validation = validateOutline(mapped, clusters);
    if (validation.ok) {
      return {
        outline: mapped,
        rawResponse,
        attempts: attempt,
      };
    }

    errors = validation.errors;
    logger.warn('Outline validation failed', { runId, attempt, errors });
    if (attempt >= 3) {
      throw new Error(`Outline validation failed: ${errors.join('; ')}`);
    }
  }

  throw new Error('Outline generation failed after retries');
};

