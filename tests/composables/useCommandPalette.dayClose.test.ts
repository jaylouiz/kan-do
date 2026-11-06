import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useCommandPalette } from '~/composables/useCommandPalette'
import { useDayClose } from '~/composables/useDayClose'

vi.mock('nuxt/app', () => ({ navigateTo: vi.fn() }))
vi.mock('~/composables/useTaskOperations', () => ({
  useTaskOperations: () => ({ moveTaskToStatus: vi.fn(), canMoveToStatus: () => ({ allowed: true }) }),
}))
vi.mock('~/composables/useTaskDeletion', () => ({
  useTaskDeletion: () => ({ deleteTaskWithUndo: vi.fn() }),
}))
vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({ syncExistingDoneTasks: vi.fn(), updateTaskRecord: vi.fn() }),
}))

type Item = { id: string, onSelect: () => void }

describe('command palette: close the day', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useDayClose().close()
    document.body.innerHTML = ''
  })

  it('closes the palette first and opens the dialog only after the palette has left', () => {
    const palette = useCommandPalette({ openStatistics: vi.fn(), openSettings: vi.fn() })
    const dayClose = useDayClose()
    palette.isOpen.value = true // open() is client-only (import.meta.client is false in Vitest)

    const global = palette.groups.value.find(g => g.id === 'global')!
    const item = (global.items as Item[]).find(i => i.id === 'day-close')!
    item.onSelect()

    expect(palette.isOpen.value).toBe(false)
    expect(dayClose.isOpen.value).toBe(false) // never modal on modal: still waiting for the leave animation

    palette.restoreFocus() // the palette's after:leave
    expect(dayClose.isOpen.value).toBe(true)
  })

  it('does not open the dialog when a later palette run starts without choosing the command', () => {
    const palette = useCommandPalette({ openStatistics: vi.fn(), openSettings: vi.fn() })
    palette.isOpen.value = true
    palette.restoreFocus()
    expect(useDayClose().isOpen.value).toBe(false)
  })
})
