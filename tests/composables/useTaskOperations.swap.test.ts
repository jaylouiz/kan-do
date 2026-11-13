/**
 * #241: `moveOrSwapToStatus` / `canMoveOrSwapToStatus`, the one path menu, palette and sheet use to put a task into
 * Jetzt. WIP risk area: the rule stays in `utils/wipGuard.ts`, this only decides "swap, or the guarded move".
 * Real Pinia stores and real useTaskSwap / useTaskSync; only UI side effects are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useTaskOperations } from '~/composables/useTaskOperations'
import { toastAddMock } from '../mocks/nuxt-imports'
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

describe('moveOrSwapToStatus / canMoveOrSwapToStatus (#241)', () => {
  let tasksStore: ReturnType<typeof useTasksStore>
  let boardStore: ReturnType<typeof useBoardStore>

  const seed = (entries: Array<[string, TaskStatus]>) => {
    entries.forEach(([id, status]) => tasksStore.addTask(makeTask({ id, title: `Title ${id}`, status })))
    boardStore.reconcileColumnsWithTasks(tasksStore.tasks)
  }
  const ids = (tasks: Task[]) => tasks.map(t => t.id)
  const toastIds = () => toastAddMock.mock.calls.map(c => (c[0] as { id: string }).id)
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

  describe.each([
    ['Offen', TaskStatus.Open],
    ['Wartet', TaskStatus.Waiting],
  ] as const)('a task from %s into Jetzt', (_name, origin) => {
    it('Jetzt holds one other task: they swap, one swap toast', async () => {
      seed([['run', TaskStatus.Progress], ['next', origin]])
      const ops = useTaskOperations()

      expect(ops.canMoveOrSwapToStatus('next', TaskStatus.Progress)).toEqual({ allowed: true })
      await expect(ops.moveOrSwapToStatus('next', TaskStatus.Progress)).resolves.toBe(true)

      expect(ids(tasksStore.tasksProgress)).toEqual(['next'])
      expect(ids(tasksStore.tasksWaiting)).toEqual(['run'])
      expect(toastIds()).toEqual(['swap-next'])
    })

    it('Jetzt is empty: a plain move, no swap toast', async () => {
      seed([['next', origin]])
      const ops = useTaskOperations()

      expect(ops.canMoveOrSwapToStatus('next', TaskStatus.Progress)).toEqual({ allowed: true })
      await expect(ops.moveOrSwapToStatus('next', TaskStatus.Progress)).resolves.toBe(true)

      expect(ids(tasksStore.tasksProgress)).toEqual(['next'])
      expect(toastIds()).not.toContain('swap-next')
    })

    it('Jetzt holds two tasks (invalid state): refused like before, nothing moves', async () => {
      seed([['run1', TaskStatus.Progress], ['run2', TaskStatus.Progress], ['next', origin]])
      const ops = useTaskOperations()

      expect(ops.canMoveOrSwapToStatus('next', TaskStatus.Progress)).toEqual({ allowed: false, reason: 'progressFull' })
      await expect(ops.moveOrSwapToStatus('next', TaskStatus.Progress)).resolves.toBe(false)

      expect(ids(tasksStore.tasksProgress)).toEqual(['run1', 'run2'])
      expect(toastIds()).toEqual(['wip-limit'])
    })

    it('another target never swaps, also while Jetzt is full', async () => {
      const other = origin === TaskStatus.Open ? TaskStatus.Waiting : TaskStatus.Open
      seed([['run', TaskStatus.Progress], ['next', origin]])
      const ops = useTaskOperations()

      expect(ops.canMoveOrSwapToStatus('next', other)).toEqual({ allowed: true })
      await ops.moveOrSwapToStatus('next', other)
      await ops.moveOrSwapToStatus('next', TaskStatus.Done)

      expect(ids(tasksStore.tasksProgress)).toEqual(['run'])
      expect(toastIds()).not.toContain('swap-next')
    })

    it('undo of the swap restores both tasks', async () => {
      seed([['run', TaskStatus.Progress], ['next', origin]])

      await useTaskOperations().moveOrSwapToStatus('next', TaskStatus.Progress)
      undo()

      expect(ids(tasksStore.tasksProgress)).toEqual(['run'])
      expect(tasksStore.task('next')!.status).toBe(origin)
    })
  })

  describe('a task from Erledigt into Jetzt', () => {
    it('Jetzt full: refused, no completion undone, no swap', async () => {
      seed([['run', TaskStatus.Progress], ['done', TaskStatus.Done]])
      const ops = useTaskOperations()

      expect(ops.canMoveOrSwapToStatus('done', TaskStatus.Progress)).toEqual({ allowed: false, reason: 'progressFull' })
      await expect(ops.moveOrSwapToStatus('done', TaskStatus.Progress)).resolves.toBe(false)

      expect(ids(tasksStore.tasksProgress)).toEqual(['run'])
      expect(ids(tasksStore.tasksDone)).toEqual(['done'])
      expect(toastIds()).toEqual(['wip-limit'])
    })

    it('Jetzt empty: a plain move', async () => {
      seed([['done', TaskStatus.Done]])

      await expect(useTaskOperations().moveOrSwapToStatus('done', TaskStatus.Progress)).resolves.toBe(true)

      expect(ids(tasksStore.tasksProgress)).toEqual(['done'])
    })
  })

  describe('stale and repeated calls', () => {
    it('the running task left after the menu was built: no swap, a plain move (the decision is read at call time)', async () => {
      seed([['run', TaskStatus.Progress], ['next', TaskStatus.Open]])
      const ops = useTaskOperations()
      expect(ops.canMoveOrSwapToStatus('next', TaskStatus.Progress).allowed).toBe(true)

      tasksStore.updateTask('run', { status: TaskStatus.Waiting })
      boardStore.reconcileColumnsWithTasks(tasksStore.tasks)
      await expect(ops.moveOrSwapToStatus('next', TaskStatus.Progress)).resolves.toBe(true)

      expect(ids(tasksStore.tasksProgress)).toEqual(['next'])
      expect(toastIds()).not.toContain('swap-next')
    })

    it('Jetzt filled up after the menu was built from Erledigt: the refusal toast, not a swap', async () => {
      seed([['done', TaskStatus.Done]])
      const ops = useTaskOperations()
      expect(ops.canMoveOrSwapToStatus('done', TaskStatus.Progress).allowed).toBe(true)

      tasksStore.addTask(makeTask({ id: 'run', status: TaskStatus.Progress }))
      boardStore.reconcileColumnsWithTasks(tasksStore.tasks)
      await expect(ops.moveOrSwapToStatus('done', TaskStatus.Progress)).resolves.toBe(false)

      expect(ids(tasksStore.tasksProgress)).toEqual(['run'])
      expect(toastIds()).toEqual(['wip-limit'])
    })

    it('a second call right after the swap is a no-op: one toast, nothing flips back', async () => {
      seed([['run', TaskStatus.Progress], ['next', TaskStatus.Open]])
      const ops = useTaskOperations()

      await expect(ops.moveOrSwapToStatus('next', TaskStatus.Progress)).resolves.toBe(true)
      await expect(ops.moveOrSwapToStatus('next', TaskStatus.Progress)).resolves.toBe(false)

      expect(ids(tasksStore.tasksProgress)).toEqual(['next'])
      expect(ids(tasksStore.tasksWaiting)).toEqual(['run'])
      expect(toastIds()).toEqual(['swap-next'])
    })

    it('swapping back and forth: A takes Jetzt, then B takes it from A', async () => {
      seed([['a', TaskStatus.Progress], ['b', TaskStatus.Open]])
      const ops = useTaskOperations()

      await ops.moveOrSwapToStatus('b', TaskStatus.Progress)
      await ops.moveOrSwapToStatus('a', TaskStatus.Progress)

      expect(ids(tasksStore.tasksProgress)).toEqual(['a'])
      expect(ids(tasksStore.tasksWaiting)).toEqual(['b'])
    })

    it('an unknown task is not a swap and does not throw', () => {
      seed([['run', TaskStatus.Progress]])

      expect(useTaskOperations().canMoveOrSwapToStatus('ghost', TaskStatus.Progress)).toEqual({ allowed: true })
    })
  })
})
