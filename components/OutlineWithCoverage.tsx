import React from 'react';
import type { OutlinePayload } from '../shared/types';
import { Card } from './ui/Card';
import { Badge } from './ui/Badge';

const OutlineWithCoverage: React.FC<{ outline: OutlinePayload }> = ({ outline }) => (
  <Card
    title="Outline"
    description={outline.thesis}
    footer={
        outline.coverage?.coverageRatio != null && (
            <div className="flex items-center justify-end">
                <Badge variant={outline.coverage.coverageRatio > 0.7 ? 'success' : 'warning'}>
                    Coverage {(outline.coverage.coverageRatio * 100).toFixed(0)}%
                </Badge>
            </div>
        )
    }
  >
    <div className="space-y-4 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-800 before:to-transparent">
        {outline.outline.map((p, idx) => (
          <div key={idx} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
            <div className="flex items-center justify-center w-10 h-10 rounded-full border border-slate-800 bg-slate-950 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10 text-slate-400 font-mono text-sm">
                {idx + 1}
            </div>
            <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-xl border border-slate-800 bg-slate-900/40 shadow-sm">
                <div className="font-semibold text-slate-200 text-sm">{p.point}</div>
                {p.summary ? <div className="text-xs text-slate-400 mt-2 leading-relaxed">{p.summary}</div> : null}
            </div>
          </div>
        ))}
    </div>
  </Card>
);

export default OutlineWithCoverage;
