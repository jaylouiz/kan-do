import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { navigateTo } from 'nuxt/app'
import { setActivePinia, createPinia } from 'pinia'
import { useCommandPalette } from '~/composables/useCommandPalette'
import { resetFeedbackState, useFeedback } from '~/composables/useFeedback'

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

const setDesktop = (on: boolean) => {
  if (on) (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
  else delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
}
const globalItems = () => {
  const palette = useCommandPalette()
  return { palette, items: palette.groups.value.filter(g => g.id.startsWith('global-')).flatMap(g => g.items as Item[]) }
}

describe('command palette: send feedback (desktop only)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(navigateTo).mockClear()
    resetFeedbackState()
    document.body.innerHTML = ''
  })
  afterEach(() => setDesktop(false))

  it('web does not list the entry', () => {
    setDesktop(false)
    expect(globalItems().items.map(i => i.id)).not.toContain('send-feedback')
  })

  it('desktop closes the palette first and opens the dialog only after the palette has left', async () => {
    setDesktop(true)
    const { palette, items } = globalItems()
    const feedback = useFeedback()
    palette.isOpen.value = true
    items.find(i => i.id === 'send-feedback')!.onSelect()
    expect(palette.isOpen.value).toBe(false)
    expect(feedback.isOpen.value).toBe(false) // never modal on modal

    palette.restoreFocus() // the palette's after:leave
    // From any page (#224): the board first, where the dialog is mounted
    await vi.waitFor(() => expect(feedback.isOpen.value).toBe(true))
    expect(navigateTo).toHaveBeenCalledWith('/tasks')
  })
})
