import { describe, expect, it } from 'vitest';
import { normalizeImagePromptPreferences } from '../imagePrompt';

describe('normalizeImagePromptPreferences', () => {
  it('accepts known image prompt preferences', () => {
    expect(
      normalizeImagePromptPreferences({
        focus: 'infographic',
        style: 'isometric_3d',
        detailLevel: 'high_precision',
      }),
    ).toEqual({
      focus: 'infographic',
      style: 'isometric_3d',
      detailLevel: 'high_precision',
    });
  });

  it('falls back safely for unknown or malformed preferences', () => {
    expect(
      normalizeImagePromptPreferences({
        focus: 'sales_deck',
        style: '<script>',
        detailLevel: 9000,
      }),
    ).toEqual({
      focus: 'automatic',
      style: 'editorial',
      detailLevel: 'balanced',
    });
  });
});
