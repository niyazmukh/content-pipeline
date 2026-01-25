export const buildExcerpt = (value: string | null | undefined, maxLength = 600): string => {
  if (!value) return '';
  const normalized = String(value).replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
};

export const describeRecencyWindow = (hours: number): string => {
  if (!Number.isFinite(hours) || hours <= 0) {
    return 'the configured recency window';
  }
  const roundedHours = Math.round(hours);
  const days = roundedHours / 24;
  if (Number.isInteger(days)) {
    return `${days} day${days === 1 ? '' : 's'} (${roundedHours} hours)`;
  }
  const dayLabel = Number(days.toFixed(1)).toString().replace(/\.0$/, '');
  return `${dayLabel} days (${roundedHours} hours)`;
};

export const tokenize = (text: string): Set<string> => {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 3),
  );
};

export const computeSimilarity = (text1: string, text2: string): number => {
  const t1 = tokenize(text1);
  const t2 = tokenize(text2);
  if (!t1.size || !t2.size) return 0;

  let intersection = 0;
  for (const token of t1) {
    if (t2.has(token)) intersection++;
  }

  // Jaccard similarity
  const union = t1.size + t2.size - intersection;
  return union === 0 ? 0 : intersection / union;
};
