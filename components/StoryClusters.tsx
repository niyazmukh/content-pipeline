import React from 'react';
import type { OutlinePayload, StoryCluster } from '../shared/types';

const StoryClusters: React.FC<{ clusters: StoryCluster[]; outline: OutlinePayload | null }> = ({ clusters }) => {
  const top = clusters.slice(0, 12);
  return (
    <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 shadow">
      <h2 className="text-lg font-semibold text-slate-200">Story clusters</h2>
      <p className="text-sm text-slate-400 mt-1">Top {top.length} clusters (by score).</p>
      <div className="mt-4 space-y-3">
        {top.map((cluster) => (
          <article key={cluster.clusterId} className="border border-slate-800 rounded-lg p-4 bg-slate-950/40">
            <div className="flex items-start justify-between gap-3">
              <div>
                <a
                  className="text-slate-100 hover:text-blue-300 font-semibold"
                  href={cluster.representative.canonicalUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {cluster.representative.title}
                </a>
                <div className="text-xs text-slate-400 mt-1">
                  {cluster.representative.sourceName ?? cluster.representative.sourceHost}
                  {cluster.representative.publishedAt ? ` • ${cluster.representative.publishedAt.split('T')[0]}` : ''}
                  {` • ${cluster.members.length + 1} articles`}
                </div>
              </div>
              <div className="text-xs text-slate-400 whitespace-nowrap">
                score {cluster.score.toFixed(2)}
              </div>
            </div>
            {cluster.reasons?.length ? (
              <ul className="mt-3 text-sm text-slate-300 list-disc list-inside space-y-1">
                {cluster.reasons.slice(0, 4).map((r, idx) => (
                  <li key={idx}>{r}</li>
                ))}
              </ul>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
};

export default StoryClusters;

