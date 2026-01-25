import React, { useMemo } from 'react';

type ArticlePayload = {
  title: string;
  article: string;
  sources: Array<{ id: number; title: string; url: string }>;
  wordCount: number;
};

const ArticlePanel: React.FC<{
  article: ArticlePayload;
  imagePrompt: string;
  noveltyScore: number;
  warnings?: string[];
}> = ({ article, imagePrompt, noveltyScore, warnings }) => {
  const sources = useMemo(() => article.sources ?? [], [article.sources]);

  return (
    <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 shadow">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-200">Article</h2>
          <p className="text-sm text-slate-400 mt-1">
            {article.wordCount} words • novelty score {noveltyScore.toFixed(2)}
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

      {imagePrompt ? (
        <div className="mt-6 border border-slate-800 rounded-lg p-4 bg-slate-950/40">
          <div className="text-sm font-semibold text-slate-200">Image prompt</div>
          <pre className="mt-2 text-sm text-slate-300 whitespace-pre-wrap">{imagePrompt}</pre>
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

