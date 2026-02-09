import React from 'react';
import type { ApiKeys } from '../services/apiKeys';
import { Card } from './ui/Card';
import { Badge } from './ui/Badge';
import HelpTip from './HelpTip';
import { Button } from './ui/Button';

interface ApiConfigPanelProps {
  apiKeys: ApiKeys;
  setApiKeys: React.Dispatch<React.SetStateAction<ApiKeys>>;
  hasUserKeys: boolean;
  onClearKeys: () => void;
}

const ApiConfigPanel: React.FC<ApiConfigPanelProps> = ({ apiKeys, setApiKeys, hasUserKeys, onClearKeys }) => {
  const [isOpen, setIsOpen] = React.useState<boolean>(hasUserKeys);

  React.useEffect(() => {
    if (hasUserKeys) {
      setIsOpen(true);
    }
  }, [hasUserKeys]);

  return (
    <Card className="border-slate-800 bg-slate-900/60 p-0">
      <button
        type="button"
        className="flex w-full items-center justify-between p-6 text-left select-none hover:bg-slate-900/80 transition-colors"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-controls="api-config-content"
      >
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-slate-200">API keys</h2>
          <div className="flex gap-2">
            {hasUserKeys ? (
              <Badge variant="default" className="py-0.5">User Keys</Badge>
            ) : (
              <Badge variant="outline" className="py-0.5">Default Backend</Badge>
            )}
            <span className="py-1 text-xs text-slate-500">Optional override for backend quotas</span>
          </div>
        </div>
        <svg
          className={`h-5 w-5 text-slate-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div id="api-config-content" className="space-y-6 border-t border-slate-800 px-6 pb-6 pt-6 text-sm text-slate-300">
          <div className="mb-1 flex items-start justify-between gap-4">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span>{hasUserKeys ? 'Using your personal API keys.' : 'Using the default backend configuration (if available).'}</span>
              <HelpTip label="Keys are saved in your browser and included as request headers when you run the pipeline. Shared backend keys can run out of quota if many users run the app." />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onClearKeys();
              }}
              title="Clears locally stored keys (browser localStorage)."
              disabled={!hasUserKeys}
            >
              Clear keys
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">Gemini API key <span className="text-slate-500">(required)</span></label>
              <input
                type="password"
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                value={apiKeys.geminiApiKey}
                onChange={(event) => setApiKeys((prev) => ({ ...prev, geminiApiKey: event.target.value }))}
                placeholder="paste key here..."
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">Gemini RPM <span className="text-slate-500">(optional)</span></label>
              <input
                type="number"
                min={1}
                max={10}
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                value={apiKeys.geminiRpm}
                onChange={(event) => setApiKeys((prev) => ({ ...prev, geminiRpm: event.target.value }))}
                placeholder="default"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">Google CSE API key</label>
              <input
                type="password"
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                value={apiKeys.googleCseApiKey}
                onChange={(event) => setApiKeys((prev) => ({ ...prev, googleCseApiKey: event.target.value }))}
                placeholder="optional"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">Google CSE Search Engine ID (cx)</label>
              <input
                type="text"
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                value={apiKeys.googleCseCx}
                onChange={(event) => setApiKeys((prev) => ({ ...prev, googleCseCx: event.target.value }))}
                placeholder="optional"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">NewsAPI key</label>
              <input
                type="password"
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                value={apiKeys.newsApiKey}
                onChange={(event) => setApiKeys((prev) => ({ ...prev, newsApiKey: event.target.value }))}
                placeholder="optional"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">EventRegistry key</label>
              <input
                type="password"
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                value={apiKeys.eventRegistryApiKey}
                onChange={(event) => setApiKeys((prev) => ({ ...prev, eventRegistryApiKey: event.target.value }))}
                placeholder="optional"
              />
            </div>
          </div>

          <div className="border-t border-slate-800 pt-6">
            <details className="group">
              <summary className="flex cursor-pointer select-none items-center gap-2 text-sm font-medium text-slate-400 hover:text-slate-200">
                <svg className="h-4 w-4 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                How to get API keys
              </summary>
              <div className="mt-4 space-y-4 pl-6 text-sm text-slate-400">
                <p>
                  Leave all fields blank to use the default backend keys (if configured). Your personal keys are saved in your browser and sent with requests.
                </p>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="rounded border border-slate-800/50 bg-slate-950/40 p-3">
                    <div className="mb-2 text-xs font-bold uppercase tracking-wide text-blue-400">Gemini</div>
                    <ol className="list-inside list-decimal space-y-1 text-xs">
                      <li>Go to <a className="text-blue-400 hover:underline" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">AI Studio</a></li>
                      <li>Create API key</li>
                      <li>Paste into "Gemini API key"</li>
                    </ol>
                  </div>

                  <div className="rounded border border-slate-800/50 bg-slate-950/40 p-3">
                    <div className="mb-2 text-xs font-bold uppercase tracking-wide text-emerald-400">NewsAPI</div>
                    <ol className="list-inside list-decimal space-y-1 text-xs">
                      <li>Register at <a className="text-blue-400 hover:underline" href="https://newsapi.org/register" target="_blank" rel="noreferrer">newsapi.org</a></li>
                      <li>Copy key from dashboard</li>
                      <li>Paste into "NewsAPI key"</li>
                    </ol>
                  </div>

                  <div className="rounded border border-slate-800/50 bg-slate-950/40 p-3">
                    <div className="mb-2 text-xs font-bold uppercase tracking-wide text-purple-400">EventRegistry</div>
                    <ol className="list-inside list-decimal space-y-1 text-xs">
                      <li>Register at <a className="text-blue-400 hover:underline" href="https://eventregistry.org/register" target="_blank" rel="noreferrer">eventregistry.org</a></li>
                      <li>Find API key in profile</li>
                      <li>Paste into "EventRegistry key"</li>
                    </ol>
                  </div>

                  <div className="rounded border border-slate-800/50 bg-slate-950/40 p-3">
                    <div className="mb-2 text-xs font-bold uppercase tracking-wide text-orange-400">Google CSE</div>
                    <ol className="list-inside list-decimal space-y-1 text-xs">
                      <li>Create engine at <a className="text-blue-400 hover:underline" href="https://programmablesearchengine.google.com/" target="_blank" rel="noreferrer">CSE</a></li>
                      <li>Get "Search Engine ID" (cx)</li>
                      <li>Get "Custom Search API" key from Cloud Console</li>
                    </ol>
                  </div>
                </div>
              </div>
            </details>
          </div>
        </div>
      )}
    </Card>
  );
};

export default ApiConfigPanel;
