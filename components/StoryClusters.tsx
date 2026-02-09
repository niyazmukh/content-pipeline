import React from 'react';
import type { StoryCluster } from '../shared/types';
import { Card } from './ui/Card';
import { Badge } from './ui/Badge';

const StoryClusters: React.FC<{ clusters: StoryCluster[] }> = ({ clusters }) => {
  const top = clusters.slice(0, 12);
  return (
    <Card
      title="Story Clusters"
      description={`Top ${top.length} clusters by relevance score`}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {top.map((cluster) => (
          <article
            key={cluster.clusterId}
            className="group relative flex h-full flex-col overflow-hidden rounded-lg border border-slate-800 bg-slate-950/40 p-4 transition hover:bg-slate-950/60"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <Badge variant="neutral" className="font-mono text-[10px]">Score {cluster.score.toFixed(2)}</Badge>
              <div className="font-mono text-[10px] text-slate-500">
                {cluster.members.length + 1} item{cluster.members.length + 1 !== 1 ? 's' : ''}
              </div>
            </div>

            <a
              className="mb-2 line-clamp-3 text-sm font-semibold leading-snug text-slate-100 transition-colors hover:text-blue-300"
              href={cluster.representative.canonicalUrl}
              target="_blank"
              rel="noreferrer"
              title={cluster.representative.title}
            >
              {cluster.representative.title}
            </a>

            <div className="mt-auto mb-3 truncate pt-2 font-mono text-xs text-slate-500">
              {cluster.representative.sourceName ?? cluster.representative.sourceHost}
              {cluster.representative.publishedAt ? ` - ${cluster.representative.publishedAt.split('T')[0]}` : ''}
            </div>

            {cluster.reasons?.length ? (
              <ul className="list-inside list-disc space-y-1 border-t border-slate-800/50 pt-3 text-xs text-slate-400 opacity-70 transition-opacity group-hover:opacity-100">
                {cluster.reasons.slice(0, 2).map((reason, idx) => (
                  <li key={idx} className="line-clamp-1" title={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}
          </article>
        ))}
      </div>
    </Card>
  );
};

export default StoryClusters;
