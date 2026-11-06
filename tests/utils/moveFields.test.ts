import { describe, it, expect } from 'vitest'
import { lostFieldsForMove } from '~/utils/moveFields'
import { SOURCE_IDS, type SourceId } from '~/types/taskSource'
import { TaskStatus } from '~/types/taskStatus'
import type { Task, TaskCustomEntry } from '~/types/task'
import type { NotionPropertyMapping } from '~/types/notion'

const task = (extra: Partial<Task> = {}): Task => ({
  id: 't', source: 'local', externalId: null, title: 'T', status: TaskStatus.Open, activity: null, topic: null,
  topicColorCode: null, priority: 2, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, ...extra,
})

const custom = (key: string, value: TaskCustomEntry['value']): [string, TaskCustomEntry] => [
  key, { key, name: key, propType: value.type, value },
]

const FULL: NotionPropertyMapping = {
  title: 'Name', status: 'Status', priority: 'Prio', timeBox: 'Box', topic: 'Topic', activity: 'Act',
  timeSpent: 'Spent', completedDate: 'Done', unplanned: { mode: 'boolean', propertyName: 'Unplanned' },
  customProperties: [{ name: 'Owner', key: 'owner', type: 'text', enabled: true }],
}
const BARE: NotionPropertyMapping = { title: 'Name', status: 'Status' }

describe('lostFieldsForMove', () => {
  it('a task with nothing to lose counts zero for every source', () => {
    for (const target of SOURCE_IDS) expect(lostFieldsForMove(task(), target as SourceId, BARE)).toBe(0)
  })

  it('Notion -> Local counts each custom value (Local holds all other fields)', () => {
    const rich = task({
      source: 'notion', externalId: 'p', priority: 3, topic: 'x', activity: 'y', timeBoxSeconds: 600, timeSpentSeconds: 60,
      isUnplanned: true, completedAt: new Date(),
      custom: Object.fromEntries([
        custom('owner', { type: 'text', value: 'Ada' }),
        custom('tags', { type: 'multi_select', value: [{ name: 'a' }] }),
        custom('empty', { type: 'text', value: '' }),
        custom('off', { type: 'checkbox', value: false }),
      ]),
    })
    expect(lostFieldsForMove(rich, 'local', FULL)).toBe(2)
  })

  it('Local -> Notion counts the fields the mapping lacks, only when they carry a value', () => {
    const rich = task({ priority: 3, topic: 'x', activity: 'y', timeBoxSeconds: 600, timeSpentSeconds: 60, isUnplanned: true, completedAt: new Date() })
    expect(lostFieldsForMove(rich, 'notion', BARE)).toBe(7)
    expect(lostFieldsForMove(rich, 'notion', FULL)).toBe(0)
    expect(lostFieldsForMove(rich, 'notion', { ...FULL, topic: null, timeSpent: null })).toBe(2)
  })

  it('a default priority (Normal, #653; also a stored 0) and a false unplanned flag are nothing to lose', () => {
    expect(lostFieldsForMove(task({ priority: 2, isUnplanned: false, timeSpentSeconds: 0 }), 'notion', BARE)).toBe(0)
    expect(lostFieldsForMove(task({ priority: 0 }), 'notion', BARE)).toBe(0)
    expect(lostFieldsForMove(task({ priority: 1 }), 'notion', BARE)).toBe(1)
  })

  it('a custom entry the target maps (enabled) is kept, a disabled or unknown one is lost', () => {
    const t = task({ custom: Object.fromEntries([custom('owner', { type: 'text', value: 'Ada' }), custom('other', { type: 'number', value: 3 })]) })
    expect(lostFieldsForMove(t, 'notion', FULL)).toBe(1)
    const disabled: NotionPropertyMapping = { ...FULL, customProperties: [{ name: 'Owner', key: 'owner', type: 'text', enabled: false }] }
    expect(lostFieldsForMove(t, 'notion', disabled)).toBe(2)
  })

  it('Todoist holds priority and topic only', () => {
    const rich = task({ priority: 2, topic: 'x', activity: 'y', timeBoxSeconds: 600, timeSpentSeconds: 60 })
    expect(lostFieldsForMove(rich, 'todoist', null)).toBe(3)
  })
})
