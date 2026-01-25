import React from 'react';
import type { StageName } from '../shared/types';

type UiStatus = 'idle' | 'loading' | 'success' | 'error';

export type PipelineStageRow = {
  stage: StageName;
  status: UiStatus;
};

const labelForStage: Record<StageName, string> = {
  retrieval: 'Retrieval',
  ranking: 'Clustering',
  outline: 'Outline',
  targetedResearch: 'Targeted research',
  synthesis: 'Article synthesis',
  imagePrompt: 'Image prompt',
};

const dotClass = (status: UiStatus) => {
  if (status === 'success') return 'bg-emerald-500';
  if (status === 'error') return 'bg-red-500';
  if (status === 'loading') return 'bg-blue-400 animate-pulse';
  return 'bg-slate-700';
};

const PipelineStatus: React.FC<{ stages: PipelineStageRow[] }> = ({ stages }) => (
  <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 shadow">
    <h2 className="text-lg font-semibold text-slate-200">Pipeline status</h2>
    <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-3">
      {stages.map((row) => (
        <div key={row.stage} className="flex items-center gap-3 border border-slate-800 rounded-lg px-3 py-2 bg-slate-950/40">
          <span className={`w-2.5 h-2.5 rounded-full ${dotClass(row.status)}`} />
          <span className="text-sm text-slate-200">{labelForStage[row.stage] ?? row.stage}</span>
        </div>
      ))}
    </div>
  </section>
);

export default PipelineStatus;

