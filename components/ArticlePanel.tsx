import React, { useMemo } from 'react';
import type { ImagePromptSlide } from '../shared/types';
import { Card } from './ui/Card';

type ArticlePayload = {
  title: string;
  article: string;
  sources: Array<{ id: number; title: string; url: string }>;
  wordCount: number;
};

const ArticlePanel: React.FC<{
  article: ArticlePayload;
  imagePrompts: ImagePromptSlide[];
  noveltyScore: number;
  warnings?: string[];
}> = ({ article, imagePrompts, noveltyScore, warnings }) => {
  const sources = useMemo(() => article.sources ?? [], [article.sources]);

  return (
    <Card
      title="Article"
      description={`${article.wordCount} words - novelty score ${noveltyScore.toFixed(2)}`}
      className="border-slate-800/80 bg-slate-900/40 ring-1 ring-white/5" // Subtle highlight for the final result
      footer={
        sources.length > 0 && (
            <div className="space-y-2">
                <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold flex items-center gap-2">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                    Cited Sources
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                    {sources.map(s => (
                        <a key={s.id} href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center px-2 py-1 bg-slate-800 rounded border border-slate-700 text-blue-400 hover:text-blue-300 hover:border-blue-800 hover:bg-slate-800/80 transition">
                            <span className="opacity-50 mr-1.5 font-mono">[{s.id}]</span> {s.title}
                        </a>
                    ))}
                </div>
            </div>
        )
      }
    >
      {warnings?.length ? (
        <div className="mb-6 p-4 border border-amber-900/50 bg-amber-950/20 rounded-lg">
          <div className="font-semibold text-amber-500 flex items-center gap-2 text-sm">
             <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
             Warnings during generation
          </div>
          <ul className="mt-2 list-disc list-inside space-y-1 text-amber-200/80 text-xs pl-1">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="max-w-none">
          <h1 className="text-2xl md:text-3xl font-bold text-white mb-6 leading-tight tracking-tight">{article.title}</h1>
          <div className="space-y-4 text-slate-300 leading-relaxed font-serif text-lg">
            {article.article.split('\n\n').map((para, i) => {
                if (!para.trim()) return null;
                return <p key={i}>{para}</p>;
            })}
          </div>
      </div>

      {imagePrompts.length > 0 && (
        <div className="mt-10 pt-6 border-t border-slate-800/60">
          <div className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <svg className="w-4 h-4 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            Suggested Image Prompts ({imagePrompts.length})
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {imagePrompts.map((slide, idx) => (
                <div key={`${slide.title}-${idx}`} className="group relative border border-slate-800 rounded-lg p-4 bg-slate-950/40 hover:bg-slate-950/60 transition overflow-hidden">
                    <div className="absolute top-0 right-0 p-2 opacity-50 text-[10px] font-mono text-slate-500">#{idx + 1}</div>
                    <div className="font-medium text-slate-200 text-sm mb-2 pr-6">{slide.title}</div>
                    <div className="text-xs text-slate-400 italic bg-black/20 p-2 rounded border border-white/5">"{slide.prompt}"</div>
                </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
};

export default ArticlePanel;
