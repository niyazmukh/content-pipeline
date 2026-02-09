import React from 'react';
import type { StageName } from '../shared/types';
import { Card } from './ui/Card';

type UiStatus = 'idle' | 'loading' | 'success' | 'error';

export type PipelineStageRow = {
  stage: StageName;
  status: UiStatus;
  detail?: string;
};

const labelForStage: Record<StageName, string> = {
  retrieval: 'Retrieval',
  ranking: 'Clustering',
  outline: 'Outline',
  targetedResearch: 'Research',
  synthesis: 'Synthesis',
  imagePrompt: 'Imagery',
};

const tooltipForStage: Record<StageName, string> = {
  retrieval: 'Fetches candidates from enabled sources, opens links, extracts text/metadata, and filters low-quality pages.',
  ranking: 'Deduplicates, ranks, and clusters related stories to avoid repeating the same source.',
  outline: 'Uses Gemini to draft a thesis + outline based on the retrieved clusters.',
  targetedResearch: 'For each outline point, gathers extra evidence (more queries + extraction) to strengthen citations.',
  synthesis: 'Uses Gemini to write the final article from the outline, clusters, and evidence.',
  imagePrompt: 'Generates a short image prompt for the article (optional).',
};

const PipelineStatus: React.FC<{ stages: PipelineStageRow[] }> = ({ stages }) => {
  return (
    <Card className="p-0 overflow-hidden bg-slate-900 border-slate-800">
      <div className="flex flex-col md:flex-row w-full divide-y md:divide-y-0 md:divide-x divide-slate-800">
        {stages.map((row, idx) => {
          const isActive = row.status === 'loading';
          const isDone = row.status === 'success';
          const isError = row.status === 'error';
          
          return (
            <div 
                key={row.stage} 
                className={`flex-1 p-4 relative group transition-colors ${isActive ? 'bg-blue-950/20' : ''} ${isDone ? 'bg-slate-950/40' : ''}`}
                title={tooltipForStage[row.stage]}
            >
               {isActive && (
                 <div className="absolute inset-x-0 bottom-0 h-0.5 bg-blue-500 animate-pulse shadow-[0_0_10px_rgba(59,130,246,0.5)]"></div>
               )}
               {isDone && (
                  <div className="absolute inset-x-0 bottom-0 h-0.5 bg-emerald-500/50"></div>
               )}
               {isError && (
                  <div className="absolute inset-x-0 bottom-0 h-0.5 bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]"></div>
               )}

               <div className="flex items-center gap-3 mb-1">
                  <div className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold border transition-colors ${
                      isDone 
                        ? 'bg-emerald-900/40 border-emerald-500/50 text-emerald-400' 
                        : isActive 
                            ? 'bg-blue-900/40 border-blue-500/50 text-blue-400 ring-4 ring-blue-500/10' 
                            : isError 
                                ? 'bg-red-900/40 border-red-500/50 text-red-400'
                                : 'bg-slate-800 border-slate-700 text-slate-500'
                  }`}>
                      {isDone ? (
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                      ) : (
                          <span>{idx + 1}</span>
                      )}
                  </div>
                  <span className={`text-sm font-medium ${isActive ? 'text-blue-200' : isDone ? 'text-slate-200' : 'text-slate-500'}`}>
                      {labelForStage[row.stage]}
                  </span>
               </div>
               
               <div className="pl-9 min-h-[1.25rem]">
                   {row.status === 'loading' && (
                       <div className="text-xs text-blue-400 animate-pulse font-medium">Running...</div>
                   )}
                   {row.detail && (
                       <div className="text-xs text-slate-400 truncate font-mono" title={row.detail}>{row.detail}</div>
                   )}
               </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
};

export default PipelineStatus;
