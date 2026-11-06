import { describe, it, expect } from 'vitest';
import { getAccuracyTier, getAccuracyVerdict, getVerdictColor } from '~/utils/statisticsAccuracy';

describe('statisticsAccuracy', () => {
  it('classifies verdicts from data', () => {
    expect(getAccuracyVerdict({ timeBoxSeconds: 600, estimationAccuracy: 110 })).toBe('yes');
    expect(getAccuracyVerdict({ timeBoxSeconds: 600, estimationAccuracy: 111 })).toBe('almost');
    expect(getAccuracyVerdict({ timeBoxSeconds: 600, estimationAccuracy: 130 })).toBe('almost');
    expect(getAccuracyVerdict({ timeBoxSeconds: 600, estimationAccuracy: 131 })).toBe('no');
    expect(getAccuracyVerdict({ timeBoxSeconds: null, estimationAccuracy: 90 })).toBeNull();
    expect(getAccuracyVerdict({ timeBoxSeconds: 0, estimationAccuracy: 90 })).toBeNull();
    expect(getAccuracyVerdict({ timeBoxSeconds: 600, estimationAccuracy: null })).toBeNull();
  });

  it('derives colours from the verdict', () => {
    expect(getVerdictColor('yes')).toBe('success');
    expect(getVerdictColor('almost')).toBe('warning');
    expect(getVerdictColor('no')).toBe('error');
    expect(getVerdictColor(null)).toBe('neutral');
  });

  it('derives accuracy tiers', () => {
    expect(getAccuracyTier(100)).toBe('excellent');
    expect(getAccuracyTier(85)).toBe('good');
    expect(getAccuracyTier(75)).toBe('okay');
    expect(getAccuracyTier(40)).toBe('poor');
  });
});
