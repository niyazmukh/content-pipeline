export interface QueryExclusions {
  excludeTerms?: string[];
  excludeEntities?: string[];
  excludeLocations?: string[];
}

const normalizeList = (values: string[] | undefined): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values ?? []) {
    const clean = String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
};

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const phrasePattern = (value: string): RegExp => {
  const body = value.split(/\s+/).map(escapeRegex).join('\\s+');
  return new RegExp(`(^|[^a-z0-9])${body}([^a-z0-9]|$)`, 'i');
};

const hostMatchesLocation = (host: string, location: string): boolean => {
  const normalizedHost = host.toLowerCase();
  const normalizedLocation = location.toLowerCase();
  if ((normalizedLocation === 'india' || normalizedLocation === 'indian') && normalizedHost.endsWith('.in')) {
    return true;
  }
  if (
    (normalizedLocation === 'united kingdom' || normalizedLocation === 'uk' || normalizedLocation === 'britain') &&
    normalizedHost.endsWith('.uk')
  ) {
    return true;
  }
  return false;
};

const locationAliases = (location: string): string[] => {
  const clean = location.toLowerCase();
  if (clean === 'india') return ['india', 'indian'];
  if (clean === 'united states' || clean === 'usa' || clean === 'us') return ['united states', 'usa', 'u.s.', 'american'];
  if (clean === 'united kingdom' || clean === 'uk') return ['united kingdom', 'uk', 'u.k.', 'british'];
  return [clean];
};

export const firstMatchingExclusion = (
  text: string,
  host: string | null | undefined,
  exclusions: QueryExclusions = {},
): string | null => {
  const haystack = text.toLowerCase();
  for (const entity of normalizeList(exclusions.excludeEntities)) {
    if (phrasePattern(entity).test(haystack)) return 'excluded_entity';
  }
  for (const location of normalizeList(exclusions.excludeLocations)) {
    if (host && hostMatchesLocation(host, location)) return 'excluded_location';
    if (locationAliases(location).some((alias) => phrasePattern(alias).test(haystack))) return 'excluded_location';
  }
  for (const term of normalizeList(exclusions.excludeTerms)) {
    if (phrasePattern(term).test(haystack)) return 'excluded_term';
  }
  return null;
};
