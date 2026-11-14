import { describe, it, expect, beforeEach, vi } from 'vitest'
import { addLiveSecond, clearAllLiveSeconds } from '~/lib/liveTime'
import { setActivePinia, createPinia } from 'pinia'

import { useCompletionUndo } from '~/composables/useCompletionUndo'
import { useTaskOperations } from '~/composables/useTaskOperations'
import { useTaskSync } from '~/composables/useTaskSync'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { toastAddMock, toastRemoveMock } from '../mocks/nuxt-imports'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import { mapHelpers } from '~/utils/mapHelpers'
import { switchSource, sourceOf } from '../helpers/taskSource'

const recordMock = vi.fn()
const removeRecordMock = vi.fn()
vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({
    recordTaskCompletion: recordMock,
    removeTaskRecord: removeRecordMock,
    updateTaskRecord: vi.fn(),
  }),
}))
vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: vi.fn() }),
}))
vi.mock('~/store/notionConfig', () => ({
  useNotionConfigStore: () => ({ isConfigured: () => true, config: {} }),
}))

const notionUpdateMock = vi.fn()
vi.mock('~/composables/useNotionIntegration', () => ({
  useNotionIntegration: () => ({
    isConfigured: { value: true },
    createInstance: () => ({ updateTask: notionUpdateMock }),
  }),
}))
const todoistCompleteMock = vi.fn()
const todoistReopenMock = vi.fn()
vi.mock('~/integrations/TodoistIntegration', () => ({
  TodoistIntegration: vi.fn().mockImplementation(function () {
    return { completeTask: todoistCompleteMock, reopenTask: todoistReopenMock }
  }),
}))

function makeTask(id: string, status: TaskStatus, extra: Partial<Task> = {}): Task {
  return {
    id, ...sourceOf(id), title: `Task ${id}`, status, activity: null, topic: null, topicColorCode: null,
    priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, ...extra,
  }
}

function lastToastUndo() {
  const call = toastAddMock.mock.calls.at(-1)![0]
  return call.actions[0].onClick as () => void
}

describe('useCompletionUndo', () => {
  let tasksStore: ReturnType<typeof useTasksStore>
  let boardStore: ReturnType<typeof useBoardStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    tasksStore = useTasksStore()
    boardStore = useBoardStore()
    switchSource('local')
    for (const t of [
      makeTask('a', TaskStatus.Open), makeTask('b', TaskStatus.Open), makeTask('c', TaskStatus.Open),
      makeTask('p', TaskStatus.Progress, { timeSpentSeconds: 90 }),
    ]) tasksStore.addTask(t)
    boardStore.reconcileColumnsWithTasks(tasksStore.tasks)
  })

  const ids = (list: Task[]) => list.map(t => t.id)

  it('shows one toast per completion with a stable id, title and undo action', async () => {
    await useTaskOperations().moveTaskToStatus('b', TaskStatus.Done)

    expect(toastAddMock).toHaveBeenCalledTimes(1)
    const toast = toastAddMock.mock.calls[0]![0]
    expect(toast).toMatchObject({ id: 'complete-task-b', title: 'Erledigt', description: 'Task b', duration: 5000 })
    expect(toast.actions[0].label).toBe('Rückgängig')
  })

  it('truncates long titles at 40 characters', async () => {
    tasksStore.updateTask('a', { title: 'x'.repeat(60) })
    await useTaskOperations().moveTaskToStatus('a', TaskStatus.Done)
    expect(toastAddMock.mock.calls[0]![0].description).toBe(`${'x'.repeat(40)}...`)
  })

  it('shows no toast for moves that are not completions', async () => {
    const { moveTaskToStatus } = useTaskOperations()
    await moveTaskToStatus('a', TaskStatus.Waiting)
    await moveTaskToStatus('a', TaskStatus.Open)
    await moveTaskToStatus('b', TaskStatus.Done)
    toastAddMock.mockClear()
    await moveTaskToStatus('b', TaskStatus.Open) // out of Done
    await moveTaskToStatus('b', TaskStatus.Done)
    toastAddMock.mockClear()
    await moveTaskToStatus('b', TaskStatus.Done) // within Done
    expect(toastAddMock).not.toHaveBeenCalled()
  })

  it('undo restores column, position, completedAt and statistics', async () => {
    await useTaskOperations().moveTaskToStatus('b', TaskStatus.Done)
    expect(tasksStore.task('b')!.completedAt).toBeInstanceOf(Date)
    expect(ids(tasksStore.tasksOpen)).toEqual(['a', 'c'])

    lastToastUndo()()
    await vi.waitFor(() => expect(tasksStore.task('b')!.status).toBe(TaskStatus.Open))

    expect(ids(tasksStore.tasksOpen)).toEqual(['a', 'b', 'c'])
    expect(tasksStore.task('b')!.completedAt).toBeNull()
    expect(removeRecordMock).toHaveBeenCalledWith('b')
    expect(ids(tasksStore.tasksDone)).toEqual([])
    expect(toastRemoveMock).toHaveBeenCalledWith('complete-task-b')
  })

  it('restores the drag path (snapshot index passed in) and previous time spent', async () => {
    const { captureCompletionSnapshot, notifyCompleted } = useCompletionUndo()
    const snapshot = captureCompletionSnapshot('c', 2)
    tasksStore.updateTask('c', { status: TaskStatus.Done }) // what onDragEnd does
    notifyCompleted(snapshot)

    lastToastUndo()()
    await vi.waitFor(() => expect(tasksStore.task('c')!.status).toBe(TaskStatus.Open))
    expect(ids(tasksStore.tasksOpen)).toEqual(['a', 'b', 'c'])
  })

  it('the snapshot carries the seconds a running timer has not written yet (#286)', () => {
    tasksStore.updateTask('c', { timeSpentSeconds: 100 })
    addLiveSecond('c')
    addLiveSecond('c')
    addLiveSecond('c')
    try {
      expect(useCompletionUndo().captureCompletionSnapshot('c', 2)!.previousTimeSpentSeconds).toBe(103)
    } finally {
      clearAllLiveSeconds()
    }
  })

  it('undo during the in-card done confirmation cancels it (#124)', async () => {
    const { captureCompletionSnapshot, notifyCompleted } = useCompletionUndo()
    const snapshot = captureCompletionSnapshot('c', 2)
    tasksStore.updateTask('c', { status: TaskStatus.Done }) // what onDragEnd does
    boardStore.startConfirmation('c')
    notifyCompleted(snapshot)

    lastToastUndo()()
    await vi.waitFor(() => expect(tasksStore.task('c')!.status).toBe(TaskStatus.Open))
    expect(boardStore.confirmingTaskIds).toEqual([])
  })

  it('undo brings back the carried-over counter that completing dropped (#99)', async () => {
    tasksStore.recordCarryOver('2026-10-19')
    tasksStore.recordCarryOver('2026-10-20')
    tasksStore.keepCarryOver('b')
    const before = mapHelpers.get(tasksStore.carryOverByTaskId, 'b')
    expect(before?.days).toBe(1)

    await useTaskOperations().moveTaskToStatus('b', TaskStatus.Done)
    tasksStore.recordCarryOver('2026-10-20') // what the board's tracker does after the status change
    expect(mapHelpers.has(tasksStore.carryOverByTaskId, 'b')).toBe(false)

    lastToastUndo()()
    await vi.waitFor(() => expect(tasksStore.task('b')!.status).toBe(TaskStatus.Open))
    tasksStore.recordCarryOver('2026-10-20')
    expect(mapHelpers.get(tasksStore.carryOverByTaskId, 'b')).toEqual(before)
  })

  it('restores the previous time tracking state', async () => {
    await useTaskOperations().moveTaskToStatus('p', TaskStatus.Done)
    tasksStore.updateTask('p', { timeSpentSeconds: 93 }) // a last timer tick after the snapshot
    lastToastUndo()()
    await vi.waitFor(() => expect(tasksStore.task('p')!.status).toBe(TaskStatus.Progress))
    expect(tasksStore.task('p')!.timeSpentSeconds).toBe(90)
  })

  it('respects the WIP limit: full Jetzt sends the task to Wartet', async () => {
    await useTaskOperations().moveTaskToStatus('p', TaskStatus.Done)
    tasksStore.updateTask('a', { status: TaskStatus.Progress }) // Jetzt is occupied meanwhile
    lastToastUndo()()
    await vi.waitFor(() => expect(tasksStore.task('p')!.status).toBe(TaskStatus.Waiting))
    expect(tasksStore.tasksProgress).toHaveLength(1)
  })

  it('is a no-op when the task was deleted, archived or already moved out of Done', async () => {
    const { moveTaskToStatus } = useTaskOperations()
    await moveTaskToStatus('a', TaskStatus.Done)
    const undoA = lastToastUndo()
    tasksStore.removeTask('a')
    undoA()

    await moveTaskToStatus('b', TaskStatus.Done)
    const undoB = lastToastUndo()
    tasksStore.archiveTasks(['b'])
    undoB()
    await Promise.resolve()
    expect(tasksStore.task('b')!.status).toBe(TaskStatus.Done)

    await moveTaskToStatus('c', TaskStatus.Done)
    const undoC = lastToastUndo()
    await moveTaskToStatus('c', TaskStatus.Waiting)
    undoC()
    await Promise.resolve()
    expect(tasksStore.task('c')!.status).toBe(TaskStatus.Waiting)
  })

  it('keeps independent undos for several completions in a row', async () => {
    const { moveTaskToStatus } = useTaskOperations()
    await moveTaskToStatus('a', TaskStatus.Done)
    const undoA = lastToastUndo()
    await moveTaskToStatus('b', TaskStatus.Done)
    undoA()
    await vi.waitFor(() => expect(tasksStore.task('a')!.status).toBe(TaskStatus.Open))
    expect(tasksStore.task('b')!.status).toBe(TaskStatus.Done)
  })

  it('local mode makes no network calls', async () => {
    await useTaskOperations().moveTaskToStatus('a', TaskStatus.Done)
    lastToastUndo()()
    await vi.waitFor(() => expect(tasksStore.task('a')!.status).toBe(TaskStatus.Open))
    expect(todoistReopenMock).not.toHaveBeenCalled()
    expect(notionUpdateMock).not.toHaveBeenCalled()
  })

  it('Todoist: undo calls reopenTask', async () => {
    switchSource('todoist')
    boardStore.setTodoistApiToken('tok')
    await useTaskOperations().moveTaskToStatus('a', TaskStatus.Done)
    expect(todoistCompleteMock).toHaveBeenCalledWith('a')
    lastToastUndo()()
    await vi.waitFor(() => expect(todoistReopenMock).toHaveBeenCalledWith('a'))
  })

  it('Notion: undo writes the previous status and a late completion response cannot re-apply Done', async () => {
    switchSource('notion')
    let resolveCompletion!: (t: Task) => void
    notionUpdateMock.mockImplementationOnce(() => new Promise<Task>((r) => { resolveCompletion = r }))
    notionUpdateMock.mockImplementation(async (t: Task) => ({ ...t }))

    const completion = useTaskOperations().moveTaskToStatus('a', TaskStatus.Done) // still in flight
    lastToastUndo()()
    // The undo write is ordered after the completion write: it cannot overtake it upstream
    await Promise.resolve()
    expect(notionUpdateMock).toHaveBeenCalledTimes(1)

    resolveCompletion({ ...tasksStore.task('a')!, status: TaskStatus.Done })
    await vi.waitFor(() => expect(notionUpdateMock).toHaveBeenCalledTimes(2))
    expect(notionUpdateMock.mock.calls[1]![0].status).toBe(TaskStatus.Open)
    await completion
    expect(tasksStore.task('a')!.status).toBe(TaskStatus.Open)
  })

  it('mergeTasks keeps the undone status while the undo is still syncing', async () => {
    switchSource('notion')
    let resolveUndo!: (t: Task) => void
    notionUpdateMock.mockImplementationOnce(async (t: Task) => ({ ...t }))
    notionUpdateMock.mockImplementationOnce(() => new Promise<Task>((r) => { resolveUndo = r }))
    await useTaskOperations().moveTaskToStatus('a', TaskStatus.Done)

    lastToastUndo()()
    await vi.waitFor(() => expect(notionUpdateMock).toHaveBeenCalledTimes(2))
    tasksStore.mergeTasks('notion', [makeTask('a', TaskStatus.Done)]) // stale upstream refresh
    expect(tasksStore.task('a')!.status).toBe(TaskStatus.Open)

    resolveUndo(makeTask('a', TaskStatus.Open))
    await vi.waitFor(() => expect(tasksStore.task('a')!.status).toBe(TaskStatus.Open))
  })

  it('undo while the completion sync is in flight bumps the operation version again', async () => {
    switchSource('notion')
    let resolveCompletion!: (t: Task) => void
    notionUpdateMock.mockImplementationOnce(() => new Promise<Task>((r) => { resolveCompletion = r }))
    notionUpdateMock.mockImplementation(async (t: Task) => ({ ...t }))
    const before = tasksStore.getTaskOperationVersion('a')

    const completion = useTaskOperations().moveTaskToStatus('a', TaskStatus.Done)
    lastToastUndo()()
    await vi.waitFor(() => expect(tasksStore.task('a')!.status).toBe(TaskStatus.Open))
    expect(tasksStore.getTaskOperationVersion('a')).toBe(before + 2) // one per status write: completion, undo

    // the stale completion response (Done, completedAt) must not be applied
    resolveCompletion({ ...tasksStore.task('a')!, status: TaskStatus.Done, completedAt: new Date() })
    await completion
    expect(tasksStore.task('a')!.status).toBe(TaskStatus.Open)
    expect(tasksStore.task('a')!.completedAt ?? null).toBeNull()
  })
})

describe('useCompletionUndo: a whole stack completed in one drop (#150)', () => {
  let tasksStore: ReturnType<typeof useTasksStore>
  let boardStore: ReturnType<typeof useBoardStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    tasksStore = useTasksStore()
    boardStore = useBoardStore()
    switchSource('local')
    // Open order: a, x, b, y, c; the stack is a, b, c
    for (const id of ['a', 'x', 'b', 'y', 'c']) tasksStore.addTask(makeTask(id, TaskStatus.Open, { timeSpentSeconds: id === 'b' ? 30 : 0 }))
    boardStore.reconcileColumnsWithTasks(tasksStore.tasks)
  })

  const ids = (list: Task[]) => list.map(t => t.id)

  /** What onDragEnd does: capture, move every member, flag the confirmations, notify once */
  async function completeStack(members: string[]) {
    const { captureCompletionSnapshots, notifyCompletedBlock } = useCompletionUndo()
    const snapshots = captureCompletionSnapshots(members)
    await useTaskSync().updateTaskStatuses(members, TaskStatus.Done)
    members.forEach(id => boardStore.startConfirmation(id))
    notifyCompletedBlock(snapshots)
    return snapshots
  }

  it('captures every member with its previous index, skipping tasks that are done or gone', () => {
    tasksStore.updateTask('y', { status: TaskStatus.Done })
    const snapshots = useCompletionUndo().captureCompletionSnapshots(['a', 'b', 'y', 'gone', 'c'])
    expect(snapshots.map(s => [s.taskId, s.previousIndex])).toEqual([['a', 0], ['b', 2], ['c', 3]])
  })

  it('shows one toast for the whole stack, with the count and one undo action', async () => {
    await completeStack(['a', 'b', 'c'])

    expect(toastAddMock).toHaveBeenCalledTimes(1)
    const toast = toastAddMock.mock.calls[0]![0]
    expect(toast.title).toBe('3 Aufgaben erledigt')
    expect(toast.actions).toHaveLength(1)
    expect(toast.actions[0].label).toBe('Rückgängig')
  })

  it('shows the single-task toast when only one member was left to complete', async () => {
    await completeStack(['a'])
    expect(toastAddMock.mock.calls[0]![0]).toMatchObject({ id: 'complete-task-a', title: 'Erledigt' })
  })

  it('shows no toast when nothing was completed', () => {
    useCompletionUndo().notifyCompletedBlock([])
    expect(toastAddMock).not.toHaveBeenCalled()
  })

  it('one undo restores every member: status, position, completedAt, time spent, confirmation', async () => {
    await completeStack(['a', 'b', 'c'])
    expect(ids(tasksStore.tasksOpen)).toEqual(['x', 'y'])
    expect(boardStore.confirmingTaskIds).toEqual(['a', 'b', 'c'])
    tasksStore.updateTask('b', { timeSpentSeconds: 33 }) // a last timer tick after the snapshot

    lastToastUndo()()
    await vi.waitFor(() => expect(ids(tasksStore.tasksOpen)).toHaveLength(5))

    expect(ids(tasksStore.tasksOpen)).toEqual(['a', 'x', 'b', 'y', 'c'])
    for (const id of ['a', 'b', 'c']) {
      expect(tasksStore.task(id)!.status).toBe(TaskStatus.Open)
      expect(tasksStore.task(id)!.completedAt).toBeNull()
    }
    expect(tasksStore.task('b')!.timeSpentSeconds).toBe(30)
    expect(boardStore.confirmingTaskIds).toEqual([])
    expect(removeRecordMock).toHaveBeenCalledTimes(3)
    expect(toastRemoveMock).toHaveBeenCalledTimes(1)
  })

  it('restores in ascending previous index whatever order the snapshots come in', async () => {
    const { captureCompletionSnapshots, undoCompletions } = useCompletionUndo()
    const snapshots = captureCompletionSnapshots(['c', 'a', 'b'])
    await useTaskSync().updateTaskStatuses(['c', 'a', 'b'], TaskStatus.Done)

    await undoCompletions(snapshots)

    expect(ids(tasksStore.tasksOpen)).toEqual(['a', 'x', 'b', 'y', 'c'])
  })

  it('skips a member that was deleted or moved on meanwhile and restores the rest', async () => {
    await completeStack(['a', 'b', 'c'])
    tasksStore.removeTask('a')
    await useTaskSync().updateTaskStatuses(['b'], TaskStatus.Waiting)

    lastToastUndo()()
    await vi.waitFor(() => expect(tasksStore.task('c')!.status).toBe(TaskStatus.Open))

    expect(tasksStore.task('b')!.status).toBe(TaskStatus.Waiting)
    expect(ids(tasksStore.tasksOpen)).toEqual(['x', 'y', 'c'])
  })
})

describe('useCompletionUndo: undo while the completion writes are still going out (#150)', () => {
  const members = ['m1', 'm2', 'm3', 'm4', 'm5']
  let tasksStore: ReturnType<typeof useTasksStore>
  let boardStore: ReturnType<typeof useBoardStore>
  /** Every upstream write in the order it started: the status the task was sent with */
  let writes: Array<{ id: string; status: TaskStatus }>
  /** Tasks that got a second write while an earlier write of theirs was still in flight */
  let overlapping: string[]
  let releaseFirstWrite: () => void

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    tasksStore = useTasksStore()
    boardStore = useBoardStore()
    switchSource('notion')
    for (const id of members) tasksStore.addTask(makeTask(id, TaskStatus.Open))
    boardStore.reconcileColumnsWithTasks(tasksStore.tasks)

    writes = []
    overlapping = []
    releaseFirstWrite = () => {}
    const inFlight = new Set<string>()
    notionUpdateMock.mockReset()
    notionUpdateMock.mockImplementation(async (task: Task) => {
      writes.push({ id: task.id, status: task.status })
      if (inFlight.has(task.id)) overlapping.push(task.id)
      inFlight.add(task.id)
      try {
        // The first write hangs: the rest of the chain is queued behind it for "seconds"
        if (writes.length === 1) await new Promise<void>((resolve) => { releaseFirstWrite = resolve })
        return { ...task }
      } finally {
        inFlight.delete(task.id)
      }
    })
  })

  /** Lets everything that can start without the hung write start */
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

  const lastWriteStatus = (id: string) => writes.filter(w => w.id === id).at(-1)?.status

  it('ends with every member Open locally and in the last upstream write of each task', async () => {
    const { captureCompletionSnapshots, notifyCompletedBlock } = useCompletionUndo()
    const snapshots = captureCompletionSnapshots(members)
    const chain = useTaskSync().updateTaskStatuses(members, TaskStatus.Done)
    notifyCompletedBlock(snapshots)
    await vi.waitFor(() => expect(writes).toHaveLength(1)) // m1's completion is in flight, m2..m5 are queued

    lastToastUndo()()
    await flush()
    // Sync refreshes keep coming in while the writes drain: upstream still says Done
    tasksStore.mergeTasks('notion', members.map(id => makeTask(id, TaskStatus.Done)))
    releaseFirstWrite()
    await chain
    await vi.waitFor(() => expect(tasksStore.tasksOpen).toHaveLength(5))
    await vi.waitFor(() => expect(members.every(id => lastWriteStatus(id) === TaskStatus.Open)).toBe(true))

    for (const id of members) {
      expect(tasksStore.task(id)!.status).toBe(TaskStatus.Open)
      expect(tasksStore.task(id)!.completedAt ?? null).toBeNull()
    }
  })

  it('never has two writes of one task in flight, so the undo cannot overtake its completion', async () => {
    const { captureCompletionSnapshots, notifyCompletedBlock } = useCompletionUndo()
    const snapshots = captureCompletionSnapshots(members)
    const chain = useTaskSync().updateTaskStatuses(members, TaskStatus.Done)
    notifyCompletedBlock(snapshots)
    await vi.waitFor(() => expect(writes).toHaveLength(1))

    lastToastUndo()()
    await flush()
    releaseFirstWrite()
    await chain
    await vi.waitFor(() => expect(members.every(id => lastWriteStatus(id) === TaskStatus.Open)).toBe(true))

    expect(overlapping).toEqual([])
    for (const id of members) {
      const sequence = writes.filter(w => w.id === id).map(w => w.status)
      const firstOpen = sequence.indexOf(TaskStatus.Open)
      if (firstOpen >= 0) expect(sequence.slice(firstOpen)).not.toContain(TaskStatus.Done)
    }
  })

  it('a refresh after the undo started cannot bring Done back while the undo write is in flight', async () => {
    const { captureCompletionSnapshots, notifyCompletedBlock } = useCompletionUndo()
    // m1's undo write hangs, so its lock is what protects it from refreshes
    let releaseUndoWrite: () => void = () => {}
    const completionWrite = notionUpdateMock.getMockImplementation()!
    notionUpdateMock.mockImplementation(async (task: Task) => {
      if (task.id === 'm1' && task.status === TaskStatus.Open) {
        writes.push({ id: task.id, status: task.status })
        await new Promise<void>((resolve) => { releaseUndoWrite = resolve })
        return { ...task }
      }
      return completionWrite(task)
    })
    const snapshots = captureCompletionSnapshots(members)
    const chain = useTaskSync().updateTaskStatuses(members, TaskStatus.Done)
    notifyCompletedBlock(snapshots)
    await vi.waitFor(() => expect(writes).toHaveLength(1))
    lastToastUndo()()
    await flush()

    releaseFirstWrite() // m1's completion write finishes: its lock release must not unpin m1's undo
    await chain
    await vi.waitFor(() => expect(writes.some(w => w.id === 'm1' && w.status === TaskStatus.Open)).toBe(true))
    tasksStore.mergeTasks('notion', members.map(id => makeTask(id, TaskStatus.Done)))
    expect(tasksStore.task('m1')!.status).toBe(TaskStatus.Open)

    releaseUndoWrite()
    await vi.waitFor(() => expect(tasksStore.tasksOpen).toHaveLength(5))
  })
})
