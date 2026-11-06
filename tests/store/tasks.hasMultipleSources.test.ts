import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

function task(id: string, source: Task['source']): Task {
  return {
    id, source, externalId: source === 'local' ? null : id, title: id, status: TaskStatus.Open, priority: 1,
    activity: null, topic: null, topicColorCode: null, notes: null, timeBoxSeconds: 0, timeSpentSeconds: 0, timerId: null,
  }
}

describe('tasks store: hasMultipleSources (#323)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('is false for an empty board and for one source', () => {
    const tasks = useTasksStore()
    expect(tasks.hasMultipleSources).toBe(false)
    tasks.addTask(task('a', 'notion'))
    tasks.addTask(task('b', 'notion'))
    expect(tasks.hasMultipleSources).toBe(false)
  })

  it('is true once two sources hold tasks, and false again when one runs out (a sequence)', () => {
    const tasks = useTasksStore()
    tasks.addTask(task('a', 'notion'))
    tasks.addTask(task('b', 'local'))
    expect(tasks.hasMultipleSources).toBe(true)
    tasks.removeTask('b')
    expect(tasks.hasMultipleSources).toBe(false)
  })

  it('derives from the tasks, not from the connected sources', () => {
    const tasks = useTasksStore()
    useBoardStore().setSources({ connected: ['notion'], default: 'notion' })
    tasks.addTask(task('a', 'local'))
    expect(tasks.hasMultipleSources).toBe(false)
  })

  it('does not count a missing or unknown source as a second source (#360)', () => {
    const tasks = useTasksStore()
    tasks.addTask(task('a', 'local'))
    tasks.addTask({ ...task('b', 'local'), source: undefined } as unknown as Task)
    tasks.addTask({ ...task('c', 'local'), source: 'bogus' } as unknown as Task)
    expect(tasks.hasMultipleSources).toBe(false)
    tasks.addTask(task('d', 'notion'))
    expect(tasks.hasMultipleSources).toBe(true)
  })
})
