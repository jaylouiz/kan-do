import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useDayClose } from '~/composables/useDayClose'
import { useNewDayRecap, resetNewDayRecap } from '~/composables/useNewDayRecap'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useDayRecapStore } from '~/store/dayRecap'
import { dataState } from '~/lib/dataStorage'
import { emptyDataStatus } from '~/lib/dataStatus'
import { toastAddMock } from '../mocks/nuxt-imports'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

const syncArchiveStatusForTasks = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('~/composables/useTaskSync', () => ({ useTaskSync: () => ({ syncArchiveStatusForTasks }) }))
vi.mock('~/composables/useTaskOperations', () => ({ useTaskOperations: () => ({ stopTimer: vi.fn(), moveTaskToStatus: vi.fn() }) }))
vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({ syncExistingDoneTasks: vi.fn(), updateTaskRecord: vi.fn() }),
}))

// Thursday 22 Oct 2026, 09:00 local
const NOW = new Date(2026, 9, 22, 9, 0)
const TODAY = '2026-10-22'

const task = (id: string, status: TaskStatus, completedAt?: Date): Task => ({
  id, source: 'local', externalId: null, title: id, status, activity: null, topic: null, topicColorCode: null,
  priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, ...(completedAt ? { completedAt } : {}),
})
const yesterdayAt = (hour: number) => new Date(2026, 9, 21, hour)

function setup(options: { lastShownDay?: string | null, tasks?: Task[], onboarded?: boolean } = {}) {
  const tasks = useTasksStore()
  const board = useBoardStore()
  const recap = useDayRecapStore()
  tasks.tasks = options.tasks ?? [
    task('d1', TaskStatus.Done, yesterdayAt(9)),
    task('d2', TaskStatus.Done, yesterdayAt(15)),
    task('o1', TaskStatus.Open),
    task('w1', TaskStatus.Waiting),
  ]
  if (options.onboarded !== false) board.boardConfig = { sources: { connected: [], default: 'local' } }
  recap.lastShownDay = options.lastShownDay === undefined ? '2026-10-21' : options.lastShownDay
  return { tasks, board, recap }
}

describe('useNewDayRecap', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    setActivePinia(createPinia())
    resetNewDayRecap()
    toastAddMock.mockClear()
    syncArchiveStatusForTasks.mockClear()
    Object.assign(dataState, emptyDataStatus(), { available: false })
  })
  afterEach(() => vi.useRealTimers())

  describe('detection', () => {
    it('opens when onboarded, the marker is before today and there are done-before-today tasks', () => {
      setup()
      const recap = useNewDayRecap()
      recap.check('tasks')
      expect(recap.isOpen.value).toBe(true)
      const snap = recap.snapshot.value!
      expect(snap.done.map(t => t.id)).toEqual(['d1', 'd2'])
      expect(snap.undone.map(t => t.id)).toEqual(['o1', 'w1'])
      expect(snap.when.kind).toBe('yesterday')
      expect(snap.dayKey).toBe(TODAY)
    })

    it('does not open on a sheet route', () => {
      setup()
      const recap = useNewDayRecap()
      recap.check('tasks-add')
      recap.check('tasks-id')
      expect(recap.isOpen.value).toBe(false)
    })

    it('does not open over an open day-close dialog (never modal on modal)', () => {
      setup()
      const dayClose = useDayClose()
      dayClose.open()
      const recap = useNewDayRecap()
      recap.check('tasks')
      expect(recap.isOpen.value).toBe(false)
      dayClose.close()
      recap.check('tasks')
      expect(recap.isOpen.value).toBe(true)
    })

    it('does not open without onboarding (sources === null)', () => {
      const { recap: store } = setup({ onboarded: false })
      const recap = useNewDayRecap()
      recap.check('tasks')
      expect(recap.isOpen.value).toBe(false)
      expect(store.lastShownDay).toBe('2026-10-21')
    })

    it.each(['conflict', 'folder-unavailable'] as const)('does not open nor write while the data status is %s', (status) => {
      const { recap: store } = setup()
      Object.assign(dataState, emptyDataStatus({ status }), { available: true })
      const recap = useNewDayRecap()
      recap.check('tasks')
      expect(recap.isOpen.value).toBe(false)
      expect(store.lastShownDay).toBe('2026-10-21')
    })

    it('opens with an ok desktop status', () => {
      setup()
      Object.assign(dataState, emptyDataStatus(), { available: true })
      const recap = useNewDayRecap()
      recap.check('tasks')
      expect(recap.isOpen.value).toBe(true)
    })

    it('does not open when the marker is today or ahead (reload, clock set back)', () => {
      for (const lastShownDay of [TODAY, '2026-10-30']) {
        setActivePinia(createPinia())
        resetNewDayRecap()
        setup({ lastShownDay })
        const recap = useNewDayRecap()
        recap.check('tasks')
        expect(recap.isOpen.value).toBe(false)
      }
    })

    it('does not open when nothing was done before today (done today, archived, none) and writes nothing', () => {
      const archivedDone = task('old', TaskStatus.Done, yesterdayAt(9))
      const { tasks, recap: store } = setup({ tasks: [task('today', TaskStatus.Done, new Date(2026, 9, 22, 8)), archivedDone, task('o', TaskStatus.Open)] })
      tasks.archivedTaskIds = ['old']
      const recap = useNewDayRecap()
      recap.check('tasks')
      expect(recap.isOpen.value).toBe(false)
      expect(store.lastShownDay).toBe('2026-10-21')
    })

    it('baseline: no marker writes today once and shows nothing', () => {
      const { recap: store } = setup({ lastShownDay: null })
      const recap = useNewDayRecap()
      recap.check('tasks')
      expect(recap.isOpen.value).toBe(false)
      expect(store.lastShownDay).toBe(TODAY)
    })

    it('baseline: a malformed marker is replaced by today and shows nothing', () => {
      const { recap: store } = setup({ lastShownDay: 'garbage' })
      const recap = useNewDayRecap()
      recap.check('tasks')
      expect(recap.isOpen.value).toBe(false)
      expect(store.lastShownDay).toBe(TODAY)
    })

    it('baseline is skipped while the data status blocks', () => {
      const { recap: store } = setup({ lastShownDay: null })
      Object.assign(dataState, emptyDataStatus({ status: 'conflict' }), { available: true })
      useNewDayRecap().check('tasks')
      expect(store.lastShownDay).toBeNull()
    })

    it('a midnight crossed while the recap is not open does not matter: the key is taken at check()', () => {
      const { recap: store } = setup({ lastShownDay: TODAY })
      const recap = useNewDayRecap()
      recap.check('tasks')
      vi.setSystemTime(new Date(2026, 9, 23, 0, 5))
      expect(recap.isOpen.value).toBe(false)
      expect(store.lastShownDay).toBe(TODAY)
    })

    it('opens on the first check of a new day although the shared "today" is still yesterday (#242)', () => {
      const lateTask = new Date(2026, 9, 22, 15)
      setup({ lastShownDay: TODAY, tasks: [task('d1', TaskStatus.Done, lateTask)] })
      const recap = useNewDayRecap()
      // the shared "today" was computed on the 22nd; the window comes back on the 23rd without a remount
      void useTasksStore().tasksDonePrevious.length
      vi.setSystemTime(new Date(2026, 9, 23, 0, 30))
      recap.check('tasks')
      expect(recap.isOpen.value).toBe(true)
      expect(recap.snapshot.value!.dayKey).toBe('2026-10-23')
    })

    it('opens when the window is focused again on a new day, never while it stays focused across midnight (#242)', () => {
      setup({ lastShownDay: TODAY, tasks: [task('d1', TaskStatus.Done, new Date(2026, 9, 22, 15))] })
      const recap = useNewDayRecap()
      const stop = recap.listenForReturn(() => 'tasks')
      vi.setSystemTime(new Date(2026, 9, 23, 0, 30))
      vi.advanceTimersByTime(10 * 60 * 1000)
      expect(recap.isOpen.value).toBe(false)
      window.dispatchEvent(new Event('focus'))
      expect(recap.isOpen.value).toBe(true)
      stop()
    })

    it('stops listening after the returned stop function (#242)', () => {
      setup({ lastShownDay: TODAY, tasks: [task('d1', TaskStatus.Done, yesterdayAt(9))] })
      const recap = useNewDayRecap()
      recap.listenForReturn(() => 'tasks')()
      window.dispatchEvent(new Event('focus'))
      expect(recap.isOpen.value).toBe(false)
    })

    it('names the day by the newest completion: 3 days back reads as a weekday', () => {
      setup({ tasks: [task('d', TaskStatus.Done, new Date(2026, 9, 19, 16))] })
      const recap = useNewDayRecap()
      recap.check('tasks')
      expect(recap.snapshot.value!.when.kind).toBe('weekday')
    })
  })

  describe('snapshot', () => {
    it('is a copy: later store changes do not alter it', () => {
      const { tasks } = setup()
      const recap = useNewDayRecap()
      recap.check('tasks')
      tasks.tasks = []
      expect(recap.snapshot.value!.done).toHaveLength(2)
      expect(recap.snapshot.value!.undone).toHaveLength(2)
    })
  })

  describe('leave', () => {
    it('with the switch on archives the done tasks, moves the marker and closes, without a toast (#463)', () => {
      const { tasks, recap: store } = setup()
      const recap = useNewDayRecap()
      recap.check('tasks')
      recap.leave()
      expect(recap.isOpen.value).toBe(false)
      expect(tasks.archivedTaskIds).toEqual(['d1', 'd2'])
      expect(syncArchiveStatusForTasks).toHaveBeenCalledWith(['d1', 'd2'])
      expect(toastAddMock).not.toHaveBeenCalled()
      expect(store.lastShownDay).toBe(TODAY)
    })

    it('with the switch off archives nothing, shows no toast, but still moves the marker', () => {
      const { tasks, recap: store } = setup()
      store.setArchiveDone(false)
      const recap = useNewDayRecap()
      recap.check('tasks')
      recap.leave()
      expect(recap.isOpen.value).toBe(false)
      expect(tasks.archivedTaskIds).toEqual([])
      expect(toastAddMock).not.toHaveBeenCalled()
      expect(syncArchiveStatusForTasks).not.toHaveBeenCalled()
      expect(store.lastShownDay).toBe(TODAY)
    })

    it('archives only the snapshot ids that are still done before today', () => {
      const { tasks } = setup()
      const recap = useNewDayRecap()
      recap.check('tasks')
      // A fetch reopened d1 and deleted nothing else; a task newly revealed as done is not in the snapshot
      tasks.tasks = [
        task('d1', TaskStatus.Open),
        task('d2', TaskStatus.Done, yesterdayAt(15)),
        task('late', TaskStatus.Done, yesterdayAt(10)),
      ]
      recap.leave()
      expect(tasks.archivedTaskIds).toEqual(['d2'])
    })

    it('does not reopen after leaving with the archive (sequence: open, leave, finishLeave, check again)', () => {
      const { tasks } = setup()
      const recap = useNewDayRecap()
      recap.check('tasks')
      recap.leave()
      recap.finishLeave()
      expect(tasks.archivedTaskIds).toEqual(['d1', 'd2'])
      useNewDayRecap().check('tasks')
      expect(recap.isOpen.value).toBe(false)
      expect(toastAddMock).not.toHaveBeenCalled()
    })

    it('closes without archiving, syncing or moving the marker when the data status turned blocking meanwhile', () => {
      const { tasks, recap: store } = setup()
      const recap = useNewDayRecap()
      recap.check('tasks')
      Object.assign(dataState, emptyDataStatus({ status: 'conflict' }), { available: true })
      recap.leave()
      expect(recap.isOpen.value).toBe(false)
      expect(tasks.archivedTaskIds).toEqual([])
      expect(syncArchiveStatusForTasks).not.toHaveBeenCalled()
      expect(toastAddMock).not.toHaveBeenCalled()
      expect(store.lastShownDay).toBe('2026-10-21')
    })

    it('is a no-op while closed', () => {
      const { recap: store } = setup()
      useNewDayRecap().leave()
      expect(store.lastShownDay).toBe('2026-10-21')
      expect(toastAddMock).not.toHaveBeenCalled()
    })

    it('finishLeave drops the snapshot and hands focus to the board region, never <body>', () => {
      document.body.innerHTML = '<main data-task-sheet-return></main>'
      setup()
      const recap = useNewDayRecap()
      recap.check('tasks')
      recap.leave()
      expect(recap.snapshot.value).not.toBeNull()
      recap.finishLeave()
      expect(recap.snapshot.value).toBeNull()
      expect(document.activeElement).toBe(document.querySelector('main'))
    })
  })
})
