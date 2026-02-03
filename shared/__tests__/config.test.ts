import { describe, expect, it } from 'vitest';
import { parseRecencyHoursParam } from '../config';

describe('parseRecencyHoursParam', () => {
  it('returns undefined for null or invalid values', () => {
    expect(parseRecencyHoursParam(null, 24)).toBeUndefined();
    expect(parseRecencyHoursParam('abc', 24)).toBeUndefined();
  });

  it('clamps and rounds values', () => {
    expect(parseRecencyHoursParam('5', 24)).toBe(6);
    expect(parseRecencyHoursParam('-10', 24)).toBe(6);
    expect(parseRecencyHoursParam('1000', 24)).toBe(720);
    expect(parseRecencyHoursParam('24.4', 10)).toBe(24);
  });

  it('returns undefined when clamped value equals fallback', () => {
    expect(parseRecencyHoursParam('24', 24)).toBeUndefined();
    expect(parseRecencyHoursParam('24.4', 24)).toBeUndefined();
  });
});
