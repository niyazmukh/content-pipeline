import { describe, expect, it } from 'vitest';
import { assertGenerateContentFinished } from '../genai';

describe('assertGenerateContentFinished', () => {
  it('throws on MAX_TOKENS even when a partial text part exists', () => {
    expect(() =>
      assertGenerateContentFinished({
        candidates: [
          {
            finishReason: 'MAX_TOKENS',
            content: { parts: [{ text: '{"article":"truncated' }] },
          },
        ],
      }),
    ).toThrow(/MAX_TOKENS/i);
  });

  it('allows normal STOP responses', () => {
    expect(() =>
      assertGenerateContentFinished({
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"ok":true}' }] } }],
      }),
    ).not.toThrow();
  });
});
