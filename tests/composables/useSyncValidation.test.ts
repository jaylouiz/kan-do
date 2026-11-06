import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

// tasksStore.tasks will be controlled via this ref
const localTasksMock = ref<Task[]>([])

vi.mock('~/store/tasks', () => ({
  useTasksStore: () => ({
    get tasks() { return localTasksMock.value },
  }),
}))

// eslint-disable-next-line import/first
import { useSyncValidation, resetSyncValidation } from '~/composables/useSyncValidation'

function makeTasks(count: number, source: 'local' | 'notion' = 'notion'): Task[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `task-${i}`, source, externalId: source === 'local' ? null : `task-${i}`,
    title: `Task ${i}`,
    status: TaskStatus.Open,
    activity: null,
    topic: null,
    topicColorCode: null,
    priority: 1,
    notes: null,
    timeBoxSeconds: null,
    timeSpentSeconds: 0,
    timerId: null,
  }))
}

describe('useSyncValidation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localTasksMock.value = []
    resetSyncValidation()
  })

  describe('validateSyncResult', () => {
    it('returns valid when there are no local tasks and fetched is empty', () => {
      localTasksMock.value = []
      const { validateSyncResult } = useSyncValidation()
      const result = validateSyncResult('notion', [])
      expect(result.isValid).toBe(true)
      expect(result.needsConfirmation).toBe(false)
    })

    it('returns valid when local tasks exist and fetched count is similar', () => {
      localTasksMock.value = makeTasks(10)
      const { validateSyncResult } = useSyncValidation()
      const result = validateSyncResult('notion', makeTasks(9))
      expect(result.isValid).toBe(true)
      expect(result.needsConfirmation).toBe(false)
    })

    it('flags empty fetched result when local tasks exist', () => {
      localTasksMock.value = makeTasks(5)
      const { validateSyncResult } = useSyncValidation()
      const result = validateSyncResult('notion', [])
      expect(result.isValid).toBe(false)
      expect(result.needsConfirmation).toBe(true)
      expect(result.reason).toBe('empty_sync_with_local_data')
    })

    it('flags >80% task count drop', () => {
      localTasksMock.value = makeTasks(100)
      const { validateSyncResult } = useSyncValidation()
      // 15 fetched = 85% drop
      const result = validateSyncResult('notion', makeTasks(15))
      expect(result.isValid).toBe(false)
      expect(result.needsConfirmation).toBe(true)
      expect(result.reason).toBe('significant_task_count_drop')
    })

    it('does not flag exactly 80% drop', () => {
      localTasksMock.value = makeTasks(100)
      const { validateSyncResult } = useSyncValidation()
      // 20 fetched = 80% drop (not >80%)
      const result = validateSyncResult('notion', makeTasks(20))
      expect(result.isValid).toBe(true)
      expect(result.needsConfirmation).toBe(false)
    })

    it('does not flag moderate reduction', () => {
      localTasksMock.value = makeTasks(10)
      const { validateSyncResult } = useSyncValidation()
      const result = validateSyncResult('notion', makeTasks(5))
      expect(result.isValid).toBe(true)
      expect(result.needsConfirmation).toBe(false)
    })
  })

  describe('validateSyncResult on a mixed board', () => {
    const notionTasks = (count: number): Task[] =>
      makeTasks(count).map((task) => ({ ...task, id: `n-${task.id}`, externalId: `n-${task.id}` }))

    it('ignores Local tasks when the fetched Notion tasks match the stored Notion tasks', () => {
      localTasksMock.value = [...makeTasks(20, 'local'), ...notionTasks(4)]
      const { validateSyncResult } = useSyncValidation()
      const result = validateSyncResult('notion', notionTasks(4))
      expect(result.isValid).toBe(true)
      expect(result.needsConfirmation).toBe(false)
    })

    it('is valid for a first Notion fetch while only Local tasks are stored', () => {
      localTasksMock.value = makeTasks(20, 'local')
      const { validateSyncResult } = useSyncValidation()
      expect(validateSyncResult('notion', notionTasks(3)).needsConfirmation).toBe(false)
      expect(validateSyncResult('notion', []).needsConfirmation).toBe(false)
    })

    it('still flags a drop within the fetched source', () => {
      localTasksMock.value = [...makeTasks(3, 'local'), ...notionTasks(10)]
      const { validateSyncResult } = useSyncValidation()
      expect(validateSyncResult('notion', notionTasks(1)).reason).toBe('significant_task_count_drop')
      expect(validateSyncResult('notion', []).reason).toBe('empty_sync_with_local_data')
    })
  })

  describe('requestUserConfirmation', () => {
    it('sets showWarningModal to true', () => {
      const { requestUserConfirmation, showWarningModal } = useSyncValidation()
      expect(showWarningModal.value).toBe(false)
      requestUserConfirmation() // don't await — just trigger it
      expect(showWarningModal.value).toBe(true)
    })

    it('resolves true when handleConfirm is called', async () => {
      const { requestUserConfirmation, handleConfirm } = useSyncValidation()
      const promise = requestUserConfirmation()
      handleConfirm()
      const result = await promise
      expect(result).toBe(true)
    })

    it('resolves false when handleCancel is called', async () => {
      const { requestUserConfirmation, handleCancel } = useSyncValidation()
      const promise = requestUserConfirmation()
      handleCancel()
      const result = await promise
      expect(result).toBe(false)
    })
  })

  describe('validateAndConfirm', () => {
    it('returns true without modal when validation passes', async () => {
      localTasksMock.value = makeTasks(5)
      const { validateAndConfirm } = useSyncValidation()
      const result = await validateAndConfirm('notion', makeTasks(4))
      expect(result).toBe(true)
    })

    it('shows modal and returns true when user confirms suspicious sync', async () => {
      localTasksMock.value = makeTasks(5)
      const { validateAndConfirm, handleConfirm, showWarningModal } = useSyncValidation()

      const promise = validateAndConfirm('notion', [])
      expect(showWarningModal.value).toBe(true)
      handleConfirm()
      const result = await promise
      expect(result).toBe(true)
    })

    it('shows modal and returns false when user cancels', async () => {
      localTasksMock.value = makeTasks(5)
      const { validateAndConfirm, handleCancel } = useSyncValidation()

      const promise = validateAndConfirm('notion', [])
      handleCancel()
      const result = await promise
      expect(result).toBe(false)
    })
  })
  describe('Local tasks never take part (#318)', () => {
    it('does not warn for Local, whatever the fetched count', () => {
      localTasksMock.value = makeTasks(10, 'local')
      const { validateSyncResult } = useSyncValidation()
      expect(validateSyncResult('local', []).needsConfirmation).toBe(false)
      expect(validateSyncResult('local', makeTasks(1, 'local')).needsConfirmation).toBe(false)
    })

    it('counts only the fetched source: stored Local tasks do not hide a Notion drop', async () => {
      localTasksMock.value = [...makeTasks(50, 'local'), ...makeTasks(10)]
      const { validateAndConfirm, handleCancel, warning } = useSyncValidation()
      const promise = validateAndConfirm('notion', [])
      expect(warning.value).toMatchObject({ source: 'notion', reason: 'empty_sync_with_local_data', currentTaskCount: 10, fetchedCount: 0 })
      handleCancel()
      expect(await promise).toBe(false)
    })
  })

  describe('one shared warning state (#337)', () => {
    it('shows the warning of one instance in another: the page and the manager see the same modal', async () => {
      localTasksMock.value = makeTasks(5)
      const manager = useSyncValidation()
      const page = useSyncValidation()

      const promise = manager.validateAndConfirm('notion', [])
      expect(page.showWarningModal.value).toBe(true)
      expect(page.warning.value?.source).toBe('notion')

      page.handleConfirm()
      expect(await promise).toBe(true)
      expect(manager.showWarningModal.value).toBe(false)
    })

    it('cancelling in one instance resolves the other instance\'s validation with false', async () => {
      localTasksMock.value = makeTasks(5)
      const promise = useSyncValidation().validateAndConfirm('notion', [])
      useSyncValidation().handleCancel()
      expect(await promise).toBe(false)
    })
  })

  describe('several sources warn in the same refresh', () => {
    it('asks one after the other, each answer resolves its own source', async () => {
      localTasksMock.value = [...makeTasks(5), ...makeTasks(5, 'local').map((task) => ({ ...task, id: `t-${task.id}`, source: 'todoist' as const, externalId: `t-${task.id}` }))]
      const { validateAndConfirm, handleConfirm, handleCancel, warning } = useSyncValidation()

      const notion = validateAndConfirm('notion', [])
      const todoist = validateAndConfirm('todoist', [])
      expect(warning.value?.source).toBe('notion')

      handleConfirm()
      expect(await notion).toBe(true)
      expect(warning.value?.source).toBe('todoist')

      handleCancel()
      expect(await todoist).toBe(false)
      expect(warning.value).toBeNull()
    })

    it('a newer warning for the same source replaces the waiting one and cancels it', async () => {
      localTasksMock.value = makeTasks(5)
      const { validateAndConfirm, handleConfirm } = useSyncValidation()

      const stale = validateAndConfirm('notion', [])
      const fresh = validateAndConfirm('notion', [])
      expect(await stale).toBe(false)

      handleConfirm()
      expect(await fresh).toBe(true)
    })
  })
})
