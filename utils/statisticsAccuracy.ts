/**
 * @module statisticsAccuracy
 * @description Locale-independent classification of estimation accuracy for the statistics views.
 * Verdicts and colours are derived from data only; labels are translated at display time via
 * `statistics.accuracy.<verdict>`.
 */

/** A task counts as finished within its timebox up to this share of the planned time (percent). */
export const IN_TIMEBOX_MAX_ACCURACY = 110;

/** Whether a task was finished within its timebox. */
export type AccuracyVerdict = 'yes' | 'almost' | 'no';

export type VerdictColor = 'success' | 'warning' | 'error';

/**
 * Classifies a completion record.
 * @returns `null` when the task had no timebox (or no accuracy could be computed)
 */
export function getAccuracyVerdict(record: {
  timeBoxSeconds: number | null;
  estimationAccuracy: number | null;
}): AccuracyVerdict | null {
  if (!record.timeBoxSeconds || record.timeBoxSeconds === 0) return null;
  const accuracy = record.estimationAccuracy;
  if (accuracy === null) return null;
  // Yes: done within or slightly over the timebox
  if (accuracy <= IN_TIMEBOX_MAX_ACCURACY) return 'yes';
  // Almost: took a bit longer
  if (accuracy <= 130) return 'almost';
  // No: significantly over the timebox
  return 'no';
}

/** Badge colour for a verdict; `null` (no timebox) is neutral. */
export function getVerdictColor(verdict: AccuracyVerdict | null): VerdictColor | 'neutral' {
  switch (verdict) {
    case 'yes': return 'success';
    case 'almost': return 'warning';
    case 'no': return 'error';
    default: return 'neutral';
  }
}

export type AccuracyTier = 'excellent' | 'good' | 'okay' | 'poor';

/** Tier of an accuracy percentage (100 = perfect estimate); labels via `statistics.accuracyLabel.<tier>`. */
export function getAccuracyTier(accuracy: number): AccuracyTier {
  if (accuracy >= 90 && accuracy <= 110) return 'excellent';
  if (accuracy >= 80 && accuracy <= 120) return 'good';
  if (accuracy >= 70 && accuracy <= 130) return 'okay';
  return 'poor';
}
