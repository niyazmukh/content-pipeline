import React, { useState, useCallback, useEffect, useMemo } from 'react';
import type {
  StageEvent,
  StageName,
  StageStatus,
  StoryCluster,
  OutlinePayload,
  EvidenceItem,
  RunAgentSuccessPayload,
  ArticleGenerationResult,
  RetrievalMetrics,
  ApiConfigResponse,
} from './shared/types';
import { DEFAULT_TOPIC_QUERY } from './shared/defaultTopicQuery';
import PipelineStatus from './components/PipelineStatus';
import RetrievalMetricsPanel from './components/RetrievalMetricsPanel';
import StoryClusters from './components/StoryClusters';
import OutlineWithCoverage from './components/OutlineWithCoverage';
import EvidencePanel from './components/EvidencePanel';
import ArticlePanel from './components/ArticlePanel';
import { runUnifiedPipeline, generateArticle, generateImagePrompt, fetchPublicConfig } from './services/geminiService';
import { LoaderIcon, SparklesIcon } from './components/icons';
import { loadApiKeys, saveApiKeys, clearApiKeys, type ApiKeys } from './services/apiKeys';

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
  const [runId, setRunId] = useState<string>('');
  const [articleResult, setArticleResult] = useState<ArticleGenerationResult | null>(null);
  const [imagePrompt, setImagePrompt] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [configLoaded, setConfigLoaded] = useState<boolean>(false);
  const [retrievalMetrics, setRetrievalMetrics] = useState<RetrievalMetrics | null>(null);
  const [publicConfig, setPublicConfig] = useState<ApiConfigResponse | null>(null);
  const [recencyHours, setRecencyHours] = useState<number>(168);
  const [runRecencyHours, setRunRecencyHours] = useState<number | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeys>(() => loadApiKeys());
  const hasUserKeys = Boolean(
    apiKeys.geminiApiKey ||
      apiKeys.googleCseApiKey ||
      apiKeys.googleCseCx ||
      apiKeys.newsApiKey ||
      apiKeys.eventRegistryApiKey,
  );

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
    saveApiKeys(apiKeys);
  }, [apiKeys]);

  const resetState = useCallback(() => {
    setStageStates(buildInitialStageState());
    setClusters([]);
    setOutline(null);
    setEvidence([]);
    setRunId('');
    setArticleResult(null);
    setImagePrompt('');
    setError('');
    setRetrievalMetrics(null);
    setRunRecencyHours(null);
  }, []);

  const handleStageEvent = useCallback((event: StageEvent<unknown>) => {
    setStageStates((prev) => ({
      ...prev,
      [event.stage]: event.status,
    }));

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
      const data = event.data as { outline?: OutlinePayload } | undefined;
      if (data?.outline) {
        setOutline(data.outline);
      }
    }

    if (event.stage === 'targetedResearch' && event.status === 'success') {
      const data = event.data as RunAgentSuccessPayload | undefined;
      if (data) {
        setRunId(data.runId);
        setOutline(data.outline);
        setEvidence(data.evidence);
        setClusters(data.clusters);
        if (typeof data.recencyHours === 'number') {
          setRunRecencyHours(data.recencyHours);
        }
      }
    }
  }, []);

  const runPipeline = useCallback(async () => {
    if (!topic.trim()) {
      setError('Topic is required.');
      return;
    }

    setIsRunning(true);
    resetState();

    try {
      const agentResult = await runUnifiedPipeline({
        topic: topic.trim(),
        recencyHours,
        onStageEvent: handleStageEvent,
      });

      setRunId(agentResult.runId);
      setOutline(agentResult.outline);
      setEvidence(agentResult.evidence);
      setClusters(agentResult.clusters);
      setRunRecencyHours(agentResult.recencyHours);

      const article = await generateArticle({
        runId: agentResult.runId,
        topic: topic.trim(),
        outline: agentResult.outline,
        clusters: agentResult.clusters,
        evidence: agentResult.evidence,
        recencyHours: agentResult.recencyHours,
      }, handleStageEvent);

      setArticleResult(article);

      const image = await generateImagePrompt({
        runId: agentResult.runId,
        article: article.article.article,
      }, handleStageEvent);

      setImagePrompt(image.prompt);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setIsRunning(false);
    }
  }, [handleStageEvent, recencyHours, resetState, topic]);

  const pipelineStatus = useMemo(() => {
    return STAGES.map((stage) => ({
      stage,
      status: mapStageStatus(stageStates[stage]),
    }));
  }, [stageStates]);

  const canGenerateArticle = outline && evidence.length > 0 && clusters.length > 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="max-w-6xl mx-auto px-6 py-10">
        <h1 className="text-3xl font-bold">Intelligence Pipeline</h1>
        <p className="mt-2 text-slate-400">
          Unified retrieval, outline, evidence, and synthesis with a configurable recency window.
          Active window: {describeRecencyLabel(runRecencyHours ?? recencyHours)}.
        </p>
      </header>

      <main className="max-w-6xl mx-auto px-6 pb-16 space-y-8">
        <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 shadow-lg">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold">API keys</h2>
              <p className="text-sm text-slate-400 mt-1">
                Keys are stored locally in your browser and sent with each request. Leave blank to use the default backend.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                clearApiKeys();
                setApiKeys(loadApiKeys());
              }}
              className="text-xs text-slate-300 hover:text-slate-100 border border-slate-700 rounded px-3 py-1"
            >
              Clear keys
            </button>
          </div>
          <div className="mt-3 text-xs text-slate-400">
            {hasUserKeys ? 'Using your personal API keys.' : 'Using the default backend configuration.'}
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
            <h3 className="font-semibold mb-2">Getting API keys (quick guide)</h3>
            <ol className="list-decimal list-inside space-y-2 text-slate-400">
              <li>
                Gemini: open <a className="text-blue-400 hover:text-blue-300" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Google AI Studio API keys</a>, click “Create API key”, copy it into the Gemini field.
              </li>
              <li>
                NewsAPI: open <a className="text-blue-400 hover:text-blue-300" href="https://newsapi.org/register" target="_blank" rel="noreferrer">newsapi.org/register</a>, create a free account, then copy your key from the dashboard.
              </li>
              <li>
                EventRegistry: open <a className="text-blue-400 hover:text-blue-300" href="https://eventregistry.org/register" target="_blank" rel="noreferrer">eventregistry.org/register</a>, sign up, then copy your API key from your profile page.
              </li>
              <li>
                Google CSE: create a search engine at <a className="text-blue-400 hover:text-blue-300" href="https://programmablesearchengine.google.com/" target="_blank" rel="noreferrer">programmablesearchengine.google.com</a>, then enable the Custom Search API in Google Cloud and copy both the API key and the Search Engine ID (cx).
              </li>
            </ol>
          </div>
        </section>

        <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 shadow-lg">
          <div className="flex flex-col md:flex-row md:items-end md:space-x-4 space-y-4 md:space-y-0">
            <div className="flex-1">
              <label htmlFor="topic" className="block text-sm font-medium text-slate-300 mb-2">Topic</label>
              <textarea
                id="topic"
                className="w-full h-24 bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-slate-100 focus:outline-none focus:ring focus:ring-blue-500/40"
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
              />
              <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                <div className="flex items-center space-x-2">
                  <span className="font-medium text-slate-300">Recency window</span>
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
            >
              {isRunning ? <LoaderIcon className="w-5 h-5 animate-spin" /> : <SparklesIcon className="w-5 h-5" />}
              <span className="ml-2 font-semibold">Run pipeline</span>
            </button>
          </div>
          {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        </section>

        <PipelineStatus stages={pipelineStatus} />

        <RetrievalMetricsPanel metrics={retrievalMetrics} />

        {clusters.length > 0 && (
          <StoryClusters clusters={clusters} outline={outline} />
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
            imagePrompt={imagePrompt}
            noveltyScore={articleResult.noveltyScore}
            warnings={articleResult.warnings}
          />
        )}
      </main>
    </div>
  );
};

export default App;

