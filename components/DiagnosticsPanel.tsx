import React, { useState } from 'react';
import { Card } from './ui/Card';
import { Badge } from './ui/Badge';
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
    stageEventLog
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

    const toggleOpen = () => setIsOpen(!isOpen);

    return (
        <Card className="border-slate-800 bg-slate-900/60 p-0">
             <div 
                className="flex items-center justify-between p-6 cursor-pointer select-none"
                onClick={toggleOpen}
             >
                <div className="flex items-center gap-3">
                     <h2 className="text-lg font-semibold text-slate-200">Diagnostics</h2>
                     <div className="flex gap-2">
                        {healthError ? (
                            <Badge variant="error" className="py-0.5">System Error</Badge>
                        ) : (
                            <Badge variant="success" className="bg-emerald-950/20 text-emerald-400 border-emerald-900/50 py-0.5">System Healthy</Badge>
                        )}
                         <span className="text-xs text-slate-500 py-1">Run ID: {runId || 'N/A'}</span>
                     </div>
                </div>
                 <svg 
                    className={`w-5 h-5 text-slate-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} 
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                 </svg>
             </div>

             {isOpen && (
             <div className="px-6 pb-6 space-y-6 text-sm text-slate-300 border-t border-slate-800 pt-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                     <div>
                        <div className="text-xs text-slate-500 uppercase tracking-wide font-bold mb-2">System Info</div>
                        <div className="text-xs space-y-2 font-mono text-slate-400">
                            <div className="flex justify-between border-b border-slate-800/50 pb-1">
                                <span>API Base</span> <span className="text-slate-200">{API_BASE_URL}</span>
                            </div>
                            <div className="flex justify-between border-b border-slate-800/50 pb-1">
                                <span>Run ID</span> <span className="text-slate-200">{runId || '-'}</span>
                            </div>
                            <div className="flex justify-between border-b border-slate-800/50 pb-1">
                                <span>Catalog Size</span> <span className="text-slate-200">{sourceCatalog.length}</span>
                            </div>
                        </div>
                     </div>

                     <div>
                        <div className="text-xs text-slate-500 uppercase tracking-wide font-bold mb-2">Client Authorization</div>
                        <div className="text-xs space-y-2">
                             <div className="mb-2">Mode: {hasUserKeys ? <span className="text-blue-400 font-medium">User Keys</span> : <span className="text-slate-400">Default Backend</span>}</div>
                             <div className="flex gap-1.5 flex-wrap">
                                 <Badge variant={keyPresence.gemini ? 'default' : 'outline'} className="py-0.5">Gemini</Badge>
                                 <Badge variant={keyPresence.googleCse ? 'default' : 'outline'} className="py-0.5">CSE</Badge>
                                 <Badge variant={keyPresence.newsApi ? 'default' : 'outline'} className="py-0.5">News</Badge>
                                 <Badge variant={keyPresence.eventRegistry ? 'default' : 'outline'} className="py-0.5">Registry</Badge>
                             </div>
                             <div className="mt-2 text-xs text-slate-500">Global RPM Limit: <span className="text-slate-300">{geminiRpm || 'Default'}</span></div>
                        </div>
                     </div>
                     
                     {publicConfig && (
                        <div>
                             <div className="text-xs text-slate-500 uppercase tracking-wide font-bold mb-2">Retrieval Config</div>
                             <div className="text-xs grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-slate-400">
                                 <span className="text-slate-500">Min Accepted</span> <span className="text-slate-200 text-right">{publicConfig.retrieval.minAccepted}</span>
                                 <span className="text-slate-500">Max Attempts</span> <span className="text-slate-200 text-right">{publicConfig.retrieval.maxAttempts}</span>
                                 <span className="text-slate-500">Global Conc.</span> <span className="text-slate-200 text-right">{publicConfig.retrieval.globalConcurrency}</span>
                                 <span className="text-slate-500">Host Conc.</span> <span className="text-slate-200 text-right">{publicConfig.retrieval.perHostConcurrency}</span>
                             </div>
                        </div>
                     )}
                </div>

                <div className="pt-6 border-t border-slate-800">
                    <div className="flex items-center justify-between mb-4">
                        <div className="text-xs text-slate-500 uppercase tracking-wide font-bold">Backend Service Health</div>
                        <button 
                            onClick={handleRefreshHealth}
                            className="text-xs px-2 py-1 rounded border border-slate-700 hover:bg-slate-800 text-slate-300 transition-colors"
                        >
                            Refetch Status
                        </button>
                    </div>
                    
                    {health?.backendKeys ? (
                         <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                            {([
                              ['Gemini', health.backendKeys.gemini],
                              ['NewsAPI', health.backendKeys.newsApi],
                              ['EventRegistry', health.backendKeys.eventRegistry],
                              ['Google CSE', health.backendKeys.googleCse],
                            ] as Array<[string, boolean]>).map(([label, ok]) => (
                                <div key={label} className={`flex items-center justify-between px-3 py-2 rounded border ${ok ? 'border-emerald-900/30 bg-emerald-950/20' : 'border-red-900/30 bg-red-950/20'}`}>
                                    <span className={`text-xs font-medium ${ok ? 'text-emerald-400' : 'text-red-400'}`}>{label}</span>
                                    <div className={`w-2 h-2 rounded-full ${ok ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'}`}></div>
                                </div>
                            ))}
                         </div>
                    ) : (
                        <div className="text-xs text-red-400 flex items-center p-3 border border-red-900/30 rounded bg-red-950/10">
                            <span className="mr-2">⚠️</span> {healthError || 'Checking backend status...'}
                        </div>
                    )}
                </div>

                <div className="pt-6 border-t border-slate-800">
                    <div className="text-xs text-slate-500 uppercase tracking-wide font-bold mb-3">
                        Event Log <span className="font-normal normal-case text-slate-600 ml-1">({stageEventLog.length} events)</span>
                    </div>
                     <div className="h-64 overflow-y-auto rounded-lg bg-slate-950 border border-slate-800/50 p-2 font-mono text-[10px] leading-relaxed scrollbar-thin scrollbar-thumb-slate-700">
                        {stageEventLog.length === 0 ? (
                            <div className="flex h-full items-center justify-center text-slate-600 italic">No events recorded for this session.</div>
                        ) : (
                            stageEventLog.slice().reverse().map((ev, idx) => (
                                <div key={idx} className="flex gap-3 mb-1.5 pb-1.5 border-b border-slate-900 last:border-0 last:mb-0 last:pb-0 hover:bg-slate-900/50 px-2 -mx-2 rounded">
                                    <span className="text-slate-600 shrink-0 select-none w-16">{ev.ts.split('T')[1].split('.')[0]}</span>
                                    <span className="text-blue-500 shrink-0 w-24 text-right">[{ev.stage}]</span>
                                    <span className={`shrink-0 w-16 text-center font-bold ${ev.status === 'success' ? 'text-emerald-500' : ev.status === 'failure' ? 'text-red-500' : 'text-amber-500'}`}>
                                        {ev.status.toUpperCase()}
                                    </span>
                                    <span className="text-slate-300 break-words flex-1">{ev.message || '-'}</span>
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
