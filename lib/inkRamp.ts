/**
 * @module lib/inkRamp
 * @description The chart palette of the Statistik page (#469, DESIGN.md "Ink ring"): the ink (`--ui-text-highlighted`) at six
 * strengths, darkest = largest. Charts never take a hue; a topic's own hue stays on its mark.
 */

/** Share of the ink per ramp step, step 0 first. */
export const INK_STEPS = [100, 72, 50, 32, 18, 10] as const

/** The CSS colour of a ramp step (clamped to the ramp). */
export function inkColor(step: number): string {
  const index = Math.min(Math.max(Math.trunc(step), 0), INK_STEPS.length - 1)
  const share = INK_STEPS[index]!
  return share === 100 ? 'var(--ui-text-highlighted)' : `color-mix(in srgb, var(--ui-text-highlighted) ${share}%, transparent)`
}
