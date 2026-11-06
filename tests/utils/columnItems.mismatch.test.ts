import { describe, it, expect, vi } from 'vitest'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

// The rendered order lacks `a1`: buildColumnItems and getRenderedTaskOrder disagree
vi.mock('~/utils/taskGrouping', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/utils/taskGrouping')>()
  return {
    ...actual,
    getRenderedTaskOrder: () => ({ draggableIds: ['u1'], rendered: [], expandedKeys: [] }),
  }
})

// eslint-disable-next-line import/first -- the mock above must be registered before the import
import { buildColumnItems } from '~/utils/columnItems'

const task = (id: string, topic: string | null): Task =>
  ({ id, title: id, status: TaskStatus.Open, topic, priority: 1, timeSpentSeconds: 0, timeBoxSeconds: null }) as unknown as Task

describe('buildColumnItems: an item missing from the rendered order', () => {
  // (the dev warning is behind import.meta.dev, which vitest does not define)
  it('does not collide with the first sortable', () => {
    const items = buildColumnItems({
      tasks: [task('u1', null), task('a1', 'Design'), task('a2', 'Design')],
      groupKey: 'topic',
      expandedKeys: [],
      groupLabel: key => key,
      isMuted: () => false,
    })

    const sortableIndices = items.flatMap(item => (item.kind === 'card' || item.kind === 'stack' ? [item.sortableIndex] : []))
    expect(sortableIndices).toEqual([0, 1]) // u1 keeps 0, the stack goes past the end
  })
})
