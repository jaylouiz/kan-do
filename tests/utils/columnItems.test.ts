import { describe, it, expect } from 'vitest'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import { buildColumnItems, withCapacityItem, groupKeyOfHeaderKey, isStackHeaderKey, orderGaps, stackHeaderKey } from '~/utils/columnItems'
import { getRenderedTaskOrder, groupTasksByKey } from '~/utils/taskGrouping'

const task = (id: string, topic: string | null): Task =>
  ({ id, title: id, status: TaskStatus.Open, topic, priority: 1, timeSpentSeconds: 0, timeBoxSeconds: null }) as unknown as Task

// u1 ungrouped; Design a1 a2 a3 (stack); Backend b1 alone; Ops o1 o2 (stack)
const TASKS = [
  task('a1', 'Design'), task('u1', null), task('a2', 'Design'), task('b1', 'Backend'),
  task('o1', 'Ops'), task('a3', 'Design'), task('o2', 'Ops'),
]

const build = (expandedKeys: string[]) =>
  buildColumnItems({ tasks: TASKS, groupKey: 'topic', expandedKeys, groupLabel: key => key, isMuted: () => false })

// Sortables in list order: cards by their task id, a collapsed stack by its front task (#150)
const cards = (items: ReturnType<typeof build>) =>
  items.flatMap(item =>
    item.kind === 'card'
      ? [{ id: item.task.id, sortableIndex: item.sortableIndex }]
      : item.kind === 'stack'
        ? [{ id: item.tasks[0]!.id, sortableIndex: item.sortableIndex }]
        : [])

describe('buildColumnItems (#148 header row)', () => {
  it('gives a collapsed stack the sortable index of its front task (#150)', () => {
    const stacks = build([]).flatMap(item => (item.kind === 'stack' ? [[item.groupKey, item.sortableIndex]] : []))
    expect(stacks).toEqual([['Design', 1], ['Ops', 3]])
  })

  it('puts a header row in front of an expanded group, and none on collapsed ones', () => {
    const items = build(['Design'])
    expect(items.map(item => item.key)).toEqual([
      'u1', 'stack-header:Design', 'a1', 'a2', 'a3', 'b1', 'stack:Ops',
    ])
    const header = items.find(item => item.kind === 'stack-header')
    expect(header).toMatchObject({ groupKey: 'Design', label: 'Design', count: 3 })
    // The header's pill reads the group's front task (topic mark, #578)
    expect(header).toMatchObject({ firstTask: { id: 'a1' } })
    expect(items.some(item => item.kind === 'stack-header' && item.groupKey === 'Ops')).toBe(false)
  })

  it('never hands a header a sortable index', () => {
    const header = build(['Design', 'Ops']).filter(item => item.kind === 'stack-header')
    expect(header).toHaveLength(2)
    header.forEach(item => expect('sortableIndex' in item).toBe(false))
  })

  it('maps drop indices with header rows exactly as without them', () => {
    for (const expanded of [[], ['Design'], ['Ops'], ['Design', 'Ops']]) {
      const items = build(expanded)
      const { draggableIds } = getRenderedTaskOrder(TASKS, 'topic', expanded)
      // dense sortable indices, in draggable order: a header row consumes none
      expect(cards(items).map(c => c.sortableIndex)).toEqual(draggableIds.map((_, index) => index))
      expect(cards(items).map(c => c.id)).toEqual(draggableIds)
    }
  })

  it('keeps the same indices for the cards before and after an expanded group', () => {
    const collapsed = cards(build([]))
    const expanded = cards(build(['Design']))
    // u1 and b1 sit outside the group: the collapsed stack is one sortable (a1), the expanded one has three
    expect(collapsed.map(c => c.id)).toEqual(['u1', 'a1', 'b1', 'o1'])
    expect(collapsed.map(c => c.sortableIndex)).toEqual([0, 1, 2, 3])
    expect(expanded.map(c => c.id)).toEqual(['u1', 'a1', 'a2', 'a3', 'b1', 'o1'])
    expect(expanded.map(c => c.sortableIndex)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('marks the members of an expanded group and names the group', () => {
    const members = build(['Design']).flatMap(item => (item.kind === 'card' && item.fromStack ? [item.fromStack] : []))
    expect(members).toEqual(['Design', 'Design', 'Design'])
  })

  it('names the place of each member in its stack for the spacing', () => {
    const positions = build(['Design']).flatMap(item => (item.kind === 'card' ? [item.stackPosition] : []))
    expect(positions).toEqual([undefined, 'first', 'middle', 'last', undefined])
  })

  it('numbers the members of an expanded group 1-based with the group size and label, and no one else (#154)', () => {
    const items = build(['Design'])
    const places = items.flatMap(item =>
      item.kind === 'card' ? [[item.task.id, item.stackIndex, item.stackSize, item.stackLabel]] : [])
    expect(places).toEqual([
      ['u1', undefined, undefined, undefined],
      ['a1', 1, 3, 'Design'],
      ['a2', 2, 3, 'Design'],
      ['a3', 3, 3, 'Design'],
      ['b1', undefined, undefined, undefined],
    ])
  })

  it('numbers every item, headers included, for the z-index', () => {
    expect(build(['Design']).map(item => item.itemIndex)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('renders the tasks in order without a group key', () => {
    const items = buildColumnItems({ tasks: TASKS, groupKey: null, expandedKeys: ['Design'], groupLabel: key => key, isMuted: () => false })
    expect(items.map(item => item.key)).toEqual(TASKS.map(t => t.id))
    expect(items.every(item => item.kind === 'card')).toBe(true)
  })
})

describe('buildColumnItems vs getRenderedTaskOrder (one order, two traversals)', () => {
  const MATRIX: Array<{ name: string, tasks: Task[], groupKey: 'topic' | null, expanded: string[] }> = [
    { name: 'no grouping', tasks: TASKS, groupKey: null, expanded: [] },
    { name: 'grouping, all collapsed', tasks: TASKS, groupKey: 'topic', expanded: [] },
    { name: 'grouping, one expanded', tasks: TASKS, groupKey: 'topic', expanded: ['Design'] },
    { name: 'grouping, all expanded', tasks: TASKS, groupKey: 'topic', expanded: ['Design', 'Ops'] },
    { name: 'a key that is no stack in expandedKeys', tasks: TASKS, groupKey: 'topic', expanded: ['Backend', 'Nope'] },
    { name: 'only ungrouped tasks', tasks: [task('u1', null), task('u2', null)], groupKey: 'topic', expanded: [] },
    { name: 'only singleton groups', tasks: [task('a1', 'A'), task('b1', 'B'), task('c1', 'C')], groupKey: 'topic', expanded: ['A'] },
    { name: 'ungrouped between groups', tasks: [task('a1', 'A'), task('u1', null), task('a2', 'A'), task('u2', null)], groupKey: 'topic', expanded: [] },
    { name: 'an empty list', tasks: [], groupKey: 'topic', expanded: [] },
  ]

  it.each(MATRIX)('lists the same tasks in the same order: $name', ({ tasks, groupKey, expanded }) => {
    const items = buildColumnItems({ tasks, groupKey, expandedKeys: expanded, groupLabel: key => key, isMuted: () => false })
    const { rendered } = getRenderedTaskOrder(tasks, groupKey, expanded)
    const listed = items.flatMap(item => (item.kind === 'card' ? [item.task.id] : item.kind === 'stack' ? item.tasks.map(t => t.id) : []))
    expect(listed).toEqual(rendered.map(t => t.id))
  })

  it.each(MATRIX)('lists the same sortables with matching sortableIndex: $name', ({ tasks, groupKey, expanded }) => {
    const items = buildColumnItems({ tasks, groupKey, expandedKeys: expanded, groupLabel: key => key, isMuted: () => false })
    const { draggableIds } = getRenderedTaskOrder(tasks, groupKey, expanded)
    expect(cards(items).map(c => c.id)).toEqual(draggableIds)
    // Independent of getRenderedTaskOrder: the sortables in list order are numbered densely from 0
    // (header rows are no sortables), so each one's index is its position among them
    cards(items).forEach((c, position) => expect(c.sortableIndex).toBe(position))
  })

  it.each(MATRIX)('gives the same items with pre-grouped input: $name', ({ tasks, groupKey, expanded }) => {
    const options = { tasks, groupKey, expandedKeys: expanded, groupLabel: (key: string) => key, isMuted: () => false }
    const groups = groupKey === null ? undefined : groupTasksByKey(tasks, groupKey)
    expect(buildColumnItems({ ...options, groups })).toEqual(buildColumnItems(options))
    expect(getRenderedTaskOrder(tasks, groupKey, expanded, groups)).toEqual(getRenderedTaskOrder(tasks, groupKey, expanded))
  })
})

describe('buildColumnItems: gaps of deleted cards (#422)', () => {
  const gap = (taskId: string, afterId: string | null | undefined, requestedAt = 0) =>
    ({ taskId, task: task(taskId, null), fromStatus: TaskStatus.Open, afterId, height: 132, state: 'open' as const, paused: false, requestedAt })
  const withGaps = (gaps: ReturnType<typeof gap>[], expandedKeys: string[] = []) =>
    buildColumnItems({ tasks: TASKS, groupKey: 'topic', expandedKeys, groupLabel: key => key, isMuted: () => false, gaps })

  it('puts a gap behind the card it followed, and none of it counts as a sortable', () => {
    const items = withGaps([gap('x', 'u1')])
    expect(items.map(item => item.key).indexOf('gap:x')).toBe(items.map(item => item.key).indexOf('u1') + 1)
    expect(cards(items)).toEqual(cards(build([])))
  })

  it('null = first, undefined or an id that left the column = the end', () => {
    expect(withGaps([gap('x', null)])[0]?.key).toBe('gap:x')
    expect(withGaps([gap('x', undefined)]).at(-1)?.key).toBe('gap:x')
    expect(withGaps([gap('x', 'moved-away')]).at(-1)?.key).toBe('gap:x')
  })

  it('a gap after a member of a collapsed stack sits behind the stack', () => {
    const keys = withGaps([gap('x', 'a2')]).map(item => item.key)
    expect(keys.indexOf('gap:x')).toBe(keys.indexOf('stack:Design') + 1)
  })

  it('gaps with the same anchor keep their delete order; a gap hung on another gap follows it', () => {
    const keys = withGaps([gap('late', 'u1', 20), gap('early', 'u1', 10)]).map(item => item.key)
    expect(keys.slice(keys.indexOf('u1') + 1, keys.indexOf('u1') + 3)).toEqual(['gap:early', 'gap:late'])

    const chained = withGaps([gap('second', 'first', 5), gap('first', 'u1', 9)]).map(item => item.key)
    expect(chained.slice(chained.indexOf('u1') + 1, chained.indexOf('u1') + 3)).toEqual(['gap:first', 'gap:second'])
  })
})

describe('buildColumnItems: gaps anchored on a stack header (#438)', () => {
  const gap = (taskId: string, afterId: string | null | undefined, requestedAt = 0) =>
    ({ taskId, task: task(taskId, 'Design'), fromStatus: TaskStatus.Open, afterId, height: 132, state: 'open' as const, paused: false, requestedAt })
  const keysOf = (tasks: Task[], gaps: ReturnType<typeof gap>[], expandedKeys: string[]) =>
    buildColumnItems({ tasks, groupKey: 'topic', expandedKeys, groupLabel: key => key, isMuted: () => false, gaps }).map(item => item.key)
  const header = stackHeaderKey('Design')

  it('the helper names the header item key of buildColumnItems', () => {
    const items = buildColumnItems({ tasks: TASKS, groupKey: 'topic', expandedKeys: ['Design'], groupLabel: key => key, isMuted: () => false })
    expect(items.map(item => item.key)).toContain(header)
  })

  it('an expanded stack: the gap sits between the header and the first remaining member', () => {
    const keys = keysOf([task('a2', 'Design'), task('a3', 'Design'), task('a4', 'Design')], [gap('a1', header)], ['Design'])
    expect(keys).toEqual([header, 'gap:a1', 'a2', 'a3', 'a4'])
  })

  it('the stack the card belonged to gets the gap, never the other one', () => {
    const tasks = [task('a2', 'Design'), task('a3', 'Design'), task('o1', 'Ops'), task('o2', 'Ops')]
    const keys = keysOf(tasks, [gap('a1', header)], ['Design', 'Ops'])
    expect(keys).toEqual([header, 'gap:a1', 'a2', 'a3', stackHeaderKey('Ops'), 'o1', 'o2'])
  })

  it('two gaps on the header stay in delete order, the older above the newer', () => {
    const keys = keysOf(
      [task('a3', 'Design'), task('a4', 'Design')],
      [gap('a2', header, 20), gap('a1', header, 10)],
      ['Design'],
    )
    expect(keys).toEqual([header, 'gap:a1', 'gap:a2', 'a3', 'a4'])
    // a gap chained behind the other (hops) keeps the same order
    const chained = keysOf([task('a3', 'Design'), task('a4', 'Design')], [gap('a2', 'a1', 20), gap('a1', header, 10)], ['Design'])
    expect(chained).toEqual([header, 'gap:a1', 'gap:a2', 'a3', 'a4'])
  })

  it('the user collapsed the group: the gap sits behind the collapsed stack, and behind the header again once expanded', () => {
    const tasks = [task('a2', 'Design'), task('a3', 'Design')]
    expect(keysOf(tasks, [gap('a1', header)], [])).toEqual(['stack:Design', 'gap:a1'])
    expect(keysOf(tasks, [gap('a1', header)], ['Design'])).toEqual([header, 'gap:a1', 'a2', 'a3'])
  })

  it('the group dropped to one card: the gap sits directly above that card, not at the end', () => {
    const tasks = [task('u1', null), task('a2', 'Design'), task('b1', 'Backend')]
    const keys = keysOf(tasks, [gap('a1', header)], ['Design'])
    expect(keys).toEqual(['u1', 'gap:a1', 'a2', 'b1'])
  })

  it('a group dissolved by two deletes keeps both gaps above the lone card in delete order', () => {
    const keys = keysOf([task('u1', null), task('a3', 'Design'), task('b1', 'Backend')], [gap('a2', header, 20), gap('a1', header, 10)], ['Design'])
    expect(keys).toEqual(['u1', 'gap:a1', 'gap:a2', 'a3', 'b1'])
  })

  it('a header anchor whose group is gone entirely falls back to the column end', () => {
    const keys = keysOf([task('u1', null), task('b1', 'Backend')], [gap('a1', header)], ['Design'])
    expect(keys).toEqual(['u1', 'b1', 'gap:a1'])
  })

  it('gaps hanging on a card keep their place next to header gaps', () => {
    const keys = keysOf([task('a2', 'Design'), task('a3', 'Design'), task('a4', 'Design')], [gap('x', 'a2', 5), gap('a1', header, 10)], ['Design'])
    expect(keys).toEqual([header, 'gap:a1', 'a2', 'gap:x', 'a3', 'a4'])
  })
})

describe('buildColumnItems: gaps after the anchors were rewritten when a group\'s last member went (#457)', () => {
  const gap = (taskId: string, afterId: string | null | undefined, requestedAt = 0) =>
    ({ taskId, task: task(taskId, 'Design'), fromStatus: TaskStatus.Open, afterId, height: 132, state: 'open' as const, paused: false, requestedAt })
  const keysOf = (tasks: Task[], gaps: ReturnType<typeof gap>[]) =>
    buildColumnItems({ tasks, groupKey: 'topic', expandedKeys: ['Design'], groupLabel: key => key, isMuted: () => false, gaps }).map(item => item.key)

  it('the header key helpers round-trip a group key, also one with a colon', () => {
    expect(isStackHeaderKey(stackHeaderKey('Design'))).toBe(true)
    expect(isStackHeaderKey('a1')).toBe(false)
    expect(groupKeyOfHeaderKey(stackHeaderKey('Team: Design'))).toBe('Team: Design')
  })

  it('card anchors in front of the group keep the delete order where the group stood', () => {
    const tasks = [task('u1', null), task('b1', 'Backend')]
    expect(keysOf(tasks, [gap('a3', 'u1', 30), gap('a1', 'u1', 10), gap('a2', 'u1', 20)])).toEqual(['u1', 'gap:a1', 'gap:a2', 'gap:a3', 'b1'])
  })

  it('a stack in the first position: the null anchor keeps the gaps at the top, not at the end', () => {
    const tasks = [task('u1', null), task('b1', 'Backend')]
    expect(keysOf(tasks, [gap('a2', null, 20), gap('a1', null, 10)])).toEqual(['gap:a1', 'gap:a2', 'u1', 'b1'])
  })

  it('a gap chained behind a rewritten gap follows it', () => {
    const tasks = [task('u1', null), task('b1', 'Backend')]
    expect(keysOf(tasks, [gap('a2', 'a1', 20), gap('a1', 'u1', 10)])).toEqual(['u1', 'gap:a1', 'gap:a2', 'b1'])
  })
})

describe('orderGaps: the order gaps share a place in', () => {
  const gap = (taskId: string, afterId: string | null | undefined, requestedAt: number) => ({ taskId, afterId, requestedAt })

  it('fewer hops through other gaps first, then the older delete; a chain ends on its anchor', () => {
    const ordered = orderGaps([gap('g3', 'g2', 3), gap('g2', 'u1', 2), gap('g1', 'u1', 1), gap('g4', 'u1', 4)])
    expect(ordered.map(({ gap: g, anchor, hops }) => [g.taskId, anchor, hops])).toEqual([
      ['g1', 'u1', 0], ['g2', 'u1', 0], ['g4', 'u1', 0], ['g3', 'u1', 1],
    ])
  })

  it('a cycle terminates instead of looping', () => {
    expect(orderGaps([gap('g1', 'g2', 1), gap('g2', 'g1', 2)])).toHaveLength(2)
  })
})

describe('withCapacityItem (#132)', () => {
  it('puts a non-sortable capacity item behind the named item and renumbers the list', () => {
    const items = withCapacityItem(build([]), 'b1')
    expect(items.map(item => item.key)).toEqual(['u1', 'stack:Design', 'b1', 'capacity', 'stack:Ops'])
    expect(items.map(item => item.itemIndex)).toEqual([0, 1, 2, 3, 4])
    // the drag order is the same with and without the line
    expect(cards(items)).toEqual(cards(build([])))
  })

  it('puts it behind a member of an expanded group, between the members', () => {
    const items = withCapacityItem(build(['Design']), 'a2')
    expect(items.map(item => item.key)).toEqual(['u1', 'stack-header:Design', 'a1', 'a2', 'capacity', 'a3', 'b1', 'stack:Ops'])
  })

  it('returns the list unchanged for no key or a key that is not in it', () => {
    const base = build([])
    expect(withCapacityItem(base, null)).toBe(base)
    expect(withCapacityItem(base, 'gone')).toBe(base)
  })
})
