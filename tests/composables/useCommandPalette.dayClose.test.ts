import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { navigateTo } from 'nuxt/app'
import { setActivePinia, createPinia } from 'pinia'
import { useCommandPalette } from '~/composables/useCommandPalette'
import { useDayClose } from '~/composables/useDayClose'
import { resetAppResetState, useAppReset } from '~/composables/useAppReset'

vi.mock('nuxt/app', () => ({ navigateTo: vi.fn(), useRouter: () => ({ currentRoute: ref({ path: '/tasks' }) }) }))
vi.mock('~/composables/useTaskOperations', () => ({
  useTaskOperations: () => ({ moveOrSwapToStatus: vi.fn(), canMoveOrSwapToStatus: () => ({ allowed: true }) }),
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
    vi.mocked(navigateTo).mockClear()
    useDayClose().close()
    document.body.innerHTML = ''
  })

  it('closes the palette first and opens the dialog only after the palette has left', async () => {
    const palette = useCommandPalette()
    const dayClose = useDayClose()
    palette.isOpen.value = true // open() is client-only (import.meta.client is false in Vitest)

    const global = palette.groups.value.find(g => g.id === 'global-actions')!
    const item = (global.items as Item[]).find(i => i.id === 'day-close')!
    item.onSelect()

    expect(palette.isOpen.value).toBe(false)
    expect(dayClose.isOpen.value).toBe(false) // never modal on modal: still waiting for the leave animation

    palette.restoreFocus() // the palette's after:leave
    // From any page (#224): the board first, where the dialog is mounted, then the dialog
    await vi.waitFor(() => expect(dayClose.isOpen.value).toBe(true))
    expect(navigateTo).toHaveBeenCalledWith('/tasks')
  })

  it('does not open the dialog when a later palette run starts without choosing the command', () => {
    const palette = useCommandPalette()
    palette.isOpen.value = true
    palette.restoreFocus()
    expect(useDayClose().isOpen.value).toBe(false)
  })
})

describe('command palette: reset the app (kd#227)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetAppResetState()
    vi.mocked(navigateTo).mockClear()
    document.body.innerHTML = ''
  })

  it('closes the palette, goes to Daten & Speicher with the question open and erases nothing', () => {
    const palette = useCommandPalette()
    const reset = useAppReset()
    palette.isOpen.value = true

    const global = palette.groups.value.find(g => g.id === 'global-data')!
    const item = (global.items as Item[]).find(i => i.id === 'reset-app')!
    item.onSelect()

    expect(palette.isOpen.value).toBe(false)
    expect(navigateTo).toHaveBeenCalledWith('/settings/data')
    expect(reset.isOpen.value).toBe(true) // the section asks in place once the page is there
    expect(reset.busy.value).toBe(false) // confirming is the section's job
  })
})
