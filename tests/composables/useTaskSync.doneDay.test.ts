/**
 * kd#131: `setCompletedDay` moves a done task and its completion record to the chosen day (statistics count it
 * there), respects the limits, pushes the day to a source and keeps it over that source's write echo.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: vi.fn(), handleSuccess: vi.fn() }),
}))
vi.mock('~/composables/useNotionDataSource', () => ({
  useNotionDataSource: () => ({ ensureDataSourceConfigured: vi.fn().mockResolvedValue(true) }),
}))

const notion = {
  fetchActiveBoardTasks: vi.fn<() => Promise<Task[]>>(),
  updateTask: vi.fn<(task: Task) => Promise<Task>>(),
}
vi.mock('~/composables/useNotionIntegration', () => ({
  useNotionIntegration: () => ({ isConfigured: { value: true }, createInstance: () => notion }),
}))
vi.mock('~/store/notionConfig', () => ({
  useNotionConfigStore: () => ({ isConfigured: true, hasDataSourceSelected: true, config: { token: 't', statusMapping: { archive: null } } }),
}))

/* eslint-disable import/first -- order-sensitive: mocks must be registered before the SUT is imported */
import { useTaskSync } from '~/composables/useTaskSync'
import { useTasksStore } from '~/store/tasks'
import { useTaskStatisticsStore } from '~/store/taskStatistics'
import { useBoardStore } from '~/store/board'
import { useIntegrationHealthStore } from '~/store/integrationHealth'
import { dayKey } from '~/utils/recapDay'
/* eslint-enable import/first */

const NOW = new Date(2026, 10, 10, 9, 30, 0, 0)
const CREATED = new Date(2026, 10, 5, 10, 0, 0, 0)
const DONE_TODAY = new Date(2026, 10, 10, 8, 15, 0, 0)

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id, source: 'local', externalId: null, title: `Task ${id}`, status: TaskStatus.Done, activity: null, topic: 'Garten',
    topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: 1800, timeSpentSeconds: 2400, timerId: null,
    createdAt: CREATED, completedAt: DONE_TODAY, ...overrides,
  }
}

/** Seconds of completed work per local day, as the Statistik page groups its records. */
function secondsByDay(): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const record of useTaskStatisticsStore().completionRecords) {
    const key = dayKey(new Date(record.completedAt))
    totals[key] = (totals[key] ?? 0) + record.actualTimeSpentSeconds
  }
  return totals
}

describe('setCompletedDay (kd#131)', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    Object.values(notion).forEach((fn) => fn.mockReset())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  describe('on a Local board', () => {
    beforeEach(() => {
      useBoardStore().setSources({ connected: [], default: 'local' })
      useTasksStore().setTasks([task('l1'), task('l2', { timeSpentSeconds: 600 })])
      useTaskStatisticsStore().syncExistingDoneTasks(useTasksStore().tasks, [])
    })

    it('counts the task and its time on the corrected day, and leaves the other task alone', () => {
      expect(secondsByDay()).toEqual({ '2026-11-10': 3000 })

      const stored = useTaskSync().setCompletedDay('l1', '2026-11-09', NOW)

      expect(stored).toEqual(new Date(2026, 10, 9, 8, 15, 0, 0))
      expect(useTasksStore().task('l1')).toMatchObject({ completedAt: stored, completedAtCorrected: true, timeSpentSeconds: 2400 })
      expect(secondsByDay()).toEqual({ '2026-11-09': 2400, '2026-11-10': 600 })
      const record = useTaskStatisticsStore().completionRecords.find(r => r.taskId === 'l1')
      expect(record).toMatchObject({ title: 'Task l1', topic: 'Garten', timeBoxSeconds: 1800, actualTimeSpentSeconds: 2400 })
    })

    it('a later edit of the done task keeps the record on the corrected day', async () => {
      useTaskSync().setCompletedDay('l1', '2026-11-09', NOW)
      useTasksStore().updateTask('l1', { timeSpentSeconds: 3000 })
      await vi.waitFor(() => expect(secondsByDay()).toEqual({ '2026-11-09': 3000, '2026-11-10': 600 }))
    })

    it('changes nothing for a future day, a day before the task was created, a task that is not done or an unknown task', () => {
      useTasksStore().addTask(task('open', { status: TaskStatus.Open, completedAt: null }))
      const sync = useTaskSync()
      expect(sync.setCompletedDay('l1', '2026-11-11', NOW)).toBeNull()
      expect(sync.setCompletedDay('l1', '2026-11-04', NOW)).toBeNull()
      expect(sync.setCompletedDay('open', '2026-11-09', NOW)).toBeNull()
      expect(sync.setCompletedDay('nope', '2026-11-09', NOW)).toBeNull()
      expect(useTasksStore().task('l1')?.completedAt).toEqual(DONE_TODAY)
      expect(useTasksStore().task('l1')?.completedAtCorrected).toBeUndefined()
      expect(secondsByDay()).toEqual({ '2026-11-10': 3000 })
    })

    it('moves the record of an archived task too', () => {
      useTasksStore().archiveTasks(['l1'])
      useTaskSync().setCompletedDay('l1', '2026-11-09', NOW)
      expect(secondsByDay()).toEqual({ '2026-11-09': 2400, '2026-11-10': 600 })
    })

    it('a done task without a record gets one on the corrected day', () => {
      useTaskStatisticsStore().removeTaskRecord('l1')
      useTaskSync().setCompletedDay('l1', '2026-11-09', NOW)
      expect(secondsByDay()).toEqual({ '2026-11-09': 2400, '2026-11-10': 600 })
    })

    it('completing the task again starts from the new completion, not the corrected day', async () => {
      const sync = useTaskSync()
      sync.setCompletedDay('l1', '2026-11-09', NOW)
      await sync.updateTaskStatus({ taskId: 'l1', status: TaskStatus.Open })
      await sync.updateTaskStatus({ taskId: 'l1', status: TaskStatus.Done })
      const again = useTasksStore().task('l1')!
      expect(again.completedAtCorrected).toBeUndefined()
      expect(dayKey(again.completedAt!)).toBe(dayKey(new Date()))
    })
  })

  describe('on a Notion task', () => {
    beforeEach(() => {
      useBoardStore().setSources({ connected: ['notion'], default: 'notion' })
      useTasksStore().setTasks([task('n1', { source: 'notion', externalId: 'page-n1' })])
      useIntegrationHealthStore().recordSuccessfulSync('notion')
    })

    it('pushes the corrected time through the adapter and keeps it over an echo that reports another time', async () => {
      // A database without a completion-date property answers with "now" for a done task
      notion.updateTask.mockImplementation(async (t) => ({ ...t, completedAt: new Date() }))
      const stored = useTaskSync().setCompletedDay('n1', '2026-11-09', NOW)

      await vi.waitFor(() => expect(useTasksStore().task('n1')?.pendingSync).toBeUndefined())

      expect(notion.updateTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'n1', completedAt: stored }))
      expect(useTasksStore().task('n1')).toMatchObject({ completedAt: stored, completedAtCorrected: true })
    })

    it('survives the next fetch, and the statistics stay on the corrected day', async () => {
      notion.updateTask.mockImplementation(async (t) => ({ ...t }))
      const stored = useTaskSync().setCompletedDay('n1', '2026-11-09', NOW)
      await vi.waitFor(() => expect(useTasksStore().task('n1')?.pendingSync).toBeUndefined())

      useTasksStore().mergeTasks('notion', [task('page-n1', { source: 'notion', externalId: 'page-n1', completedAt: new Date(2026, 10, 10, 12) })])

      expect(useTasksStore().task('n1')?.completedAt).toEqual(stored)
      await vi.waitFor(() => expect(secondsByDay()).toEqual({ '2026-11-09': 2400 }))
    })

    it('a failed push keeps the corrected day and the pending marker for the retry', async () => {
      notion.updateTask.mockRejectedValue(new Error('Network error'))
      const stored = useTaskSync().setCompletedDay('n1', '2026-11-09', NOW)
      await vi.waitFor(() => expect(useTasksStore().task('n1')?.pendingSync?.attempts).toBe(1))
      expect(useTasksStore().task('n1')?.completedAt).toEqual(stored)
    })
  })
})
