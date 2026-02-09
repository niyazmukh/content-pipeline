import { describe, expect, it } from 'vitest';
import { validateArticleBody } from '../validators';

describe('validateArticleBody', () => {
  it('recognizes markdown-styled Key developments headers', () => {
    const article = [
      'Lead paragraph with context [1].',
      '',
      '**Key developments (past 14 days):**',
      '- 2026-02-09 - Example Source - Example headline (https://example.com/news) [1]',
    ].join('\n');

    const result = validateArticleBody(article, {
      minCitations: 0,
      minDistinctCitationIds: 0,
      minNarrativeDates: 0,
      narrativeDatesPolicy: 'off',
      keyDevelopmentsPolicy: 'require',
      paragraphCitationsPolicy: 'off',
      minKeyDevelopmentsBullets: 1,
      maxKeyDevelopmentsBullets: 7,
    });

    expect(result.errors).not.toContain('Missing "Key developments" section.');
  });
});

