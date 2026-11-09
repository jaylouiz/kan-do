import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, getActivePinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import UiCatalogBoardHost from '~/dev-tools/ui-catalog/BoardSampleHost.vue'
import { useTasksStore } from '~/store/tasks'

// The drag-and-drop provider is not under test: a plain box keeps jsdom out of dnd-kit's DOM measuring.
vi.mock('@dnd-kit/vue', () => ({ DragDropProvider: { name: 'DragDropProvider', template: '<div><slot /></div>' } }))

// What a store-bound block does in `setup`: read a store, and report what that store holds.
const seen = { open: -1, progress: -1, forOpen: -1, forDone: -1 }
const Probe = defineComponent({
  props: { tasksFor: { type: Function, required: true } },
  setup(props) {
    const tasks = useTasksStore()
    seen.open = tasks.tasksOpen.length
    seen.progress = tasks.tasksProgress.length
    seen.forOpen = (props.tasksFor as (kind: string) => unknown[])('open').length
    seen.forDone = (props.tasksFor as (kind: string) => unknown[])('done').length
    return () => h('i')
  },
})

describe('the board sample host of /ui (#77, D2)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('seeds a store of its own with the demo board and leaves the app\'s store and storage alone', () => {
    const appPinia = createPinia()
    setActivePinia(appPinia)
    const appTasks = useTasksStore(appPinia)
    appTasks.setTasks([])
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    const wrapper = mount(UiCatalogBoardHost, {
      slots: { default: ({ tasksFor }: { tasksFor: unknown }) => h(Probe, { tasksFor: tasksFor as never }) },
      global: { plugins: [appPinia] },
    })

    // the block read the sample's store: the demo board, one card in Jetzt, the open cards, today's done cards
    expect(seen.open).toBeGreaterThan(1)
    expect(seen.progress).toBe(1)
    expect(seen.forOpen).toBe(seen.open)
    expect(seen.forDone).toBeGreaterThan(0)
    // the app's store did not move, and nothing reached storage
    expect(appTasks.tasksOpen).toHaveLength(0)
    expect(setItem).not.toHaveBeenCalled()
    expect(appTasks.tasksProgress).toHaveLength(0)
    expect(appTasks.tasksDoneToday).toHaveLength(0)

    // unmounting hands the app's Pinia back as the active one
    wrapper.unmount()
    expect(getActivePinia()).toBe(appPinia)
  })
})
