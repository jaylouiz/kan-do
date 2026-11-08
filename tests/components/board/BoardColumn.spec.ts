/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import BoardColumn from '~/components/board/BoardColumn.vue'
import { TaskStatus } from '~/types/taskStatus'
import { setTestLocale } from '~/tests/helpers/i18n'
import { useTaskDraft } from '~/composables/useTaskDraft'

// Stub browser APIs not available in jsdom
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// Mock ColumnDropZone to prevent @dnd-kit/vue from loading (ResizeObserver unavailable in jsdom)
vi.mock('~/components/board/ColumnDropZone.vue', () => ({
  default: { template: '<div />' }
}))

// Mocks
const flags = vi.hoisted(() => ({ openColumnAddButton: true }))
vi.mock('~/utils/featureFlags', () => ({
  useFeatureFlags: () => flags,
}))

vi.mock('~/composables/useColumnSortable', () => ({
  useColumnSortable: () => ({
    isDragging: { value: false },
    isDropTarget: { value: false },
    isDragSource: { value: false },
  })
}))

vi.mock('~/composables/useBoardDragState', () => ({
  useBoardDragState: () => ({
    dragState: { value: { isDragging: false, draggedTaskId: null, sourceColumnEl: null } }
  })
}))

vi.mock('~/store/tasks', () => ({
  useTasksStore: () => ({
    tasksDonePrevious: [],
  })
}))

vi.mock('~/store/board', () => ({
  useBoardStore: () => ({
    columnByTaskStatus: vi.fn().mockReturnValue({ sorting: { field: 'manual', direction: 'asc' } }),
    setColumnSorting: vi.fn(),
  })
}))

// BoardColumn relies on the Nuxt auto-import of navigateTo
const navigateTo = vi.hoisted(() => vi.fn())
vi.stubGlobal('navigateTo', navigateTo)
vi.mock('nuxt/app', () => ({ navigateTo }))

// Stub components
const stubs = {
  BoardColumnHeader: true,
  ColumnSortingControl: {
    template: '<div data-testid="sorting-control"></div>',
    props: ['visible', 'status', 'sorting']
  },
  BoardColumnYesterdayNote: true,
  BoardColumnProgressContent: true,
  TaskStack: true,
  SortableTaskWrapper: { template: '<div><slot /></div>' },
  TaskCardContextMenu: { template: '<div><slot /></div>' },
  TaskCard: true,
  ColumnDropZone: true,
  AddTaskSlot: {
    props: ['status', 'label', 'showButton', 'hidden'],
    template: '<div data-testid="add-slot" :data-status="status" :data-show-button="String(showButton)" :data-hidden="String(hidden)">{{ label }}</div>',
  },
  UDropdownMenu: true,
  UButton: true,
}

describe('BoardColumn', () => {
  it('hides sorting control for Progress column', () => {
    const wrapper = mount(BoardColumn, {
      props: {
        taskStatus: TaskStatus.Progress,
        tasks: [{ id: '1', title: 'Task 1', status: TaskStatus.Progress } as any],
        isDragging: false,
        muteOthers: false
      },
      global: { stubs }
    })
    
    expect(wrapper.find('[data-testid="sorting-control"]').exists()).toBe(false)
  })

  it('hides sorting control for empty columns', () => {
    const wrapper = mount(BoardColumn, {
      props: {
        taskStatus: TaskStatus.Open,
        tasks: [],
        isDragging: false,
        muteOthers: false
      },
      global: { stubs }
    })
    
    expect(wrapper.find('[data-testid="sorting-control"]').exists()).toBe(false)
  })

  it('shows sorting control for non-progress column with tasks', () => {
    const wrapper = mount(BoardColumn, {
      props: {
        taskStatus: TaskStatus.Open,
        tasks: [
          { id: '1', title: 'Task 1', status: TaskStatus.Open } as any,
          { id: '2', title: 'Task 2', status: TaskStatus.Open } as any,
        ],
        isDragging: false,
        muteOthers: false
      },
      global: { stubs }
    })
    
    expect(wrapper.find('[data-testid="sorting-control"]').exists()).toBe(true)
  })
  
  it('positions sorting control in a flex container for centering', () => {
     const wrapper = mount(BoardColumn, {
      props: {
        taskStatus: TaskStatus.Open,
        tasks: [
          { id: '1', title: 'Task 1', status: TaskStatus.Open } as any,
          { id: '2', title: 'Task 2', status: TaskStatus.Open } as any,
        ],
        isDragging: false,
        muteOthers: false
      },
      global: { stubs }
    })
    
    const control = wrapper.find('[data-testid="sorting-control"]')
    const container = control.element.parentElement
    expect(container?.className).toContain('relative')
    expect(container?.className).toContain('h-10')
    expect(container?.className).toContain('flex')
    expect(container?.className).toContain('items-center')
    expect(container?.className).toContain('justify-center')
  })
  it('renders localized column headlines', () => {
    const mountWaiting = () => mount(BoardColumn, {
      props: { taskStatus: TaskStatus.Waiting, tasks: [], isDragging: false, muteOthers: false },
      global: { stubs },
    })
    const title = (w: ReturnType<typeof mountWaiting>) => w.find('board-column-header-stub').attributes('title')

    expect(title(mountWaiting())).toBe('Wartet?')
    setTestLocale('en')
    expect(title(mountWaiting())).toBe('Waiting?')
  })

  describe('add slot (#125)', () => {
    const mountStatus = (taskStatus: TaskStatus, isDragging = false) => mount(BoardColumn, {
      props: { taskStatus, tasks: [], isDragging, muteOthers: false },
      global: { stubs },
    })
    const slot = (w: ReturnType<typeof mountStatus>) => w.find('[data-testid="add-slot"]')

    afterEach(() => {
      flags.openColumnAddButton = true
      useTaskDraft().clearDraft()
    })

    it('renders the labelled slot only in the Open column', () => {
      expect(slot(mountStatus(TaskStatus.Open)).text()).toBe('Aufgabe hinzufügen')
      expect(slot(mountStatus(TaskStatus.Open)).attributes('data-status')).toBe(String(TaskStatus.Open))
      expect(slot(mountStatus(TaskStatus.Waiting)).exists()).toBe(false)
      expect(slot(mountStatus(TaskStatus.Done)).exists()).toBe(false)
    })

    it('respects the feature flag, but keeps an Offen draft opened another way (command palette)', () => {
      flags.openColumnAddButton = false
      expect(slot(mountStatus(TaskStatus.Open)).exists()).toBe(false)
      useTaskDraft().startDraft()
      const w = mountStatus(TaskStatus.Open)
      expect(slot(w).exists()).toBe(true)
      expect(slot(w).attributes('data-show-button')).toBe('false')
    })

    it('stays mounted but hidden during a drag, so the list does not collapse', () => {
      expect(slot(mountStatus(TaskStatus.Open)).attributes('data-hidden')).toBe('false')
      expect(slot(mountStatus(TaskStatus.Open, true)).attributes('data-hidden')).toBe('true')
    })

    it('is not rendered in static mode', () => {
      const w = mount(BoardColumn, {
        props: { taskStatus: TaskStatus.Open, tasks: [], isDragging: false, muteOthers: false, staticMode: true },
        global: { stubs },
      })
      expect(slot(w).exists()).toBe(false)
    })
  })

  describe('opening a card (#111, kd#25)', () => {
    const openTasks = [{ id: 'a', title: 'A', status: TaskStatus.Open } as any]
    const mountOpen = (extra: Record<string, unknown> = {}) =>
      mount(BoardColumn, {
        props: { taskStatus: TaskStatus.Open, tasks: openTasks, isDragging: false, muteOthers: false, ...extra },
        global: {
          stubs: {
            ...stubs,
            TaskCard: { props: ['task'], emits: ['open'], template: '<div class="task" @click="$emit(\'open\', task.id)" />' },
          },
        },
      })

    beforeEach(() => navigateTo.mockClear())

    it('navigates exactly once per open gesture', async () => {
      const wrapper = mountOpen()
      await wrapper.find('.task').trigger('click')
      expect(navigateTo).toHaveBeenCalledTimes(1)
      expect(navigateTo).toHaveBeenCalledWith({ path: '/tasks/a' })
    })

    it('does not navigate in static mode', async () => {
      const wrapper = mountOpen({ staticMode: true })
      await wrapper.find('.task').trigger('click')
      expect(navigateTo).not.toHaveBeenCalled()
    })
  })
})
