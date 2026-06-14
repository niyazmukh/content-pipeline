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

const formatPercent = (value: number | undefined): string => `${Math.round((value ?? 0) * 100)}%`;

const warningLabels: Record<string, string> = {
  source_count_below_minimum: 'Too few strong sources',
  topic_anchor_coverage_low: 'Topic coverage is weak',
  provider_diversity_low: 'Provider diversity is low',
  facet_coverage_incomplete: 'Some requested facets are missing',
};

const formatFacetLabel = (value: string): string =>
  value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

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
  const quality = metrics.quality;
  const qualityBadgeVariant = quality?.readyForSynthesis ? 'success' : 'warning';
  const qualityBadgeText = quality?.readyForSynthesis ? 'Ready' : 'Needs Review';
  const diagnosticsJson = JSON.stringify(
    {
      candidateCount: metrics.candidateCount,
      accepted: metrics.accepted,
      duplicatesRemoved: metrics.duplicatesRemoved,
      perProvider,
      extractionErrors,
      quality,
    },
    null,
    2,
  );

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

      {quality && (
        <div className="mb-6 rounded border border-slate-800 bg-slate-950/30 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-slate-200">Source Quality</p>
                <Badge variant={qualityBadgeVariant}>{qualityBadgeText}</Badge>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-400 sm:grid-cols-4">
                <span>Selected: <span className="font-mono text-slate-200">{quality.selectedSourceCount}</span></span>
                <span>Rejected: <span className="font-mono text-slate-200">{quality.rejectedSourceCount}</span></span>
                <span>Providers: <span className="font-mono text-slate-200">{quality.providerCount}</span></span>
                <span>Anchor: <span className="font-mono text-slate-200">{formatPercent(quality.anchorCoverage)}</span></span>
                <span className="col-span-2 sm:col-span-4">
                  Evidence score: <span className="font-mono text-slate-200">{quality.averageEvidenceScore.toFixed(3)}</span>
                </span>
              </div>
            </div>
            {quality.warnings.length > 0 && (
              <div className="flex max-w-xl flex-wrap gap-2">
                {quality.warnings.map((warning) => (
                  <Badge key={warning} variant="warning" title={warning}>
                    {warningLabels[warning] ?? warning}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {Object.keys(quality.facets).length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {Object.entries(quality.facets).map(([facet, count]) => (
                <Badge key={facet} variant={count > 0 ? 'neutral' : 'outline'} title={`${count} selected source(s)`}>
                  {formatFacetLabel(facet)}: {count}
                </Badge>
              ))}
            </div>
          )}

          {quality.rejected.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-xs font-medium text-slate-400 hover:text-slate-200">
                Rejected source reasons
              </summary>
              <ul className="mt-2 space-y-1 text-xs text-slate-500">
                {quality.rejected.slice(0, 6).map((item) => (
                  <li key={item.id} className="truncate" title={`${item.title} - ${item.reasons.join(', ')}`}>
                    <span className="text-slate-300">{item.sourceHost}</span>: {item.reasons.join(', ')}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

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
              const variants = Array.isArray(provider.queryVariants) ? provider.queryVariants : [];
              const usedVariant = variants.find((variant) => variant.used);
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
                    {usedVariant && (
                      <div
                        className="mt-1 text-xs text-emerald-400/70 font-mono truncate max-w-[20rem]"
                        title={usedVariant.query}
                      >
                        Used: {usedVariant.query}
                      </div>
                    )}
                    {variants.length > 1 && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-300">
                          {variants.length} query variants
                        </summary>
                        <ul className="mt-1 space-y-1 text-xs text-slate-500">
                          {variants.map((variant, index) => (
                            <li key={`${provider.provider}-variant-${index}`} className="font-mono truncate max-w-[28rem]" title={variant.query}>
                              {variant.used ? 'used' : 'skip'} raw {variant.rawReturned ?? 0}
                              {typeof variant.afterRecency === 'number' ? ` / recent ${variant.afterRecency}` : ''}
                              {typeof variant.afterPreFilter === 'number' ? ` / kept ${variant.afterPreFilter}` : ''}: {variant.query}
                            </li>
                          ))}
                        </ul>
                      </details>
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

      <details className="mt-6 rounded border border-slate-800 bg-slate-950/40">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-300 hover:text-slate-100">
          Provider diagnostics JSON
        </summary>
        <pre className="max-h-96 overflow-auto border-t border-slate-800 p-4 text-xs leading-relaxed text-slate-400">
          {diagnosticsJson}
        </pre>
      </details>
    </Card>
  );
};

export default RetrievalMetricsPanel;
