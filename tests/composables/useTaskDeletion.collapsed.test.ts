import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTaskDeletion, resetTaskDeletionState, DELETE_UNDO_WINDOW_MS } from '~/composables/useTaskDeletion'
import { closingGaps, GAP_CLOSE_MS } from '~/lib/deleteGapState'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useDeletedGaps } from '~/composables/useDeletedGaps'
import { buildColumnItems, stackHeaderKey } from '~/utils/columnItems'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

/**
 * #502: gaps of several cards deleted from a *collapsed* stack keep the card order. The board is re-rendered from
 * the real item order between the steps, with the group collapsed (what `measureSlot` reads: a stack box with the
 * member ids, gap elements as siblings, no wrapper for a member). The result is read with the group expanded.
 */

vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({ syncExistingDoneTasks: vi.fn(), updateTaskRecord: vi.fn(), recordDiscardedTime: vi.fn(), removeDiscardedTime: vi.fn() }),
}))
vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: vi.fn() }),
}))

const makeTask = (id: string, topic: string | null, priority: number): Task => ({
  id, source: 'local', externalId: null, title: `Task ${id}`, status: TaskStatus.Open, activity: null, topic, topicColorCode: null,
  priority, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null,
}) as Task

const header = stackHeaderKey('Design')

describe('gap order follows the card order in a collapsed stack (#502)', () => {
  let tasksStore: ReturnType<typeof useTasksStore>
  let boardStore: ReturnType<typeof useBoardStore>
  let api: ReturnType<typeof useTaskDeletion>

  const items = (expandedKeys: string[]) => buildColumnItems({
    tasks: tasksStore.tasksOpen, groupKey: 'topic', expandedKeys, groupLabel: key => key, isMuted: () => false, gaps: useDeletedGaps().gaps.value,
  })
  const keys = (expandedKeys: string[] = ['Design', 'Ops']) => items(expandedKeys).map(item => item.key)

  /** The board with every group collapsed, as the DOM `measureSlot` reads. */
  function renderCollapsed() {
    document.body.innerHTML = ''
    const list = document.createElement('div')
    for (const item of items([])) {
      const el = document.createElement('div')
      if (item.kind === 'stack') {
        el.className = 'task-stack'
        el.dataset.taskId = item.tasks[0]!.id
        el.dataset.stackTaskIds = JSON.stringify(item.tasks.map(task => task.id))
        el.dataset.stackKey = item.groupKey
        Object.defineProperty(el, 'offsetHeight', { value: 168 })
      } else if (item.kind === 'gap') {
        el.dataset.gapId = item.gap.taskId
      } else if (item.kind === 'card') {
        el.className = 'task-wrapper'
        el.dataset.taskId = item.task.id
        Object.defineProperty(el, 'offsetHeight', { value: 100 })
      }
      list.append(el)
    }
    document.body.append(list)
  }

  function seed(cards: Array<[string, string | null]>) {
    tasksStore.setTasks(cards.map(([id, topic], index) => makeTask(id, topic, index)))
    boardStore.reconcileColumnsWithTasks(tasksStore.tasks)
  }
  function del(...ids: string[]) {
    for (const id of ids) {
      renderCollapsed()
      expect(api.deleteTaskWithUndo(id)).toBe(true)
      vi.advanceTimersByTime(10)
    }
  }
  const undo = (...ids: string[]) => { for (const id of ids) api.undoDelete(id) }
  const slotOf = (id: string) => tasksStore.pendingDeletes[id]?.slot ?? closingGaps[id]?.slot

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

  describe('stack of 3', () => {
    beforeEach(() => seed([['u1', null], ['a1', 'Design'], ['a2', 'Design'], ['a3', 'Design'], ['c1', 'Ops']]))

    it('repro 1: delete a2, a3, undo a2, expand -> header a1 a2 gap:a3', () => {
      del('a2', 'a3')
      expect(slotOf('a2')?.afterId).toBe('a1')
      expect(slotOf('a3')?.afterId).toBe('a2')
      undo('a2')
      expect(keys()).toEqual(['u1', header, 'a1', 'a2', 'gap:a3', 'c1'])
    })

    it('repro 2: delete a1, a2, undo a1, expand -> header a1 gap:a2 a3', () => {
      del('a1', 'a2')
      expect(slotOf('a2')?.afterId).toBe('a1')
      undo('a1')
      expect(keys()).toEqual(['u1', header, 'a1', 'gap:a2', 'a3', 'c1'])
    })

    it('a1, then a2: both gaps sit above the lone card a3, where the stack stood', () => {
      del('a1', 'a2')
      expect(keys()).toEqual(['u1', 'gap:a1', 'gap:a2', 'a3', 'c1'])
    })

    const PERMUTATIONS = [['a1', 'a2', 'a3'], ['a1', 'a3', 'a2'], ['a2', 'a1', 'a3'], ['a2', 'a3', 'a1'], ['a3', 'a1', 'a2'], ['a3', 'a2', 'a1']]
    const SUBSETS = [['a1'], ['a2'], ['a3'], ['a1', 'a2'], ['a1', 'a3'], ['a2', 'a3'], ['a1', 'a2', 'a3']]

    it.each(PERMUTATIONS)('deleted in the order %s, %s, %s: gap:a1 gap:a2 gap:a3 between u1 and c1', (...order) => {
      del(...order)
      expect(keys()).toEqual(['u1', 'gap:a1', 'gap:a2', 'gap:a3', 'c1'])
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
            if (undone.size >= 2 && member === subset.toSorted()[0]) expected.push(header)
            expected.push(member)
          } else expected.push(`gap:${member}`)
        }
        expect(keys()).toEqual([...expected, 'c1'])
      },
    )

    it.each(PERMUTATIONS.flatMap(order => SUBSETS.map(subset => [order, subset] as const)))(
      'A -> B -> A: deleted in the order %j, a subset %j undone and deleted again (reverse order): the gaps are in card order again',
      (order, subset) => {
        del(...order)
        undo(...subset)
        del(...[...subset].reverse())
        expect(keys()).toEqual(['u1', 'gap:a1', 'gap:a2', 'gap:a3', 'c1'])
      },
    )

    it('the gap of a2 elapses and glides shut: a3 keeps its place behind a1', async () => {
      del('a2', 'a3')
      api.pauseDelete('a3')
      await vi.advanceTimersByTimeAsync(DELETE_UNDO_WINDOW_MS + GAP_CLOSE_MS)
      expect(slotOf('a3')?.afterId).toBe('a1')
      expect(keys()).toEqual(['u1', 'a1', 'gap:a3', 'c1'])
    })
  })

  describe('stack of 4', () => {
    beforeEach(() => seed([['u1', null], ['a1', 'Design'], ['a2', 'Design'], ['a3', 'Design'], ['a4', 'Design'], ['c1', 'Ops']]))

    const permutations = (list: string[]): string[][] => list.length <= 1
      ? [list]
      : list.flatMap((item, index) => permutations([...list.slice(0, index), ...list.slice(index + 1)]).map(rest => [item, ...rest]))

    it.each(permutations(['a1', 'a2', 'a3', 'a4']))('deleted in the order %s, %s, %s, %s: the four gaps in card order', (...order) => {
      del(...order)
      expect(keys()).toEqual(['u1', 'gap:a1', 'gap:a2', 'gap:a3', 'gap:a4', 'c1'])
    })

    it('delete a3, a2; undo a3: a3 is back behind the gap of a2 and the stack follows the card order', () => {
      del('a3', 'a2')
      undo('a3')
      expect(keys()).toEqual(['u1', header, 'a1', 'gap:a2', 'a3', 'a4', 'c1'])
    })
  })

  describe('stack of 2', () => {
    beforeEach(() => seed([['u1', null], ['a1', 'Design'], ['a2', 'Design'], ['c1', 'Ops']]))

    it('the first member deleted: the gap sits directly above the lone card, like the expanded read', () => {
      del('a1')
      expect(slotOf('a1')?.afterId).toBe(header)
      expect(keys()).toEqual(['u1', 'gap:a1', 'a2', 'c1'])
    })

    it('the second member deleted: the gap sits below the lone first card', () => {
      del('a2')
      expect(keys()).toEqual(['u1', 'a1', 'gap:a2', 'c1'])
    })

    it.each([[['a1', 'a2']], [['a2', 'a1']]])('deleted in the order %j: gap:a1 gap:a2; undo of each and again (A -> B -> A)', (order) => {
      del(...order)
      expect(keys()).toEqual(['u1', 'gap:a1', 'gap:a2', 'c1'])
      undo('a2')
      del('a2')
      expect(keys()).toEqual(['u1', 'gap:a1', 'gap:a2', 'c1'])
      undo('a1')
      expect(keys()).toEqual(['u1', 'a1', 'gap:a2', 'c1'])
    })
  })

  describe('a card behind the stack', () => {
    beforeEach(() => seed([['u1', null], ['a1', 'Design'], ['a2', 'Design'], ['a3', 'Design'], ['c1', 'Ops'], ['d1', 'Docs']]))

    // Read collapsed: a gap of a card behind a collapsed stack is expanded-ambiguous (it hangs on a member), out of scope here
    it('c1 deleted first, then a2: the gap of a2 stands in front of the gap of c1, both directly below the stack', () => {
      del('c1', 'a2')
      expect(slotOf('c1')?.afterId).toBe('a2')
      expect(keys([])).toEqual(['u1', 'stack:Design', 'gap:a2', 'gap:c1', 'd1'])
      undo('a2')
      expect(keys([])).toEqual(['u1', 'stack:Design', 'gap:c1', 'd1'])
    })

    it('c1 deleted first, then a2 and a3: the order stays a2, a3, c1; undo of c1 leaves the others', () => {
      del('c1', 'a2', 'a3')
      expect(keys([])).toEqual(['u1', 'a1', 'gap:a2', 'gap:a3', 'gap:c1', 'd1'])
      undo('c1')
      expect(keys([])).toEqual(['u1', 'a1', 'gap:a2', 'gap:a3', 'c1', 'd1'])
    })

    it('a2 deleted first, then c1: c1 hangs on the gap of a2 as before', () => {
      del('a2', 'c1')
      expect(slotOf('c1')?.afterId).toBe('a2')
      expect(keys([])).toEqual(['u1', 'stack:Design', 'gap:a2', 'gap:c1', 'd1'])
    })
  })
})
