/**
 * Hardening of useBoardDndKit against dnd-kit's private API (#379): `refreshDroppableShapes` survives a
 * manager without the members it reads and its frames die with the drag; the WIP check falls back to the
 * sortable's `group` when `initialGroup` is missing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import { useTasksStore } from '~/store/tasks'
import { useBoardDndKit } from '~/composables/useBoardDndKit'
import { sourceOf, switchSource } from '../helpers/taskSource'

vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: vi.fn(), handleSuccess: vi.fn() }),
}))
vi.mock('@dnd-kit/vue/sortable', () => ({
  isSortable: (source: unknown) => source !== null && typeof source === 'object' && 'initialGroup' in source,
}))

const makeTask = (id: string, status: TaskStatus): Task => ({
  id, ...sourceOf(id),
  title: id,
  status,
  activity: null,
  topic: null,
  topicColorCode: null,
  priority: 0,
  notes: null,
  timeSpentSeconds: 0,
  timeBoxSeconds: null,
  timerId: null,
})

/** Manual animation frames: `flushFrames` runs what is queued and not cancelled, one generation per call */
let queued: Map<number, FrameRequestCallback>
let nextHandle: number
const flushFrames = () => {
  const run = [...queued.entries()]
  queued.clear()
  run.forEach(([, callback]) => callback(0))
}

const onScreen = { getBoundingClientRect: () => ({ left: 10, right: 100 }) }

describe('useBoardDndKit: refreshDroppableShapes (#379)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    switchSource('local')
    queued = new Map()
    nextHandle = 1
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      queued.set(nextHandle, callback)
      return nextHandle++
    })
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => queued.delete(handle))
  })
  afterEach(() => vi.unstubAllGlobals())

  const startDrag = (manager: unknown) => {
    const kit = useBoardDndKit()
    kit.onDragStart({ operation: { source: { id: 't1', group: TaskStatus.Open, manager } as never } })
    return kit
  }

  it('refreshes the droppables that are on the visible page, two frames later', () => {
    const visible = vi.fn()
    const hidden = vi.fn()
    const kit = startDrag({ registry: { droppables: [
      { element: onScreen, refreshShape: visible },
      { element: { getBoundingClientRect: () => ({ left: 5000, right: 5100 }) }, refreshShape: hidden },
    ] } })
    kit.refreshDroppableShapes()
    flushFrames()
    expect(visible).not.toHaveBeenCalled()
    flushFrames()
    expect(visible).toHaveBeenCalledTimes(1)
    expect(hidden).not.toHaveBeenCalled()
  })

  it.each([
    ['no registry', {}],
    ['no droppables', { registry: {} }],
    ['a droppable without refreshShape', { registry: { droppables: [{ element: onScreen }] } }],
    ['a droppable that throws', { registry: { droppables: [{ element: onScreen, refreshShape: () => { throw new Error('gone') } }] } }],
    ['no manager at all', undefined],
  ])('does not throw inside the frame with %s', (_name, manager) => {
    const kit = startDrag(manager)
    kit.refreshDroppableShapes()
    expect(() => { flushFrames(); flushFrames() }).not.toThrow()
  })

  it('cancels its pending frames when the drag ends', () => {
    const refreshShape = vi.fn()
    const kit = startDrag({ registry: { droppables: [{ element: onScreen, refreshShape }] } })
    kit.refreshDroppableShapes()
    flushFrames() // first frame ran, the second is pending
    kit.onDragEnd({ canceled: true, operation: { source: null, target: null } })
    expect(queued.size).toBe(0)
    flushFrames()
    expect(refreshShape).not.toHaveBeenCalled()
  })
})

describe('useBoardDndKit: WIP check source column (#379)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    switchSource('local')
    const tasksStore = useTasksStore()
    tasksStore.addTask(makeTask('now', TaskStatus.Progress))
    tasksStore.addTask(makeTask('other', TaskStatus.Open))
  })

  const over = (source: Record<string, unknown>) => {
    const preventDefault = vi.fn()
    useBoardDndKit().onDragOver({
      operation: { source, target: { group: TaskStatus.Progress, initialGroup: undefined } },
      preventDefault,
    })
    return preventDefault
  }

  it('reads initialGroup first: a Jetzt card sorted over Offen and back is not an entry', () => {
    expect(over({ id: 'now', initialGroup: TaskStatus.Progress, group: TaskStatus.Open })).not.toHaveBeenCalled()
  })

  it('falls back to group when initialGroup is missing: an Offen card is still refused', () => {
    expect(over({ id: 'other', initialGroup: undefined, group: TaskStatus.Open })).toHaveBeenCalled()
  })

  it('falls back to group when initialGroup is missing: a Jetzt card may reorder in Jetzt', () => {
    expect(over({ id: 'now', initialGroup: undefined, group: TaskStatus.Progress })).not.toHaveBeenCalled()
  })
})
