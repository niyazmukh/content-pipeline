import { describe, expect, it } from 'vitest';
import { isEditorialValidationError, validateArticleBody, validatePromotionPolicy } from '../validators';

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

describe('validatePromotionPolicy', () => {
  it('returns a single actionable error for repeated promotional phrases', () => {
    const errors = validatePromotionPolicy(
      'Buy now to get started. Request a demo to learn more. Subscribe now for updates.',
    );

    expect(errors).toEqual(['Avoid promotional or call-to-action language; keep the tone analytical and reportorial.']);
  });

  it('classifies promotion-policy failures as editorial validation issues', () => {
    expect(
      isEditorialValidationError('Avoid promotional or call-to-action language; keep the tone analytical and reportorial.'),
    ).toBe(true);
    expect(isEditorialValidationError('Article references citation IDs not in Source Catalog: 99')).toBe(false);
  });
});

