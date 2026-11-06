import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTasksStore } from '~/store/tasks'
import type { Task } from '~/types/task'
import { TaskStatus } from '~/types/taskStatus'
import { mapHelpers } from '~/utils/mapHelpers'
import { usePropertyOptionsStore } from '~/store/propertyOptions'

vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({ syncExistingDoneTasks: vi.fn(), updateTaskRecord: vi.fn() }),
}))

function makeTask(overrides: Partial<Task> & Pick<Task, 'id'>): Task {
  const source = overrides.source ?? 'notion'
  return {
    title: overrides.id,
    notes: null,
    status: TaskStatus.Open,
    priority: 1,
    activity: null,
    timeBoxSeconds: null,
    timeSpentSeconds: 0,
    topic: null,
    topicColorCode: null,
    timerId: null,
    source,
    externalId: source === 'local' ? null : overrides.id,
    ...overrides,
  }
}

describe('tasks store: mergeTasks(source, fetched) (#326)', () => {
  let store: ReturnType<typeof useTasksStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useTasksStore()
  })

  it('replaces only the tasks of that source and leaves the others untouched', () => {
    const local = makeTask({ id: 'local-1', source: 'local', title: 'mine' })
    store.setTasks([local, makeTask({ id: 'n1' }), makeTask({ id: 'n2' })])

    store.mergeTasks('notion', [makeTask({ id: 'n1', title: 'renamed' })])

    expect(store.tasks.map(t => t.id).sort()).toEqual(['local-1', 'n1'])
    expect(store.task('local-1')).toEqual(local)
    expect(store.task('n1')?.title).toBe('renamed')
    expect(store.task('n2')).toBeNull()
  })

  it('replaceOthers drops the other sources, but a Local task whose id is a fetched externalId is that task', () => {
    store.setTasks([
      makeTask({ id: 'page-1', source: 'local', timeSpentSeconds: 600 }), // a Notion task turned Local by a mode switch
      makeTask({ id: 'local_born', source: 'local' }),
    ])

    store.mergeTasks('notion', [makeTask({ id: 'page-1' }), makeTask({ id: 'page-2' })], { replaceOthers: true })

    expect(store.tasks.map(t => [t.id, t.source, t.externalId])).toEqual([
      ['page-1', 'notion', 'page-1'],
      ['page-2', 'notion', 'page-2'],
    ])
    expect(store.task('page-1')?.timeSpentSeconds).toBe(600)
  })

  it('without replaceOthers a Local task with the same id as a fetched externalId is not adopted', () => {
    store.setTasks([makeTask({ id: 'page-1', source: 'local' })])

    store.mergeTasks('notion', [makeTask({ id: 'page-1' })])

    expect(store.tasks).toHaveLength(2)
    expect(store.tasks.filter(t => t.source === 'local').map(t => t.id)).toEqual(['page-1'])
    expect(store.tasks.find(t => t.source === 'notion')?.id).not.toBe('page-1')
  })

  it('does not touch other sources when the fetch comes back empty', () => {
    store.setTasks([makeTask({ id: 'l', source: 'local' }), makeTask({ id: 'n1' })])
    store.mergeTasks('notion', [])
    expect(store.tasks.map(t => t.id)).toEqual(['l'])
  })

  it('matches existing tasks by (source, externalId) and keeps the app-level id', () => {
    store.setTasks([makeTask({ id: 'app-id', externalId: 'page-9', timerId: 7, timeSpentSeconds: 600 })])

    store.mergeTasks('notion', [makeTask({ id: 'page-9', externalId: 'page-9', title: 'from notion', timeSpentSeconds: 100 })])

    expect(store.tasks).toHaveLength(1)
    const merged = store.task('app-id')!
    expect(merged.title).toBe('from notion')
    expect(merged.externalId).toBe('page-9')
    expect(merged.timerId).toBe(7)
    expect(merged.timeSpentSeconds).toBe(600)
  })

  it('does not match a task of another source that has the same externalId', () => {
    store.setTasks([makeTask({ id: 'shared', source: 'todoist', externalId: 'shared', title: 'todoist one' })])

    store.mergeTasks('notion', [makeTask({ id: 'shared', externalId: 'shared', title: 'notion one' })])

    expect(store.tasks).toHaveLength(2)
    expect(store.tasks.find(t => t.source === 'todoist')?.title).toBe('todoist one')
    const notion = store.tasks.find(t => t.source === 'notion')!
    expect(notion.title).toBe('notion one')
    expect(notion.externalId).toBe('shared')
    expect(notion.id).not.toBe('shared') // the id is taken by the Todoist task
  })

  it('gives a new external task id = externalId, or a generated id when that id is taken', () => {
    store.setTasks([makeTask({ id: 'taken', source: 'local' })])

    store.mergeTasks('notion', [
      makeTask({ id: 'fresh', externalId: 'fresh' }),
      makeTask({ id: 'taken', externalId: 'taken' }),
    ])

    const fresh = store.tasks.find(t => t.externalId === 'fresh')!
    const collided = store.tasks.find(t => t.source === 'notion' && t.externalId === 'taken')!
    expect(fresh.id).toBe('fresh')
    expect(collided.id).not.toBe('taken')
    expect(store.tasks.filter(t => t.id === 'taken')).toHaveLength(1)
    expect(new Set(store.tasks.map(t => t.id)).size).toBe(store.tasks.length)
  })

  it('honours deletedTaskIds, also when the fetched task maps to a deleted app id', () => {
    store.setTasks([makeTask({ id: 'app-id', externalId: 'page-1' }), makeTask({ id: 'other' })])
    store.removeTask('app-id')

    store.mergeTasks('notion', [makeTask({ id: 'page-1', externalId: 'page-1' }), makeTask({ id: 'other' })])

    expect(store.task('app-id')).toBeNull()
    expect(store.tasks.map(t => t.id)).toEqual(['other'])
  })

  it('keeps local time tracking as pending when the local value is higher', () => {
    store.setTasks([makeTask({ id: 'n1', timeSpentSeconds: 500 })])
    store.mergeTasks('notion', [makeTask({ id: 'n1', timeSpentSeconds: 300 })])
    expect(store.task('n1')!.timeSpentSeconds).toBe(500)
    expect(mapHelpers.get(store.pendingTimeUpdates, 'n1')?.timeSpentSeconds).toBe(500)
  })

  it('stamps the merge source on fetched tasks that lack an externalId', () => {
    store.mergeTasks('notion', [{ ...makeTask({ id: 'n1' }), externalId: null }])
    expect(store.task('n1')).toMatchObject({ source: 'notion', externalId: 'n1' })
  })
})

describe('one topic vocabulary across sources (#321)', () => {
  it('after a Notion merge the topic suggestions still offer the Local names next to the Notion ones', () => {
    setActivePinia(createPinia())
    const store = useTasksStore()
    store.setTasks([makeTask({ id: 'l1', source: 'local', topic: 'Garten' })])
    store.mergeTasks('notion', [makeTask({ id: 'n1', topic: 'Büro' })])
    expect(usePropertyOptionsStore().getTopicOptions).toEqual(['Büro', 'Garten'])
  })
})

