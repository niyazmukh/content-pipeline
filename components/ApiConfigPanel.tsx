import React from 'react';
import type { ApiKeys } from '../services/apiKeys';
import { Card } from './ui/Card';
import HelpTip from './HelpTip';
import { Button } from './ui/Button';

interface ApiConfigPanelProps {
  apiKeys: ApiKeys;
  setApiKeys: React.Dispatch<React.SetStateAction<ApiKeys>>;
  hasUserKeys: boolean;
  onClearKeys: () => void;
}

const ApiConfigPanel: React.FC<ApiConfigPanelProps> = ({ apiKeys, setApiKeys, hasUserKeys, onClearKeys }) => {
  const [isExpanded, setIsExpanded] = React.useState<boolean>(hasUserKeys);

  React.useEffect(() => {
    if (hasUserKeys) {
      setIsExpanded(true);
    }
  }, [hasUserKeys]);

  return (
    <Card 
        title="API keys" 
        description="Optional: add your own keys to avoid shared backend quotas."
        className="bg-slate-900/60 border-slate-800"
        action={
          <div className="flex items-center gap-2">
            <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setIsExpanded((prev) => !prev)}
                aria-expanded={isExpanded}
            >
                {isExpanded ? 'Hide keys' : 'Show keys'}
            </Button>
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
        }
    >
      {!isExpanded ? (
        <div className="text-xs text-slate-400">
          API key fields are hidden. Expand to manage your personal keys.
        </div>
      ) : (
        <>
      <div className="mb-4 text-xs text-slate-400 flex items-center gap-2">
        <span>{hasUserKeys ? 'Using your personal API keys.' : 'Using the default backend configuration (if available).'}</span>
        <HelpTip label="Keys are saved in your browser and included as request headers when you run the pipeline. Shared backend keys can run out of quota if many users run the app." />
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1.5">Gemini API key <span className="text-slate-500">(required)</span></label>
          <input
            type="password"
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
            value={apiKeys.geminiApiKey}
            onChange={(event) => setApiKeys((prev) => ({ ...prev, geminiApiKey: event.target.value }))}
            placeholder="paste key here..."
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1.5">Gemini RPM <span className="text-slate-500">(optional)</span></label>
          <input
            type="number"
            min={1}
            max={10}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
            value={apiKeys.geminiRpm}
            onChange={(event) => setApiKeys((prev) => ({ ...prev, geminiRpm: event.target.value }))}
            placeholder="default"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1.5">Google CSE API key</label>
          <input
            type="password"
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
            value={apiKeys.googleCseApiKey}
            onChange={(event) => setApiKeys((prev) => ({ ...prev, googleCseApiKey: event.target.value }))}
            placeholder="optional"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1.5">Google CSE Search Engine ID (cx)</label>
          <input
            type="text"
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
            value={apiKeys.googleCseCx}
            onChange={(event) => setApiKeys((prev) => ({ ...prev, googleCseCx: event.target.value }))}
            placeholder="optional"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1.5">NewsAPI key</label>
          <input
            type="password"
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
            value={apiKeys.newsApiKey}
            onChange={(event) => setApiKeys((prev) => ({ ...prev, newsApiKey: event.target.value }))}
            placeholder="optional"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1.5">EventRegistry key</label>
          <input
            type="password"
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
            value={apiKeys.eventRegistryApiKey}
            onChange={(event) => setApiKeys((prev) => ({ ...prev, eventRegistryApiKey: event.target.value }))}
            placeholder="optional"
          />
        </div>
      </div>

      <div className="mt-8 border-t border-slate-800 pt-6">
        <details className="group">
           <summary className="text-sm font-medium text-slate-400 hover:text-slate-200 cursor-pointer select-none flex items-center gap-2">
               <svg className="w-4 h-4 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
               How to get API keys
           </summary>
           <div className="mt-4 pl-6 text-sm text-slate-400 space-y-4">
                <p>
                  Leave all fields blank to use the default backend keys (if configured). Your personal keys are saved in your browser and sent with requests.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-slate-950/40 p-3 rounded border border-slate-800/50"> 
                        <div className="text-xs uppercase tracking-wide text-blue-400 font-bold mb-2">Gemini</div>
                        <ol className="list-decimal list-inside space-y-1 text-xs">
                            <li>Go to <a className="text-blue-400 hover:underline" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">AI Studio</a></li>
                            <li>Create API key</li>
                            <li>Paste into "Gemini API key"</li>
                        </ol>
                    </div>

                    <div className="bg-slate-950/40 p-3 rounded border border-slate-800/50"> 
                        <div className="text-xs uppercase tracking-wide text-emerald-400 font-bold mb-2">NewsAPI</div>
                        <ol className="list-decimal list-inside space-y-1 text-xs">
                            <li>Register at <a className="text-blue-400 hover:underline" href="https://newsapi.org/register" target="_blank" rel="noreferrer">newsapi.org</a></li>
                            <li>Copy key from dashboard</li>
                            <li>Paste into "NewsAPI key"</li>
                        </ol>
                    </div>

                     <div className="bg-slate-950/40 p-3 rounded border border-slate-800/50"> 
                        <div className="text-xs uppercase tracking-wide text-purple-400 font-bold mb-2">EventRegistry</div>
                        <ol className="list-decimal list-inside space-y-1 text-xs">
                            <li>Register at <a className="text-blue-400 hover:underline" href="https://eventregistry.org/register" target="_blank" rel="noreferrer">eventregistry.org</a></li>
                            <li>Find API key in profile</li>
                            <li>Paste into "EventRegistry key"</li>
                        </ol>
                    </div>

                     <div className="bg-slate-950/40 p-3 rounded border border-slate-800/50"> 
                        <div className="text-xs uppercase tracking-wide text-orange-400 font-bold mb-2">Google CSE</div>
                        <ol className="list-decimal list-inside space-y-1 text-xs">
                            <li>Create engine at <a className="text-blue-400 hover:underline" href="https://programmablesearchengine.google.com/" target="_blank" rel="noreferrer">CSE</a></li>
                            <li>Get "Search Engine ID" (cx)</li>
                            <li>Get "Custom Search API" key from Cloud Console</li>
                        </ol>
                    </div>
                </div>
           </div>
        </details>
      </div>
        </>
      )}
    </Card>
  );
};

export default ApiConfigPanel;
