import React, { useState } from 'react';

type IntroModalProps = {
  open: boolean;
  onClose: (opts: { dontShowAgain: boolean }) => void;
};

const IntroModal: React.FC<IntroModalProps> = ({ open, onClose }) => {
  const [dontShowAgain, setDontShowAgain] = useState<boolean>(true);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/70" onClick={() => onClose({ dontShowAgain })} />
      <div className="relative w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl">
        <div className="p-6">
          <h2 className="text-xl font-semibold text-slate-100">Welcome to the Intelligence Pipeline</h2>
          <p className="mt-2 text-sm text-slate-300">
            This app turns a topic into a well-cited article by pulling from multiple sources, clustering the results,
            creating an outline, doing targeted research per outline point, and then synthesizing the final write-up.
          </p>

          <div className="mt-4 space-y-3 text-sm text-slate-300">
            <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
              <p className="font-semibold text-slate-200">How it works</p>
              <ul className="mt-2 list-disc list-inside space-y-1 text-slate-300">
                <li><span className="text-slate-200">Retrieval:</span> fetch candidates from NewsAPI / EventRegistry / Google CSE (if enabled).</li>
                <li><span className="text-slate-200">Extraction:</span> open links, extract article text + metadata, and filter low-quality pages.</li>
                <li><span className="text-slate-200">Clustering:</span> dedupe and group related stories into clusters.</li>
                <li><span className="text-slate-200">Outline:</span> Gemini proposes a thesis and outline from the clusters.</li>
                <li><span className="text-slate-200">Targeted research:</span> for each outline point, the app gathers extra evidence.</li>
                <li><span className="text-slate-200">Synthesis:</span> Gemini writes the article and a sources list.</li>
              </ul>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
              <p className="font-semibold text-slate-200">API keys & quotas</p>
              <p className="mt-2">
                By default, the backend may use shared “default” API keys. Those keys can hit quota limits quickly when multiple users run the pipeline.
                If you plan to run many topics, add your own keys in the <span className="font-semibold">API keys</span> section.
              </p>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
              <p className="font-semibold text-slate-200">Privacy & safety</p>
              <ul className="mt-2 list-disc list-inside space-y-1">
                <li>Your keys are stored in your browser (<span className="font-mono">localStorage</span>) so they survive reopening the page.</li>
                <li>Your keys are sent to the backend as request headers only when you run the pipeline.</li>
                <li>The app is designed to avoid logging or persisting your keys on the server, but any backend can technically see headers while processing.</li>
              </ul>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between gap-4">
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={dontShowAgain}
                onChange={(e) => setDontShowAgain(e.target.checked)}
              />
              Don’t show this again
            </label>
            <button
              type="button"
              onClick={() => onClose({ dontShowAgain })}
              className="inline-flex items-center justify-center h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 transition text-sm font-semibold"
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default IntroModal;

