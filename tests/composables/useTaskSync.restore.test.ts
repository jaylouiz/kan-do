/**
 * #422: restoring a task from the trash through `useTaskSync.restoreTask`. Sequences, not single calls: the source
 * restores first and the board changes in one step after it, a failure leaves the entry in the trash and nothing
 * on the board, a fetch that started before the restore neither drops nor duplicates the task, a cancelled
 * queued delete never reaches the source, and the app `id` survives a Todoist re-create.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import type { SourceId } from '~/types/taskSource'
import type { TaskSourceAdapter } from '~/integrations/sources/types'

const handleErrorMock = vi.fn()
vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: handleErrorMock, handleSuccess: vi.fn() }),
}))
const statistics = { recordTaskCompletion: vi.fn(), removeTaskRecord: vi.fn(), updateTaskRecord: vi.fn(), syncExistingDoneTasks: vi.fn(), removeDiscardedTime: vi.fn() }
vi.mock('~/store/taskStatistics', () => ({ useTaskStatisticsStore: () => statistics }))

const calls: string[] = []
const adapters = {} as Record<SourceId, ReturnType<typeof fakeAdapter>>

function fakeAdapter(id: SourceId) {
  return {
    id,
    syncsTime: id === 'notion',
    isConfigured: () => true,
    fetchActive: vi.fn(async () => [] as Task[]),
    create: vi.fn(async (draft: Partial<Task>) => draft as Task),
    update: vi.fn(async (task: Task): Promise<Task | null> => { calls.push(`update:${id}:${task.externalId}:${task.status}`); return null }),
    remove: vi.fn(async (task: Task) => { calls.push(`remove:${id}:${task.externalId}`) }),
    restore: vi.fn(async (task: Task): Promise<Task> => {
      calls.push(`restore:${id}:${task.externalId}:${task.status}`)
      // Todoist re-creates under a new id, Notion un-archives the same page
      return id === 'todoist' ? { ...task, externalId: 'td-new' } : task
    }),
    archivesAsStatus: () => false,
    health: () => 'healthy' as const,
  } satisfies TaskSourceAdapter
}
vi.mock('~/composables/useTaskSources', () => ({ useTaskSources: () => ({ adapterFor: (id: SourceId) => adapters[id] }) }))

/* eslint-disable import/first -- order-sensitive: mocks must be registered before the SUT is imported */
import { useTaskSync } from '~/composables/useTaskSync'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useTrashStore } from '~/store/trash'
import { useTrash } from '~/composables/useTrash'
import { mapHelpers } from '~/utils/mapHelpers'
/* eslint-enable import/first */

const makeTask = (overrides: Partial<Task> & Pick<Task, 'id'>): Task => {
  const source = overrides.source ?? 'local'
  return {
    title: `Task ${overrides.id}`, notes: 'notes', status: TaskStatus.Open, priority: 2, activity: null, timeBoxSeconds: 600,
    timeSpentSeconds: 120, topic: 'Büro', topicColorCode: null, timerId: null, source,
    externalId: source === 'local' ? null : overrides.id, createdAt: new Date('2026-01-01T00:00:00Z'), ...overrides,
  }
}

describe('useTaskSync: restoring from the trash (#422)', () => {
  let tasksStore: ReturnType<typeof useTasksStore>
  let trash: ReturnType<typeof useTrashStore>

  /** What the delete flow leaves behind once its window closed and the commit ran */
  const trashed = (task: Task, fromStatus = task.status) => {
    tasksStore.removeTask(task.id)
    trash.add({ taskId: task.id, task, deletedAt: Date.now(), fromStatus, carryOver: { days: 2, keptAtDays: 0, lastSeenDay: '2026-10-30' } as never })
  }

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    calls.length = 0
    handleErrorMock.mockReset()
    for (const id of ['local', 'notion', 'todoist'] as const) adapters[id] = fakeAdapter(id)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    useBoardStore().setSources({ connected: ['notion', 'todoist'], default: 'local' })
    tasksStore = useTasksStore()
    trash = useTrashStore()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  })

  it('Local: re-adds the task with its id and fields at the end of its old column, and the entry goes', async () => {
    const waiting = makeTask({ id: 'w', status: TaskStatus.Waiting })
    tasksStore.setTasks([waiting, makeTask({ id: 'x', status: TaskStatus.Waiting })])
    useBoardStore().reconcileColumnsWithTasks(tasksStore.tasks)
    trashed(waiting)
    expect(tasksStore.deletedTaskIds).toContain('w')

    await useTaskSync().restoreTask(trash.entry('w')!)

    expect(tasksStore.task('w')).toMatchObject({ id: 'w', status: TaskStatus.Waiting, notes: 'notes', topic: 'Büro', timeSpentSeconds: 120, timeBoxSeconds: 600 })
    expect(tasksStore.deletedTaskIds).not.toContain('w')
    expect(useBoardStore().columnByTaskStatus(TaskStatus.Waiting)?.taskOrder.at(-1)).toBe('w')
    expect(mapHelpers.get(tasksStore.carryOverByTaskId, 'w')?.days).toBe(2)
    expect(trash.entry('w')).toBeUndefined()
    expect(calls).toEqual([`restore:local:null:${TaskStatus.Waiting}`])
  })

  it('a restore takes the task\'s discarded time out of the statistics (#537)', async () => {
    const task = makeTask({ id: 'disc' })
    trashed(task)
    await useTaskSync().restoreTask(trash.entry('disc')!)
    expect(statistics.removeDiscardedTime).toHaveBeenCalledWith('disc')
  })

  it('Offen (status 0): the restored card goes to the end of the column, not back to its old index', async () => {
    const open = makeTask({ id: 'o', status: TaskStatus.Open })
    tasksStore.setTasks([open, makeTask({ id: 'p', status: TaskStatus.Open }), makeTask({ id: 'q', status: TaskStatus.Open })])
    useBoardStore().reconcileColumnsWithTasks(tasksStore.tasks)
    trashed(open)
    expect(useBoardStore().columnByTaskStatus(TaskStatus.Open)?.taskOrder).toEqual(['o', 'p', 'q'])

    await useTaskSync().restoreTask(trash.entry('o')!)

    expect(useBoardStore().columnByTaskStatus(TaskStatus.Open)?.taskOrder).toEqual(['p', 'q', 'o'])
  })

  it('a task from Jetzt returns to Offen, also when Jetzt is empty', async () => {
    const running = makeTask({ id: 'r', status: TaskStatus.Progress })
    tasksStore.setTasks([running])
    trashed(running)

    await useTaskSync().restoreTask(trash.entry('r')!)

    expect(tasksStore.task('r')?.status).toBe(TaskStatus.Open)
    expect(useBoardStore().columnByTaskStatus(TaskStatus.Open)?.taskOrder).toContain('r')
    expect(useBoardStore().columnByTaskStatus(TaskStatus.Progress)?.taskOrder).not.toContain('r')
  })

  it('Notion: un-archives the same page (externalId unchanged), source first, then the board', async () => {
    const page = makeTask({ id: 'n1', source: 'notion', status: TaskStatus.Waiting })
    tasksStore.setTasks([page])
    trashed(page)

    let boardDuringRestore: Task | null = tasksStore.task('n1')
    adapters.notion.restore.mockImplementationOnce(async (task: Task) => { boardDuringRestore = tasksStore.task('n1'); calls.push('restore:notion'); return task })
    await useTaskSync().restoreTask(trash.entry('n1')!)

    expect(boardDuringRestore).toBeNull()
    expect(tasksStore.task('n1')).toMatchObject({ id: 'n1', externalId: 'n1', source: 'notion' })
    expect(calls).toEqual(['restore:notion'])
  })

  it('Todoist: a new externalId, the app id stays', async () => {
    const td = makeTask({ id: 'td-old', source: 'todoist' })
    tasksStore.setTasks([td])
    trashed(td)

    await useTaskSync().restoreTask(trash.entry('td-old')!)

    expect(tasksStore.task('td-old')).toMatchObject({ id: 'td-old', externalId: 'td-new', source: 'todoist' })
    expect(tasksStore.task('td-new')).toBeNull()
    expect(tasksStore.deletedTaskIds).not.toContain('td-old')
  })

  it('a failed restore keeps the entry, puts nothing on the board and leaves the task blocked', async () => {
    const page = makeTask({ id: 'n1', source: 'notion' })
    tasksStore.setTasks([page])
    trashed(page)
    adapters.notion.restore.mockRejectedValueOnce(Object.assign(new Error('Bad Gateway'), { statusCode: 502 }))

    await expect(useTaskSync().restoreTask(trash.entry('n1')!)).rejects.toThrow('Bad Gateway')

    expect(tasksStore.task('n1')).toBeNull()
    expect(trash.entry('n1')).toBeDefined()
    expect(tasksStore.deletedTaskIds).toContain('n1')
  })

  it('useTrash reports a failed restore as task_restore and keeps the entry; a later retry works', async () => {
    const page = makeTask({ id: 'n1', source: 'notion' })
    tasksStore.setTasks([page])
    trashed(page)
    adapters.notion.restore.mockRejectedValueOnce(new Error('Network error: offline'))

    const { restoreFromTrash } = useTrash()
    expect(await restoreFromTrash('n1')).toBe(false)
    expect(handleErrorMock).toHaveBeenCalledWith(expect.any(Error), 'task_restore')
    expect(trash.entry('n1')).toBeDefined()

    expect(await restoreFromTrash('n1')).toBe(true)
    expect(tasksStore.task('n1')).not.toBeNull()
    expect(trash.entry('n1')).toBeUndefined()
  })

  it('offline: an external restore fails without calling the source', async () => {
    const page = makeTask({ id: 'n1', source: 'notion' })
    tasksStore.setTasks([page])
    trashed(page)
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })

    await expect(useTaskSync().restoreTask(trash.entry('n1')!)).rejects.toThrow(/offline/i)
    expect(adapters.notion.restore).not.toHaveBeenCalled()
    expect(trash.entry('n1')).toBeDefined()
  })

  it('a source that is not connected fails with the normal error and the entry stays', async () => {
    const page = makeTask({ id: 'n1', source: 'notion' })
    tasksStore.setTasks([page])
    trashed(page)
    useBoardStore().setSources({ connected: ['todoist'], default: 'local' })

    await expect(useTaskSync().restoreTask(trash.entry('n1')!)).rejects.toThrow(/not connected/)
    expect(trash.entry('n1')).toBeDefined()
  })

  it('a queued delete that never reached the source is cancelled: no restore call, the page stays', async () => {
    const page = makeTask({ id: 'n1', source: 'notion', status: TaskStatus.Progress })
    tasksStore.setTasks([page])
    tasksStore.addPendingDelete({ taskId: 'n1', task: page, carryOver: null, state: 'queued', requestedAt: Date.now() })
    trashed(page)

    await useTaskSync().restoreTask(trash.entry('n1')!)

    expect(adapters.notion.restore).not.toHaveBeenCalled()
    expect(mapHelpers.has(tasksStore.pendingDeletes, 'n1')).toBe(false)
    expect(tasksStore.task('n1')?.status).toBe(TaskStatus.Open)
    // the source still holds the page as Jetzt: it is told
    await vi.waitFor(() => expect(calls).toContain(`update:notion:n1:${TaskStatus.Open}`))
  })

  it('a fetch that started before the restore finished does not drop the task; one that contains it does not duplicate it', async () => {
    const page = makeTask({ id: 'n1', source: 'notion' })
    tasksStore.setTasks([page, makeTask({ id: 'n2', source: 'notion' })])
    trashed(page)
    await useTaskSync().restoreTask(trash.entry('n1')!)

    // the stale fetch was taken while the page was still archived
    tasksStore.mergeTasks('notion', [makeTask({ id: 'n2', source: 'notion' })])
    expect(tasksStore.tasks.map(task => task.id).sort()).toEqual(['n1', 'n2'])

    // the next fetch has it: matched by (source, externalId), not duplicated
    tasksStore.mergeTasks('notion', [makeTask({ id: 'n1', source: 'notion', title: 'Task n1 (from Notion)' }), makeTask({ id: 'n2', source: 'notion' })])
    expect(tasksStore.tasks.filter(task => task.externalId === 'n1')).toHaveLength(1)
    expect(tasksStore.task('n1')?.title).toBe('Task n1 (from Notion)')

    // the guard is released once a merge contained it: a later fetch without it removes it as for any task
    tasksStore.mergeTasks('notion', [makeTask({ id: 'n2', source: 'notion' })])
    expect(tasksStore.task('n1')).toBeNull()
  })

  it('a trashed task is not re-added by a fetch while it is in the trash', () => {
    const page = makeTask({ id: 'n1', source: 'notion' })
    tasksStore.setTasks([page])
    trashed(page)
    tasksStore.mergeTasks('notion', [makeTask({ id: 'n1', source: 'notion' })])
    expect(tasksStore.task('n1')).toBeNull()
  })

  it('the restore guard expires after 60 s', async () => {
    vi.useFakeTimers()
    try {
      const page = makeTask({ id: 'n1', source: 'notion' })
      tasksStore.setTasks([page])
      trashed(page)
      await useTaskSync().restoreTask(trash.entry('n1')!)
      vi.advanceTimersByTime(61_000)
      tasksStore.mergeTasks('notion', [])
      expect(tasksStore.task('n1')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
