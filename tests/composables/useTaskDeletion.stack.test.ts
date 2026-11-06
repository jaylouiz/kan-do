import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTaskDeletion, resetTaskDeletionState, measureSlot, preGroupAnchor, groupHasNoHeaderOrStack, DELETE_UNDO_WINDOW_MS } from '~/composables/useTaskDeletion'
import { GAP_CLOSE_MS, closingGaps } from '~/lib/deleteGapState'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useTrashStore } from '~/store/trash'
import { useDeletedGaps } from '~/composables/useDeletedGaps'
import { useUndoWindow } from '~/composables/useUndoWindow'
import { buildColumnItems, stackHeaderKey } from '~/utils/columnItems'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

/**
 * #433: the delete gap of a card inside a collapsed stack. The card has no `.task-wrapper` on the board (the
 * stack renders it inert, inside `.task-stack`), so `measureSlot` reads the stack instead: the gap hangs on a
 * member that stays and takes the stack's height.
 */

vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({ syncExistingDoneTasks: vi.fn(), updateTaskRecord: vi.fn(), recordDiscardedTime: vi.fn(), removeDiscardedTime: vi.fn() }),
}))
vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: vi.fn() }),
}))

const makeTask = (id: string, topic: string | null = null): Task => ({
  id, source: 'local', externalId: null, title: `Task ${id}`, status: TaskStatus.Open, activity: null, topic, topicColorCode: null,
  priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null,
}) as Task

/** A column list as the board renders it: cards as wrappers, a collapsed stack as one `.task-stack`. */
function renderColumn(items: Array<string | string[] | { header: string }>, stackHeight = 168): void {
  document.body.innerHTML = ''
  const list = document.createElement('div')
  for (const item of items) {
    const el = document.createElement('div')
    if (typeof item === 'object' && !Array.isArray(item)) {
      el.className = 'task-stack-header'
      el.dataset.stackHeader = item.header
    } else if (Array.isArray(item)) {
      el.className = 'task-stack'
      el.dataset.taskId = item[0]
      el.dataset.stackTaskIds = JSON.stringify(item)
      el.dataset.stackKey = 'Design'
      Object.defineProperty(el, 'offsetHeight', { value: stackHeight })
    } else {
      el.className = 'task-wrapper'
      el.dataset.taskId = item
      Object.defineProperty(el, 'offsetHeight', { value: 100 })
    }
    list.append(el)
  }
  document.body.append(list)
}

describe('measureSlot for a card inside a collapsed stack (#433)', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('hangs the gap on the member before the card and takes the stack height', () => {
    renderColumn(['u1', ['a1', 'a2', 'a3'], 'c1'])
    expect(measureSlot('a2')).toEqual({ afterId: 'a1', height: 168 })
  })

  it('the first and the last member of a 3-stack hang where they stood: header key and previous member (#457)', () => {
    renderColumn(['u1', ['a1', 'a2', 'a3'], 'c1'])
    expect(measureSlot('a1')).toEqual({ afterId: stackHeaderKey('Design'), height: 168 })
    expect(measureSlot('a3')).toEqual({ afterId: 'a2', height: 168 })
  })

  it('a stack of exactly 2 hangs its members where they stood: the first on the header key (above the lone card left), the second on the first (#502)', () => {
    renderColumn([['a1', 'a2']])
    expect(measureSlot('a1')).toEqual({ afterId: stackHeaderKey('Design'), height: 168 })
    expect(measureSlot('a2')).toEqual({ afterId: 'a1', height: 168 })
  })

  it('a stack of exactly 2 without a key attribute keeps the other member as anchor, never the deleted card itself', () => {
    renderColumn([['a1', 'a2']])
    delete document.querySelector<HTMLElement>('.task-stack')!.dataset.stackKey
    expect(measureSlot('a1')).toEqual({ afterId: 'a2', height: 168 })
    expect(measureSlot('a2')).toEqual({ afterId: 'a1', height: 168 })
  })

  it('a stack without a key attribute still anchors its first member on the next one', () => {
    renderColumn([['a1', 'a2', 'a3']])
    delete document.querySelector<HTMLElement>('.task-stack')!.dataset.stackKey
    expect(measureSlot('a1')).toEqual({ afterId: 'a2', height: 168 })
  })

  it('an unstacked card keeps measuring its own box and its predecessor', () => {
    renderColumn(['u1', ['a1', 'a2'], 'c1'])
    expect(measureSlot('c1')).toEqual({ afterId: 'a1', height: 100 })
    expect(measureSlot('u1')).toEqual({ afterId: null, height: 100 })
  })

  it('a card that is nowhere on the board, or a stack without a measured box, falls back to the column end', () => {
    renderColumn([['a1', 'a2']], 0)
    expect(measureSlot('ghost')).toEqual({ height: null })
    expect(measureSlot('a1')).toEqual({ afterId: stackHeaderKey('Design'), height: null })
  })

  it('a malformed stack attribute is ignored', () => {
    renderColumn([['a1', 'a2']])
    document.querySelector<HTMLElement>('.task-stack')!.dataset.stackTaskIds = '{not json'
    expect(measureSlot('a1')).toEqual({ height: null })
  })
})

describe('deleting a card of a collapsed stack (#433)', () => {
  let tasksStore: ReturnType<typeof useTasksStore>
  let boardStore: ReturnType<typeof useBoardStore>

  const columnKeys = (tasks: Task[]) =>
    buildColumnItems({
      tasks, groupKey: 'topic', expandedKeys: [], groupLabel: key => key, isMuted: () => false, gaps: useDeletedGaps().gaps.value,
    }).map(item => item.key)

  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    setActivePinia(createPinia())
    tasksStore = useTasksStore()
    boardStore = useBoardStore()
    boardStore.setSingleSource('local')
    boardStore.setGroupingEnabled(true)
    boardStore.setGroupingKey('topic')
    tasksStore.setTasks([makeTask('u1'), makeTask('a1', 'Design'), makeTask('a2', 'Design'), makeTask('a3', 'Design'), makeTask('c1', 'Ops')])
    boardStore.reconcileColumnsWithTasks(tasksStore.tasks)
  })

  afterEach(() => {
    resetTaskDeletionState()
    document.body.innerHTML = ''
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders the gap directly below the stack, not at the column end, and undo puts the card back in its stack', () => {
    renderColumn(['u1', ['a1', 'a2', 'a3'], 'c1'])
    const { deleteTaskWithUndo, undoDelete } = useTaskDeletion()
    const orderBefore = [...boardStore.columnByTaskStatus(TaskStatus.Open)!.taskOrder]

    expect(deleteTaskWithUndo('a2')).toBe(true)

    const [gap] = useDeletedGaps().gaps.value
    expect(gap).toMatchObject({ taskId: 'a2', afterId: 'a1', height: 168 })
    const keys = columnKeys(tasksStore.tasks)
    expect(keys.indexOf('gap:a2')).toBe(keys.indexOf('stack:Design') + 1)
    expect(keys.at(-1)).not.toBe('gap:a2')

    undoDelete('a2')
    expect(tasksStore.task('a2')?.topic).toBe('Design')
    expect(boardStore.columnByTaskStatus(TaskStatus.Open)!.taskOrder).toEqual(orderBefore)
    expect(useDeletedGaps().gaps.value).toEqual([])
  })

  it('sequence: delete, window elapses -> the trash receives it; the gap stayed at the stack until then', async () => {
    renderColumn(['u1', ['a1', 'a2', 'a3'], 'c1'])
    const { deleteTaskWithUndo } = useTaskDeletion()
    deleteTaskWithUndo('a1')
    vi.advanceTimersByTime(DELETE_UNDO_WINDOW_MS - 1)
    const keys = columnKeys(tasksStore.tasks)
    expect(keys.indexOf('gap:a1')).toBe(keys.indexOf('stack:Design') + 1)

    vi.advanceTimersByTime(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(useTrashStore().entry('a1')?.task.title).toBe('Task a1')
  })

  it('sequence: a1 then a2 of a 3-stack: both gaps hang on the group, in card order above the lone card a3 (#502)', () => {
    renderColumn(['u1', ['a1', 'a2', 'a3'], 'c1'])
    const { deleteTaskWithUndo } = useTaskDeletion()
    deleteTaskWithUndo('a1')
    // the board re-rendered: the stack now holds a2 and a3
    renderColumn(['u1', ['a2', 'a3'], 'c1'])
    deleteTaskWithUndo('a2')

    expect(tasksStore.pendingDeletes.a2?.slot?.afterId).toBe('a1')
    const keys = columnKeys(tasksStore.tasks)
    // a3 is the lone member left, so it is a plain card now: both gaps stand above it where the stack stood
    expect(keys.slice(keys.indexOf('gap:a1'), keys.indexOf('gap:a1') + 3)).toEqual(['gap:a1', 'gap:a2', 'a3'])
    expect(keys.indexOf('c1')).toBeGreaterThan(keys.indexOf('a3'))
  })
})

describe('measureSlot inside an expanded stack (#438)', () => {
  afterEach(() => { document.body.innerHTML = '' })

  /** An expanded stack as the board renders it: the header, then the members as cards (a gap is a sibling too). */
  const expanded = (extra: Array<string | { header: string }> = []) => renderColumn(['u1', { header: 'Design' }, 'a1', 'a2', 'a3', ...extra, 'c1'])

  it('the first member hangs on the header key, in its own height', () => {
    expanded()
    expect(measureSlot('a1')).toEqual({ afterId: stackHeaderKey('Design'), height: 100 })
  })

  it('a middle or last member keeps hanging on the previous member', () => {
    expanded()
    expect(measureSlot('a2')).toEqual({ afterId: 'a1', height: 100 })
    expect(measureSlot('a3')).toEqual({ afterId: 'a2', height: 100 })
  })

  it('the group key comes from the header attribute, so two stacks never mix', () => {
    renderColumn([{ header: 'Design' }, 'a1', 'a2', { header: 'Ops' }, 'o1', 'o2'])
    expect(measureSlot('o1')).toEqual({ afterId: stackHeaderKey('Ops'), height: 100 })
    expect(measureSlot('a1')).toEqual({ afterId: stackHeaderKey('Design'), height: 100 })
  })

  it('a gap rendered before the new first member is the previous sibling: the card hangs on that gap', () => {
    renderColumn([{ header: 'Design' }, 'a2', 'a3'])
    const gapEl = document.createElement('div')
    gapEl.dataset.gapId = 'a1'
    document.querySelector('[data-task-id="a2"]')!.before(gapEl)
    expect(measureSlot('a2')).toEqual({ afterId: 'a1', height: 100 })
  })

  it('a card outside any stack still measures its predecessor', () => {
    expanded()
    expect(measureSlot('c1')).toEqual({ afterId: 'a3', height: 100 })
    expect(measureSlot('u1')).toEqual({ afterId: null, height: 100 })
  })
})

describe('deleting members of an expanded stack (#438)', () => {
  let tasksStore: ReturnType<typeof useTasksStore>
  let boardStore: ReturnType<typeof useBoardStore>
  const header = stackHeaderKey('Design')

  // The board lists a column's tasks in its manual order
  const columnKeys = (tasks: Task[]) => {
    const order = boardStore.columnByTaskStatus(TaskStatus.Open)!.taskOrder
    return buildColumnItems({
      tasks: [...tasks].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)), groupKey: 'topic', expandedKeys: ['Design'], groupLabel: key => key, isMuted: () => false, gaps: useDeletedGaps().gaps.value,
    }).map(item => item.key)
  }

  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    setActivePinia(createPinia())
    tasksStore = useTasksStore()
    boardStore = useBoardStore()
    boardStore.setSingleSource('local')
    tasksStore.setTasks([makeTask('u1'), makeTask('a1', 'Design'), makeTask('a2', 'Design'), makeTask('a3', 'Design'), makeTask('a4', 'Design'), makeTask('c1', 'Ops')])
    boardStore.reconcileColumnsWithTasks(tasksStore.tasks)
  })

  afterEach(() => {
    resetTaskDeletionState()
    document.body.innerHTML = ''
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('first member: the gap sits under the header; undo and a second delete give the same place (A -> B -> A)', () => {
    const { deleteTaskWithUndo, undoDelete } = useTaskDeletion()
    for (let round = 0; round < 2; round++) {
      renderColumn(['u1', { header: 'Design' }, 'a1', 'a2', 'a3', 'a4', 'c1'])
      expect(deleteTaskWithUndo('a1')).toBe(true)
      expect(useDeletedGaps().gaps.value[0]).toMatchObject({ taskId: 'a1', afterId: header })
      expect(columnKeys(tasksStore.tasks)).toEqual(['u1', header, 'gap:a1', 'a2', 'a3', 'a4', 'c1'])
      undoDelete('a1')
      expect(columnKeys(tasksStore.tasks)).toEqual(['u1', header, 'a1', 'a2', 'a3', 'a4', 'c1'])
    }
  })

  it('the new first member deleted too: both gaps stay inside the group, older above newer', () => {
    const { deleteTaskWithUndo } = useTaskDeletion()
    renderColumn(['u1', { header: 'Design' }, 'a1', 'a2', 'a3', 'a4', 'c1'])
    deleteTaskWithUndo('a1')
    vi.advanceTimersByTime(10)
    // the board re-rendered: header, gap(a1), a2, a3
    renderColumn(['u1', { header: 'Design' }, 'a2', 'a3', 'a4', 'c1'])
    const gapEl = document.createElement('div')
    gapEl.dataset.gapId = 'a1'
    document.querySelector('[data-task-id="a2"]')!.before(gapEl)
    deleteTaskWithUndo('a2')
    expect(columnKeys(tasksStore.tasks).slice(0, 4)).toEqual(['u1', header, 'gap:a1', 'gap:a2'])
  })
})

describe('a gap whose anchor is deleted during a paused window (#438)', () => {
  let tasksStore: ReturnType<typeof useTasksStore>
  let boardStore: ReturnType<typeof useBoardStore>

  const keys = (expandedKeys: string[] = []) =>
    buildColumnItems({
      tasks: tasksStore.tasks, groupKey: 'topic', expandedKeys, groupLabel: key => key, isMuted: () => false, gaps: useDeletedGaps().gaps.value,
    }).map(item => item.key)
  const slotOf = (id: string) => tasksStore.pendingDeletes[id]?.slot

  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    setActivePinia(createPinia())
    tasksStore = useTasksStore()
    boardStore = useBoardStore()
    boardStore.setSingleSource('local')
    tasksStore.setTasks([makeTask('u1'), makeTask('a1', 'Design'), makeTask('a2', 'Design'), makeTask('a3', 'Design'), makeTask('a4', 'Design'), makeTask('c1', 'Ops')])
    boardStore.reconcileColumnsWithTasks(tasksStore.tasks)
  })

  afterEach(() => {
    resetTaskDeletionState()
    document.body.innerHTML = ''
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  /** a3 deleted and paused (hangs on a2), then a2 deleted (collapsed stack of four). */
  function deleteA3PausedThenA2() {
    const api = useTaskDeletion()
    renderColumn(['u1', ['a1', 'a2', 'a3', 'a4'], 'c1'])
    api.deleteTaskWithUndo('a3')
    api.pauseDelete('a3')
    renderColumn(['u1', ['a1', 'a2', 'a4'], 'c1'])
    api.deleteTaskWithUndo('a2')
    return api
  }

  it('a2 elapses and its glide ends: a3 stays directly below the stack with its window open', async () => {
    deleteA3PausedThenA2()
    expect(slotOf('a3')?.afterId).toBe('a2')
    // the gap of a2 is still there while it glides shut: a1 hangs behind it
    vi.advanceTimersByTime(DELETE_UNDO_WINDOW_MS)
    await vi.advanceTimersByTimeAsync(0)
    expect(keys()).toContain('gap:a2')
    await vi.advanceTimersByTimeAsync(GAP_CLOSE_MS)

    expect(keys()).not.toContain('gap:a2')
    expect(slotOf('a3')?.afterId).toBe('a1')
    const order = keys()
    expect(order.indexOf('gap:a3')).toBe(order.indexOf('stack:Design') + 1)
    expect(useDeletedGaps().gaps.value.map(gap => [gap.taskId, gap.state])).toEqual([['a3', 'open']])
    expect(useTrashStore().entry('a2')).toBeDefined()
  })

  it('undo of a2 instead: a2 is back in the stack and a3 stays below it (the lazy rewrite keeps undo exact)', () => {
    const { undoDelete } = deleteA3PausedThenA2()
    undoDelete('a2')
    expect(slotOf('a3')?.afterId).toBe('a2')
    const order = keys()
    expect(order.indexOf('gap:a3')).toBe(order.indexOf('stack:Design') + 1)
    expect(tasksStore.task('a2')?.topic).toBe('Design')
  })

  it('unstacked: c1 deleted (gap behind u1, paused), u1 deleted and elapsing: c1 keeps its place instead of the column end', async () => {
    tasksStore.setTasks([makeTask('u1'), makeTask('c1', 'Ops'), makeTask('d1', 'Docs')])
    boardStore.reconcileColumnsWithTasks(tasksStore.tasks)
    const api = useTaskDeletion()
    renderColumn(['u1', 'c1', 'd1'])
    api.deleteTaskWithUndo('c1')
    api.pauseDelete('c1')
    expect(slotOf('c1')?.afterId).toBe('u1')
    renderColumn(['u1', 'd1'])
    api.deleteTaskWithUndo('u1')
    expect(keys().slice(0, 2)).toEqual(['gap:u1', 'gap:c1'])

    await vi.advanceTimersByTimeAsync(DELETE_UNDO_WINDOW_MS + GAP_CLOSE_MS)
    expect(slotOf('c1')?.afterId).toBeNull()
    expect(keys()).toEqual(['gap:c1', 'd1'])
  })

  it('a dependent that is itself gliding shut when its anchor leaves is re-anchored too', async () => {
    tasksStore.setTasks([makeTask('u1'), makeTask('c1', 'Ops'), makeTask('d1', 'Docs')])
    boardStore.reconcileColumnsWithTasks(tasksStore.tasks)
    const api = useTaskDeletion()
    renderColumn(['u1', 'c1', 'd1'])
    api.deleteTaskWithUndo('c1')
    api.pauseDelete('c1')
    renderColumn(['u1', 'd1'])
    api.deleteTaskWithUndo('u1')
    // u1's window ends first; c1 resumes so that it closes while u1's gap still glides
    await vi.advanceTimersByTimeAsync(100)
    api.resumeDelete('c1')
    await vi.advanceTimersByTimeAsync(DELETE_UNDO_WINDOW_MS)
    expect(Object.keys(closingGaps).sort()).toEqual(['c1', 'u1'])

    await vi.advanceTimersByTimeAsync(GAP_CLOSE_MS - 100)
    expect(Object.keys(closingGaps)).toEqual(['c1'])
    expect(closingGaps.c1?.slot?.afterId).toBeNull()
    expect(keys()).toEqual(['gap:c1', 'd1'])
  })

  it('chained deletes resolve one link at a time: a1 <- a2 <- a3, a3 elapses first, then a2', async () => {
    const api = useTaskDeletion()
    renderColumn(['u1', 'c1'])
    tasksStore.setTasks([makeTask('u1'), makeTask('c1', 'Ops'), makeTask('d1', 'Docs'), makeTask('e1', 'Docs')])
    boardStore.reconcileColumnsWithTasks(tasksStore.tasks)
    // c1 hangs on u1, d1 on c1 (their gaps are not in the DOM here, so set the order by hand)
    renderColumn(['u1', 'c1', 'd1', 'e1'])
    api.deleteTaskWithUndo('d1')
    api.pauseDelete('d1')
    renderColumn(['u1', 'c1', 'e1'])
    api.deleteTaskWithUndo('c1')
    api.pauseDelete('c1')
    renderColumn(['u1', 'e1'])
    api.deleteTaskWithUndo('u1')
    expect(slotOf('d1')?.afterId).toBe('c1')
    expect(slotOf('c1')?.afterId).toBe('u1')

    await vi.advanceTimersByTimeAsync(DELETE_UNDO_WINDOW_MS + GAP_CLOSE_MS)
    // u1's gap is gone: its dependent c1 now hangs on the start of the column; d1 still on c1
    expect(slotOf('c1')?.afterId).toBeNull()
    expect(slotOf('d1')?.afterId).toBe('c1')
    expect(keys()).toEqual(['gap:c1', 'gap:d1', 'e1'])
  })
})

describe('preGroupAnchor and groupHasNoHeaderOrStack (#457)', () => {
  afterEach(() => { document.body.innerHTML = '' })

  const gapBefore = (id: string, anchorTaskId: string) => {
    const gapEl = document.createElement('div')
    gapEl.dataset.gapId = id
    document.querySelector(`[data-task-id="${anchorTaskId}"]`)!.before(gapEl)
  }

  const own = (...ids: string[]) => (gapId: string) => ids.includes(gapId)

  it('is the card in front of the group, skipping the gaps of the group itself (#477)', () => {
    renderColumn(['u1', 'a3', 'c1'])
    gapBefore('a1', 'a3')
    gapBefore('a2', 'a3')
    expect(preGroupAnchor('a3', own('a1', 'a2'))).toBe('u1')
  })

  it('a foreign gap in front of the group is the anchor: the gap of x1 in F3, the last gap of the previous stack in F2 (#477)', () => {
    renderColumn(['u1', 'a3', 'c1'])
    gapBefore('x1', 'a3')
    gapBefore('a1', 'a3')
    expect(preGroupAnchor('a3', own('a1'))).toBe('x1')
    expect(preGroupAnchor('a3')).toBe('a1')
  })

  it('a stack in the first position of the column (only own gaps before it) gives null', () => {
    renderColumn(['a3', 'c1'])
    gapBefore('a1', 'a3')
    expect(preGroupAnchor('a3', own('a1'))).toBeNull()
  })

  it('a collapsed stack in front is named by its front task', () => {
    renderColumn([['o1', 'o2'], 'a3'])
    gapBefore('a1', 'a3')
    expect(preGroupAnchor('a3', own('a1'))).toBe('o1')
  })

  it('a card that is not on the board gives null', () => {
    renderColumn(['u1'])
    expect(preGroupAnchor('ghost')).toBeNull()
  })

  it('a group is gone when neither its header nor a collapsed stack of it is rendered in the card\'s list; another group does not count', () => {
    renderColumn([{ header: 'Ops' }, 'o1', 'o2', 'a3'])
    expect(groupHasNoHeaderOrStack('Design', 'a3')).toBe(true)
    expect(groupHasNoHeaderOrStack('Ops', 'a3')).toBe(false)
    renderColumn([['a1', 'a2']])
    expect(groupHasNoHeaderOrStack('Design', 'a1')).toBe(false)
  })

  it('a header or a collapsed stack of the same group key in another column does not count (F1)', () => {
    renderColumn([{ header: 'Ops' }, 'o1', 'o2', 'a3'])
    const other = document.createElement('div')
    other.innerHTML = '<div class="task-stack-header" data-stack-header="Design"></div><div class="task-stack" data-task-id="w1" data-stack-key="Design" data-stack-task-ids="[&quot;w1&quot;,&quot;w2&quot;]"></div>'
    document.body.append(other)
    expect(groupHasNoHeaderOrStack('Design', 'a3')).toBe(true)
    // a card that is nowhere on the board has no list to look at
    expect(groupHasNoHeaderOrStack('Design', 'ghost')).toBe(false)
  })

  it('a group key with quotes and a colon is escaped for the selector', () => {
    renderColumn([{ header: 'Team: "Design"' }, 'a1'])
    expect(groupHasNoHeaderOrStack('Team: "Design"', 'a1')).toBe(false)
  })
})

describe('deleting the whole expanded stack while the gaps are open (#457)', () => {
  let tasksStore: ReturnType<typeof useTasksStore>
  let boardStore: ReturnType<typeof useBoardStore>
  const header = stackHeaderKey('Design')

  const columnKeys = () => {
    const order = boardStore.columnByTaskStatus(TaskStatus.Open)!.taskOrder
    return buildColumnItems({
      tasks: [...tasksStore.tasks].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)),
      groupKey: 'topic', expandedKeys: ['Design'], groupLabel: key => key, isMuted: () => false, gaps: useDeletedGaps().gaps.value,
    }).map(item => item.key)
  }
  const slotOf = (id: string) => tasksStore.pendingDeletes[id]?.slot ?? closingGaps[id]?.slot

  /** Re-renders the DOM from the real item order (what the board would show now). */
  function renderFromStore(expectedOrder: string[]) {
    const items: Array<string | { header: string }> = []
    for (const key of expectedOrder) {
      if (key === header) items.push({ header: 'Design' })
      else if (!key.startsWith('gap:')) items.push(key)
    }
    renderColumn(items)
    expectedOrder.forEach((key, index) => {
      if (!key.startsWith('gap:')) return
      const gapEl = document.createElement('div')
      gapEl.dataset.gapId = key.slice(4)
      const list = document.body.firstElementChild!
      list.insertBefore(gapEl, list.children[index] ?? null)
    })
  }

  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    setActivePinia(createPinia())
    tasksStore = useTasksStore()
    boardStore = useBoardStore()
    boardStore.setSingleSource('local')
    boardStore.setGroupingEnabled(true)
    boardStore.setGroupingKey('topic')
    tasksStore.setTasks([makeTask('u1'), makeTask('a1', 'Design'), makeTask('a2', 'Design'), makeTask('a3', 'Design'), makeTask('c1', 'Ops'), makeTask('d1', 'Docs')])
    boardStore.reconcileColumnsWithTasks(tasksStore.tasks)
  })

  afterEach(() => {
    resetTaskDeletionState()
    document.body.innerHTML = ''
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  /** Deletes the members in the given order, re-rendering the board between the deletes. */
  function deleteInOrder(order: string[]) {
    const api = useTaskDeletion()
    for (const id of order) {
      renderFromStore(columnKeys())
      expect(api.deleteTaskWithUndo(id)).toBe(true)
      vi.advanceTimersByTime(10) // gaps are ordered by their request time
    }
    return api
  }

  it('stack of 2: delete a1, then a2: both gaps stay where the stack stood, older above newer, not at the column end', () => {
    tasksStore.removeTask('a3')
    deleteInOrder(['a1', 'a2'])
    // a1 hangs behind the item before the stack; a2 behind a1's gap (gaps chain in card order)
    expect(slotOf('a1')?.afterId).toBe('u1')
    expect(slotOf('a2')?.afterId).toBe('a1')
    expect(columnKeys()).toEqual(['u1', 'gap:a1', 'gap:a2', 'c1', 'd1'])
  })

  it.each([
    [['a1', 'a2', 'a3']],
    [['a3', 'a2', 'a1']],
    [['a2', 'a1', 'a3']],
    [['a2', 'a3', 'a1']],
  ])('stack of 3 deleted in the order %j: three gaps in card order between u1 and c1', (order) => {
    deleteInOrder(order)
    expect(columnKeys()).toEqual(['u1', 'gap:a1', 'gap:a2', 'gap:a3', 'c1', 'd1'])
  })

  it('F1: the same topic parked in another column (a header or a collapsed stack there) does not keep the gaps on the header key', () => {
    tasksStore.removeTask('a3')
    const api = useTaskDeletion()
    for (const id of ['a1', 'a2']) {
      renderFromStore(columnKeys())
      // another column's list on the same page: a header and a collapsed stack of the same group key
      const other = document.createElement('div')
      other.innerHTML = '<div class="task-stack-header" data-stack-header="Design"></div><div class="task-stack" data-task-id="w1" data-stack-key="Design" data-stack-task-ids="[&quot;w1&quot;,&quot;w2&quot;]"></div>'
      document.body.append(other)
      api.deleteTaskWithUndo(id)
      vi.advanceTimersByTime(10)
    }
    expect(slotOf('a1')?.afterId).toBe('u1')
    expect(slotOf('a2')?.afterId).toBe('a1')
    expect(columnKeys()).toEqual(['u1', 'gap:a1', 'gap:a2', 'c1', 'd1'])
  })

  it('a stack in the first position of the column: the gaps stay at the top (null anchor), not at the end', () => {
    tasksStore.removeTask('u1')
    boardStore.reconcileColumnsWithTasks(tasksStore.tasks)
    const api = useTaskDeletion()
    for (const id of ['a1', 'a2', 'a3']) {
      renderFromStore(columnKeys())
      api.deleteTaskWithUndo(id)
      vi.advanceTimersByTime(10)
    }
    expect(slotOf('a1')?.afterId).toBeNull()
    expect(slotOf('a3')?.afterId).toBe('a2')
    expect(columnKeys()).toEqual(['gap:a1', 'gap:a2', 'gap:a3', 'c1', 'd1'])
  })

  it('undo of the last-deleted and of the first-deleted member puts it back at its slot, the other gaps stay (A -> B -> A)', () => {
    const { undoDelete, deleteTaskWithUndo } = deleteInOrder(['a1', 'a2', 'a3'])
    undoDelete('a3')
    expect(columnKeys()).toEqual(['u1', 'gap:a1', 'gap:a2', 'a3', 'c1', 'd1'])
    undoDelete('a1')
    // a1 is back as the first member of its group (header again); a2's gap hangs on a1 and follows it (#477)
    expect(columnKeys()).toEqual(['u1', header, 'a1', 'gap:a2', 'a3', 'c1', 'd1'])
    // A -> B -> A: delete the undone member again; the group dissolves again and its gap stays after the gap of a2
    renderFromStore(columnKeys())
    deleteTaskWithUndo('a3')
    expect(columnKeys()).toEqual(['u1', 'a1', 'gap:a2', 'gap:a3', 'c1', 'd1'])
  })

  const ORDERS = [['a1', 'a2', 'a3'], ['a1', 'a3', 'a2'], ['a2', 'a1', 'a3'], ['a2', 'a3', 'a1'], ['a3', 'a1', 'a2'], ['a3', 'a2', 'a1']]
  it.each(ORDERS.flatMap(order => ['a1', 'a2', 'a3'].map(member => [order, member] as const)))(
    'A -> B -> A: delete in the order %j, undo %s, delete it again: the three gaps are in card order again',
    (order, member) => {
      const { undoDelete, deleteTaskWithUndo } = deleteInOrder([...order])
      undoDelete(member)
      renderFromStore(columnKeys())
      vi.advanceTimersByTime(10)
      deleteTaskWithUndo(member)
      expect(columnKeys()).toEqual(['u1', 'gap:a1', 'gap:a2', 'gap:a3', 'c1', 'd1'])
    },
  )

  it('a sorted column: taskOrder is not the card order, so no gap is chained by it', () => {
    boardStore.setColumnSorting(TaskStatus.Open, 'priority', 'asc')
    boardStore.columnByTaskStatus(TaskStatus.Open)!.taskOrder = ['c1', 'd1', 'a3', 'a2', 'a1', 'u1']
    const { deleteTaskWithUndo } = useTaskDeletion()
    renderColumn(['u1', { header: 'Design' }, 'a1', 'a2', 'a3', 'c1', 'd1'])
    deleteTaskWithUndo('a1')
    vi.advanceTimersByTime(10)
    renderColumn(['u1', { header: 'Design' }, 'a2', 'a3', 'c1', 'd1'])
    const gapEl = document.createElement('div')
    gapEl.dataset.gapId = 'a1'
    document.querySelector('[data-task-id="a2"]')!.before(gapEl)
    deleteTaskWithUndo('a2')
    // the DOM's order (a1 above a2) stands, although taskOrder lists a2 first: a2 hangs on the gap in front of it
    expect(slotOf('a1')?.afterId).toBe(header)
    expect(slotOf('a2')?.afterId).toBe('a1')
  })

  it('the window of the first gap elapses before the last member is deleted: the later gaps stay at the stack, the trash has each card', async () => {
    const api = useTaskDeletion()
    renderFromStore(columnKeys())
    api.deleteTaskWithUndo('a1')
    await vi.advanceTimersByTimeAsync(100)
    renderFromStore(columnKeys())
    api.deleteTaskWithUndo('a2')
    await vi.advanceTimersByTimeAsync(DELETE_UNDO_WINDOW_MS - 1000)
    // a3, the last member, goes while a1 and a2 are still open; a1's window then closes first
    renderFromStore(columnKeys())
    api.deleteTaskWithUndo('a3')
    await vi.advanceTimersByTimeAsync(900 + GAP_CLOSE_MS + 10)
    expect(useTrashStore().entry('a1')).toBeDefined()
    expect(columnKeys()).toEqual(['u1', 'gap:a2', 'gap:a3', 'c1', 'd1'])
    await vi.advanceTimersByTimeAsync(DELETE_UNDO_WINDOW_MS + GAP_CLOSE_MS)
    expect(columnKeys()).toEqual(['u1', 'c1', 'd1'])
    for (const id of ['a1', 'a2', 'a3']) expect(useTrashStore().entry(id)).toBeDefined()
  })

  it('the first gap elapses and glides shut before the last member is deleted: the later gaps keep the stack place', async () => {
    const api = useTaskDeletion()
    renderFromStore(columnKeys())
    api.deleteTaskWithUndo('a1')
    await vi.advanceTimersByTimeAsync(DELETE_UNDO_WINDOW_MS + GAP_CLOSE_MS)
    expect(useTrashStore().entry('a1')).toBeDefined()
    renderFromStore(columnKeys())
    api.deleteTaskWithUndo('a2')
    renderFromStore(columnKeys())
    api.deleteTaskWithUndo('a3')
    expect(columnKeys()).toEqual(['u1', 'gap:a2', 'gap:a3', 'c1', 'd1'])
    expect(slotOf('a2')?.afterId).toBe('u1')
    expect(slotOf('a3')?.afterId).toBe('a2')
  })

  it('a gap that is closing (window over, gliding shut) when the last member goes is re-pointed too', async () => {
    const api = useTaskDeletion()
    renderFromStore(columnKeys())
    api.deleteTaskWithUndo('a1')
    renderFromStore(columnKeys())
    api.deleteTaskWithUndo('a2')
    await vi.advanceTimersByTimeAsync(DELETE_UNDO_WINDOW_MS + 10)
    expect(Object.keys(closingGaps)).toContain('a1')
    renderFromStore(columnKeys())
    api.deleteTaskWithUndo('a3')
    expect(closingGaps.a1?.slot?.afterId).toBe('u1')
    expect(columnKeys().slice(0, 4)).toEqual(['u1', 'gap:a1', 'gap:a2', 'gap:a3'])
  })

  it('a later delete of the anchor card keeps the rewritten gaps in place (lazy re-anchor of #438)', async () => {
    const api = useTaskDeletion()
    for (const id of ['a1', 'a2', 'a3']) {
      renderFromStore(columnKeys())
      api.deleteTaskWithUndo(id)
      api.pauseDelete(id)
    }
    renderFromStore(columnKeys())
    api.deleteTaskWithUndo('u1')
    await vi.advanceTimersByTimeAsync(DELETE_UNDO_WINDOW_MS + GAP_CLOSE_MS)
    expect(slotOf('a1')?.afterId).toBeNull()
    expect(columnKeys()).toEqual(['gap:a1', 'gap:a2', 'gap:a3', 'c1', 'd1'])
  })

  it('two stacks: the sequence in one never moves a gap of the other, and a gap of a stack not fully deleted stays under its header', () => {
    tasksStore.setTasks([
      makeTask('u1'), makeTask('a1', 'Design'), makeTask('a2', 'Design'),
      makeTask('o1', 'Ops'), makeTask('o2', 'Ops'), makeTask('o3', 'Ops'), makeTask('d1', 'Docs'),
    ])
    boardStore.reconcileColumnsWithTasks(tasksStore.tasks)
    const keysOf = () => {
      const order = boardStore.columnByTaskStatus(TaskStatus.Open)!.taskOrder
      return buildColumnItems({
        tasks: [...tasksStore.tasks].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)),
        groupKey: 'topic', expandedKeys: ['Design', 'Ops'], groupLabel: key => key, isMuted: () => false, gaps: useDeletedGaps().gaps.value,
      }).map(item => item.key)
    }
    const renderBoth = () => {
      renderColumn(keysOf().filter(key => !key.startsWith('gap:')).map(key => key.startsWith('stack-header:') ? { header: key.slice('stack-header:'.length) } : key))
      keysOf().forEach((key, index) => {
        if (!key.startsWith('gap:')) return
        const gapEl = document.createElement('div')
        gapEl.dataset.gapId = key.slice(4)
        const list = document.body.firstElementChild!
        list.insertBefore(gapEl, list.children[index] ?? null)
      })
    }
    const api = useTaskDeletion()
    for (const id of ['o1', 'a1', 'a2', 'o2']) {
      renderBoth()
      api.deleteTaskWithUndo(id)
      vi.advanceTimersByTime(10)
    }
    const keys = keysOf()
    // Design is gone: its gaps sit where it stood (behind u1); Ops still has o3 alone, o1 and o2 hang in front of it
    expect(keys.indexOf('gap:a1')).toBe(keys.indexOf('u1') + 1)
    expect(keys.indexOf('gap:a2')).toBe(keys.indexOf('u1') + 2)
    expect(keys.indexOf('gap:o1')).toBeLessThan(keys.indexOf('o3'))
    expect(keys.indexOf('gap:o2')).toBeLessThan(keys.indexOf('o3'))
    expect(keys.indexOf('gap:o1')).toBeGreaterThan(keys.indexOf('gap:a2'))
    expect(slotOf('o1')?.afterId).not.toBe(slotOf('a1')?.afterId)
  })
})

/**
 * #477: gaps hang on their true predecessor. Whatever order cards are deleted, undone and deleted again in, the gaps
 * show in the order the cards stood in, and a card that returns is followed by the gaps that hung on it. The matrix
 * runs on a manual column and on one sorted by creation date (F1), where `taskOrder` says nothing about the card order.
 */
describe.each([['a manual column', false], ['a column sorted by creation date (F1)', true]])('gap order follows the card order (#477), %s', (_name, sorted) => {
  let tasksStore: ReturnType<typeof useTasksStore>
  let boardStore: ReturnType<typeof useBoardStore>
  let api: ReturnType<typeof useTaskDeletion>
  const header = (group: string) => stackHeaderKey(group)

  const keys = () => buildColumnItems({
    tasks: tasksStore.tasksOpen, groupKey: 'topic', expandedKeys: ['Design', 'Ops'], groupLabel: key => key, isMuted: () => false, gaps: useDeletedGaps().gaps.value,
  }).map(item => item.key)

  /** The board's DOM for the item keys: headers, cards and gap elements in list order (what `measureSlot` reads). */
  function renderKeys(itemKeys: string[]) {
    renderColumn(itemKeys.filter(key => !key.startsWith('gap:')).map(key => key.startsWith('stack-header:') ? { header: key.slice('stack-header:'.length) } : key))
    const list = document.body.firstElementChild!
    itemKeys.forEach((key, index) => {
      if (!key.startsWith('gap:')) return
      const gapEl = document.createElement('div')
      gapEl.dataset.gapId = key.slice(4)
      list.insertBefore(gapEl, list.children[index] ?? null)
    })
  }

  /** Seeds the Offen column: `[id, topic]` in card order; the creation date follows the order, so a sort by it keeps it (only three priority levels exist since #617, too few to order five cards). */
  function seed(cards: Array<[string, string | null]>) {
    tasksStore.setTasks(cards.map(([id, topic], index) => ({ ...makeTask(id, topic), createdAt: new Date(2026, 0, 1 + index) })))
    boardStore.reconcileColumnsWithTasks(tasksStore.tasks)
    if (sorted) boardStore.setColumnSorting(TaskStatus.Open, 'dateCreated', 'asc')
  }

  /** Deletes in the given order, re-rendering the board before each delete. */
  function del(...ids: string[]) {
    for (const id of ids) {
      renderKeys(keys())
      expect(api.deleteTaskWithUndo(id)).toBe(true)
      vi.advanceTimersByTime(10)
    }
  }
  const undo = (...ids: string[]) => { for (const id of ids) api.undoDelete(id) }
  const slotOf = (id: string) => tasksStore.pendingDeletes[id]?.slot ?? closingGaps[id]?.slot

  const PERMUTATIONS = [['a1', 'a2', 'a3'], ['a1', 'a3', 'a2'], ['a2', 'a1', 'a3'], ['a2', 'a3', 'a1'], ['a3', 'a1', 'a2'], ['a3', 'a2', 'a1']]
  const SUBSETS = [['a1'], ['a2'], ['a3'], ['a1', 'a2'], ['a1', 'a3'], ['a2', 'a3'], ['a1', 'a2', 'a3']]

  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    setActivePinia(createPinia())
    tasksStore = useTasksStore()
    boardStore = useBoardStore()
    boardStore.setSingleSource('local')
    boardStore.setGroupingEnabled(true)
    boardStore.setGroupingKey('topic')
    api = useTaskDeletion()
  })

  afterEach(() => {
    resetTaskDeletionState()
    document.body.innerHTML = ''
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('F0: ungrouped cards', () => {
    beforeEach(() => seed([['u1', null], ['c1', null], ['d1', null]]))

    it('delete c1, d1; undo c1 puts the gap of d1 behind it; undo d1 restores the column', () => {
      del('c1', 'd1')
      expect(keys()).toEqual(['u1', 'gap:c1', 'gap:d1'])
      expect(slotOf('d1')?.afterId).toBe('c1')
      undo('c1')
      expect(keys()).toEqual(['u1', 'c1', 'gap:d1'])
      undo('d1')
      expect(keys()).toEqual(['u1', 'c1', 'd1'])
    })

    it('delete d1, c1: the same order; undo d1 leaves the gap of c1 above it', () => {
      del('d1', 'c1')
      expect(keys()).toEqual(['u1', 'gap:c1', 'gap:d1'])
      undo('d1')
      expect(keys()).toEqual(['u1', 'gap:c1', 'd1'])
    })

    it('A -> B -> A: undo c1, delete it again, undo it: the order of the gaps never flips', () => {
      del('c1', 'd1')
      undo('c1')
      del('c1')
      expect(keys()).toEqual(['u1', 'gap:c1', 'gap:d1'])
      undo('c1')
      expect(keys()).toEqual(['u1', 'c1', 'gap:d1'])
    })

    it('the gap of c1 elapses and glides shut: the gap of d1 stays in place (#438)', async () => {
      del('c1', 'd1')
      api.pauseDelete('d1')
      await vi.advanceTimersByTimeAsync(DELETE_UNDO_WINDOW_MS + GAP_CLOSE_MS)
      expect(keys()).toEqual(['u1', 'gap:d1'])
      expect(slotOf('d1')?.afterId).toBe('u1')
    })
  })

  describe('F0s and stack of 3', () => {
    beforeEach(() => seed([['u1', null], ['a1', 'Design'], ['a2', 'Design'], ['a3', 'Design'], ['c1', 'Ops'], ['d1', 'Docs']]))

    it('F0s, a stack of 2: delete a1, a2; undo a2, delete it again, undo a1 -> a1 gap:a2', () => {
      tasksStore.removeTask('a3')
      del('a1', 'a2')
      expect(keys()).toEqual(['u1', 'gap:a1', 'gap:a2', 'c1', 'd1'])
      undo('a2')
      expect(keys()).toEqual(['u1', 'gap:a1', 'a2', 'c1', 'd1'])
      del('a2')
      expect(keys()).toEqual(['u1', 'gap:a1', 'gap:a2', 'c1', 'd1'])
      undo('a1')
      expect(keys()).toEqual(['u1', 'a1', 'gap:a2', 'c1', 'd1'])
    })

    it.each(PERMUTATIONS)('deleted in the order %s, %s, %s: gap:a1 gap:a2 gap:a3 between u1 and c1', (...order) => {
      del(...order)
      expect(keys()).toEqual(['u1', 'gap:a1', 'gap:a2', 'gap:a3', 'c1', 'd1'])
    })

    it('delete all, undo a3, undo a1 -> u1 header a1 gap:a2 a3 c1 d1', () => {
      del('a1', 'a2', 'a3')
      undo('a3', 'a1')
      expect(keys()).toEqual(['u1', header('Design'), 'a1', 'gap:a2', 'a3', 'c1', 'd1'])
    })

    it.each(PERMUTATIONS.flatMap(order => SUBSETS.map(subset => [order, subset] as const)))(
      'deleted in the order %j, any subset %j undone: returned cards and remaining gaps keep the card order',
      (order, subset) => {
        del(...order)
        undo(...subset)
        const undone = new Set(subset)
        const expected = ['u1']
        for (const member of ['a1', 'a2', 'a3']) {
          if (undone.has(member)) {
            if (undone.size >= 2 && member === subset.toSorted()[0]) expected.push(header('Design'))
            expected.push(member)
          } else expected.push(`gap:${member}`)
        }
        expect(keys()).toEqual([...expected, 'c1', 'd1'])
      },
    )

    it.each(PERMUTATIONS.flatMap(order => SUBSETS.map(subset => [order, subset] as const)))(
      'deleted in the order %j, a subset %j undone and deleted again (reverse order): the gaps are in card order again',
      (order, subset) => {
        del(...order)
        undo(...subset)
        del(...[...subset].reverse())
        expect(keys()).toEqual(['u1', 'gap:a1', 'gap:a2', 'gap:a3', 'c1', 'd1'])
      },
    )

    it('F4: pruning the column\'s taskOrder between the deletes changes no gap order', () => {
      boardStore.setColumnSorting(TaskStatus.Open, 'dateCreated', 'asc')
      const prune = () => { boardStore.columnByTaskStatus(TaskStatus.Open)!.taskOrder = [] }
      del('a2')
      prune()
      del('a1')
      prune()
      del('a3')
      prune()
      expect(keys()).toEqual(['u1', 'gap:a1', 'gap:a2', 'gap:a3', 'c1', 'd1'])
      undo('a3')
      prune()
      del('a3')
      expect(keys()).toEqual(['u1', 'gap:a1', 'gap:a2', 'gap:a3', 'c1', 'd1'])
    })
  })

  describe('F2: two adjacent stacks', () => {
    beforeEach(() => seed([['u1', null], ['a1', 'Design'], ['a2', 'Design'], ['o1', 'Ops'], ['o2', 'Ops'], ['d1', 'Docs']]))

    const permutations = (items: string[]): string[][] => items.length <= 1
      ? [items]
      : items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map(rest => [item, ...rest]))

    it.each(permutations(['a1', 'a2', 'o1', 'o2']))('deleted in the order %s, %s, %s, %s: the gaps of the first stack, then the second', (...order) => {
      del(...order)
      expect(keys()).toEqual(['u1', 'gap:a1', 'gap:a2', 'gap:o1', 'gap:o2', 'd1'])
    })

    it('undo of a member of the first stack leaves the second stack\'s gaps behind it', () => {
      del('o1', 'a1', 'o2', 'a2')
      undo('a1')
      expect(keys()).toEqual(['u1', 'a1', 'gap:a2', 'gap:o1', 'gap:o2', 'd1'])
    })
  })

  describe('F3: an ungrouped card in front of a stack', () => {
    beforeEach(() => seed([['u1', null], ['x1', null], ['a1', 'Design'], ['a2', 'Design'], ['c1', 'Ops']]))

    it.each(permutations3(['a1', 'a2', 'x1']))('deleted in the order %s, %s, %s: u1 gap:x1 gap:a1 gap:a2; undo x1 puts the card in front of the group\'s gaps', (...order) => {
      del(...order)
      expect(keys()).toEqual(['u1', 'gap:x1', 'gap:a1', 'gap:a2', 'c1'])
      undo('x1')
      expect(keys()).toEqual(['u1', 'x1', 'gap:a1', 'gap:a2', 'c1'])
    })
  })

  describe('cycles and old data', () => {
    it('a card dragged behind a gap that hangs on it, then deleted: no gap hangs on itself, the column renders (worst case the end)', () => {
      seed([['u1', null], ['c1', null], ['d1', null]])
      del('c1')
      expect(slotOf('c1')?.afterId).toBe('u1')
      // u1 is dragged behind the gap of c1, which hangs on u1
      renderKeys(['gap:c1', 'u1', 'd1'])
      expect(api.deleteTaskWithUndo('u1')).toBe(true)
      expect(slotOf('u1')?.afterId).toBeUndefined()
      expect(keys().sort()).toEqual(['d1', 'gap:c1', 'gap:u1'])
      expect(keys()[0]).toBe('d1')
    })

    it('a delete persisted by the previous version (several gaps on one root anchor) renders in delete order', () => {
      seed([['u1', null], ['c1', null], ['d1', null], ['e1', null]])
      tasksStore.removeTask('c1')
      tasksStore.removeTask('d1')
      // The gaps show while their undo window is open: the app restarted inside it
      for (const [id, requestedAt] of [['d1', 2], ['c1', 1]] as const) {
        tasksStore.addPendingDelete({
          taskId: id, task: makeTask(id), carryOver: null, state: 'waiting', requestedAt, fromStatus: TaskStatus.Open, slot: { afterId: 'u1', height: 100 }, orderIndex: null,
        })
        useUndoWindow('delete').beginTimed(id, DELETE_UNDO_WINDOW_MS, () => {})
      }
      expect(keys()).toEqual(['u1', 'gap:c1', 'gap:d1', 'e1'])
    })
  })
})

function permutations3(items: string[]): string[][] {
  return items.length <= 1
    ? [items]
    : items.flatMap((item, index) => permutations3([...items.slice(0, index), ...items.slice(index + 1)]).map(rest => [item, ...rest]))
}
