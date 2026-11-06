/**
 * @module lib/demoIds
 * @description Id convention of the demo board (#527, #536). Kept apart from `lib/demo-board.ts` (seed data) so that
 * stores can recognise demo tasks without depending on the sample data: `demo-board` and `demo-statistics-history`
 * build ids with {@link demoTaskId}, `store/taskStatistics` asks {@link isDemoTaskId}.
 */

/** Every demo task id starts with this; see {@link isDemoTaskId}. */
export const DEMO_ID_PREFIX = 'demo-'

/**
 * Whether a task is one of the demo board's. The statistics backfill skips these: the sample completions of the
 * onboarding button must not become permanent statistics (#527). `?seed=demo` writes the completion records itself,
 * so developers still get statistics data.
 */
export const isDemoTaskId = (id: string): boolean => id.startsWith(DEMO_ID_PREFIX)

/** A fresh, short token that tells one load of the demo board from another (#536). */
export const newDemoLoadId = (): string => Math.random().toString(36).slice(2, 8).padEnd(6, '0')

/** `demo-<loadId>-<key>`: unique per load, so a second load never meets the archive, trash or statistics of the first. */
export const demoTaskId = (loadId: string, key: string): string => `${DEMO_ID_PREFIX}${loadId}-${key}`
