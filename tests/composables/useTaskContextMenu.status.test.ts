/**
 * #241: the context menu's "Status ändern" entries follow `canMoveOrSwapToStatus` (a full Jetzt that the task can
 * take over is a plain, enabled "Jetzt") and choosing one goes through `moveOrSwapToStatus`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import type { Task } from '~/types/task'
import { TaskStatus } from '~/types/taskStatus'
import { setTestLocale } from '../helpers/i18n'

vi.mock('nuxt/app', () => ({ navigateTo: vi.fn() }))
const moveOrSwapToStatus = vi.fn(async () => true)
const canMoveOrSwapToStatus = vi.fn((_id: string, _status: TaskStatus) => ({ allowed: true }) as { allowed: boolean, reason?: string })
vi.mock('~/composables/useTaskOperations', () => ({
  useTaskOperations: () => ({ moveOrSwapToStatus, canMoveOrSwapToStatus }),
}))
vi.mock('~/composables/useTaskDeletion', () => ({ useTaskDeletion: () => ({ deleteTaskWithUndo: vi.fn() }) }))
vi.mock('~/composables/useTaskMove', () => ({ useTaskMove: () => ({ moveTaskToSource: vi.fn() }) }))

/* eslint-disable import/first -- order-sensitive: mocks must be registered before the SUT is imported */
import { useTaskContextMenu } from '~/composables/useTaskContextMenu'
import { useTasksStore } from '~/store/tasks'
/* eslint-enable import/first */

type Item = { label?: string, disabled?: boolean, children?: Item[], onSelect?: () => void }

const task: Task = {
  id: 'a', source: 'local', externalId: null, title: 'A', status: TaskStatus.Open, activity: null, topic: null, topicColorCode: null,
  priority: 2, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null,
}

describe('useTaskContextMenu: status children (#241)', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    moveOrSwapToStatus.mockClear()
    canMoveOrSwapToStatus.mockReset().mockReturnValue({ allowed: true })
    setTestLocale('de')
  })

  const statusChildren = (t: Task = task): Item[] => {
    useTasksStore().setTasks([t])
    const groups = useTaskContextMenu(ref(t)).menuItems.value as Item[][]
    return groups.flat().find(i => i.label === 'Status ändern')!.children!
  }

  it('a task that can swap sees an enabled, plain "Jetzt" (no "max. erreicht")', () => {
    const jetzt = statusChildren().find(i => i.label?.startsWith('Jetzt'))!
    expect(jetzt.label).toBe('Jetzt')
    expect(jetzt.disabled).toBe(false)
    expect(canMoveOrSwapToStatus).toHaveBeenCalledWith('a', TaskStatus.Progress)
  })

  it('a refused Jetzt stays disabled with the reason in the label', () => {
    canMoveOrSwapToStatus.mockImplementation((_id, status) => status === TaskStatus.Progress ? { allowed: false, reason: 'progressFull' } : { allowed: true })
    const jetzt = statusChildren({ ...task, status: TaskStatus.Done }).find(i => i.label?.startsWith('Jetzt'))!
    expect(jetzt.label).toBe('Jetzt (max. erreicht)')
    expect(jetzt.disabled).toBe(true)
  })

  it('the entry of the current status is disabled; choosing another runs the swap-aware move', () => {
    const children = statusChildren()
    expect(children.find(i => i.label === 'Heute')!.disabled).toBe(true)
    children.find(i => i.label === 'Jetzt')!.onSelect!()
    expect(moveOrSwapToStatus).toHaveBeenCalledWith('a', TaskStatus.Progress)
  })

  it('choosing the current status moves nothing', () => {
    statusChildren().find(i => i.label === 'Heute')!.onSelect!()
    expect(moveOrSwapToStatus).not.toHaveBeenCalled()
  })
})
