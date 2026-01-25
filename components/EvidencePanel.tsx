import React from 'react';
import type { EvidenceItem } from '../shared/types';

const EvidencePanel: React.FC<{ evidence: EvidenceItem[] }> = ({ evidence }) => (
  <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 shadow">
    <h2 className="text-lg font-semibold text-slate-200" title="Evidence is collected per outline point and includes citations used later for synthesis.">
      Evidence
    </h2>
    <div className="mt-4 space-y-4">
      {evidence.map((item) => (
        <article key={item.outlineIndex} className="border border-slate-800 rounded-lg p-4 bg-slate-950/40">
          <div className="font-semibold text-slate-100">
            {item.outlineIndex + 1}. {item.point}
          </div>
          <pre className="mt-3 text-sm text-slate-300 whitespace-pre-wrap">{item.digest}</pre>
          {item.citations.length > 0 ? (
            <div className="mt-3 text-sm text-slate-300">
              <div className="text-xs uppercase tracking-wide text-slate-400">Citations</div>
              <ul className="mt-2 space-y-1">
                {item.citations.slice(0, 6).map((c) => (
                  <li key={c.id}>
                    [{c.id}]{' '}
                    <a className="text-blue-300 hover:text-blue-200" href={c.url} target="_blank" rel="noreferrer">
                      {c.title}
                    </a>{' '}
                    <span className="text-slate-400">({c.source})</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  </section>
);

export default EvidencePanel;
