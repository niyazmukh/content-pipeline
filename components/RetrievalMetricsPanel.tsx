import React from 'react';
import type { RetrievalMetrics, RetrievalProviderMetrics } from '../shared/types';
import { Card } from './ui/Card';
import { Badge } from './ui/Badge';

interface RetrievalMetricsPanelProps {
  metrics: RetrievalMetrics | null;
}

const providerLabels: Record<RetrievalProviderMetrics['provider'], string> = {
  google: 'Google CSE',
  googlenews: 'Google News (RSS)',
  newsapi: 'NewsAPI',
  eventregistry: 'EventRegistry',
};

const formatReasonCounts = (reasons: Record<string, number> | undefined): string => {
  if (!reasons) return '';
  const entries = Object.entries(reasons).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '';
  const head = entries
    .slice(0, 3)
    .map(([k, v]) => `${k}x${v}`)
    .join(', ');
  return entries.length > 3 ? `${head}, ...` : head;
};

const computeUnique = (provider: RetrievalProviderMetrics): number =>
  provider.unique ?? Math.max(0, provider.returned - (provider.deduped ?? 0));

const computeSkipped = (provider: RetrievalProviderMetrics): number =>
  provider.skipped ?? Math.max(0, computeUnique(provider) - (provider.queued ?? provider.extractionAttempts));

const StatBox: React.FC<{ label: string; value: number }> = ({ label, value }) => (
    <div className="flex flex-col items-center justify-center p-3 rounded bg-slate-800/50 border border-slate-700/50">
        <div className="text-2xl font-bold text-slate-100">{value}</div>
        <div className="text-xs uppercase tracking-wider text-slate-400 font-medium">{label}</div>
    </div>
);

const RetrievalMetricsPanel: React.FC<RetrievalMetricsPanelProps> = ({ metrics }) => {
  if (!metrics) {
    return null;
  }

  const connectorOrder: RetrievalProviderMetrics['provider'][] = ['google', 'googlenews', 'newsapi', 'eventregistry'];
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
    <Card 
        title="Retrieval Metrics" 
        className="border-slate-800 bg-slate-900/40"
        footer={
             <div className="flex flex-col sm:flex-row justify-between text-xs text-slate-500 gap-2">
                <div className="space-x-4">
                  <span>Candidates: {metrics.candidateCount}</span>
                  <span>Accepted: {metrics.accepted}</span>
                  <span>Dupes Removed: {metrics.duplicatesRemoved}</span>
                </div>
                 <div className="flex gap-4">
                    <span>Newest: {metrics.newestArticleHours != null ? `${metrics.newestArticleHours}h ago` : 'n/a'}</span>
                    <span>Oldest: {metrics.oldestArticleHours != null ? `${metrics.oldestArticleHours}h ago` : 'n/a'}</span>
                </div>
            </div>
        }
    >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            <StatBox label="Total Returned" value={displayedReturned} />
            <StatBox label="Extraction Attempts" value={displayedAttempts} />
            <StatBox label="Accepted" value={displayedAccepted} />
        </div>

      <div className="overflow-x-auto -mx-6 px-6 pb-2">
        <table className="min-w-full text-sm text-left text-slate-300">
          <thead className="text-xs uppercase tracking-wide text-slate-500 border-b border-slate-800">
            <tr>
              <th className="px-3 py-3 font-medium">Provider</th>
              <th className="px-3 py-3 font-medium text-right">Returned</th>
              <th className="px-3 py-3 font-medium text-right">Unique</th>
              <th className="px-3 py-3 font-medium text-right">Skipped</th>
              <th className="px-3 py-3 font-medium text-right">Rejected</th>
              <th className="px-3 py-3 font-medium text-right">Attempts</th>
              <th className="px-3 py-3 font-medium text-right">Accepted</th>
              <th className="px-3 py-3 font-medium text-right">No Date</th>
              <th className="px-3 py-3 font-medium text-right">Errors</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {perProvider.map((provider) => {
              const providerErrorCount = Array.isArray(provider.extractionErrors) ? provider.extractionErrors.length : 0;
              const rejectionSummary = formatReasonCounts(provider.rejectionReasons);
              const unique = computeUnique(provider);
              const skipped = computeSkipped(provider);
              return (
                <tr key={provider.provider} className="group hover:bg-slate-800/30 transition-colors">
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-200">{providerLabels[provider.provider]}</span>
                      {provider.disabled && (
                        <Badge variant="outline">Disabled</Badge>
                      )}
                      {provider.failed && (
                        <Badge variant="error">Failed</Badge>
                      )}
                    </div>
                    {provider.query && (
                      <div className="mt-1 text-xs text-slate-500 font-mono truncate max-w-[20rem]" title={provider.query}>
                        {provider.query}
                      </div>
                    )}
                    {rejectionSummary && (
                      <div className="mt-1 text-xs text-orange-400/70 truncate max-w-[20rem]" title={rejectionSummary}>
                        Rejected: {rejectionSummary}
                      </div>
                    )}
                    {provider.error && (
                      <div className="mt-1 text-xs text-red-400 truncate max-w-[20rem]" title={provider.error}>
                        {provider.error}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-slate-400">{provider.returned}</td>
                  <td className="px-3 py-3 text-right font-mono text-slate-400" title={`Deduped: ${provider.deduped ?? 0}`}>
                    {unique}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-slate-400">{skipped}</td>
                  <td className="px-3 py-3 text-right font-mono text-slate-400">{provider.preFiltered}</td>
                  <td className="px-3 py-3 text-right font-mono text-slate-400">{provider.extractionAttempts}</td>
                  <td className="px-3 py-3 text-right font-mono text-emerald-400 font-bold">{provider.accepted}</td>
                  <td className="px-3 py-3 text-right font-mono text-slate-500">{provider.missingPublishedAt}</td>
                  <td className="px-3 py-3 text-right font-mono text-slate-500">{providerErrorCount}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      
      {hasErrors && (
        <div className="mt-6 p-4 rounded bg-red-950/20 border border-red-900/30">
          <p className="font-medium text-red-200 text-sm mb-2">Extraction Errors</p>
          <ul className="space-y-1 text-xs font-mono">
            {extractionErrors.slice(0, 5).map((error, index) => (
              <li key={`${error.provider}-${index}`} className="text-red-300/80 break-all">
                <span className="uppercase text-red-400 font-bold mr-2">{error.provider}</span>
                {error.error} <span className="text-slate-500">({error.url})</span>
              </li>
            ))}
            {extractionErrors.length > 5 && <li className="text-slate-500 italic">+{extractionErrors.length - 5} more</li>}
          </ul>
        </div>
      )}
    </Card>
  );
};

export default RetrievalMetricsPanel;
