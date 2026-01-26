import React, { useMemo } from 'react';
import type { ImagePromptSlide } from '../shared/types';

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
    <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 shadow">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-200" title="Final output synthesized by Gemini from outline + clusters + evidence.">
            Article
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            {article.wordCount} words - novelty score {noveltyScore.toFixed(2)}
          </p>
        </div>
      </div>

      {warnings?.length ? (
        <div className="mt-4 border border-amber-800/50 bg-amber-950/30 rounded-lg p-3 text-sm text-amber-200">
          <div className="font-semibold">Warnings</div>
          <ul className="mt-2 list-disc list-inside space-y-1">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <h3 className="mt-5 text-xl font-bold text-slate-100">{article.title}</h3>
      <pre className="mt-4 whitespace-pre-wrap text-slate-200 leading-relaxed">{article.article}</pre>

      {imagePrompts.length ? (
        <div className="mt-6 border border-slate-800 rounded-lg p-4 bg-slate-950/40 space-y-3">
          <div className="text-sm font-semibold text-slate-200">Image prompts ({imagePrompts.length} slide{imagePrompts.length === 1 ? '' : 's'})</div>
          {imagePrompts.map((slide, idx) => (
            <div key={`${slide.title}-${idx}`} className="border border-slate-800 rounded-lg p-3 bg-slate-950/30">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold text-slate-100">
                  Slide {idx + 1}: {slide.title}
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full border border-slate-700 bg-slate-950/60 text-slate-300 uppercase tracking-wide">
                  {slide.visualStrategy}
                </span>
              </div>
              {slide.layout ? (
                <div className="mt-2 text-xs text-slate-400">
                  <span className="text-slate-500">Layout:</span> {slide.layout}
                </div>
              ) : null}
              {slide.overlayText?.length ? (
                <div className="mt-2 text-xs text-slate-400">
                  <span className="text-slate-500">Overlay text:</span> {slide.overlayText.join(' • ')}
                </div>
              ) : null}
              <pre className="mt-3 text-sm text-slate-200 whitespace-pre-wrap">{slide.prompt}</pre>
              {slide.negativePrompt ? (
                <div className="mt-2 text-xs text-slate-400">
                  <span className="text-slate-500">Negatives:</span> {slide.negativePrompt}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {sources.length > 0 ? (
        <div className="mt-6">
          <div className="text-sm font-semibold text-slate-200">Sources</div>
          <ol className="mt-2 list-decimal list-inside space-y-1 text-sm text-slate-300">
            {sources.map((s) => (
              <li key={s.id}>
                <a className="text-blue-300 hover:text-blue-200" href={s.url} target="_blank" rel="noreferrer">
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
};

export default ArticlePanel;
