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
        <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 shadow-lg">
          <details className="group">
            <summary className="cursor-pointer select-none flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">API keys</h2>
                <p className="text-sm text-slate-400 mt-1">
                  Optional: add your own keys to avoid shared backend quotas. Keys are stored in your browser.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  clearApiKeys();
                  setApiKeys(loadApiKeys());
                }}
                className="text-xs text-slate-300 hover:text-slate-100 border border-slate-700 rounded px-3 py-1"
                title="Clears locally stored keys (browser localStorage)."
              >
                Clear keys
              </button>
              <span className="text-xs text-slate-400 group-open:hidden">Show</span>
              <span className="text-xs text-slate-400 hidden group-open:inline">Hide</span>
              <span className="inline-block text-slate-500 group-open:hidden">&gt;</span>
              <span className="inline-block text-slate-500 hidden group-open:inline">v</span>
            </div>
            </summary>

          <div className="mt-3 text-xs text-slate-400 flex items-center gap-2">
            <span>{hasUserKeys ? 'Using your personal API keys.' : 'Using the default backend configuration (if available).'}</span>
            <HelpTip label="Keys are saved in your browser and included as request headers when you run the pipeline. Shared backend keys can run out of quota if many users run the app." />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Gemini API key (required)</label>
              <input
                type="password"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm"
                value={apiKeys.geminiApiKey}
                onChange={(event) => setApiKeys((prev) => ({ ...prev, geminiApiKey: event.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Gemini RPM (optional)</label>
              <input
                type="number"
                min={1}
                max={10}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm"
                value={apiKeys.geminiRpm}
                onChange={(event) => setApiKeys((prev) => ({ ...prev, geminiRpm: event.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Google CSE API key</label>
              <input
                type="password"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm"
                value={apiKeys.googleCseApiKey}
                onChange={(event) => setApiKeys((prev) => ({ ...prev, googleCseApiKey: event.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Google CSE Search Engine ID (cx)</label>
              <input
                type="text"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm"
                value={apiKeys.googleCseCx}
                onChange={(event) => setApiKeys((prev) => ({ ...prev, googleCseCx: event.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">NewsAPI key</label>
              <input
                type="password"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm"
                value={apiKeys.newsApiKey}
                onChange={(event) => setApiKeys((prev) => ({ ...prev, newsApiKey: event.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">EventRegistry key</label>
              <input
                type="password"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm"
                value={apiKeys.eventRegistryApiKey}
                onChange={(event) => setApiKeys((prev) => ({ ...prev, eventRegistryApiKey: event.target.value }))}
              />
            </div>
          </div>
          <div className="mt-6 border-t border-slate-800 pt-4 text-sm text-slate-300">
            <div>
              <div className="font-semibold text-slate-200">Getting API keys</div>
              <div className="mt-3 text-slate-400 space-y-4">
                <p className="text-sm">
                  Leave all fields blank to use the default backend keys. If you paste your own keys, they stay in your browser (localStorage) and are sent with each request.
                </p>

                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Quick links</div>
                  <ol className="mt-2 list-decimal list-inside space-y-2">
                    <li>
                      Gemini API key: <a className="text-blue-400 hover:text-blue-300" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">AI Studio - API keys</a>
                    </li>
                    <li>
                      NewsAPI key: <a className="text-blue-400 hover:text-blue-300" href="https://newsapi.org/register" target="_blank" rel="noreferrer">NewsAPI - Register</a>
                    </li>
                    <li>
                      EventRegistry key: <a className="text-blue-400 hover:text-blue-300" href="https://eventregistry.org/register" target="_blank" rel="noreferrer">EventRegistry - Register</a>
                    </li>
                    <li>
                      Google CSE: <a className="text-blue-400 hover:text-blue-300" href="https://programmablesearchengine.google.com/" target="_blank" rel="noreferrer">Programmable Search Engine</a>
                    </li>
                  </ol>
                </div>

                <details className="border border-slate-800 rounded-lg p-4 bg-slate-950/30">
                  <summary className="cursor-pointer select-none font-semibold text-slate-200">Gemini (extended guide)</summary>
                  <div className="mt-3 space-y-2">
                    <ol className="list-decimal list-inside space-y-2">
                      <li>Open <a className="text-blue-400 hover:text-blue-300" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">AI Studio - API keys</a>.</li>
                      <li>Sign in with your Google account (if prompted).</li>
                      <li>Click "Create API key", then copy the key.</li>
                      <li>Paste it into "Gemini API key" above.</li>
                    </ol>
                    <p className="text-xs text-slate-500">
                      Reference: <a className="text-blue-400 hover:text-blue-300" href="https://ai.google.dev/gemini-api/docs/api-key" target="_blank" rel="noreferrer">Gemini API key docs</a>.
                    </p>
                  </div>
                </details>

                <details className="border border-slate-800 rounded-lg p-4 bg-slate-950/30">
                  <summary className="cursor-pointer select-none font-semibold text-slate-200">NewsAPI (extended guide)</summary>
                  <div className="mt-3 space-y-2">
                    <ol className="list-decimal list-inside space-y-2">
                      <li>Open <a className="text-blue-400 hover:text-blue-300" href="https://newsapi.org/register" target="_blank" rel="noreferrer">newsapi.org/register</a> and create an account.</li>
                      <li>After signing in, open your NewsAPI dashboard and copy your API key.</li>
                      <li>Paste it into "NewsAPI key" above.</li>
                    </ol>
                    <p className="text-xs text-slate-500">
                      Reference: <a className="text-blue-400 hover:text-blue-300" href="https://newsapi.org/docs" target="_blank" rel="noreferrer">NewsAPI docs</a> (endpoint used: <a className="text-blue-400 hover:text-blue-300" href="https://newsapi.org/docs/endpoints/everything" target="_blank" rel="noreferrer">/v2/everything</a>).
                    </p>
                  </div>
                </details>

                <details className="border border-slate-800 rounded-lg p-4 bg-slate-950/30">
                  <summary className="cursor-pointer select-none font-semibold text-slate-200">EventRegistry (extended guide)</summary>
                  <div className="mt-3 space-y-2">
                    <ol className="list-decimal list-inside space-y-2">
                      <li>Open <a className="text-blue-400 hover:text-blue-300" href="https://eventregistry.org/register" target="_blank" rel="noreferrer">eventregistry.org/register</a> and create an account.</li>
                      <li>After signing in, find your API key in your profile / account settings.</li>
                      <li>Paste it into "EventRegistry key" above.</li>
                    </ol>
                    <p className="text-xs text-slate-500">
                      Reference: <a className="text-blue-400 hover:text-blue-300" href="https://eventregistry.org/documentation" target="_blank" rel="noreferrer">EventRegistry documentation</a> (endpoint used: <code className="text-slate-300">/api/v1/article/getArticles</code>).
                    </p>
                  </div>
                </details>

                <details className="border border-slate-800 rounded-lg p-4 bg-slate-950/30">
                  <summary className="cursor-pointer select-none font-semibold text-slate-200">Google CSE (extended guide)</summary>
                  <div className="mt-3 space-y-2">
                    <ol className="list-decimal list-inside space-y-2">
                      <li>Create a search engine at <a className="text-blue-400 hover:text-blue-300" href="https://programmablesearchengine.google.com/" target="_blank" rel="noreferrer">Programmable Search Engine</a>.</li>
                      <li>Copy the "Search engine ID" (also called <code className="text-slate-300">cx</code>) and paste it into "Google CSE Search Engine ID (cx)".</li>
                      <li>In Google Cloud, enable the "Custom Search API", create an API key, and paste it into "Google CSE API key".</li>
                    </ol>
                    <p className="text-xs text-slate-500">
                      Reference: <a className="text-blue-400 hover:text-blue-300" href="https://developers.google.com/custom-search/v1/overview" target="_blank" rel="noreferrer">Custom Search JSON API</a>.
                    </p>
                  </div>
                </details>
              </div>
            </div>
          </div>
          </details>
        </section>

        <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 shadow-lg">
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
        </section>

        <PipelineStatus stages={pipelineStatus} />

        <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 shadow">
          <details className="group">
            <summary className="cursor-pointer select-none text-lg font-semibold text-slate-200">
              Diagnostics
            </summary>
            <div className="mt-4 space-y-3 text-sm text-slate-300">
              <div className="text-xs text-slate-400">
                API base: <span className="font-mono text-slate-200">{API_BASE_URL}</span>
              </div>
              <div className="text-xs text-slate-400">
                Run ID: <span className="font-mono text-slate-200">{runId || '-'}</span>
              </div>
              <div className="text-xs text-slate-400">
                Source catalog:{' '}
                <span className="font-mono text-slate-200">{sourceCatalog.length ? `${sourceCatalog.length} sources` : '-'}</span>
              </div>

              <div className="text-xs text-slate-400">
                Client keys:{' '}
                <span className="text-slate-200">
                  {hasUserKeys ? 'provided' : 'not provided (using default backend keys if available)'}
                </span>
              </div>
              <div className="text-xs text-slate-400">
                Client key details:{' '}
                <span className="font-mono text-slate-200">Gemini={keyPresence.gemini ? 'on' : 'off'}</span>{' '}
                <span className="font-mono text-slate-200">GoogleCSE={keyPresence.googleCse ? 'on' : 'off'}</span>{' '}
                <span className="font-mono text-slate-200">NewsAPI={keyPresence.newsApi ? 'on' : 'off'}</span>{' '}
                <span className="font-mono text-slate-200">EventRegistry={keyPresence.eventRegistry ? 'on' : 'off'}</span>
              </div>

              <div className="text-xs text-slate-400">
                Gemini RPM header:{' '}
                <span className="font-mono text-slate-200">{apiKeys.geminiRpm?.trim() || '-'}</span>
              </div>

              {publicConfig && (
                <div className="text-xs text-slate-400">
                  Retrieval budget:{' '}
                  <span className="font-mono text-slate-200">minAccepted={publicConfig.retrieval.minAccepted}</span>{' '}
                  <span className="font-mono text-slate-200">maxAttempts={publicConfig.retrieval.maxAttempts}</span>{' '}
                  <span className="font-mono text-slate-200">globalConc={publicConfig.retrieval.globalConcurrency}</span>{' '}
                  <span className="font-mono text-slate-200">perHostConc={publicConfig.retrieval.perHostConcurrency}</span>{' '}
                  <span className="font-mono text-slate-200">budgetMs={publicConfig.retrieval.totalBudgetMs}</span>
                </div>
              )}

              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span>Default backend keys:</span>
                {health?.backendKeys ? (
                  <div className="flex flex-wrap gap-2">
                    {([
                      ['Gemini', health.backendKeys.gemini],
                      ['NewsAPI', health.backendKeys.newsApi],
                      ['EventRegistry', health.backendKeys.eventRegistry],
                      ['Google CSE', health.backendKeys.googleCse],
                    ] as Array<[string, boolean]>).map(([label, ok]) => (
                      <span
                        key={label}
                        className={`text-[10px] px-2 py-0.5 rounded-full border ${
                          ok
                            ? 'border-emerald-900/60 bg-emerald-950/40 text-emerald-300'
                            : 'border-slate-700 bg-slate-950/60 text-slate-400'
                        } uppercase tracking-wide`}
                      >
                        {label}: {ok ? 'on' : 'off'}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-slate-500">
                    {healthError ? `unavailable (${healthError})` : 'loading...'}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    fetchHealth()
                      .then((next) => {
                        setHealth(next);
                        setHealthError('');
                      })
                      .catch((err) => {
                        setHealth(null);
                        setHealthError(err instanceof Error ? err.message : String(err));
                      });
                  }}
                  className="ml-auto text-xs text-slate-300 hover:text-slate-100 border border-slate-700 rounded px-3 py-1"
                >
                  Refresh
                </button>
              </div>
            </div>
          </details>

          <details className="group mt-4">
            <summary className="cursor-pointer select-none text-sm font-semibold text-slate-200">
              Event log (last {stageEventLog.length})
            </summary>
            <div className="mt-3 max-h-64 overflow-auto border border-slate-800 rounded-lg bg-slate-950/40 p-3">
              {stageEventLog.length === 0 ? (
                <div className="text-xs text-slate-500">No events yet.</div>
              ) : (
                <div className="space-y-1">
                  {stageEventLog.slice(-50).map((ev, idx) => (
                    <div key={`${ev.ts}-${idx}`} className="text-xs font-mono text-slate-300">
                      <span className="text-slate-500">{ev.ts.slice(11, 19)}</span>{' '}
                      <span className="text-slate-400">{ev.stage}</span>{' '}
                      <span className="text-slate-400">{ev.status}</span>{' '}
                      <span className="text-slate-200">{ev.message || ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </details>
        </section>

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
