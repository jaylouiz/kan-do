/**
 * @module store
 * @description Calls tasks-store actions in the running app, to simulate a sync that changes the
 * board while the user interacts with it (a task added, re-grouped, re-statused or removed).
 * Dev server only: it reaches Pinia through `window.useNuxtApp()`.
 */

import type { Page } from '@playwright/test'
import type { SeedTask } from './seed'

type TaskAction =
  | { action: 'addTask'; args: [Partial<SeedTask> & Pick<SeedTask, 'id' | 'title' | 'status'>] }
  | { action: 'updateTask'; args: [string, Record<string, unknown>] }
  | { action: 'removeTask'; args: [string] }

export async function callTasksStore(page: Page, call: TaskAction): Promise<void> {
  await page.evaluate(({ action, args }) => {
    const app = (window as unknown as { useNuxtApp: () => { $pinia: { _s: Map<string, Record<string, (...a: unknown[]) => unknown>> } } }).useNuxtApp()
    app.$pinia._s.get('tasks')![action]!(...args)
  }, call)
}

/**
 * A minimal task as the app expects it (fields the seed leaves out get neutral values). Every stored task has a
 * `source` and an `externalId` (ADR 015): a task without them counts as a second source on a Local board and
 * crashes the card footer's source icon (#323, #322).
 */
export function fullTask(task: Partial<SeedTask> & Pick<SeedTask, 'id' | 'title' | 'status'>) {
  return {
    source: 'local' as const,
    externalId: null,
    activity: null,
    topic: null,
    topicColorCode: null,
    priority: 1,
    notes: null,
    timeBoxSeconds: null,
    timeSpentSeconds: 0,
    timerId: null,
    custom: {},
    ...task,
  }
}
