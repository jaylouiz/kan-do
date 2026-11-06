import { describe, it, expect } from 'vitest'
import { TaskStatus } from '~/types/taskStatus'
import type { Task, TaskCustomValue } from '~/types/task'
import { setTestLocale } from '../helpers/i18n'
import {
  EMPTY_GROUP_KEY,
  deriveGroupKeyForTask,
  shouldTaskBeGrouped,
  groupTasksByKey,
  isGroupingActiveFor,
  getRenderedTaskOrder,
  getStackKeys,
  getGroupLabel,
} from '~/utils/taskGrouping'

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1', source: 'local', externalId: null,
    title: 'Test Task',
    status: TaskStatus.Open,
    activity: null,
    topic: null,
    topicColorCode: null,
    priority: 0,
    notes: null,
    timeBoxSeconds: null,
    timeSpentSeconds: 0,
    timerId: null,
    ...overrides,
  }
}

describe('deriveGroupKeyForTask', () => {
  describe('topic grouping', () => {
    it('returns topic value when set', () => {
      const task = makeTask({ topic: 'Design' })
      expect(deriveGroupKeyForTask(task, 'topic')).toBe('Design')
    })

    it('returns EMPTY_GROUP_KEY when topic is null', () => {
      const task = makeTask({ topic: null })
      expect(deriveGroupKeyForTask(task, 'topic')).toBe(EMPTY_GROUP_KEY)
    })

    it('trims whitespace from topic', () => {
      const task = makeTask({ topic: '  Work  ' })
      expect(deriveGroupKeyForTask(task, 'topic')).toBe('Work')
    })

    it('returns EMPTY_GROUP_KEY for blank topic string', () => {
      const task = makeTask({ topic: '   ' })
      expect(deriveGroupKeyForTask(task, 'topic')).toBe(EMPTY_GROUP_KEY)
    })
  })

  describe('activity grouping (#505)', () => {
    it('returns the trimmed activity when set', () => {
      expect(deriveGroupKeyForTask(makeTask({ activity: '  Planung ' }), 'activity')).toBe('Planung')
    })

    it('returns EMPTY_GROUP_KEY for a missing or blank activity, and ignores the topic', () => {
      expect(deriveGroupKeyForTask(makeTask({ activity: null, topic: 'Design' }), 'activity')).toBe(EMPTY_GROUP_KEY)
      expect(deriveGroupKeyForTask(makeTask({ activity: '   ' }), 'activity')).toBe(EMPTY_GROUP_KEY)
    })

    it('stacks tasks with the same activity, leaves the ones without out, and names the group by the activity', () => {
      const a1 = makeTask({ id: 'a1', activity: 'Planung' })
      const a2 = makeTask({ id: 'a2', activity: 'Planung', topic: 'Other' })
      const b = makeTask({ id: 'b', activity: 'Entwicklung' })
      const none = makeTask({ id: 'n' })
      const tasks = [a1, none, a2, b]
      expect(shouldTaskBeGrouped(none, 'activity')).toBe(false)
      const groups = groupTasksByKey(tasks, 'activity')
      expect([...groups.keys()]).toEqual(['Planung', 'Entwicklung'])
      expect(groups.get('Planung')?.map(t => t.id)).toEqual(['a1', 'a2'])
      expect(getStackKeys(tasks, 'activity')).toEqual(['Planung'])
      expect(getGroupLabel('Planung', 'activity', a1)).toBe('Planung')
    })
  })

  describe('priority grouping', () => {
    it('returns priority as string', () => {
      const task = makeTask({ priority: 3 })
      expect(deriveGroupKeyForTask(task, 'priority')).toBe('3')
    })

    it('puts a task without a priority (0, null, missing) in the Normal group (#653)', () => {
      for (const priority of [0, null, undefined]) {
        expect(deriveGroupKeyForTask(makeTask({ priority: priority as unknown as number }), 'priority')).toBe('2')
      }
    })

    it('puts the former 4th level (urgent) in the High group (#617)', () => {
      expect(deriveGroupKeyForTask(makeTask({ priority: 4 }), 'priority')).toBe('3')
      const groups = groupTasksByKey([makeTask({ id: 'a', priority: 4 }), makeTask({ id: 'b', priority: 3 }), makeTask({ id: 'c', priority: 2 })], 'priority')
      expect([...groups.keys()].sort()).toEqual(['2', '3'])
      expect(groups.get('3')?.map(task => task.id)).toEqual(['a', 'b'])
    })
  })

  describe('custom property grouping', () => {
    it('returns text value for text custom property', () => {
      const task = makeTask({
        custom: {
          myfield: {
            key: 'myfield',
            name: 'My Field',
            propType: 'text',
            value: { type: 'text', value: 'hello' },
          },
        },
      })
      expect(deriveGroupKeyForTask(task, 'custom:myfield')).toBe('hello')
    })

    it('returns EMPTY_GROUP_KEY for null text value', () => {
      const task = makeTask({
        custom: {
          myfield: {
            key: 'myfield',
            name: 'My Field',
            propType: 'text',
            value: { type: 'text', value: null },
          },
        },
      })
      expect(deriveGroupKeyForTask(task, 'custom:myfield')).toBe(EMPTY_GROUP_KEY)
    })

    it('returns number as string for number custom property', () => {
      const task = makeTask({
        custom: {
          effort: {
            key: 'effort',
            name: 'Effort',
            propType: 'number',
            value: { type: 'number', value: 42 },
          },
        },
      })
      expect(deriveGroupKeyForTask(task, 'custom:effort')).toBe('42')
    })

    it('returns select name for select custom property', () => {
      const task = makeTask({
        custom: {
          priority: {
            key: 'priority',
            name: 'Priority',
            propType: 'select',
            value: { type: 'select', value: { name: 'High', color: 'red' } },
          },
        },
      })
      expect(deriveGroupKeyForTask(task, 'custom:priority')).toBe('High')
    })

    it('returns EMPTY_GROUP_KEY for null select value', () => {
      const task = makeTask({
        custom: {
          priority: {
            key: 'priority',
            name: 'Priority',
            propType: 'select',
            value: { type: 'select', value: null },
          },
        },
      })
      expect(deriveGroupKeyForTask(task, 'custom:priority')).toBe(EMPTY_GROUP_KEY)
    })

    it('returns EMPTY_GROUP_KEY for multi_select (not supported)', () => {
      const task = makeTask({
        custom: {
          tags: {
            key: 'tags',
            name: 'Tags',
            propType: 'multi_select',
            value: { type: 'multi_select', value: [{ name: 'A' }] },
          },
        },
      })
      expect(deriveGroupKeyForTask(task, 'custom:tags')).toBe(EMPTY_GROUP_KEY)
    })

    it('returns date start for date custom property', () => {
      const task = makeTask({
        custom: {
          duedate: {
            key: 'duedate',
            name: 'Due Date',
            propType: 'date',
            value: { type: 'date', value: { start: '2024-01-15' } },
          },
        },
      })
      expect(deriveGroupKeyForTask(task, 'custom:duedate')).toBe('2024-01-15')
    })

    it('returns "true" for checked checkbox', () => {
      const task = makeTask({
        custom: {
          done: {
            key: 'done',
            name: 'Done',
            propType: 'checkbox',
            value: { type: 'checkbox', value: true },
          },
        },
      })
      expect(deriveGroupKeyForTask(task, 'custom:done')).toBe('true')
    })

    it('returns "false" for unchecked checkbox', () => {
      const task = makeTask({
        custom: {
          done: {
            key: 'done',
            name: 'Done',
            propType: 'checkbox',
            value: { type: 'checkbox', value: false },
          },
        },
      })
      expect(deriveGroupKeyForTask(task, 'custom:done')).toBe('false')
    })

    it('returns EMPTY_GROUP_KEY when custom property is missing', () => {
      const task = makeTask({ custom: {} })
      expect(deriveGroupKeyForTask(task, 'custom:nonexistent')).toBe(EMPTY_GROUP_KEY)
    })
  })

  it('returns EMPTY_GROUP_KEY for unknown groupKey', () => {
    const task = makeTask()
    // @ts-expect-error -- testing invalid groupKey
    expect(deriveGroupKeyForTask(task, 'invalid_key')).toBe(EMPTY_GROUP_KEY)
  })
})

describe('shouldTaskBeGrouped', () => {
  it('returns true for topic with a value', () => {
    const task = makeTask({ topic: 'Design' })
    expect(shouldTaskBeGrouped(task, 'topic')).toBe(true)
  })

  it('returns false for topic when null (empty key)', () => {
    const task = makeTask({ topic: null })
    expect(shouldTaskBeGrouped(task, 'topic')).toBe(false)
  })

  it('always returns true for priority grouping (even without a priority)', () => {
    const taskZero = makeTask({ priority: 0 })
    expect(shouldTaskBeGrouped(taskZero, 'priority')).toBe(true)
  })

  it('returns true for non-empty custom property', () => {
    const task = makeTask({
      custom: {
        myfield: {
          key: 'myfield',
          name: 'My Field',
          propType: 'text',
          value: { type: 'text', value: 'hello' },
        },
      },
    })
    expect(shouldTaskBeGrouped(task, 'custom:myfield')).toBe(true)
  })

  it('returns false for missing custom property', () => {
    const task = makeTask({ custom: {} })
    expect(shouldTaskBeGrouped(task, 'custom:missing')).toBe(false)
  })
})

describe('groupTasksByKey', () => {
  it('groups tasks by topic', () => {
    const tasks = [
      makeTask({ id: '1', topic: 'Design' }),
      makeTask({ id: '2', topic: 'Dev' }),
      makeTask({ id: '3', topic: 'Design' }),
    ]
    const groups = groupTasksByKey(tasks, 'topic')
    expect(groups.get('Design')).toHaveLength(2)
    expect(groups.get('Dev')).toHaveLength(1)
  })

  it('excludes tasks with no topic from grouping', () => {
    const tasks = [
      makeTask({ id: '1', topic: 'Design' }),
      makeTask({ id: '2', topic: null }),
    ]
    const groups = groupTasksByKey(tasks, 'topic')
    expect(groups.get('Design')).toHaveLength(1)
    expect(groups.has(EMPTY_GROUP_KEY)).toBe(false)
  })

  it('returns empty map for empty task array', () => {
    const groups = groupTasksByKey([], 'topic')
    expect(groups.size).toBe(0)
  })

  it('groups all tasks under priority; a task without a priority joins Normal (#653)', () => {
    const tasks = [
      makeTask({ id: '1', priority: 0 }),
      makeTask({ id: '2', priority: 3 }),
      makeTask({ id: '3', priority: 2 }),
    ]
    const groups = groupTasksByKey(tasks, 'priority')
    expect([...groups.keys()].sort()).toEqual(['2', '3'])
    expect(groups.get('2')!.map(t => t.id)).toEqual(['1', '3'])
  })

  it('preserves original task order within a group', () => {
    const tasks = [
      makeTask({ id: '1', topic: 'A' }),
      makeTask({ id: '2', topic: 'A' }),
      makeTask({ id: '3', topic: 'A' }),
    ]
    const groups = groupTasksByKey(tasks, 'topic')
    const groupA = groups.get('A')!
    expect(groupA[0]!.id).toBe('1')
    expect(groupA[1]!.id).toBe('2')
    expect(groupA[2]!.id).toBe('3')
  })
})

describe('isGroupingActiveFor', () => {
  it('is active for a grouping column with grouping enabled and a key', () => {
    expect(isGroupingActiveFor(TaskStatus.Open, true, 'topic')).toBe(true)
    expect(isGroupingActiveFor(TaskStatus.Waiting, true, 'priority')).toBe(true)
    expect(isGroupingActiveFor(TaskStatus.Done, true, 'topic')).toBe(true)
  })

  it('is inactive when grouping is disabled or has no key', () => {
    expect(isGroupingActiveFor(TaskStatus.Open, false, 'topic')).toBe(false)
    expect(isGroupingActiveFor(TaskStatus.Open, true, null)).toBe(false)
  })

  it('is never active for Jetzt', () => {
    expect(isGroupingActiveFor(TaskStatus.Progress, true, 'topic')).toBe(false)
  })
})

describe('getRenderedTaskOrder (#135)', () => {
  const ids = (tasks: Task[]) => tasks.map(t => t.id)

  it('without a group key returns the input order with every task draggable', () => {
    const tasks = [makeTask({ id: 'a', topic: 'A' }), makeTask({ id: 'b' }), makeTask({ id: 'c', topic: 'A' })]
    const { rendered, draggableIds } = getRenderedTaskOrder(tasks, null)
    expect(ids(rendered)).toEqual(['a', 'b', 'c'])
    expect(draggableIds).toEqual(['a', 'b', 'c'])
  })

  it('topic grouping renders ungrouped first, then groups by first appearance, stacks contiguous', () => {
    const tasks = [
      makeTask({ id: 'a1', topic: 'A' }),
      makeTask({ id: 'u1' }),
      makeTask({ id: 'b1', topic: 'B' }),
      makeTask({ id: 'a2', topic: 'A' }),
      makeTask({ id: 'u2' }),
    ]
    const { rendered, draggableIds } = getRenderedTaskOrder(tasks, 'topic')
    expect(ids(rendered)).toEqual(['u1', 'u2', 'a1', 'a2', 'b1'])
    // The collapsed stack A is one sortable, by its front task (#150)
    expect(draggableIds).toEqual(['u1', 'u2', 'a1', 'b1'])
  })

  it('a single-card group is draggable', () => {
    const tasks = [makeTask({ id: 'c1', topic: 'C' }), makeTask({ id: 'b1', topic: 'B' })]
    expect(getRenderedTaskOrder(tasks, 'topic').draggableIds).toEqual(['c1', 'b1'])
  })

  it('priority grouping has no ungrouped section', () => {
    const tasks = [
      makeTask({ id: 'p1', priority: 1 }),
      makeTask({ id: 'p2', priority: 2 }),
      makeTask({ id: 'p1b', priority: 1 }),
    ]
    const { rendered, draggableIds } = getRenderedTaskOrder(tasks, 'priority')
    expect(ids(rendered)).toEqual(['p1', 'p1b', 'p2'])
    // The collapsed priority-1 stack counts once, by its front task
    expect(draggableIds).toEqual(['p1', 'p2'])
  })
})

describe('getRenderedTaskOrder with expanded stacks (#147)', () => {
  const tasks = [
    makeTask({ id: 'a1', topic: 'A' }),
    makeTask({ id: 'u1' }),
    makeTask({ id: 'b1', topic: 'B' }),
    makeTask({ id: 'a2', topic: 'A' }),
    makeTask({ id: 'c1', topic: 'C' }),
    makeTask({ id: 'c2', topic: 'C' }),
    makeTask({ id: 'u2' }),
  ]

  it('keeps the rendered order and makes the members of an expanded group draggable, in order', () => {
    const { rendered, draggableIds } = getRenderedTaskOrder(tasks, 'topic', ['A'])
    expect(rendered.map(t => t.id)).toEqual(['u1', 'u2', 'a1', 'a2', 'b1', 'c1', 'c2'])
    // Dense and in render order: ungrouped, the expanded A members, the single B card; C stays a collapsed stack (front c1)
    expect(draggableIds).toEqual(['u1', 'u2', 'a1', 'a2', 'b1', 'c1'])
  })

  it('handles several expanded groups and mixed collapsed ones', () => {
    expect(getRenderedTaskOrder(tasks, 'topic', ['C']).draggableIds).toEqual(['u1', 'u2', 'a1', 'b1', 'c1', 'c2'])
    expect(getRenderedTaskOrder(tasks, 'topic', ['A', 'C']).draggableIds).toEqual(['u1', 'u2', 'a1', 'a2', 'b1', 'c1', 'c2'])
  })

  it('ignores an expanded key whose group has no stack', () => {
    expect(getRenderedTaskOrder(tasks, 'topic', ['B', 'Z']).draggableIds).toEqual(['u1', 'u2', 'a1', 'b1', 'c1'])
  })

  it('expanded keys do not matter without grouping', () => {
    expect(getRenderedTaskOrder(tasks, null, ['A']).draggableIds).toEqual(tasks.map(t => t.id))
  })
})

describe('getStackKeys', () => {
  it('lists the groups of 2+ tasks in render order', () => {
    const tasks = [
      makeTask({ id: 'b1', topic: 'B' }),
      makeTask({ id: 'a1', topic: 'A' }),
      makeTask({ id: 'a2', topic: 'A' }),
      makeTask({ id: 'b2', topic: 'B' }),
      makeTask({ id: 'c1', topic: 'C' }),
      makeTask({ id: 'u1' }),
    ]
    expect(getStackKeys(tasks, 'topic')).toEqual(['B', 'A'])
  })

  it('is empty without grouping', () => {
    expect(getStackKeys([makeTask({ topic: 'A' }), makeTask({ id: 'x', topic: 'A' })], null)).toEqual([])
  })
})

describe('date group keys', () => {
  const dated = (id: string, start: string) =>
    makeTask({ id, custom: { due: { key: 'due', name: 'Due', propType: 'date', value: { type: 'date', value: { start } } } } })

  it('keys one instant written with two offsets once, as its ISO string', () => {
    const a = dated('a', '2026-10-23T09:00:00Z')
    const b = dated('b', '2026-10-23T11:00:00+02:00')
    expect(deriveGroupKeyForTask(a, 'custom:due')).toBe('2026-10-23T09:00:00.000Z')
    expect(deriveGroupKeyForTask(b, 'custom:due')).toBe('2026-10-23T09:00:00.000Z')
    const groups = groupTasksByKey([a, b], 'custom:due')
    expect([...groups.keys()]).toEqual(['2026-10-23T09:00:00.000Z'])
    expect(getStackKeys([a, b], 'custom:due')).toEqual(['2026-10-23T09:00:00.000Z'])
  })

  it('keeps a date-only value and an unparseable value as written', () => {
    expect(deriveGroupKeyForTask(dated('a', '2026-10-23'), 'custom:due')).toBe('2026-10-23')
    expect(deriveGroupKeyForTask(dated('a', 'soon'), 'custom:due')).toBe('soon')
  })

  it('canonicalizes a ±hhmm offset without colon', () => {
    expect(deriveGroupKeyForTask(dated('a', '2026-10-23T11:00:00+0200'), 'custom:due')).toBe('2026-10-23T09:00:00.000Z')
  })

  it('keeps junk, offset-less datetimes and invalid instants as written', () => {
    for (const value of ['12', '2026-10-23T09:00', '2026-13-45T00:00:00Z']) {
      expect(deriveGroupKeyForTask(dated('a', value), 'custom:due')).toBe(value)
    }
  })

  it('keeps two different instants apart', () => {
    const groups = groupTasksByKey([dated('a', '2026-10-23T09:00:00Z'), dated('b', '2026-10-23T09:00:01Z')], 'custom:due')
    expect(groups.size).toBe(2)
  })
})

describe('getGroupLabel', () => {
  const withCustom = (name: string, value: TaskCustomValue) =>
    makeTask({ custom: { prop: { key: 'prop', name, propType: value.type, value } } })

  it('uses the value of a topic group', () => {
    expect(getGroupLabel('Design', 'topic')).toBe('Design')
  })

  it('names priority groups with the priority label; there is no "none" priority (#653)', () => {
    expect(getGroupLabel('3', 'priority')).toBe('Hoch')
    expect(getGroupLabel('0', 'priority')).toBe('Normal')
    // The former 4th level (urgent) is named High (#617)
    expect(getGroupLabel('4', 'priority')).toBe('Hoch')
  })

  it('formats a date-only group as a localized date, not the ISO key', () => {
    const task = withCustom('Fällig', { type: 'date', value: { start: '2026-10-23' } })
    const key = deriveGroupKeyForTask(task, 'custom:prop')
    expect(getGroupLabel(key, 'custom:prop', task)).toBe('23. Oktober 2026')
    setTestLocale('en')
    expect(getGroupLabel(key, 'custom:prop', task)).toBe('October 23, 2026')
  })

  it('formats a date with a time without the raw ISO string', () => {
    const task = withCustom('Fällig', { type: 'date', value: { start: '2026-10-23T09:00:00.000Z' } })
    const key = deriveGroupKeyForTask(task, 'custom:prop')
    const label = getGroupLabel(key, 'custom:prop', task)
    expect(label).toContain('2026')
    expect(label).not.toContain('T09:00')
    expect(label).not.toContain('Z')
  })

  it('never answers "Invalid Date": a malformed value is its own label', () => {
    for (const start of ['not a date', '2026-13-45', '2026-10-23Tgarbage']) {
      const task = withCustom('Fällig', { type: 'date', value: { start } })
      const key = deriveGroupKeyForTask(task, 'custom:prop')
      expect(key).toBe(start)
      expect(getGroupLabel(key, 'custom:prop', task)).toBe(start)
    }
  })

  it('falls back to the end of a range that has no start', () => {
    const task = withCustom('Fällig', { type: 'date', value: { end: '2026-10-24' } as { start: string; end?: string } })
    expect(getGroupLabel('2026-10-24', 'custom:prop', task)).toBe('24. Oktober 2026')
  })

  it('names a checkbox group "<Property>: Ja/Nein" and "Yes/No" in English', () => {
    const checked = withCustom('Erledigt?', { type: 'checkbox', value: true })
    const unchecked = withCustom('Erledigt?', { type: 'checkbox', value: false })
    expect(getGroupLabel('true', 'custom:prop', checked)).toBe('Erledigt?: Ja')
    expect(getGroupLabel('false', 'custom:prop', unchecked)).toBe('Erledigt?: Nein')
    setTestLocale('en')
    expect(getGroupLabel('true', 'custom:prop', checked)).toBe('Erledigt?: Yes')
    expect(getGroupLabel('false', 'custom:prop', unchecked)).toBe('Erledigt?: No')
  })

  it('leaves text, number and select values unchanged, a text "true" included', () => {
    const text = withCustom('Notiz', { type: 'text', value: 'true' })
    expect(getGroupLabel('true', 'custom:prop', text)).toBe('true')
    const number = withCustom('Menge', { type: 'number', value: 42 })
    expect(getGroupLabel('42', 'custom:prop', number)).toBe('42')
    const select = withCustom('Status', { type: 'select', value: { name: 'Review' } })
    expect(getGroupLabel('Review', 'custom:prop', select)).toBe('Review')
  })

  it('names the empty group "none" and returns the key when the task is not at hand', () => {
    expect(getGroupLabel(EMPTY_GROUP_KEY, 'custom:prop')).toBe('Keine')
    expect(getGroupLabel('true', 'custom:prop')).toBe('true')
  })
})

describe('grouping across sources (#323)', () => {
  it('stacks same-named topics of a Local and a Notion task into one group, case-sensitive', () => {
    const local = makeTask({ id: 'l1', source: 'local', externalId: null, topic: 'Backend' })
    const notion = makeTask({ id: 'n1', source: 'notion', externalId: 'n1', topic: ' Backend ' })
    const other = makeTask({ id: 'n2', source: 'notion', externalId: 'n2', topic: 'backend' })

    const groups = groupTasksByKey([local, notion, other], 'topic')

    expect(groups.get('Backend')?.map((t) => t.id)).toEqual(['l1', 'n1'])
    expect(groups.get('backend')?.map((t) => t.id)).toEqual(['n2'])
  })

  it('groups by priority regardless of the source', () => {
    const a = makeTask({ id: 'a', source: 'local', externalId: null, priority: 3 })
    const b = makeTask({ id: 'b', source: 'todoist', externalId: 'b', priority: 3 })
    expect(groupTasksByKey([a, b], 'priority').get('3')?.map((t) => t.id)).toEqual(['a', 'b'])
  })
})
