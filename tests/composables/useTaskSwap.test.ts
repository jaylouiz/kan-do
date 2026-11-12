/**
 * The swap (#162): the incoming task takes over Jetzt, the running one goes to Wartet, one undo toast.
 * Real Pinia stores and real useTaskSync; only the integrations and UI side effects are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useTaskStatisticsStore } from '~/store/taskStatistics'
import { useTaskSwap } from '~/composables/useTaskSwap'
import { toastAddMock, toastRemoveMock } from '../mocks/nuxt-imports'
import { sourceOf } from '../helpers/taskSource'

vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: vi.fn(), handleSuccess: vi.fn() }),
}))

const makeTask = (overrides: Partial<Task>): Task => ({
  id: 'task-1', ...sourceOf(overrides.id ?? 'task-1'),
  title: 'Test',
  status: TaskStatus.Open,
  activity: null,
  topic: null,
  topicColorCode: null,
  priority: 0,
  notes: null,
  timeSpentSeconds: 0,
  timeBoxSeconds: null,
  timerId: null,
  ...overrides,
})

describe('useTaskSwap (#162)', () => {
  let tasksStore: ReturnType<typeof useTasksStore>
  let boardStore: ReturnType<typeof useBoardStore>

  const seed = (entries: Array<[string, TaskStatus, Partial<Task>?]>) => {
    entries.forEach(([id, status, extra]) => tasksStore.addTask(makeTask({ id, title: `Title ${id}`, status, ...extra })))
    boardStore.reconcileColumnsWithTasks(tasksStore.tasks)
  }
  const ids = (tasks: Task[]) => tasks.map(t => t.id)
  const undo = () => {
    const toast = toastAddMock.mock.calls.at(-1)![0] as { actions: Array<{ onClick: () => void }> }
    toast.actions[0]!.onClick()
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    tasksStore = useTasksStore()
    boardStore = useBoardStore()
  })

  it('moves the running task to Wartet, the incoming one to Jetzt, and offers one undo toast naming both', () => {
    seed([['run', TaskStatus.Progress], ['next', TaskStatus.Open]])

    expect(useTaskSwap().swapIntoProgress('next')).toBe(true)

    expect(ids(tasksStore.tasksProgress)).toEqual(['next'])
    expect(ids(tasksStore.tasksWaiting)).toEqual(['run'])
    expect(tasksStore.tasksOpen).toHaveLength(0)
    expect(toastAddMock).toHaveBeenCalledTimes(1)
    expect(toastAddMock.mock.calls[0]![0]).toMatchObject({ id: 'swap-next', duration: 6000 })
  })

  it('from Wartet the running task takes the slot the incoming card leaves', () => {
    boardStore.setColumnSorting(TaskStatus.Waiting, 'manual', 'asc')
    seed([['run', TaskStatus.Progress], ['w1', TaskStatus.Waiting], ['w2', TaskStatus.Waiting], ['w3', TaskStatus.Waiting]])

    useTaskSwap().swapIntoProgress('w2')

    expect(ids(tasksStore.tasksWaiting)).toEqual(['w1', 'run', 'w3'])
    expect(ids(tasksStore.tasksProgress)).toEqual(['w2'])
  })

  it('keeps tracked time and records no statistics', () => {
    seed([['run', TaskStatus.Progress, { timeSpentSeconds: 90 }], ['next', TaskStatus.Open, { timeSpentSeconds: 30 }]])
    const statistics = useTaskStatisticsStore()
    const recorded = vi.spyOn(statistics, 'recordTaskCompletion')
    const removed = vi.spyOn(statistics, 'removeTaskRecord')

    useTaskSwap().swapIntoProgress('next')
    expect(tasksStore.task('run')!.timeSpentSeconds).toBe(90)
    expect(tasksStore.task('next')!.timeSpentSeconds).toBe(30)

    undo()
    expect(tasksStore.task('run')!.timeSpentSeconds).toBe(90)
    expect(tasksStore.task('next')!.timeSpentSeconds).toBe(30)
    expect(recorded).not.toHaveBeenCalled()
    expect(removed).not.toHaveBeenCalled()
  })

  it('undo restores both tasks, the incoming one at its old index', () => {
    boardStore.setColumnSorting(TaskStatus.Open, 'manual', 'asc')
    seed([['run', TaskStatus.Progress], ['o1', TaskStatus.Open], ['o2', TaskStatus.Open], ['o3', TaskStatus.Open]])

    useTaskSwap().swapIntoProgress('o2')
    undo()

    expect(ids(tasksStore.tasksProgress)).toEqual(['run'])
    expect(ids(tasksStore.tasksOpen)).toEqual(['o1', 'o2', 'o3'])
    expect(tasksStore.tasksWaiting).toHaveLength(0)
    expect(toastRemoveMock).toHaveBeenCalledWith('swap-o2')
  })

  it('Jetzt holds at most one task at every step, also on undo', () => {
    seed([['run', TaskStatus.Progress], ['next', TaskStatus.Open]])
    const seen: number[] = []
    const stop = tasksStore.$subscribe(() => seen.push(tasksStore.tasksProgress.length), { flush: 'sync' })

    useTaskSwap().swapIntoProgress('next')
    undo()
    stop()

    expect(Math.max(...seen)).toBeLessThanOrEqual(1)
  })

  it('undo does nothing once either task has moved on', () => {
    seed([['run', TaskStatus.Progress], ['next', TaskStatus.Open]])
    useTaskSwap().swapIntoProgress('next')
    tasksStore.updateTask('run', { status: TaskStatus.Open })

    undo()

    expect(ids(tasksStore.tasksProgress)).toEqual(['next'])
    expect(tasksStore.task('run')!.status).toBe(TaskStatus.Open)
  })

  it.each([
    ['Jetzt is empty', [['next', TaskStatus.Open]] as Array<[string, TaskStatus]>, 'next'],
    ['the task comes from Erledigt', [['run', TaskStatus.Progress], ['done', TaskStatus.Done]] as Array<[string, TaskStatus]>, 'done'],
    ['the task already runs', [['run', TaskStatus.Progress]] as Array<[string, TaskStatus]>, 'run'],
    ['the task does not exist', [['run', TaskStatus.Progress]] as Array<[string, TaskStatus]>, 'ghost'],
  ])('swaps nothing when %s', (_label, entries, id) => {
    seed(entries)
    const before = tasksStore.tasks.map(t => [t.id, t.status])

    expect(useTaskSwap().swapIntoProgress(id)).toBe(false)

    expect(tasksStore.tasks.map(t => [t.id, t.status])).toEqual(before)
    expect(toastAddMock).not.toHaveBeenCalled()
  })

  it('swaps tasks of different sources', () => {
    seed([['run', TaskStatus.Progress, { source: 'local', externalId: null }], ['next', TaskStatus.Open, { source: 'notion', externalId: 'n-1' }]])
    expect(useTaskSwap().swapIntoProgress('next')).toBe(true)
    expect(ids(tasksStore.tasksProgress)).toEqual(['next'])
  })
})
