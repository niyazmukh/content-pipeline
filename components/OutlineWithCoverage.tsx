import React from 'react';
import type { OutlinePayload } from '../shared/types';

const OutlineWithCoverage: React.FC<{ outline: OutlinePayload }> = ({ outline }) => (
  <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 shadow">
    <h2 className="text-lg font-semibold text-slate-200" title="Thesis + outline proposed by Gemini from the clustered sources.">
      Outline
    </h2>
    <p className="text-sm text-slate-400 mt-1">{outline.thesis}</p>
    <ol className="mt-4 space-y-3 list-decimal list-inside text-slate-200">
      {outline.outline.map((p, idx) => (
        <li key={idx} className="border border-slate-800 rounded-lg p-3 bg-slate-950/40">
          <div className="font-medium">{p.point}</div>
          {p.summary ? <div className="text-sm text-slate-400 mt-1">{p.summary}</div> : null}
        </li>
      ))}
    </ol>
    {outline.coverage?.coverageRatio != null ? (
      <div className="mt-4 text-xs text-slate-400">
        Coverage: {(outline.coverage.coverageRatio * 100).toFixed(0)}%
      </div>
    ) : null}
  </section>
);

export default OutlineWithCoverage;
