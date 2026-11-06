/**
 * @module timeboxProgress
 * @description Colour and label rules for timebox progress: the ring in the task sheet's time stats and the
 * card's progress chip in Jetzt (#388, which never passes `isDone`: a done card shows a grey chip, "done teal"
 * lives only in the sheet ring).
 * Overrun is attention (warning/orange), never raspberry (destructive only, see DESIGN.md);
 * finished tasks carry no escalation, only the done teal (#124).
 */

export type TimeboxRingColor = 'success' | 'primary' | 'warning';

/**
 * Semantic colour of the timebox ring.
 * @param percentage Spent share of the timebox, 0-100 (clamped upstream)
 * @param isDone Task is finished; the ring is a teal record, not a warning
 */
export function getTimeboxRingColor(percentage: number, isDone = false): TimeboxRingColor {
  if (isDone) return 'success';
  if (percentage > 80) return 'warning';
  return 'primary';
}

/** Smallest arc (percent) drawn for a running timer so the ring never collapses to a dot. */
export const RUNNING_MIN_ARC_PERCENT = 4;

/** True when the elapsed label should read "<1 min" instead of a rounded "0 min". */
export function isUnderOneMinute(seconds: number): boolean {
  return seconds > 0 && seconds < 60;
}
