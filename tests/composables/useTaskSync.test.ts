/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { sourceOf, switchSource } from '../helpers/taskSource'
import { setActivePinia, createPinia } from 'pinia'

// Register mocks BEFORE importing the SUT
vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({
    recordTaskCompletion: vi.fn(),
  }),
}))

vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({
    handleError: vi.fn(),
  }),
}))

// Notion config store mock
const notionConfigMock = {
  isConfigured: () => true,
  config: {
    token: 'test-token',
    databaseId: 'db-123',
    propertyMapping: { title: 'Name', status: 'Status' },
    statusMapping: { today: 'Today', doing: 'Doing', done: 'Done', waiting: 'Waiting', archive: null as string | null },
  },
}

vi.mock('~/store/notionConfig', () => ({
  useNotionConfigStore: () => notionConfigMock,
}))

// Integrations mocks
const updateTaskMock = vi.fn()
vi.mock('~/integrations/NotionIntegration', () => ({
  NotionIntegration: vi.fn().mockImplementation(function () {
    return {
    updateTask: updateTaskMock,
    }
  }),
}))

const todoistCompleteMock = vi.fn()
const todoistReopenMock = vi.fn()
vi.mock('~/integrations/TodoistIntegration', () => ({
  TodoistIntegration: vi.fn().mockImplementation(function () {
    return {
    completeTask: todoistCompleteMock,
    reopenTask: todoistReopenMock,
    }
  }),
}))

// Now import the SUT and related stores
// eslint-disable-next-line import/first -- order-sensitive: mocks must be defined before importing SUT
import { useTaskSync } from '~/composables/useTaskSync'
// eslint-disable-next-line import/first -- order-sensitive: mocks must be defined before importing SUT
import { useTasksStore } from '~/store/tasks'
// eslint-disable-next-line import/first -- order-sensitive: mocks must be defined before importing SUT
import { useBoardStore } from '~/store/board'
// eslint-disable-next-line import/first -- order-sensitive: mocks must be defined before importing SUT
import { TaskStatus } from '~/types/taskStatus'
// eslint-disable-next-line import/first -- used for Record-based pendingTimeUpdates
import { mapHelpers } from '~/utils/mapHelpers'

describe('useTaskSync.updateTaskStatus', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    updateTaskMock.mockReset()
    todoistCompleteMock.mockReset()
    todoistReopenMock.mockReset()
    notionConfigMock.config.statusMapping.archive = null
  })

describe('useTaskSync.syncPendingChanges', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    updateTaskMock.mockReset()
    notionConfigMock.config.statusMapping.archive = null
  })

  it('drops queued time of a source that stores none instead of leaving it to the stale cleanup (#336)', async () => {
    const tasksStore = useTasksStore()
    const boardStore = useBoardStore()
    switchSource('todoist')

    // seed pending updates
    tasksStore.addTask({
      id: 't1', source: 'todoist', externalId: 't1', title: 'T1', notes: null, status: TaskStatus.Progress,
      priority: 1, timeBoxSeconds: 0, timeSpentSeconds: 120, topic: null, topicColorCode: null, timerId: null,
      activity: null,
    })
    tasksStore.addPendingTimeUpdate('t1', 120)

    const { syncPendingChanges } = useTaskSync()
    await syncPendingChanges()

    expect(updateTaskMock).not.toHaveBeenCalled()
    expect(mapHelpers.has(tasksStore.pendingTimeUpdates, 't1')).toBe(false)
  })

  it('returns early and reports when Notion is not configured', async () => {
    // Remock notionConfig to be unconfigured
    const original = await vi.importActual<any>('~/store/notionConfig')
    vi.doMock('~/store/notionConfig', () => ({
      useNotionConfigStore: () => ({ isConfigured: () => false, config: null }),
    }))

    const mod = await import('~/composables/useTaskSync')
    const boardStore = useBoardStore()
    switchSource('notion')

    const tasksStore = useTasksStore()
    tasksStore.addPendingTimeUpdate('t1', 60)

    await mod.useTaskSync().syncPendingChanges()
    expect(updateTaskMock).not.toHaveBeenCalled()

    // restore module for following tests
    vi.doMock('~/store/notionConfig', () => original)
  })

  it('updates Notion for each pending task and clears pending updates on success', async () => {
    const tasksStore = useTasksStore()
    const boardStore = useBoardStore()
    switchSource('notion')

    updateTaskMock.mockImplementation(async (task: any) => task)

    // seed tasks and pending updates
    tasksStore.addTask({
      id: 'a', source: 'notion', externalId: 'a', title: 'A', notes: null, status: TaskStatus.Progress,
      priority: 1, timeBoxSeconds: 0, timeSpentSeconds: 10, topic: null, topicColorCode: null, timerId: null,
      activity: null,
    })
    tasksStore.addTask({
      id: 'b', source: 'notion', externalId: 'b', title: 'B', notes: null, status: TaskStatus.Progress,
      priority: 1, timeBoxSeconds: 0, timeSpentSeconds: 20, topic: null, topicColorCode: null, timerId: null,
      activity: null,
    })
    tasksStore.addPendingTimeUpdate('a', 10)
    tasksStore.addPendingTimeUpdate('b', 20)

    const { syncPendingChanges } = useTaskSync()
    await syncPendingChanges()

    expect(updateTaskMock).toHaveBeenCalledTimes(2)
    expect(updateTaskMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }))
    expect(updateTaskMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }))
    expect(mapHelpers.size(tasksStore.pendingTimeUpdates)).toBe(0)
  })

  describe('syncArchiveStatusForTasks', () => {
    beforeEach(() => {
      setActivePinia(createPinia())
      updateTaskMock.mockReset()
      notionConfigMock.config.statusMapping.archive = null
    })

    it('returns early when archive status mapping is not configured', async () => {
      const boardStore = useBoardStore()
      switchSource('notion')

      const tasksStore = useTasksStore()
      tasksStore.addTask({
        id: 'arch-1', source: 'notion', externalId: 'arch-1', title: 'Arch', notes: null, status: TaskStatus.Done,
        priority: 1, timeBoxSeconds: 0, timeSpentSeconds: 0, topic: null, topicColorCode: null,
        timerId: null, archivedAt: new Date(), activity: null,
      })

      const { syncArchiveStatusForTasks } = useTaskSync()
      await syncArchiveStatusForTasks(['arch-1'])

      expect(updateTaskMock).not.toHaveBeenCalled()
    })

    it('invokes Notion updateTask for each archived task when archive mapping exists', async () => {
      const boardStore = useBoardStore()
      switchSource('notion')
      notionConfigMock.config.statusMapping.archive = 'Archived'

      const tasksStore = useTasksStore()
      const archivedAt = new Date()
      tasksStore.addTask({
        id: 'arch-2', source: 'notion', externalId: 'arch-2', title: 'Arch 2', notes: null, status: TaskStatus.Done,
        priority: 1, timeBoxSeconds: 0, timeSpentSeconds: 0, topic: null, topicColorCode: null,
        timerId: null, archivedAt, activity: null,
      })
      tasksStore.addTask({
        id: 'arch-3', source: 'notion', externalId: 'arch-3', title: 'Arch 3', notes: null, status: TaskStatus.Done,
        priority: 1, timeBoxSeconds: 0, timeSpentSeconds: 0, topic: null, topicColorCode: null,
        timerId: null, archivedAt, activity: null,
      })

      const { syncArchiveStatusForTasks } = useTaskSync()
      await syncArchiveStatusForTasks(['arch-2', 'arch-3'])

      expect(updateTaskMock).toHaveBeenCalledTimes(2)
      expect(updateTaskMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'arch-2' }))
      expect(updateTaskMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'arch-3' }))
    })
  })
})

  it('updates store and calls NotionIntegration.updateTask when service is notion', async () => {
    const tasksStore = useTasksStore()
    const boardStore = useBoardStore()
    switchSource('notion')

    // seed a task
    tasksStore.addTask({
      id: 't1', source: 'notion', externalId: 't1',
      title: 'Test',
      notes: null,
      status: TaskStatus.Open,
      priority: 1,
      timeBoxSeconds: 0,
      timeSpentSeconds: 0,
      topic: null,
      topicColorCode: null,
      timerId: null,
      activity: null,
    })

    const { updateTaskStatus } = useTaskSync()

    await updateTaskStatus({ taskId: 't1', status: TaskStatus.Progress })

    // store updated
    const updated = tasksStore.task('t1')
    expect(updated?.status).toBe(TaskStatus.Progress)

    // notion called
    expect(updateTaskMock).toHaveBeenCalledTimes(1)
    expect(updateTaskMock).toHaveBeenCalledWith(expect.objectContaining({ id: 't1', status: TaskStatus.Progress }))
  })

  it('updates store and calls Todoist integration appropriate method when service is todoist', async () => {
    const tasksStore = useTasksStore()
    const boardStore = useBoardStore()
    switchSource('todoist')
    boardStore.setTodoistApiToken('test-token')

    // seed a Done task then move back to Open to test reopen
    tasksStore.addTask({
      id: 't2', source: 'todoist', externalId: 't2',
      title: 'Done Task',
      notes: null,
      status: TaskStatus.Done,
      priority: 1,
      timeBoxSeconds: 0,
      timeSpentSeconds: 0,
      topic: null,
      topicColorCode: null,
      timerId: null,
      activity: null,
    })

    const { updateTaskStatus } = useTaskSync()

    // Reopen
    await updateTaskStatus({ taskId: 't2', status: TaskStatus.Open })
    expect(todoistReopenMock).toHaveBeenCalledTimes(1)
    expect(todoistReopenMock).toHaveBeenCalledWith('t2')

    // Complete
    await updateTaskStatus({ taskId: 't2', status: TaskStatus.Done })
    expect(todoistCompleteMock).toHaveBeenCalledTimes(1)
    expect(todoistCompleteMock).toHaveBeenCalledWith('t2')
  })
})

describe('useTaskSync.updateTaskStatuses (whole-stack moves, #150)', () => {
  const addTask = (id: string) =>
    useTasksStore().addTask({
      id, ...sourceOf(id, 'todoist'), title: id, notes: null, status: TaskStatus.Open,
      priority: 1, timeBoxSeconds: 0, timeSpentSeconds: 0, topic: null, topicColorCode: null, timerId: null,
      activity: null,
    })

  beforeEach(() => {
    setActivePinia(createPinia())
    todoistCompleteMock.mockReset()
    switchSource('todoist')
    useBoardStore().boardConfig.todoistApiToken = 'token'
  })

  it('moves every task locally before any upstream call returns', () => {
    ['t1', 't2', 't3'].forEach(addTask)
    todoistCompleteMock.mockReturnValue(new Promise(() => {}))

    void useTaskSync().updateTaskStatuses(['t1', 't2', 't3'], TaskStatus.Done)

    const tasksStore = useTasksStore()
    for (const id of ['t1', 't2', 't3']) {
      expect(tasksStore.task(id)!.status).toBe(TaskStatus.Done)
      expect(tasksStore.task(id)!.completedAt).toBeInstanceOf(Date)
    }
  })

  it('syncs upstream one task after another, not in parallel', async () => {
    ['t1', 't2', 't3'].forEach(addTask)
    const releases: Array<() => void> = []
    todoistCompleteMock.mockImplementation(() => new Promise<void>(resolve => releases.push(resolve)))

    const done = useTaskSync().updateTaskStatuses(['t1', 't2', 't3'], TaskStatus.Done)

    await vi.waitFor(() => expect(todoistCompleteMock).toHaveBeenCalledTimes(1))
    expect(todoistCompleteMock).toHaveBeenLastCalledWith('t1')
    releases[0]!()
    await vi.waitFor(() => expect(todoistCompleteMock).toHaveBeenCalledTimes(2))
    expect(todoistCompleteMock).toHaveBeenLastCalledWith('t2')
    releases[1]!()
    await vi.waitFor(() => expect(todoistCompleteMock).toHaveBeenCalledTimes(3))
    releases[2]!()
    await done
  })

  it('a failing upstream call does not stop the others', async () => {
    ['t1', 't2'].forEach(addTask)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    todoistCompleteMock.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined)

    await useTaskSync().updateTaskStatuses(['t1', 't2'], TaskStatus.Done)

    expect(todoistCompleteMock.mock.calls).toEqual([['t1'], ['t2']])
    expect(useTasksStore().task('t2')!.status).toBe(TaskStatus.Done)
    consoleError.mockRestore()
  })

  it('skips ids that no longer exist', async () => {
    addTask('t1')
    todoistCompleteMock.mockResolvedValue(undefined)

    await useTaskSync().updateTaskStatuses(['gone', 't1'], TaskStatus.Done)

    expect(todoistCompleteMock.mock.calls).toEqual([['t1']])
  })
})

describe('useTaskSync: upstream status writes (#150)', () => {
  const addTask = (id: string, status = TaskStatus.Open) =>
    useTasksStore().addTask({
      id, ...sourceOf(id), title: id, notes: null, status,
      priority: 1, timeBoxSeconds: 0, timeSpentSeconds: 0, topic: null, topicColorCode: null, timerId: null,
      activity: null,
    })

  beforeEach(() => {
    setActivePinia(createPinia())
    todoistCompleteMock.mockReset()
    todoistReopenMock.mockReset()
    updateTaskMock.mockReset()
    notionConfigMock.config.statusMapping.archive = null
  })

  it('a later member sends the task as it is after the wait, not the snapshot from the drop', async () => {
    switchSource('notion')
    ;['t1', 't2'].forEach(id => addTask(id))
    const sent: Array<{ id: string; title: string; status: TaskStatus }> = []
    let releaseFirst: () => void = () => {}
    updateTaskMock.mockImplementation(async (task: any) => {
      sent.push({ id: task.id, title: task.title, status: task.status })
      if (sent.length === 1) await new Promise<void>(resolve => { releaseFirst = resolve })
      return task
    })

    const done = useTaskSync().updateTaskStatuses(['t1', 't2'], TaskStatus.Done)
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    useTasksStore().updateTask('t2', { title: 'edited while queued' }) // t2's write has not left yet
    releaseFirst()
    await done

    expect(sent[1]).toEqual({ id: 't2', title: 'edited while queued', status: TaskStatus.Done })
  })

  it('writes of one task go out in the order they were made, even when the first is slow', async () => {
    switchSource('todoist')
    useBoardStore().boardConfig.todoistApiToken = 'token'
    addTask('t1')
    const calls: string[] = []
    let releaseComplete: () => void = () => {}
    todoistCompleteMock.mockImplementation(async () => {
      calls.push('complete')
      await new Promise<void>(resolve => { releaseComplete = resolve })
    })
    todoistReopenMock.mockImplementation(async () => { calls.push('reopen') })

    const { updateTaskStatus } = useTaskSync()
    const completion = updateTaskStatus({ taskId: 't1', status: TaskStatus.Done })
    await vi.waitFor(() => expect(calls).toEqual(['complete']))
    const reopening = updateTaskStatus({ taskId: 't1', status: TaskStatus.Open })
    await Promise.resolve()
    expect(calls).toEqual(['complete']) // the reopen waits for the completion in flight

    releaseComplete()
    await Promise.all([completion, reopening])
    expect(calls).toEqual(['complete', 'reopen'])
  })

  describe('a newer status change is never lost to an older write in flight (#150)', () => {
    /** Notion echoes the status it received; the first write is held until released. */
    const holdFirstWrite = () => {
      const sent: Array<{ id: string; status: TaskStatus }> = []
      let release: () => void = () => {}
      updateTaskMock.mockImplementation(async (task: any) => {
        const received = { ...task } // the store hands over a live object: copy what was sent
        sent.push({ id: received.id, status: received.status })
        if (sent.length === 1) await new Promise<void>(resolve => { release = resolve })
        return received
      })
      return { sent, release: () => release() }
    }

    it('Open->Waiting held in flight, then Waiting->Done: local and upstream end Done', async () => {
      switchSource('notion')
      addTask('t1')
      const { sent, release } = holdFirstWrite()

      const { updateTaskStatus } = useTaskSync()
      const first = updateTaskStatus({ taskId: 't1', status: TaskStatus.Waiting })
      await vi.waitFor(() => expect(sent).toHaveLength(1))
      const second = updateTaskStatus({ taskId: 't1', status: TaskStatus.Done })
      release()
      await Promise.all([first, second])

      expect(useTasksStore().task('t1')!.status).toBe(TaskStatus.Done)
      expect(sent.at(-1)).toEqual({ id: 't1', status: TaskStatus.Done })
    })

    it('a block dropped in Wartet, then in Offen within the window: all members end in Offen', async () => {
      switchSource('notion')
      const ids = ['t1', 't2', 't3']
      ids.forEach(id => addTask(id))
      const { sent, release } = holdFirstWrite()

      const { updateTaskStatuses } = useTaskSync()
      const toWaiting = updateTaskStatuses(ids, TaskStatus.Waiting)
      await vi.waitFor(() => expect(sent).toHaveLength(1))
      const backToOpen = updateTaskStatuses(ids, TaskStatus.Open)
      release()
      await Promise.all([toWaiting, backToOpen])

      for (const id of ids) {
        expect(useTasksStore().task(id)!.status).toBe(TaskStatus.Open)
        expect(sent.filter(write => write.id === id).at(-1)!.status).toBe(TaskStatus.Open)
      }
    })

    it('a status change supersedes the lock of an earlier stack drop, so a refresh cannot revert it', async () => {
      switchSource('notion')
      ;['t1', 't2'].forEach(id => addTask(id))
      const { sent } = holdFirstWrite()

      const { updateTaskStatus, updateTaskStatuses } = useTaskSync()
      const stack = updateTaskStatuses(['t1', 't2'], TaskStatus.Done)
      await vi.waitFor(() => expect(sent).toHaveLength(1))
      void updateTaskStatus({ taskId: 't2', status: TaskStatus.Open }) // t2 is still queued behind t1

      const tasksStore = useTasksStore()
      tasksStore.mergeTasks('notion', ['t1', 't2'].map(id => ({ ...tasksStore.task(id)!, status: TaskStatus.Done })))

      expect(tasksStore.task('t2')!.status).toBe(TaskStatus.Open)
      void stack
    })

    it('Todoist: an undo that overtakes the queued completion sends neither a completion nor a reopen', async () => {
      switchSource('todoist')
      useBoardStore().boardConfig.todoistApiToken = 'token'
      ;['t1', 't2'].forEach(id => addTask(id))
      let releaseFirst: () => void = () => {}
      todoistCompleteMock.mockImplementationOnce(() => new Promise<void>(resolve => { releaseFirst = resolve }))
      todoistCompleteMock.mockResolvedValue(undefined)

      const { updateTaskStatus, updateTaskStatuses } = useTaskSync()
      const stack = updateTaskStatuses(['t1', 't2'], TaskStatus.Done)
      await vi.waitFor(() => expect(todoistCompleteMock).toHaveBeenCalledTimes(1))
      const undo = updateTaskStatus({ taskId: 't2', status: TaskStatus.Open }) // t2's completion has not left yet
      releaseFirst()
      await Promise.all([stack, undo])

      expect(todoistCompleteMock.mock.calls).toEqual([['t1']])
      expect(todoistReopenMock).not.toHaveBeenCalled()
    })
  })

  it('skips the write of a task that was deleted while it was queued', async () => {
    switchSource('todoist')
    useBoardStore().boardConfig.todoistApiToken = 'token'
    ;['t1', 't2'].forEach(id => addTask(id))
    let releaseFirst: () => void = () => {}
    todoistCompleteMock.mockImplementationOnce(() => new Promise<void>(resolve => { releaseFirst = resolve }))
    todoistCompleteMock.mockResolvedValue(undefined)

    const done = useTaskSync().updateTaskStatuses(['t1', 't2'], TaskStatus.Done)
    await vi.waitFor(() => expect(todoistCompleteMock).toHaveBeenCalledTimes(1))
    useTasksStore().removeTask('t2')
    releaseFirst()
    await done

    expect(todoistCompleteMock.mock.calls).toEqual([['t1']])
  })
})

describe('useTaskSync: a Todoist write that hangs until its timeout (#159)', () => {
  const TIMEOUT_MS = 10000
  const addTask = (id: string) =>
    useTasksStore().addTask({
      id, ...sourceOf(id, 'todoist'), title: id, notes: null, status: TaskStatus.Open,
      priority: 1, timeBoxSeconds: 0, timeSpentSeconds: 0, topicColorCode: null, topic: null, timerId: null,
      activity: null,
    })
  /** What `TodoistIntegration` does when the request times out: the call settles, the error is swallowed. */
  const settleAfterTimeout = () => new Promise<void>(resolve => { setTimeout(resolve, TIMEOUT_MS) })

  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    todoistCompleteMock.mockReset()
    todoistReopenMock.mockReset()
    switchSource('todoist')
    useBoardStore().boardConfig.todoistApiToken = 'token'
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('a second status write of the same task runs once the first has timed out', async () => {
    addTask('t1')
    const calls: string[] = []
    todoistCompleteMock.mockImplementationOnce(() => { calls.push('complete'); return settleAfterTimeout() })
    todoistReopenMock.mockImplementation(async () => { calls.push('reopen') })

    const { updateTaskStatus } = useTaskSync()
    const completion = updateTaskStatus({ taskId: 't1', status: TaskStatus.Done })
    await vi.advanceTimersByTimeAsync(0)
    const reopening = updateTaskStatus({ taskId: 't1', status: TaskStatus.Open })
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1)
    expect(calls).toEqual(['complete']) // still ordered behind the hung write

    await vi.advanceTimersByTimeAsync(1)
    await Promise.all([completion, reopening])
    expect(calls).toEqual(['complete', 'reopen'])
  })

  it('the later members of a dropped stack are still written and every status lock is released', async () => {
    ['t1', 't2', 't3'].forEach(addTask)
    todoistCompleteMock.mockImplementationOnce(settleAfterTimeout)
    todoistCompleteMock.mockResolvedValue(undefined)
    const unlock = vi.spyOn(useTasksStore(), 'unlockTaskStatus')

    const done = useTaskSync().updateTaskStatuses(['t1', 't2', 't3'], TaskStatus.Done)
    await vi.advanceTimersByTimeAsync(0)
    expect(todoistCompleteMock.mock.calls).toEqual([['t1']])

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS)
    await done

    expect(todoistCompleteMock.mock.calls).toEqual([['t1'], ['t2'], ['t3']])
    expect(unlock.mock.calls.map(([id]) => id)).toEqual(['t1', 't2', 't3'])
  })
})
