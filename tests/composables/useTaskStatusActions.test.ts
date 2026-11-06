import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import { useTaskStatusActions } from '~/composables/useTaskStatusActions'

const updateTaskStatusMock = vi.fn()

vi.mock('~/composables/useTaskOperations', () => ({
  useTaskOperations: () => ({
    moveTaskToStatus: updateTaskStatusMock,
  }),
}))

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1', source: 'local', externalId: null,
    title: 'Test',
    status: TaskStatus.Open,
    activity: null,
    topic: null,
    topicColorCode: null,
    priority: 1,
    notes: null,
    timeBoxSeconds: null,
    timeSpentSeconds: 0,
    timerId: null,
    ...overrides,
  }
}

describe('useTaskStatusActions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    updateTaskStatusMock.mockReset()
    updateTaskStatusMock.mockResolvedValue(undefined)
  })

  describe('changeStatus', () => {
    it('calls updateTaskStatus with the given taskId and status', async () => {
      const task = ref(makeTask({ id: 'abc', source: 'local', externalId: null, status: TaskStatus.Open }))
      const { changeStatus } = useTaskStatusActions(task)

      await changeStatus(TaskStatus.Done)

      expect(updateTaskStatusMock).toHaveBeenCalledWith('abc', TaskStatus.Done)
    })

    it('does nothing when task is null', async () => {
      const task = ref<Task | null>(null)
      const { changeStatus } = useTaskStatusActions(task)

      await changeStatus(TaskStatus.Done)

      expect(updateTaskStatusMock).not.toHaveBeenCalled()
    })

    it('does nothing when task has no id', async () => {
      const task = ref<Task | null>(makeTask({ id: '' }))
      const { changeStatus } = useTaskStatusActions(task)

      await changeStatus(TaskStatus.Done)

      expect(updateTaskStatusMock).not.toHaveBeenCalled()
    })
  })

  describe('statusMenuItems', () => {
    it('returns exactly 4 items in a single section', () => {
      const task = ref(makeTask({ status: TaskStatus.Open }))
      const { statusMenuItems } = useTaskStatusActions(task)

      expect(statusMenuItems.value).toHaveLength(1)
      expect(statusMenuItems.value[0]).toHaveLength(4)
    })

    it('disables only the current status item', () => {
      const task = ref(makeTask({ status: TaskStatus.Progress }))
      const { statusMenuItems } = useTaskStatusActions(task)

      const items = statusMenuItems.value[0]!
      const disabledItems = items.filter(i => i.disabled)
      const enabledItems = items.filter(i => !i.disabled)

      expect(disabledItems).toHaveLength(1)
      expect(enabledItems).toHaveLength(3)
    })

    it('disables the Open item when task is Open', () => {
      const task = ref(makeTask({ status: TaskStatus.Open }))
      const { statusMenuItems } = useTaskStatusActions(task)
      const items = statusMenuItems.value[0]!

      const openItem = items.find(i => i.label === 'Offen')
      expect(openItem?.disabled).toBe(true)
    })

    it('disables the Progress item when task is In Progress', () => {
      const task = ref(makeTask({ status: TaskStatus.Progress }))
      const { statusMenuItems } = useTaskStatusActions(task)
      const items = statusMenuItems.value[0]!

      const progressItem = items.find(i => i.label === 'Jetzt')
      expect(progressItem?.disabled).toBe(true)
    })

    it('disables the Done item when task is Done', () => {
      const task = ref(makeTask({ status: TaskStatus.Done }))
      const { statusMenuItems } = useTaskStatusActions(task)
      const items = statusMenuItems.value[0]!

      const doneItem = items.find(i => i.label === 'Erledigt')
      expect(doneItem?.disabled).toBe(true)
    })

    it('uses Open as default when task is null', () => {
      const task = ref<Task | null>(null)
      const { statusMenuItems } = useTaskStatusActions(task)
      const items = statusMenuItems.value[0]!

      const openItem = items.find(i => i.label === 'Offen')
      expect(openItem?.disabled).toBe(true)
    })

    it('updates reactively when task status changes', () => {
      const task = ref(makeTask({ status: TaskStatus.Open }))
      const { statusMenuItems } = useTaskStatusActions(task)

      expect(statusMenuItems.value[0]!.find(i => i.label === 'Offen')?.disabled).toBe(true)

      task.value = makeTask({ status: TaskStatus.Done })

      expect(statusMenuItems.value[0]!.find(i => i.label === 'Erledigt')?.disabled).toBe(true)
      expect(statusMenuItems.value[0]!.find(i => i.label === 'Offen')?.disabled).toBe(false)
    })
  })
})
