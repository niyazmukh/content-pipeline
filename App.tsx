import React, { useState, useCallback, useEffect, useMemo } from 'react';
import type {
  StageEvent,
  StageName,
  StageStatus,
  StoryCluster,
  OutlinePayload,
  EvidenceItem,
  ArticleGenerationResult,
  ImagePromptSlide,
  RetrievalMetrics,
  ApiConfigResponse,
  ApiHealthResponse,
  SourceCatalogEntry,
} from './shared/types';
import { DEFAULT_TOPIC_QUERY } from './shared/defaultTopicQuery';
import PipelineStatus from './components/PipelineStatus';
import RetrievalMetricsPanel from './components/RetrievalMetricsPanel';
import StoryClusters from './components/StoryClusters';
import OutlineWithCoverage from './components/OutlineWithCoverage';
import EvidencePanel from './components/EvidencePanel';
import ArticlePanel from './components/ArticlePanel';
import { API_BASE_URL, runPipelineToOutline, runTargetedResearchPoint, generateArticle, generateImagePrompt, fetchPublicConfig, fetchHealth } from './services/geminiService';
import { LoaderIcon, SparklesIcon } from './components/icons';
import { loadApiKeys, saveApiKeys, clearApiKeys, type ApiKeys } from './services/apiKeys';
import IntroModal from './components/IntroModal';
import HelpTip from './components/HelpTip';
import { applySourceCatalogToEvidence, buildGlobalSourceCatalog } from './shared/sourceCatalog';
import ApiConfigPanel from './components/ApiConfigPanel';
import DiagnosticsPanel from './components/DiagnosticsPanel';
import { Card } from './components/ui/Card';

const STAGES: StageName[] = ['retrieval', 'ranking', 'outline', 'targetedResearch', 'synthesis', 'imagePrompt'];

type StageUiStatus = Record<StageName, StageStatus | 'idle'>;

const buildInitialStageState = (): StageUiStatus => ({
  retrieval: 'idle',
  ranking: 'idle',
  outline: 'idle',
  targetedResearch: 'idle',
  synthesis: 'idle',
  imagePrompt: 'idle',
});

const buildInitialStageMessages = (): Record<StageName, string> => ({
  retrieval: '',
  ranking: '',
  outline: '',
  targetedResearch: '',
  synthesis: '',
  imagePrompt: '',
});

const mapStageStatus = (status: StageStatus | 'idle'): 'idle' | 'loading' | 'success' | 'error' => {
  if (status === 'idle') return 'idle';
  if (status === 'success') return 'success';
  if (status === 'failure') return 'error';
  return 'loading';
};

const describeRecencyLabel = (hours: number | null | undefined): string => {
  if (!Number.isFinite(hours ?? NaN) || !hours || hours <= 0) {
    return 'custom window';
  }
  if (hours % 24 === 0) {
    const days = hours / 24;
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  return `${hours} hours`;
};

const App: React.FC = () => {
  const [topic, setTopic] = useState(DEFAULT_TOPIC_QUERY);
  const [stageStates, setStageStates] = useState<StageUiStatus>(buildInitialStageState);
  const [clusters, setClusters] = useState<StoryCluster[]>([]);
  const [outline, setOutline] = useState<OutlinePayload | null>(null);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [sourceCatalog, setSourceCatalog] = useState<SourceCatalogEntry[]>([]);
  const [runId, setRunId] = useState<string>('');
  const [articleResult, setArticleResult] = useState<ArticleGenerationResult | null>(null);
  const [imagePrompts, setImagePrompts] = useState<ImagePromptSlide[]>([]);
  const [error, setError] = useState<string>('');
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [configLoaded, setConfigLoaded] = useState<boolean>(false);
  const [retrievalMetrics, setRetrievalMetrics] = useState<RetrievalMetrics | null>(null);
  const [publicConfig, setPublicConfig] = useState<ApiConfigResponse | null>(null);
  const [recencyHours, setRecencyHours] = useState<number>(168);
  const [runRecencyHours, setRunRecencyHours] = useState<number | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeys>(() => loadApiKeys());
  const [health, setHealth] = useState<ApiHealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string>('');
  const [stageMessages, setStageMessages] = useState<Record<StageName, string>>(buildInitialStageMessages);
  const [stageEventLog, setStageEventLog] = useState<Array<StageEvent<unknown>>>([]);
  const [targetedProgress, setTargetedProgress] = useState<{ completed: number; total: number; skipped: number; currentIndex: number | null } | null>(null);
  const [showIntro, setShowIntro] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('gcp_pipeline_intro_dismissed_v1') !== '1';
  });
  const hasUserKeys = Boolean(
    apiKeys.geminiApiKey ||
      apiKeys.googleCseApiKey ||
      apiKeys.googleCseCx ||
      apiKeys.newsApiKey ||
      apiKeys.eventRegistryApiKey,
  );
  const keyPresence = {
    gemini: Boolean(apiKeys.geminiApiKey),
    googleCse: Boolean(apiKeys.googleCseApiKey && apiKeys.googleCseCx),
    newsApi: Boolean(apiKeys.newsApiKey),
    eventRegistry: Boolean(apiKeys.eventRegistryApiKey),
  };

  useEffect(() => {
    fetchPublicConfig()
      .then((config) => {
        setPublicConfig(config);
        setRecencyHours(config.recencyHours);
        setConfigLoaded(true);
      })
      .catch((err) => {
        console.error('Failed to load public config', err);
        setConfigLoaded(true);
      });
  }, []);

  useEffect(() => {
    fetchHealth()
      .then((next) => {
        setHealth(next);
        setHealthError('');
      })
      .catch((err) => {
        setHealth(null);
        setHealthError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  useEffect(() => {
    saveApiKeys(apiKeys);
  }, [apiKeys]);

  const resetState = useCallback(() => {
    setStageStates(buildInitialStageState());
    setStageMessages(buildInitialStageMessages());
    setStageEventLog([]);
    setTargetedProgress(null);
    setClusters([]);
    setOutline(null);
    setEvidence([]);
    setSourceCatalog([]);
    setRunId('');
    setArticleResult(null);
    setImagePrompts([]);
    setError('');
    setRetrievalMetrics(null);
    setRunRecencyHours(null);
  }, []);

  const handleStageEvent = useCallback((event: StageEvent<unknown>) => {
    setStageStates((prev) => ({
      ...prev,
      [event.stage]: event.status,
    }));

    if (event.message) {
      setStageMessages((prev) => ({ ...prev, [event.stage]: event.message || '' }));
    }

    setStageEventLog((prev) => {
      const next = [...prev, event];
      if (next.length > 200) {
        next.splice(0, next.length - 200);
      }
      return next;
    });

    if (event.runId) {
      setRunId((prev) => prev || event.runId);
    }

    if (event.stage === 'retrieval') {
      if (event.status === 'success') {
        const data = event.data as RetrievalMetrics | undefined;
        if (data) {
          setRetrievalMetrics(data);
        }
      }
      if (event.status === 'failure') {
        setRetrievalMetrics(null);
      }
    }

    if (event.stage === 'ranking' && event.status === 'success') {
      const data = event.data as { clusters?: StoryCluster[] } | undefined;
      if (data?.clusters) {
        setClusters(data.clusters);
      }
    }

    if (event.stage === 'outline' && event.status === 'success') {
      const data = event.data as { outline?: OutlinePayload; recencyHours?: number; clusters?: StoryCluster[] } | undefined;
      if (data?.outline) {
        setOutline(data.outline);
      }
      if (Array.isArray(data?.clusters)) {
        setClusters(data.clusters);
      }
      if (typeof data?.recencyHours === 'number') {
        setRunRecencyHours(data.recencyHours);
      }
    }
  }, []);

  const tokenize = useCallback((text: string): Set<string> => {
    return new Set(
      String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 3),
    );
  }, []);

  const computeOverlapScore = useCallback((topicText: string, pointText: string): number => {
    const topicTokens = tokenize(topicText);
    const pointTokens = tokenize(pointText);
    if (topicTokens.size === 0 || pointTokens.size === 0) return 0;
    let hits = 0;
    for (const t of pointTokens) {
      if (topicTokens.has(t)) hits += 1;
    }
    return hits / Math.max(1, topicTokens.size);
  }, [tokenize]);

  const pickTargetedResearchIndices = useCallback(
    (args: { topic: string; outline: OutlinePayload; clusters: StoryCluster[] }) => {
      const points = Array.isArray(args.outline.outline) ? args.outline.outline : [];
      if (points.length <= 2) {
        return points.map((_p, idx) => idx);
      }

      const scoreByClusterId = new Map<string, number>();
      for (const cluster of args.clusters || []) {
        scoreByClusterId.set(cluster.clusterId, Number(cluster.score) || 0);
      }

      const scored = points.map((p, idx) => {
        const supports = Array.isArray(p.supports) ? p.supports : [];
        const supportScore = supports.reduce((sum, id) => sum + (scoreByClusterId.get(id) ?? 0), 0);
        const overlap = computeOverlapScore(args.topic, `${p.point} ${p.summary || ''}`);
        // Support score dominates; overlap is a small tiebreaker.
        const score = supportScore + overlap * 0.25;
        return { idx, score };
      });

      scored.sort((a, b) => b.score - a.score);
      const maxScore = scored[0]?.score ?? 0;
      const cap = Math.min(2, scored.length);

      const thresholded =
        maxScore > 0
          ? scored.filter((row) => row.score >= maxScore * 0.6)
          : scored.filter((row) => row.score > 0);

      const selected = (thresholded.length ? thresholded : scored).slice(0, cap).map((row) => row.idx);
      return selected;
    },
    [computeOverlapScore],
  );

  const buildSkippedEvidence = useCallback((args: {
    outlineIndex: number;
    point: { point: string; summary?: string; supports: string[] };
    clusters: StoryCluster[];
  }): EvidenceItem => {
    const byId = new Map<string, StoryCluster>();
    for (const c of args.clusters || []) byId.set(c.clusterId, c);

    const sources = (args.point.supports || [])
      .map((id) => byId.get(id)?.representative)
      .filter((rep): rep is StoryCluster['representative'] => Boolean(rep))
      .slice(0, 3);

    const citations = sources.map((rep, idx) => ({
      id: idx + 1,
      title: rep.title,
      url: rep.canonicalUrl,
      source: rep.sourceName ?? rep.sourceHost,
      publishedAt: rep.publishedAt ?? null,
    }));

    const lines = sources.map((rep) => {
      const date = rep.publishedAt ? rep.publishedAt.split('T')[0] : 'Undated';
      const source = rep.sourceName ?? rep.sourceHost;
      const title = rep.title;
      const url = rep.canonicalUrl;
      const excerpt = rep.excerpt || '';
      return `${date} - ${source}: ${title} (${url})\nKey points: ${excerpt}`;
    });

    return {
      outlineIndex: args.outlineIndex,
      point: args.point.point,
      digest: lines.length ? lines.join('\n\n') : 'Targeted research skipped for this point (low relevance).',
      citations,
    };
  }, []);

  const runPipeline = useCallback(async () => {
    if (!topic.trim()) {
      setError('Topic is required.');
      return;
    }

    setIsRunning(true);
    resetState();

    try {
      const outlineResult = await runPipelineToOutline({
        topic: topic.trim(),
        recencyHours,
        onStageEvent: handleStageEvent,
      });

      setRunId(outlineResult.runId);
      setOutline(outlineResult.outline);
      setClusters(outlineResult.clusters);
      setRunRecencyHours(outlineResult.recencyHours);

      setStageStates((prev) => ({ ...prev, targetedResearch: 'start' }));
      const outlinePoints = outlineResult.outline.outline;
      const indicesToResearch = pickTargetedResearchIndices({
        topic: topic.trim(),
        outline: outlineResult.outline,
        clusters: outlineResult.clusters,
      });
      const selected = new Set(indicesToResearch);
      const skipped = Math.max(0, outlinePoints.length - indicesToResearch.length);
      setTargetedProgress({ completed: 0, total: indicesToResearch.length, skipped, currentIndex: indicesToResearch.length ? indicesToResearch[0] : null });

      const evidenceItems: Array<EvidenceItem | undefined> = new Array(outlinePoints.length);

      for (let i = 0; i < outlinePoints.length; i += 1) {
        if (selected.has(i)) continue;
        const p = outlinePoints[i];
        evidenceItems[i] = buildSkippedEvidence({
          outlineIndex: i,
          point: { point: p.point, summary: p.summary, supports: Array.isArray(p.supports) ? p.supports : [] },
          clusters: outlineResult.clusters,
        });
      }
      setEvidence(evidenceItems.filter((value): value is EvidenceItem => Boolean(value)).sort((a, b) => a.outlineIndex - b.outlineIndex));

      const maxConcurrent = Math.min(2, Math.max(1, indicesToResearch.length));
      let nextIndex = 0;
      let completed = 0;

      const workers = new Array(maxConcurrent).fill(null).map(async () => {
        while (true) {
          const i = nextIndex;
          nextIndex += 1;
          if (i >= indicesToResearch.length) break;
          const outlineIndex = indicesToResearch[i];
          setStageStates((prev) => ({ ...prev, targetedResearch: 'progress' }));
          setTargetedProgress((prev) => (prev ? { ...prev, currentIndex: outlineIndex } : { completed: 0, total: indicesToResearch.length, skipped, currentIndex: outlineIndex }));
          const item = await runTargetedResearchPoint(
            {
              runId: outlineResult.runId,
              topic: topic.trim(),
              outlineIndex,
              point: outlinePoints[outlineIndex].point,
              summary: outlinePoints[outlineIndex].summary,
              recencyHours: outlineResult.recencyHours,
            },
            handleStageEvent,
          );
          evidenceItems[outlineIndex] = item;
          completed += 1;
          setEvidence(evidenceItems.filter((value): value is EvidenceItem => Boolean(value)).sort((a, b) => a.outlineIndex - b.outlineIndex));
          setTargetedProgress((prev) => (prev ? { ...prev, completed } : { completed, total: indicesToResearch.length, skipped, currentIndex: null }));
        }
      });

      await Promise.all(workers);
      setStageStates((prev) => ({ ...prev, targetedResearch: 'success' }));
      setTargetedProgress((prev) => (prev ? { ...prev, currentIndex: null, completed: prev.total } : null));

      const finalizedEvidence = evidenceItems
        .filter((value): value is EvidenceItem => Boolean(value))
        .sort((a, b) => a.outlineIndex - b.outlineIndex);

      const catalog = buildGlobalSourceCatalog({
        clusters: outlineResult.clusters,
        evidence: finalizedEvidence,
        maxSources: 80,
      });
      const normalizedEvidence = applySourceCatalogToEvidence(finalizedEvidence, catalog);
      setSourceCatalog(catalog);
      setEvidence(normalizedEvidence);

      const article = await generateArticle({
        runId: outlineResult.runId,
        topic: topic.trim(),
        outline: outlineResult.outline,
        clusters: outlineResult.clusters,
        evidence: normalizedEvidence,
        sourceCatalog: catalog,
        recencyHours: outlineResult.recencyHours,
      }, handleStageEvent);

      setArticleResult(article);
      if (Array.isArray(article.sourceCatalog) && article.sourceCatalog.length) {
        setSourceCatalog(article.sourceCatalog);
      }

      const image = await generateImagePrompt({
        runId: outlineResult.runId,
        article: article.article.article,
      }, handleStageEvent);

      setImagePrompts(image.slides);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setIsRunning(false);
    }
  }, [handleStageEvent, recencyHours, resetState, topic]);

  const pipelineStatus = useMemo(() => {
    const detailForStage = (stage: StageName): string | undefined => {
      if (stage === 'retrieval' && retrievalMetrics) {
        return `${retrievalMetrics.accepted} accepted / ${retrievalMetrics.candidateCount} candidates`;
      }
      if (stage === 'ranking' && clusters.length) {
        return `${clusters.length} clusters`;
      }
      if (stage === 'outline' && outline) {
        return `${outline.outline.length} outline points`;
      }
      if (stage === 'targetedResearch' && outline) {
        const totalOutline = outline.outline.length;
        const researchedTotal = targetedProgress?.total ?? totalOutline;
        const completed = targetedProgress?.completed ?? Math.min(evidence.length, researchedTotal);
        const skipped = targetedProgress?.skipped ?? Math.max(0, totalOutline - researchedTotal);
        const runningIndex = targetedProgress?.currentIndex;
        if (Number.isFinite(runningIndex ?? NaN) && runningIndex != null) {
          return `Researching ${runningIndex + 1}/${totalOutline} (researched ${completed}/${researchedTotal}, skipped ${skipped})`;
        }
        if (researchedTotal > 0) {
          return `Researched ${Math.min(completed, researchedTotal)}/${researchedTotal} (skipped ${skipped})`;
        }
        return skipped > 0 ? `Skipped ${skipped}/${totalOutline}` : undefined;
      }
      if (stage === 'synthesis' && articleResult) {
        return `${articleResult.article.wordCount} words`;
      }
      if (stage === 'imagePrompt' && imagePrompts.length) {
        return 'Ready';
      }
      const msg = stageMessages[stage];
      return msg || undefined;
    };

    return STAGES.map((stage) => ({
      stage,
      status: mapStageStatus(stageStates[stage]),
      detail: detailForStage(stage),
    }));
  }, [articleResult, clusters.length, evidence.length, imagePrompts.length, outline, retrievalMetrics, stageMessages, stageStates, targetedProgress]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <IntroModal
        open={showIntro}
        onClose={({ dontShowAgain }) => {
          if (dontShowAgain && typeof window !== 'undefined') {
            window.localStorage.setItem('gcp_pipeline_intro_dismissed_v1', '1');
          }
          setShowIntro(false);
        }}
      />
      <header className="max-w-6xl mx-auto px-6 py-10">
        <h1 className="text-3xl font-bold">Intelligence Pipeline</h1>
        <p className="mt-2 text-slate-400">
          Unified retrieval, outline, evidence, and synthesis with a configurable recency window.
          Active window: {describeRecencyLabel(runRecencyHours ?? recencyHours)}.
        </p>
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowIntro(true)}
            className="text-xs text-slate-300 hover:text-slate-100 border border-slate-700 rounded px-3 py-1"
          >
            What is this?
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 pb-16 space-y-8">
        <ApiConfigPanel 
          apiKeys={apiKeys} 
          setApiKeys={setApiKeys} 
          hasUserKeys={hasUserKeys} 
          onClearKeys={() => {
            clearApiKeys();
            setApiKeys(loadApiKeys());
          }}
        />

        <Card className="bg-slate-900/60 border-slate-800">
          <div className="flex flex-col md:flex-row md:items-end md:space-x-4 space-y-4 md:space-y-0">
            <div className="flex-1">
              <label htmlFor="topic" className="block text-sm font-medium text-slate-300 mb-2">
                <span className="inline-flex items-center gap-2">
                  Topic
                  <HelpTip label={'Write a clear topic in plain English.\n\nGood: specific entities + what happened + where.\nExamples:\n- \"US chip export controls impact on China AI startups\"\n- \"EU AI Act enforcement updates\"\n\nTips:\n- Avoid 1-word topics.\n- If you add constraints, keep them short (e.g., \"in 2025\", \"in Japan\").'} />
                </span>
              </label>
              <textarea
                id="topic"
                className="w-full h-24 bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-slate-100 focus:outline-none focus:ring focus:ring-blue-500/40"
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
              />
              <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                <div className="flex items-center space-x-2">
                  <span className="font-medium text-slate-300 inline-flex items-center gap-2">
                    Recency window
                    <HelpTip label="How far back to search for sources. Shorter windows yield fewer but fresher stories; longer windows increase coverage but may include older context." />
                  </span>
                  <select
                    className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs text-slate-100 focus:outline-none focus:ring focus:ring-blue-500/40"
                    value={recencyHours}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (Number.isFinite(value) && value > 0) {
                        setRecencyHours(value);
                      }
                    }}
                  >
                    <option value={168}>Last 7 days</option>
                    <option value={336}>Last 14 days</option>
                    <option value={504}>Last 21 days</option>
                    <option value={720}>Last 30 days</option>
                  </select>
                </div>
                {publicConfig && (
                  <span>
                    Default: {publicConfig.recencyHours / 24} days, min {publicConfig.retrieval.minAccepted} articles
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={runPipeline}
              disabled={isRunning || !configLoaded}
              className="inline-flex items-center justify-center h-12 px-6 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed transition"
              title="Runs retrieval -> clustering -> outline -> targeted research -> synthesis."
            >
              {isRunning ? <LoaderIcon className="w-5 h-5 animate-spin" /> : <SparklesIcon className="w-5 h-5" />}
              <span className="ml-2 font-semibold">Run pipeline</span>
            </button>
          </div>
          {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        </Card>

        <PipelineStatus stages={pipelineStatus} />

        <DiagnosticsPanel
            runId={runId || ''}
            sourceCatalog={sourceCatalog}
            hasUserKeys={hasUserKeys}
            keyPresence={keyPresence}
            geminiRpm={apiKeys.geminiRpm}
            publicConfig={publicConfig}
            health={health}
            healthError={healthError}
            fetchHealth={fetchHealth}
            setHealth={setHealth}
            setHealthError={setHealthError}
            stageEventLog={stageEventLog}
        />

        <RetrievalMetricsPanel metrics={retrievalMetrics} />

        {clusters.length > 0 && (
          <StoryClusters clusters={clusters} />
        )}

        {outline && (
          <OutlineWithCoverage outline={outline} />
        )}

        {evidence.length > 0 && (
          <EvidencePanel evidence={evidence} />
        )}

        {articleResult && (
          <ArticlePanel
            article={articleResult.article}
            imagePrompts={imagePrompts}
            noveltyScore={articleResult.noveltyScore}
            warnings={articleResult.warnings}
          />
        )}
      </main>
    </div>
  );
};

export default App;
