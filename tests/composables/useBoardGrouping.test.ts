import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useBoardGrouping } from '~/composables/useBoardGrouping'
import { useBoardStore } from '~/store/board'
import { useNotionConfigStore } from '~/store/notionConfig'
import { useTasksStore } from '~/store/tasks'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import type { NotionConfig } from '~/types/notion'

function task(id: string, source: Task['source']): Task {
  return {
    id, source, externalId: source === 'local' ? null : id, title: id, status: TaskStatus.Open, priority: 1,
    activity: null, topic: null, topicColorCode: null, notes: null, timeBoxSeconds: 0, timeSpentSeconds: 0, timerId: null,
  }
}

describe('useBoardGrouping: effective key on a mixed board (#323)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('shows topic while the board is mixed, never writes the persisted custom key, and restores it', () => {
    const board = useBoardStore()
    const tasks = useTasksStore()
    useNotionConfigStore().config = {
      propertyMapping: { customProperties: [{ name: 'Bereich', type: 'select', enabled: true, key: 'bereich' }] },
    } as unknown as NotionConfig
    board.setGroupingEnabled(true)
    board.setGroupingKey('custom:bereich')
    tasks.addTask(task('a', 'notion'))

    const { effectiveGroupKey } = useBoardGrouping()
    const writes = vi.fn()
    board.$onAction(({ name }) => writes(name))
    expect(effectiveGroupKey.value).toBe('custom:bereich')

    tasks.addTask(task('b', 'local'))
    expect(effectiveGroupKey.value).toBe('topic')
    expect(board.grouping.key).toBe('custom:bereich')

    tasks.removeTask('b')
    expect(effectiveGroupKey.value).toBe('custom:bereich')
    expect(board.grouping.key).toBe('custom:bereich')
    expect(writes).not.toHaveBeenCalled()
  })

  it('keeps the activity key effective on a mixed board (#505)', () => {
    const board = useBoardStore()
    const tasks = useTasksStore()
    board.setGroupingEnabled(true)
    board.setGroupingKey('activity')
    tasks.addTask(task('a', 'notion'))
    tasks.addTask(task('b', 'local'))
    const { effectiveGroupKey, groupingOptions } = useBoardGrouping()
    expect(groupingOptions.value.map(o => o.value)).toEqual(['topic', 'activity', 'priority'])
    expect(effectiveGroupKey.value).toBe('activity')
  })

  it('keeps a null key null', () => {
    expect(useBoardGrouping().effectiveGroupKey.value).toBeNull()
  })
})
