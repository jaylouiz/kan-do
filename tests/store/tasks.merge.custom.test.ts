/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTasksStore } from '~/store/tasks'
import type { Task } from '~/types/task'
import { TaskStatus } from '~/types/taskStatus'
import { mapHelpers } from '~/utils/mapHelpers'

function makeTask(partial: Partial<Task>): Task {
  // minimal Task shape for the test
  return {
    id: 't',
    title: 'T',
    notes: null,
    status: TaskStatus.Open,
    priority: 1,
    activity: null,
    timeBoxSeconds: null,
    timeSpentSeconds: 0,
    topic: null,
    topicColorCode: null,
    timerId: null,
    source: 'notion',
    externalId: null,
    ...partial,
  }
}

describe('useTasksStore.mergeTasks – preserves timers/timeSpent and applies custom', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('keeps highest local timeSpent and preserves timerId while adopting external custom bag', () => {
    const store = useTasksStore()

    // local existing task (with higher local time and active timer)
    const local: Task = makeTask({
      id: 'A',
      timeSpentSeconds: 500,
      timerId: 123,
    })
    store.replaceTasksWith([local])
    // Simulate pending local update higher than external
    store.addPendingTimeUpdate('A', 700)

    // external task (lower time, has custom bag)
    const external: Task = makeTask({
      id: 'A',
      timeSpentSeconds: 300,
      custom: {
        prio_cat: {
          key: 'prio_cat',
          name: 'Kategorie',
          propType: 'select',
          value: { type: 'select', value: { name: 'A', color: 'red' } },
        },
      },
    } as any)

    store.mergeTasks('notion', [external])

    const merged = store.task('A')!
    expect(merged.timerId).toBe(123) // preserved
    expect(merged.timeSpentSeconds).toBe(700) // highest of pending/local/external
    expect(merged.custom?.prio_cat?.value).toEqual({ type: 'select', value: { name: 'A', color: 'red' } })
    // pending should reflect highest local value
    const pendingUpdate = mapHelpers.get(store.pendingTimeUpdates, 'A')
    expect(pendingUpdate?.timeSpentSeconds).toBe(700)
  })
})
