import { describe, expect, it } from 'vitest';
import { getTimeboxRingColor, isUnderOneMinute } from '~/utils/timeboxProgress';

describe('getTimeboxRingColor', () => {
  it.each([
    [0, 'primary'],
    [50, 'primary'],
    [80, 'primary'],
    [81, 'warning'],
    [100, 'warning'],
  ])('maps %i%% to %s', (pct, color) => {
    expect(getTimeboxRingColor(pct)).toBe(color);
  });

  it('never returns error (raspberry) at or beyond 100%', () => {
    for (const pct of [100, 150, 1000]) expect(getTimeboxRingColor(pct)).not.toBe('error');
  });

  it('is the done teal on done cards regardless of overrun (#124)', () => {
    for (const pct of [0, 90, 100, 200]) expect(getTimeboxRingColor(pct, true)).toBe('success');
  });
});

describe('isUnderOneMinute', () => {
  it('flags only elapsed values between 0 and 60 seconds', () => {
    expect(isUnderOneMinute(0)).toBe(false);
    expect(isUnderOneMinute(1)).toBe(true);
    expect(isUnderOneMinute(59)).toBe(true);
    expect(isUnderOneMinute(60)).toBe(false);
  });
});
