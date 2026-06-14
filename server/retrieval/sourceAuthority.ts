/**
 * Source-credibility tiering for retrieval ranking and selection.
 *
 * Goal: strongly prefer globally credible outlets (wire services, quality
 * national/business press, premier technology titles) and primary
 * research/consulting/industry sources (McKinsey, Gartner, S&P, OECD, ...),
 * while penalizing PR wires and known low-quality / SEO "market-report" mills.
 *
 * This is a PREFERENCE + DENYLIST model, NOT a hard allowlist: unknown domains
 * are treated as neutral (tier 3) so niche or regional coverage is not starved.
 * Credibility is judged by outlet reputation, never by country — credible
 * regional outlets (e.g. The Hindu, SCMP) are tier 2, not penalized.
 *
 * Tiers:
 *   1 = premier (top wires, quality press, premier research/consulting)
 *   2 = strong (solid mainstream/business/trade, reputable national/regional)
 *   3 = neutral/unknown (no adjustment)
 *   4 = denied (PR wires, press-release mills, SEO content farms, low-credibility)
 *
 * The sets are intentionally extensible — add domains as needed.
 */

export type SourceTier = 1 | 2 | 3 | 4;

// Premier: wire services, quality global press, finance, premier tech,
// and primary research / consulting / multilateral institutions.
const TIER1 = new Set<string>([
  // Wire services & quality global news
  'reuters.com',
  'apnews.com',
  'bloomberg.com',
  'ft.com',
  'wsj.com',
  'nytimes.com',
  'washingtonpost.com',
  'economist.com',
  'theguardian.com',
  'bbc.com',
  'bbc.co.uk',
  'npr.org',
  'cnbc.com',
  'forbes.com',
  'axios.com',
  'politico.com',
  'theatlantic.com',
  'newyorker.com',
  // Finance / markets
  'finance.yahoo.com',
  'yahoo.com',
  'barrons.com',
  'morningstar.com',
  // Premier technology / science
  'wired.com',
  'arstechnica.com',
  'theverge.com',
  'techcrunch.com',
  'technologyreview.com',
  'nature.com',
  'science.org',
  'ieee.org',
  'spectrum.ieee.org',
  // Primary research, consulting, industry analysts, multilaterals
  'mckinsey.com',
  'bcg.com',
  'bain.com',
  'deloitte.com',
  'pwc.com',
  'kpmg.com',
  'ey.com',
  'accenture.com',
  'kearney.com',
  'oliverwyman.com',
  'rolandberger.com',
  'gartner.com',
  'forrester.com',
  'idc.com',
  'statista.com',
  'hbr.org',
  'spglobal.com',
  'moodys.com',
  'fitchratings.com',
  'nielsen.com',
  'nielseniq.com',
  'mintel.com',
  'euromonitor.com',
  'pitchbook.com',
  'cbinsights.com',
  'pewresearch.org',
  'brookings.edu',
  'rand.org',
  'weforum.org',
  'oecd.org',
  'imf.org',
  'worldbank.org',
]);

// Strong: solid mainstream/business/trade press and reputable
// national/regional outlets.
const TIER2 = new Set<string>([
  'businessinsider.com',
  'fortune.com',
  'fastcompany.com',
  'qz.com',
  'vox.com',
  'time.com',
  'newsweek.com',
  'usatoday.com',
  'thehill.com',
  'marketwatch.com',
  'theinformation.com',
  'semafor.com',
  'crunchbase.com',
  // Technology / trade
  'theregister.com',
  'zdnet.com',
  'venturebeat.com',
  'engadget.com',
  'techradar.com',
  'cnet.com',
  'protocol.com',
  // Industry trade press
  'retaildive.com',
  'supplychaindive.com',
  'industrydive.com',
  'digitalcommerce360.com',
  'modernretail.co',
  'supplychainbrain.com',
  'logisticsmgmt.com',
  'adage.com',
  'adweek.com',
  'marketingdive.com',
  'thedrum.com',
  // Reputable international / national
  'aljazeera.com',
  'dw.com',
  'france24.com',
  'scmp.com',
  'japantimes.co.jp',
  'straitstimes.com',
  'thehindu.com',
  'economictimes.indiatimes.com',
  'livemint.com',
  'business-standard.com',
  'thenationalnews.com',
  'theglobeandmail.com',
  'irishtimes.com',
  'elpais.com',
  'lemonde.fr',
]);

// Denied: PR wires, press-release mills, SEO "market-report" farms, and
// low-credibility outlets. These are penalized in ranking and rejected in
// source selection.
const DENY = new Set<string>([
  // PR / press-release distribution
  'prnewswire.com',
  'globenewswire.com',
  'businesswire.com',
  'prweb.com',
  'einpresswire.com',
  'einnews.com',
  'openpr.com',
  'issuewire.com',
  'prlog.org',
  'abnewswire.com',
  'newswire.com',
  'accesswire.com',
  'prunderground.com',
  'marketersmedia.com',
  'digitaljournal.com',
  'streetinsider.com',
  // SEO "market research" report mills (not primary research)
  'marketresearchfuture.com',
  'mordorintelligence.com',
  'fortunebusinessinsights.com',
  'marknteladvisors.com',
  'verifiedmarketresearch.com',
  'futuremarketinsights.com',
  'alliedmarketresearch.com',
  'globenewswire.io',
  // Low-credibility
  'naturalnews.com',
]);

// Substring/family patterns for denied sources (catches PR/aggregator families
// and obvious SEO-spam hosts not enumerated above).
const DENY_PATTERNS: RegExp[] = [
  /(^|\.)prnewswire\./i,
  /(^|\.)globenewswire\./i,
  /(^|\.)businesswire\./i,
  /(^|\.)einpresswire\./i,
  /(^|\.)einnews\./i,
  /(^|\.)openpr\./i,
  /(^|\.)issuewire\./i,
  /(^|\.)accesswire\./i,
  /(^|\.)prweb\./i,
  /-?pr-?newswire/i,
  /press-?release/i,
];

const TIER1_WEIGHT = 0.25;
const TIER2_WEIGHT = 0.12;
const DENY_WEIGHT = -0.6;

/** Extract a lowercase registrable-ish domain from a URL or hostname. */
export const registrableDomain = (rawUrl: string): string => {
  if (!rawUrl) return '';
  let host = rawUrl;
  try {
    host = new URL(rawUrl).hostname;
  } catch {
    // Maybe a bare hostname was passed.
    host = rawUrl.replace(/^https?:\/\//i, '').split('/')[0] || rawUrl;
  }
  return host.toLowerCase().replace(/^www\./, '');
};

const matchesSet = (domain: string, set: Set<string>): boolean => {
  if (set.has(domain)) return true;
  // Match subdomains (e.g. "edition.cnn.com" -> "cnn.com").
  for (const entry of set) {
    if (domain === entry || domain.endsWith(`.${entry}`)) return true;
  }
  return false;
};

export const isDeniedSource = (rawUrl: string): boolean => {
  const domain = registrableDomain(rawUrl);
  if (!domain) return false;
  if (matchesSet(domain, DENY)) return true;
  return DENY_PATTERNS.some((re) => re.test(domain));
};

export const getSourceTier = (rawUrl: string): SourceTier => {
  const domain = registrableDomain(rawUrl);
  if (!domain) return 3;
  if (isDeniedSource(rawUrl)) return 4;
  if (matchesSet(domain, TIER1)) return 1;
  if (matchesSet(domain, TIER2)) return 2;
  return 3;
};

/**
 * Ranking adjustment for a source's credibility. Positive boosts premier and
 * strong outlets; negative buries denied sources. Neutral (unknown) domains
 * return 0 so they are neither boosted nor penalized.
 */
export const getSourceAuthorityWeight = (rawUrl: string): number => {
  switch (getSourceTier(rawUrl)) {
    case 1:
      return TIER1_WEIGHT;
    case 2:
      return TIER2_WEIGHT;
    case 4:
      return DENY_WEIGHT;
    default:
      return 0;
  }
};
