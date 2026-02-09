import React, { useState } from 'react';
import { Card } from './ui/Card';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { ApiConfigResponse, ApiHealthResponse, SourceCatalogEntry, StageEvent } from '../shared/types';
import { API_BASE_URL } from '../services/geminiService';

interface DiagnosticsPanelProps {
  runId: string;
  sourceCatalog: SourceCatalogEntry[];
  hasUserKeys: boolean;
  keyPresence: {
    gemini: boolean;
    googleCse: boolean;
    newsApi: boolean;
    eventRegistry: boolean;
  };
  geminiRpm: string;
  publicConfig: ApiConfigResponse | null;
  health: ApiHealthResponse | null;
  healthError: string;
  fetchHealth: () => Promise<ApiHealthResponse>;
  setHealth: (h: ApiHealthResponse | null) => void;
  setHealthError: (e: string) => void;
  stageEventLog: Array<StageEvent<unknown>>;
}

const DiagnosticsPanel: React.FC<DiagnosticsPanelProps> = ({
  runId,
  sourceCatalog,
  hasUserKeys,
  keyPresence,
  geminiRpm,
  publicConfig,
  health,
  healthError,
  fetchHealth,
  setHealth,
  setHealthError,
  stageEventLog,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const handleRefreshHealth = () => {
    fetchHealth()
      .then((next) => {
        setHealth(next);
        setHealthError('');
      })
      .catch((err) => {
        setHealth(null);
        setHealthError(err instanceof Error ? err.message : String(err));
      });
  };

  return (
    <Card className="border-slate-800 bg-slate-900/60 p-0">
      <button
        type="button"
        className="flex w-full items-center justify-between p-6 text-left select-none hover:bg-slate-900/80 transition-colors"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-controls="diagnostics-content"
      >
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-slate-200">Diagnostics</h2>
          <div className="flex gap-2">
            {healthError ? (
              <Badge variant="error" className="py-0.5">System Error</Badge>
            ) : (
              <Badge variant="success" className="py-0.5">System Healthy</Badge>
            )}
            <span className="py-1 text-xs text-slate-500">Run ID: {runId || 'N/A'}</span>
          </div>
        </div>
        <svg
          className={`h-5 w-5 text-slate-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div id="diagnostics-content" className="space-y-6 border-t border-slate-800 px-6 pb-6 pt-6 text-sm text-slate-300">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            <div>
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">System Info</div>
              <div className="space-y-2 font-mono text-xs text-slate-400">
                <div className="flex justify-between border-b border-slate-800/50 pb-1">
                  <span>API Base</span>
                  <span className="max-w-[12rem] truncate text-slate-200" title={API_BASE_URL}>{API_BASE_URL}</span>
                </div>
                <div className="flex justify-between border-b border-slate-800/50 pb-1">
                  <span>Run ID</span>
                  <span className="text-slate-200">{runId || '-'}</span>
                </div>
                <div className="flex justify-between border-b border-slate-800/50 pb-1">
                  <span>Catalog Size</span>
                  <span className="text-slate-200">{sourceCatalog.length}</span>
                </div>
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Client Authorization</div>
              <div className="space-y-2 text-xs">
                <div>
                  Mode:{' '}
                  {hasUserKeys ? (
                    <span className="font-medium text-blue-400">User Keys</span>
                  ) : (
                    <span className="text-slate-400">Default Backend</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant={keyPresence.gemini ? 'default' : 'outline'} className="py-0.5">Gemini {keyPresence.gemini ? 'on' : 'off'}</Badge>
                  <Badge variant={keyPresence.googleCse ? 'default' : 'outline'} className="py-0.5">CSE {keyPresence.googleCse ? 'on' : 'off'}</Badge>
                  <Badge variant={keyPresence.newsApi ? 'default' : 'outline'} className="py-0.5">News {keyPresence.newsApi ? 'on' : 'off'}</Badge>
                  <Badge variant={keyPresence.eventRegistry ? 'default' : 'outline'} className="py-0.5">Registry {keyPresence.eventRegistry ? 'on' : 'off'}</Badge>
                </div>
                <div className="text-xs text-slate-500">
                  Global RPM Limit: <span className="text-slate-300">{geminiRpm || 'Default'}</span>
                </div>
              </div>
            </div>

            {publicConfig && (
              <div>
                <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Retrieval Config</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-xs text-slate-400">
                  <span className="text-slate-500">Min Accepted</span>
                  <span className="text-right text-slate-200">{publicConfig.retrieval.minAccepted}</span>
                  <span className="text-slate-500">Max Attempts</span>
                  <span className="text-right text-slate-200">{publicConfig.retrieval.maxAttempts}</span>
                  <span className="text-slate-500">Global Conc.</span>
                  <span className="text-right text-slate-200">{publicConfig.retrieval.globalConcurrency}</span>
                  <span className="text-slate-500">Host Conc.</span>
                  <span className="text-right text-slate-200">{publicConfig.retrieval.perHostConcurrency}</span>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-slate-800 pt-6">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Backend Service Health</div>
              <Button type="button" variant="outline" size="sm" onClick={handleRefreshHealth}>
                Refetch status
              </Button>
            </div>

            {health?.backendKeys ? (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {([
                  ['Gemini', health.backendKeys.gemini],
                  ['NewsAPI', health.backendKeys.newsApi],
                  ['EventRegistry', health.backendKeys.eventRegistry],
                  ['Google CSE', health.backendKeys.googleCse],
                ] as Array<[string, boolean]>).map(([label, ok]) => (
                  <div
                    key={label}
                    className={`flex items-center justify-between rounded border px-3 py-2 ${ok ? 'border-emerald-900/30 bg-emerald-950/20' : 'border-red-900/30 bg-red-950/20'}`}
                  >
                    <span className={`text-xs font-medium ${ok ? 'text-emerald-400' : 'text-red-400'}`}>{label}</span>
                    <div className={`h-2 w-2 rounded-full ${ok ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'}`} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center rounded border border-red-900/30 bg-red-950/10 p-3 text-xs text-red-400">
                <span className="mr-2">Warning:</span> {healthError || 'Checking backend status...'}
              </div>
            )}
          </div>

          <div className="border-t border-slate-800 pt-6">
            <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">
              Event Log <span className="ml-1 font-normal normal-case text-slate-600">({stageEventLog.length} events)</span>
            </div>
            <div className="h-64 overflow-y-auto rounded-lg border border-slate-800/50 bg-slate-950 p-2 font-mono text-[10px] leading-relaxed">
              {stageEventLog.length === 0 ? (
                <div className="flex h-full items-center justify-center italic text-slate-600">No events recorded for this session.</div>
              ) : (
                stageEventLog.slice().reverse().map((ev, idx) => (
                  <div key={idx} className="-mx-2 mb-1.5 flex gap-3 rounded border-b border-slate-900 px-2 pb-1.5 last:mb-0 last:border-0 last:pb-0 hover:bg-slate-900/50">
                    <span className="w-16 shrink-0 select-none text-slate-600">{ev.ts.split('T')[1].split('.')[0]}</span>
                    <span className="w-24 shrink-0 text-right text-blue-500">[{ev.stage}]</span>
                    <span className={`w-16 shrink-0 text-center font-bold ${ev.status === 'success' ? 'text-emerald-500' : ev.status === 'failure' ? 'text-red-500' : 'text-amber-500'}`}>
                      {ev.status.toUpperCase()}
                    </span>
                    <span className="flex-1 break-words text-slate-300">{ev.message || '-'}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
};

export default DiagnosticsPanel;
