/**
 * #322: `useTaskMove` end to end with a fake source registry. Sequences: the move is local and immediate, Undo makes
 * zero adapter calls and restores source/externalId exactly, the upstream create waits for the toast to close
 * (also when it only reports it by polling), a closed app resumes the move on the next start, a rejected create
 * shows the failure toast whose action repeats the whole move.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import type { SourceId } from '~/types/taskSource'
import { toastAddMock, toastRemoveMock } from '../mocks/nuxt-imports'

vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: vi.fn(), handleSuccess: vi.fn() }),
}))
vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({ recordTaskCompletion: vi.fn(), removeTaskRecord: vi.fn(), updateTaskRecord: vi.fn(), syncExistingDoneTasks: vi.fn() }),
}))

const calls: string[] = []
const adapter = (id: SourceId) => ({
  id, syncsTime: id === 'notion', isConfigured: () => true, fetchActive: vi.fn(async () => [] as Task[]),
  create: vi.fn(async (draft: Partial<Task>): Promise<Task> => {
    calls.push(`create:${id}`)
    return { ...(draft as Task), id: `${id}-1`, source: id, externalId: `${id}-1` }
  }),
  update: vi.fn(async (_task: Task): Promise<Task | null> => null),
  remove: vi.fn(async (task: Task) => { calls.push(`remove:${id}:${task.externalId}`) }),
  archivesAsStatus: () => false, health: () => 'healthy' as const,
})
const adapters = { local: adapter('local'), notion: adapter('notion'), todoist: adapter('todoist') }
vi.mock('~/composables/useTaskSources', () => ({ useTaskSources: () => ({ adapterFor: (id: SourceId) => adapters[id] }) }))

/* eslint-disable import/first -- order-sensitive: mocks must be registered before the SUT is imported */
import { useTaskMove, MOVE_UNDO_WINDOW_MS, resetTaskMoveState } from '~/composables/useTaskMove'
import { useTasksStore } from '~/store/tasks'
import { useTaskSync } from '~/composables/useTaskSync'
import { useBoardStore } from '~/store/board'
import { useIntegrationHealthStore } from '~/store/integrationHealth'
/* eslint-enable import/first */

const makeTask = (id: string, extra: Partial<Task> = {}): Task => ({
  id, source: 'local', externalId: null, title: `Task ${id}`, status: TaskStatus.Open, activity: null, topic: null, topicColorCode: null,
  priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, ...extra,
})

type ToastArgs = {
  id: string; title: string; description: string; color: string
  actions: Array<{ label: string; onClick: () => void; closeOnClick?: boolean }>
  'onUpdate:open'?: (open: boolean) => void
}
const lastToast = (): ToastArgs => toastAddMock.mock.calls.at(-1)![0] as ToastArgs

describe('useTaskMove (#322)', () => {
  let tasksStore: ReturnType<typeof useTasksStore>

  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    setActivePinia(createPinia())
    calls.length = 0
    vi.clearAllMocks()
    for (const a of Object.values(adapters)) { a.create.mockClear(); a.remove.mockClear(); a.update.mockClear() }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    useBoardStore().setSources({ connected: ['notion'], default: 'local' })
    useIntegrationHealthStore().recordSuccessfulSync('notion')
    tasksStore = useTasksStore()
    tasksStore.setTasks([makeTask('a', { title: 'Rückruf Frau Meyer' }), makeTask('n', { source: 'notion', externalId: 'page-n' })])
  })
  afterEach(() => {
    resetTaskMoveState()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('moves at once, shows "Nach Notion verschoben" with Rückgängig, and creates upstream only after the window', async () => {
    const { moveTaskToSource } = useTaskMove()

    expect(moveTaskToSource('a', 'notion')).toBe(true)
    expect(tasksStore.task('a')).toMatchObject({ source: 'notion', externalId: null })
    expect(lastToast()).toMatchObject({ id: 'move-task-a', title: 'Nach Notion verschoben', description: 'Rückruf Frau Meyer' })
    expect(lastToast().actions[0]).toMatchObject({ label: 'Rückgängig', closeOnClick: false })

    vi.advanceTimersByTime(MOVE_UNDO_WINDOW_MS - 1)
    await flushPromises()
    expect(calls).toEqual([])

    vi.advanceTimersByTime(1)
    await flushPromises()
    expect(calls).toEqual(['create:notion'])
    expect(tasksStore.task('a')).toMatchObject({ id: 'a', source: 'notion', externalId: 'notion-1' })
    expect(tasksStore.task('a')?.pendingMove).toBeUndefined()
    expect(tasksStore.isMoveHeld('a')).toBe(false)
  })

  it('Undo restores source and externalId exactly, makes zero adapter calls and removes the marker', async () => {
    const { moveTaskToSource } = useTaskMove()
    moveTaskToSource('n', 'local')
    expect(tasksStore.task('n')).toMatchObject({ source: 'local', externalId: null })

    lastToast().actions[0]!.onClick()
    expect(tasksStore.task('n')).toMatchObject({ source: 'notion', externalId: 'page-n' })
    expect(tasksStore.task('n')?.pendingMove).toBeUndefined()
    expect(tasksStore.task('n')?.pendingSync).toBeUndefined()
    expect(toastRemoveMock).toHaveBeenCalledWith('move-task-n')

    vi.advanceTimersByTime(MOVE_UNDO_WINDOW_MS * 3)
    await flushPromises()
    for (const a of Object.values(adapters)) {
      expect(a.create).not.toHaveBeenCalled()
      expect(a.update).not.toHaveBeenCalled()
      expect(a.remove).not.toHaveBeenCalled()
    }
  })

  describe('changes made inside the undo window (F1)', () => {
    const editTitle = async (taskId: string, title: string): Promise<void> => {
      tasksStore.updateTask(taskId, { title })
      await useTaskSync().syncTaskToIntegration(tasksStore.task(taskId)!)
    }
    /** What the timer does for one second of tracked time. */
    const tick = (taskId: string, seconds: number): void => {
      for (let i = 0; i < seconds; i++) {
        tasksStore.updateTask(taskId, { timeSpentSeconds: (tasksStore.task(taskId)?.timeSpentSeconds ?? 0) + 1 })
        tasksStore.addPendingTimeUpdate(taskId, 1)
      }
    }

    it('Notion -> Local, edit the title, Undo: the origin receives the new title once', async () => {
      const { moveTaskToSource } = useTaskMove()
      moveTaskToSource('n', 'local')
      await editTitle('n', 'Neuer Titel')
      expect(adapters.notion.update).not.toHaveBeenCalled()

      lastToast().actions[0]!.onClick()
      expect(tasksStore.task('n')).toMatchObject({ source: 'notion', externalId: 'page-n', title: 'Neuer Titel' })
      expect(tasksStore.task('n')?.pendingSync).toBeDefined()
      expect(adapters.notion.update).not.toHaveBeenCalled()

      await useTaskSync().syncPendingChanges()
      await useTaskSync().syncPendingChanges()
      expect(adapters.notion.update).toHaveBeenCalledTimes(1)
      expect(adapters.notion.update.mock.calls[0]![0]).toMatchObject({ id: 'n', externalId: 'page-n', title: 'Neuer Titel' })
      expect(tasksStore.task('n')?.pendingSync).toBeUndefined()
      expect(adapters.notion.create).not.toHaveBeenCalled()
      expect(adapters.notion.remove).not.toHaveBeenCalled()
    })

    it('Notion -> Local, stop the timer, Undo: the tracked time is pushed to the origin', async () => {
      const { moveTaskToSource } = useTaskMove()
      moveTaskToSource('n', 'local')
      tick('n', 42)
      await useTaskSync().syncPendingChanges() // what stopping the timer triggers

      lastToast().actions[0]!.onClick()
      expect(tasksStore.task('n')?.pendingSync).toBeDefined()

      await useTaskSync().syncPendingChanges()
      expect(adapters.notion.update).toHaveBeenCalledTimes(1)
      expect(adapters.notion.update.mock.calls[0]![0]).toMatchObject({ externalId: 'page-n', timeSpentSeconds: 42 })
      expect(tasksStore.task('n')?.pendingSync).toBeUndefined()
    })

    it('Notion -> Local, status change to Erledigt, Undo: the origin receives the status', async () => {
      const { moveTaskToSource } = useTaskMove()
      moveTaskToSource('n', 'local')
      await useTaskSync().updateTaskStatus({ taskId: 'n', status: TaskStatus.Done })

      lastToast().actions[0]!.onClick()
      await useTaskSync().syncPendingChanges()
      expect(adapters.notion.update).toHaveBeenCalledTimes(1)
      expect(adapters.notion.update.mock.calls[0]![0]).toMatchObject({ externalId: 'page-n', status: TaskStatus.Done })
    })

    it('Local -> Notion, edit, Undo: the task is back in Local with the edit and nothing goes upstream', async () => {
      const { moveTaskToSource } = useTaskMove()
      moveTaskToSource('a', 'notion')
      await editTitle('a', 'Neuer Titel')

      lastToast().actions[0]!.onClick()
      expect(tasksStore.task('a')).toMatchObject({ source: 'local', externalId: null, title: 'Neuer Titel' })
      expect(tasksStore.task('a')?.pendingSync).toBeUndefined()
      await useTaskSync().syncPendingChanges()
      vi.advanceTimersByTime(MOVE_UNDO_WINDOW_MS * 3)
      await flushPromises()
      expect(calls).toEqual([])
    })

    it('a window with no change leaves no marker on Undo, and a later window starts clean', async () => {
      const { moveTaskToSource } = useTaskMove()
      moveTaskToSource('n', 'local')
      await editTitle('n', 'Neuer Titel')
      lastToast().actions[0]!.onClick()
      await useTaskSync().syncPendingChanges()
      adapters.notion.update.mockClear()

      moveTaskToSource('n', 'local')
      lastToast().actions[0]!.onClick()
      expect(tasksStore.task('n')?.pendingSync).toBeUndefined()
      await useTaskSync().syncPendingChanges()
      expect(adapters.notion.update).not.toHaveBeenCalled()
    })

    it('Notion -> Local, edit, window closes: the target holds the edit and the origin is removed', async () => {
      const { moveTaskToSource } = useTaskMove()
      moveTaskToSource('n', 'local')
      await editTitle('n', 'Neuer Titel')

      vi.advanceTimersByTime(MOVE_UNDO_WINDOW_MS)
      await flushPromises()
      expect(tasksStore.task('n')).toMatchObject({ source: 'local', externalId: null, title: 'Neuer Titel' })
      expect(tasksStore.task('n')?.pendingMove).toBeUndefined()
      expect(calls).toEqual(['remove:notion:page-n'])
      expect(adapters.notion.update).not.toHaveBeenCalled()
    })

    it('Local -> Notion, edit, window closes: the create carries the edit', async () => {
      const { moveTaskToSource } = useTaskMove()
      moveTaskToSource('a', 'notion')
      await editTitle('a', 'Neuer Titel')
      tick('a', 7)

      vi.advanceTimersByTime(MOVE_UNDO_WINDOW_MS)
      await flushPromises()
      expect(calls).toEqual(['create:notion'])
      expect(adapters.notion.create.mock.calls[0]![0]).toMatchObject({ id: 'a', title: 'Neuer Titel' })
      expect(tasksStore.task('a')).toMatchObject({ source: 'notion', externalId: 'notion-1', title: 'Neuer Titel', timeSpentSeconds: 7 })
      expect(adapters.notion.update.mock.calls[0]![0]).toMatchObject({ id: 'a', timeSpentSeconds: 7 })
    })
  })

  it('Local -> Notion -> undo -> Notion again: the second move is a fresh one that creates exactly once', async () => {
    const { moveTaskToSource } = useTaskMove()
    moveTaskToSource('a', 'notion')
    lastToast().actions[0]!.onClick()
    moveTaskToSource('a', 'notion')
    vi.advanceTimersByTime(MOVE_UNDO_WINDOW_MS)
    await flushPromises()
    expect(calls).toEqual(['create:notion'])
  })

  it('commits as soon as the toast reports that it closed, and only once', async () => {
    const { moveTaskToSource } = useTaskMove()
    moveTaskToSource('a', 'notion')

    lastToast()['onUpdate:open']!(false)
    await flushPromises()
    vi.advanceTimersByTime(MOVE_UNDO_WINDOW_MS * 2)
    await flushPromises()

    expect(calls).toEqual(['create:notion'])
  })

  it('refuses a task that already has a move outstanding and one that is not there', () => {
    const { moveTaskToSource } = useTaskMove()
    expect(moveTaskToSource('a', 'notion')).toBe(true)
    expect(moveTaskToSource('a', 'local')).toBe(false)
    expect(moveTaskToSource('missing', 'local')).toBe(false)
    expect(moveTaskToSource('n', 'notion')).toBe(false)
  })

  it('app closed inside the window is not an undo: the next start commits the move', async () => {
    const first = useTaskMove()
    first.moveTaskToSource('a', 'notion')
    // The app closes: windows and holds live in memory only, the task and its marker are persisted
    resetTaskMoveState()
    const persisted = JSON.parse(JSON.stringify(tasksStore.tasks)) as Task[]
    setActivePinia(createPinia())
    useBoardStore().setSources({ connected: ['notion'], default: 'local' })
    useIntegrationHealthStore().recordSuccessfulSync('notion')
    const restored = useTasksStore()
    restored.setTasks(persisted)
    expect(restored.task('a')).toMatchObject({ source: 'notion', externalId: null, pendingMove: { fromSource: 'local' } })
    expect(calls).toEqual([])

    await useTaskMove().resumePendingMoves()

    expect(calls).toEqual(['create:notion'])
    expect(restored.task('a')).toMatchObject({ source: 'notion', externalId: 'notion-1' })
  })

  it('does not resume a move whose undo window is still open', async () => {
    const { moveTaskToSource, resumePendingMoves } = useTaskMove()
    moveTaskToSource('a', 'notion')
    await resumePendingMoves()
    expect(calls).toEqual([])
  })

  it('a rejected create shows "Verschieben fehlgeschlagen" and "Erneut versuchen" repeats the whole move, window included', async () => {
    adapters.notion.create.mockRejectedValueOnce(Object.assign(new Error('HTTP 400'), { statusCode: 400 }))
    const { moveTaskToSource } = useTaskMove()
    moveTaskToSource('a', 'notion')
    vi.advanceTimersByTime(MOVE_UNDO_WINDOW_MS)
    await flushPromises()

    expect(tasksStore.task('a')).toMatchObject({ source: 'local', externalId: null })
    expect(adapters.local.remove).not.toHaveBeenCalled()
    expect(lastToast()).toMatchObject({ id: 'move-failed-a', title: 'Verschieben fehlgeschlagen', color: 'error' })
    expect(lastToast().description).toBe('„Rückruf Frau Meyer“ bleibt in Lokal.')
    expect(lastToast().actions[0]!.label).toBe('Erneut versuchen')

    const retry = lastToast().actions[0]!
    toastAddMock.mockClear()
    retry.onClick()
    // The retry is a new move with its own undo toast and window
    expect(lastToast()).toMatchObject({ id: 'move-task-a', title: 'Nach Notion verschoben' })
    expect(tasksStore.task('a')).toMatchObject({ source: 'notion', externalId: null })
    vi.advanceTimersByTime(MOVE_UNDO_WINDOW_MS)
    await flushPromises()
    expect(tasksStore.task('a')).toMatchObject({ source: 'notion', externalId: 'notion-1' })
  })

  it('a transient failure shows no failure toast', async () => {
    adapters.notion.create.mockRejectedValueOnce(Object.assign(new Error('Network error'), { statusCode: 0 }))
    const { moveTaskToSource } = useTaskMove()
    moveTaskToSource('a', 'notion')
    toastAddMock.mockClear()
    vi.advanceTimersByTime(MOVE_UNDO_WINDOW_MS)
    await flushPromises()

    expect(toastAddMock).not.toHaveBeenCalled()
    expect(tasksStore.task('a')).toMatchObject({ source: 'notion', externalId: null })
    expect(tasksStore.task('a')?.pendingMove).toBeDefined()
  })

  it('a running timer is not interrupted by the move or its commit', async () => {
    tasksStore.setTasks([makeTask('t', { status: TaskStatus.Progress, timerId: 99, timeSpentSeconds: 60 })])
    const { moveTaskToSource } = useTaskMove()
    moveTaskToSource('t', 'notion')
    vi.advanceTimersByTime(MOVE_UNDO_WINDOW_MS)
    await flushPromises()
    expect(tasksStore.task('t')).toMatchObject({ timerId: 99, status: TaskStatus.Progress, timeSpentSeconds: 60, source: 'notion' })
  })
})
