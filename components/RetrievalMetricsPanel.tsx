import React from 'react';
import type { RetrievalMetrics, RetrievalProviderMetrics } from '../shared/types';

interface RetrievalMetricsPanelProps {
  metrics: RetrievalMetrics | null;
}

const providerLabels: Record<RetrievalProviderMetrics['provider'], string> = {
  google: 'Google CSE',
  newsapi: 'NewsAPI',
  eventregistry: 'EventRegistry',
};

const RetrievalMetricsPanel: React.FC<RetrievalMetricsPanelProps> = ({ metrics }) => {
  if (!metrics) {
    return null;
  }

  const connectorOrder: RetrievalProviderMetrics['provider'][] = ['google', 'newsapi', 'eventregistry'];
  const providedMetrics: RetrievalProviderMetrics[] = Array.isArray(metrics.perProvider)
    ? (metrics.perProvider as RetrievalProviderMetrics[])
    : [];
  const providerLookup = new Map<RetrievalProviderMetrics['provider'], RetrievalProviderMetrics>(
    providedMetrics.map((entry) => [entry.provider, entry]),
  );
  const perProvider: RetrievalProviderMetrics[] = connectorOrder.map((provider) => {
    const fallback: RetrievalProviderMetrics = {
      provider,
      returned: 0,
      preFiltered: 0,
      extractionAttempts: 0,
      accepted: 0,
      missingPublishedAt: 0,
      extractionErrors: [],
    };
    return providerLookup.get(provider) ?? fallback;
  });

  const extractionErrors = Array.isArray(metrics.extractionErrors) ? metrics.extractionErrors : [];
  const hasErrors = extractionErrors.length > 0;
  const totalReturned = perProvider.reduce((sum, provider) => sum + provider.returned, 0);
  const totalAccepted = perProvider.reduce((sum, provider) => sum + provider.accepted, 0);
  const totalAttempts = perProvider.reduce((sum, provider) => sum + provider.extractionAttempts, 0);
  const displayedReturned = totalReturned || metrics.candidateCount;
  const displayedAttempts = totalAttempts || metrics.attemptedExtractions;
  const displayedAccepted = totalAccepted || metrics.accepted;

  return (
    <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 shadow">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-200">Retrieval metrics</h2>
          <p className="text-sm text-slate-400">
            Candidates {metrics.candidateCount} | Accepted {metrics.accepted} | Duplicates removed {metrics.duplicatesRemoved}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Returned counts are connector candidates; extraction attempts depend on the global extraction budget and may be 0 if a provider is skipped.
          </p>
        </div>
        <div className="text-xs text-slate-400 text-right leading-tight">
          <p>Newest article age: {metrics.newestArticleHours != null ? `${metrics.newestArticleHours}h` : 'n/a'}</p>
          <p>Oldest article age: {metrics.oldestArticleHours != null ? `${metrics.oldestArticleHours}h` : 'n/a'}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-3 mb-4 text-xs text-slate-300">
        <div className="px-3 py-2 rounded-lg border border-slate-700 bg-slate-950/50">
          <p className="font-semibold text-slate-200 uppercase tracking-wide">Total returned</p>
          <p className="text-lg font-bold text-slate-100">{displayedReturned}</p>
        </div>
        <div className="px-3 py-2 rounded-lg border border-slate-700 bg-slate-950/50">
          <p className="font-semibold text-slate-200 uppercase tracking-wide">Extraction attempts</p>
          <p className="text-lg font-bold text-slate-100">{displayedAttempts}</p>
        </div>
        <div className="px-3 py-2 rounded-lg border border-slate-700 bg-slate-950/50">
          <p className="font-semibold text-slate-200 uppercase tracking-wide">Accepted</p>
          <p className="text-lg font-bold text-slate-100">{displayedAccepted}</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm text-left text-slate-300">
          <thead className="text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-3 py-2 font-medium">Provider</th>
              <th className="px-3 py-2 font-medium text-right">Returned</th>
              <th className="px-3 py-2 font-medium text-right">Pre-filtered</th>
              <th className="px-3 py-2 font-medium text-right">Extraction attempts</th>
              <th className="px-3 py-2 font-medium text-right">Accepted</th>
              <th className="px-3 py-2 font-medium text-right">Missing dates</th>
              <th className="px-3 py-2 font-medium text-right">Errors</th>
            </tr>
          </thead>
          <tbody>
            {perProvider.map((provider) => {
              const providerErrorCount = Array.isArray(provider.extractionErrors) ? provider.extractionErrors.length : 0;
              return (
                <tr key={provider.provider} className="border-t border-slate-800">
                  <th scope="row" className="px-3 py-2 font-semibold text-slate-200">
                    <div className="flex items-center gap-2">
                      <span>{providerLabels[provider.provider]}</span>
                      {provider.disabled && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full border border-slate-700 bg-slate-950/60 text-slate-400 uppercase tracking-wide">
                          disabled
                        </span>
                      )}
                      {provider.failed && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full border border-red-900/60 bg-red-950/40 text-red-300 uppercase tracking-wide">
                          failed
                        </span>
                      )}
                    </div>
                    {provider.query && (
                      <div
                        className="mt-1 text-xs text-slate-500 font-normal truncate max-w-[28rem]"
                        title={provider.query}
                      >
                        {provider.query}
                      </div>
                    )}
                    {provider.error && (
                      <div className="mt-1 text-xs text-red-300 font-normal truncate max-w-[28rem]" title={provider.error}>
                        {provider.error}
                      </div>
                    )}
                  </th>
                  <td className="px-3 py-2 text-right">{provider.returned}</td>
                  <td className="px-3 py-2 text-right">{provider.preFiltered}</td>
                  <td className="px-3 py-2 text-right">{provider.extractionAttempts}</td>
                  <td className="px-3 py-2 text-right">{provider.accepted}</td>
                  <td className="px-3 py-2 text-right">{provider.missingPublishedAt}</td>
                  <td className="px-3 py-2 text-right">{providerErrorCount}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hasErrors && (
        <div className="mt-4 text-xs text-red-300">
          <p className="font-semibold mb-1">Extraction errors</p>
          <ul className="space-y-1">
            {extractionErrors.slice(0, 5).map((error, index) => (
              <li key={`${error.provider}-${index}`}>
                <span className="uppercase text-slate-400">{error.provider}</span>: {error.error} ({error.url})
              </li>
            ))}
            {extractionErrors.length > 5 && (
              <li className="text-slate-400">
                +{extractionErrors.length - 5} more
              </li>
            )}
          </ul>
        </div>
      )}
    </section>
  );
};

export default RetrievalMetricsPanel;
