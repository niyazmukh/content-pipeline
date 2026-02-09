import React from 'react';
import type { EvidenceItem } from '../shared/types';
import { Card } from './ui/Card';

const EvidencePanel: React.FC<{ evidence: EvidenceItem[] }> = ({ evidence }) => (
  <Card
    title="Evidence & Citations"
    description="Collected evidence per outline point"
  >
    <div className="space-y-6">
      {evidence.map((item) => (
        <div key={item.outlineIndex} className="relative pl-6 border-l-2 border-slate-800 hover:border-blue-500/50 transition-colors">
          <div className="absolute -left-[5px] top-0 w-2.5 h-2.5 rounded-full bg-slate-800 ring-4 ring-slate-950" />
          
          <h3 className="font-semibold text-slate-100 mb-2 text-lg">
            <span className="text-slate-500 mr-2 text-base font-normal">{item.outlineIndex + 1}.</span>
            {item.point}
          </h3>
          
          <div className="bg-slate-950/30 rounded-lg p-4 border border-slate-800/50">
            <pre className="text-sm text-slate-300 whitespace-pre-wrap font-sans leading-relaxed">{item.digest}</pre>
            
            {item.citations.length > 0 && (
              <div className="mt-4 pt-3 border-t border-slate-800/50">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Citations</div>
                <div className="space-y-1">
                  {item.citations.slice(0, 6).map((c) => (
                    <div key={c.id} className="text-sm truncate">
                      <span className="text-slate-500 font-mono text-xs mr-2">[{c.id}]</span>
                      <a className="text-blue-400 hover:text-blue-300 hover:underline" href={c.url} target="_blank" rel="noreferrer">
                        {c.title}
                      </a>{' '}
                      <span className="text-slate-500 text-xs">({c.source})</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  </Card>
);

export default EvidencePanel;
