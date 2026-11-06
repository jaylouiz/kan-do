import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTasksStore } from '~/store/tasks'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

const makeTask = (status: TaskStatus): Task => ({
  id: 't1', source: 'local', externalId: null, title: 'Task', status, activity: null, topic: null, topicColorCode: null,
  priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null,
})

describe('tasks store: status locks (owner tokens)', () => {
  let tasksStore: ReturnType<typeof useTasksStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    tasksStore = useTasksStore()
    tasksStore.addTask(makeTask(TaskStatus.Open))
  })

  /** What a sync refresh does: upstream still says Done */
  const mergeUpstreamDone = () => {
    tasksStore.mergeTasks('local', [makeTask(TaskStatus.Done)])
    return tasksStore.task('t1')!.status
  }

  it('pins the status against a merge until the owner unlocks', () => {
    const lock = tasksStore.lockTaskStatus('t1')
    expect(mergeUpstreamDone()).toBe(TaskStatus.Open)

    tasksStore.unlockTaskStatus('t1', lock)
    expect(mergeUpstreamDone()).toBe(TaskStatus.Done)
  })

  it('an older owner finishing first does not release a newer owner\'s lock', () => {
    const first = tasksStore.lockTaskStatus('t1') // e.g. the completion write
    const second = tasksStore.lockTaskStatus('t1') // e.g. the undo write

    tasksStore.unlockTaskStatus('t1', first)
    expect(mergeUpstreamDone()).toBe(TaskStatus.Open)

    tasksStore.unlockTaskStatus('t1', second)
    expect(mergeUpstreamDone()).toBe(TaskStatus.Done)
  })

  it('the newest lock pins its own snapshot', () => {
    const first = tasksStore.lockTaskStatus('t1')
    tasksStore.updateTask('t1', { status: TaskStatus.Waiting })
    tasksStore.lockTaskStatus('t1')

    expect(mergeUpstreamDone()).toBe(TaskStatus.Waiting)
    tasksStore.unlockTaskStatus('t1', first)
    expect(mergeUpstreamDone()).toBe(TaskStatus.Waiting)
  })

  it('unlocking twice, or with a token that never locked anything, is harmless', () => {
    const lock = tasksStore.lockTaskStatus('t1')
    tasksStore.unlockTaskStatus('t1', lock)
    const next = tasksStore.lockTaskStatus('t1')
    tasksStore.unlockTaskStatus('t1', lock) // stale token
    tasksStore.unlockTaskStatus('t1', null)

    expect(mergeUpstreamDone()).toBe(TaskStatus.Open)
    tasksStore.unlockTaskStatus('t1', next)
  })

  it('locking an unknown task pins nothing and returns no token', () => {
    expect(tasksStore.lockTaskStatus('gone')).toBeNull()
  })
})
