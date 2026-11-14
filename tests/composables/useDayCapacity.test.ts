/**
 * #132: with a topic focus on, the capacity line counts the same scope as the list it sits in, so Wartet cards of
 * hidden topics do not use up the day. Real Pinia stores.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import type { ColumnItem } from '~/types/columnItem'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useDayCapacity } from '~/composables/useDayCapacity'
import { sourceOf } from '../helpers/taskSource'

const makeTask = (id: string, status: TaskStatus, topic: string | null): Task => ({
  id, ...sourceOf(id), title: id, status, activity: null, topic, topicColorCode: null, priority: 0, notes: null,
  timeSpentSeconds: 0, timeBoxSeconds: 3600, timerId: null,
})

describe('useDayCapacity with a topic focus', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('does not count Wartet cards of other topics', () => {
    const tasks = useTasksStore()
    // 5 h of Wartet in topic B, two 1 h Offen cards in topic A; the default day is 6 h
    for (let i = 0; i < 5; i++) tasks.addTask(makeTask(`w${i}`, TaskStatus.Waiting, 'B'))
    useBoardStore().reconcileColumnsWithTasks(tasks.tasks)
    const items = ['o1', 'o2'].map((id): ColumnItem => ({ kind: 'card', key: id, task: makeTask(id, TaskStatus.Open, 'A') }) as ColumnItem)
    const { lineAfterKey } = useDayCapacity(items, true)
    expect(lineAfterKey.value).toBe('o1') // unfocused: 5 h + 1 h fills the day after o1
    useBoardStore().setFocus('A')
    expect(lineAfterKey.value).toBeNull() // focused on A: 2 h of 6 h
  })
})
