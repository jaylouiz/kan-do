import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useArchiveDoneTasks } from '~/composables/useArchiveDoneTasks'
import { useTasksStore } from '~/store/tasks'
import { toastAddMock } from '../mocks/nuxt-imports'
import { setTestLocale } from '../helpers/i18n'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

const syncArchiveStatusForTasks = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('~/composables/useTaskSync', () => ({ useTaskSync: () => ({ syncArchiveStatusForTasks }) }))
vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({ syncExistingDoneTasks: vi.fn(), updateTaskRecord: vi.fn() }),
}))

const doneTask = (id: string): Task => ({
  id, source: 'local', externalId: null, title: id, status: TaskStatus.Done, activity: null, topic: null, topicColorCode: null,
  priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, completedAt: new Date(2026, 0, 1),
})

describe('useArchiveDoneTasks', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    toastAddMock.mockClear()
    syncArchiveStatusForTasks.mockClear()
    setTestLocale('de')
  })

  it('archives and syncs the status upstream, without a toast (#463)', () => {
    const store = useTasksStore()
    store.tasks = [doneTask('a'), doneTask('b')]
    useArchiveDoneTasks().archiveTasks(['a', 'b'])

    expect(store.archivedTaskIds).toEqual(['a', 'b'])
    expect(syncArchiveStatusForTasks).toHaveBeenCalledWith(['a', 'b'])
    expect(toastAddMock).not.toHaveBeenCalled()
  })

  it('archives in several rounds, each synced once and none toasted', () => {
    const store = useTasksStore()
    store.tasks = [doneTask('a'), doneTask('b')]
    const { archiveTasks } = useArchiveDoneTasks()

    archiveTasks(['a'])
    archiveTasks(['b'])
    expect(store.archivedTaskIds).toEqual(['a', 'b'])
    expect(syncArchiveStatusForTasks).toHaveBeenCalledTimes(2)
    expect(syncArchiveStatusForTasks).toHaveBeenNthCalledWith(1, ['a'])
    expect(syncArchiveStatusForTasks).toHaveBeenNthCalledWith(2, ['b'])
    expect(toastAddMock).not.toHaveBeenCalled()
  })

  it('does nothing for an empty list', () => {
    useArchiveDoneTasks().archiveTasks([])
    expect(toastAddMock).not.toHaveBeenCalled()
    expect(syncArchiveStatusForTasks).not.toHaveBeenCalled()
  })
})
