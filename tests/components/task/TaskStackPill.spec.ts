import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import TaskStackPill from '~/components/task/TaskStackPill.vue'
import { useBoardStore } from '~/store/board'
import { EMPTY_GROUP_KEY, getGroupLabel } from '~/utils/taskGrouping'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import type { GroupKey } from '~/types/boardGrouping'

const front = { id: 'a1', source: 'local', externalId: null, title: 'Konzept', status: TaskStatus.Open, priority: 1, topic: 'Design', topicColorCode: null } as unknown as Task

const PRIORITY_STUB = { props: { priority: null }, template: '<span class="priority" :data-priority="priority" />' }
const MARK_STUB = { template: '<span data-testid="topic-mark" />' }

/** Mounts the pill with the board grouped by `by` (the pill reads the grouping from the board store) */
function render(by: GroupKey | null, props: { groupKey: string, label: string, count?: number }) {
  const board = useBoardStore()
  board.setGroupingEnabled(by !== null)
  board.setGroupingKey(by)
  return mount(TaskStackPill, {
    props: { count: 3, firstTask: front, ...props },
    global: { stubs: { TaskPriorityBadge: PRIORITY_STUB, TopicMark: MARK_STUB, UIcon: { props: ['name'], template: '<i class="icon" :data-name="name" />' } } },
  })
}

beforeEach(() => setActivePinia(createPinia()))

describe('TaskStackPill (#504)', () => {
  it('topic: the topic mark and the neutral name, then the stack icon and the count', () => {
    const w = render('topic', { groupKey: 'Design', label: 'Design' })
    expect(w.find('[data-prop-kind]').attributes('data-prop-kind')).toBe('topic')
    expect(w.find('[data-testid="topic-mark"]').exists()).toBe(true)
    expect(w.find('.task-stack-pill__text').text()).toBe('Design')
    expect(w.find('.task-stack-pill__count .icon').attributes('data-name')).toBe('i-ph-stack')
    expect(w.find('.task-stack-pill__count').text()).toBe('3')
    expect(w.text()).not.toContain('Aufgaben')
  })

  it.each(['1', '2', '3'])('priority %s: the real priority badge is the segment, no name text', (level) => {
    const w = render('priority', { groupKey: level, label: 'x' })
    expect(w.find('.priority').attributes('data-priority')).toBe(level)
    expect(w.find('.task-stack-pill__prop').classes()).toContain('task-stack-pill__prop--priority')
    expect(w.find('.task-stack-pill__text').exists()).toBe(false)
  })

  it('there is no priority "none" (#653): a priority group key 0 is not drawn as a name', () => {
    expect(getGroupLabel('0', 'priority')).toBe('Normal')
  })

  // Any grouping that is neither topic nor priority (custom/Notion properties take the same path, but need a Notion config to be offered)
  it('activity: the plain name, no mark and no badge', () => {
    const label = 'Meeting'
    const w = render('activity', { groupKey: label, label })
    expect(w.find('[data-prop-kind]').attributes('data-prop-kind')).toBe('plain')
    expect(w.find('.task-stack-pill__text').text()).toBe(label)
    expect(w.find('[data-testid="topic-mark"]').exists()).toBe(false)
    expect(w.find('.priority').exists()).toBe(false)
  })

  it.each(['topic', 'activity'] as GroupKey[])('the empty group of %s falls back to the plain name', (by) => {
    const w = render(by, { groupKey: EMPTY_GROUP_KEY, label: 'Keine' })
    expect(w.find('[data-prop-kind]').attributes('data-prop-kind')).toBe('plain')
    expect(w.find('[data-testid="topic-mark"]').exists()).toBe(false)
    expect(w.find('.priority').exists()).toBe(false)
    expect(w.find('.task-stack-pill__text').text()).toBe('Keine')
  })

  it('marks the name and the count as private task text', () => {
    const w = render('topic', { groupKey: 'Design', label: 'Design' })
    expect(w.findAll('[data-private]')).toHaveLength(2)
  })
})
