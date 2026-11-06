import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useTopicManagement } from '~/composables/useTopicManagement'
import { useTasksStore } from '~/store/tasks'
import { useTrashStore } from '~/store/trash'
import { useTaskStatisticsStore } from '~/store/taskStatistics'
import { usePropertyOptionsStore } from '~/store/propertyOptions'
import { useTopicStylesStore } from '~/store/topicStyles'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

const task = (id: string, topic: string | null, over: Partial<Task> = {}): Task => ({
  id, source: 'local', externalId: null, title: id, status: TaskStatus.Open, activity: null, topic, topicColorCode: null,
  priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, ...over,
})

describe('useTopicManagement (#430)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('lists options plus names only tasks, the trash or the statistics carry, and counts tasks of every status', () => {
    const tasks = useTasksStore()
    const options = usePropertyOptionsStore()
    options.addTopicOption('Unused')
    tasks.setTasks([task('a', 'Work'), task('b', ' Work ', { status: TaskStatus.Done, completedAt: new Date() }), task('c', 'Home', { status: TaskStatus.Waiting })])
    useTrashStore().add({ taskId: 't', task: task('t', 'Trashed'), deletedAt: Date.now(), fromStatus: TaskStatus.Open, carryOver: null })
    useTaskStatisticsStore().recordTaskCompletion(task('s', 'Stats', { status: TaskStatus.Done, completedAt: new Date() }))

    const { topics, countOf } = useTopicManagement()
    expect(topics.value).toEqual(['Home', 'Stats', 'Trashed', 'Unused', 'Work'])
    expect(countOf('topic', 'Work')).toBe(2)
    expect(countOf('topic', 'Unused')).toBe(0)
    expect(countOf('topic', 'Trashed')).toBe(0)
  })

  it('gates a name from the schema list and from a Notion or Todoist task, not a purely local one', () => {
    const tasks = useTasksStore()
    const options = usePropertyOptionsStore()
    options.initializeFromSchema(
      { Topic: { id: 't', name: 'Topic', type: 'select', select: { options: [{ id: '1', name: 'Schema', color: 'blue' }] } } } as never,
      { title: 'Name', status: 'Status', topic: 'Topic' } as never,
    )
    tasks.setTasks([task('n', 'FromNotion', { source: 'notion', externalId: 'n' }), task('t', 'FromTodoist', { source: 'todoist', externalId: 't' }), task('l', 'Local')])
    const { isSourceOwned, rename } = useTopicManagement()
    expect(isSourceOwned('topic', 'Schema')).toBe(true)
    expect(isSourceOwned('topic', 'FromNotion')).toBe(true)
    expect(isSourceOwned('topic', 'FromTodoist')).toBe(true)
    expect(isSourceOwned('topic', 'Local')).toBe(false)
    expect(rename('topic', 'FromNotion', 'X')).toEqual({ ok: false, reason: 'owned' })
    expect(tasks.task('n')?.topic).toBe('FromNotion')
  })

  it('after a Notion disconnect (no schema, no Notion task) the same name is renamable', () => {
    const tasks = useTasksStore()
    tasks.setTasks([task('l', 'Büro')])
    expect(useTopicManagement().rename('topic', 'Büro', 'Office').ok).toBe(true)
  })

  it('refuses an empty and an unchanged (trimmed) name', () => {
    useTasksStore().setTasks([task('l', 'Work')])
    const { rename } = useTopicManagement()
    expect(rename('topic', 'Work', '   ')).toEqual({ ok: false, reason: 'empty' })
    expect(rename('topic', 'Work', ' Work ')).toEqual({ ok: false, reason: 'unchanged' })
  })

  it('renames everywhere in one pass, moves the style, makes no upstream mark and survives A -> B -> A', () => {
    const tasks = useTasksStore()
    const options = usePropertyOptionsStore()
    const styles = useTopicStylesStore()
    options.addTopicOption('Wrk')
    styles.setStyle('Wrk', { hue: 'red', symbol: 'flag' })
    tasks.setTasks([task('a', 'Wrk'), task('d', 'Wrk', { status: TaskStatus.Done, completedAt: new Date() })])
    tasks.addPendingDelete({ taskId: 'p', task: task('p', 'Wrk'), carryOver: null, state: 'waiting', requestedAt: 1 })
    useTrashStore().add({ taskId: 't', task: task('t', 'Wrk'), deletedAt: Date.now(), fromStatus: TaskStatus.Open, carryOver: null })
    useTaskStatisticsStore().recordTaskCompletion(task('d', 'Wrk', { status: TaskStatus.Done, completedAt: new Date() }))

    const { rename, topics } = useTopicManagement()
    expect(rename('topic', 'Wrk', ' Work ')).toEqual({ ok: true, name: 'Work', merged: false })
    expect(tasks.tasks.map(t => t.topic)).toEqual(['Work', 'Work'])
    expect(tasks.pendingDeletes.p?.task.topic).toBe('Work')
    expect(useTrashStore().entry('t')?.task.topic).toBe('Work')
    expect(useTaskStatisticsStore().completionRecords[0]?.topic).toBe('Work')
    expect(topics.value).toEqual(['Work'])
    expect(styles.styles).toEqual({ Work: { hue: 'red', symbol: 'flag' } })
    expect(tasks.tasks.some(t => t.pendingSync)).toBe(false)

    expect(rename('topic', 'Work', 'Wrk').ok).toBe(true)
    expect(tasks.tasks.map(t => t.topic)).toEqual(['Wrk', 'Wrk'])
    expect(styles.styles).toEqual({ Wrk: { hue: 'red', symbol: 'flag' } })
  })

  it('a rename onto an existing name merges, keeps the target style and leaves one list entry', () => {
    const tasks = useTasksStore()
    const styles = useTopicStylesStore()
    tasks.setTasks([task('a', 'A'), task('b', 'B')])
    usePropertyOptionsStore().extractOptionsFromTasks(tasks.tasks)
    styles.setStyle('A', { hue: 'red' })
    styles.setStyle('B', { hue: 'blue' })
    const { rename, mergeTarget, topics } = useTopicManagement()
    expect(mergeTarget('topic', 'A', 'B')).toBe('B')
    expect(mergeTarget('topic', 'A', 'C')).toBeNull()
    expect(rename('topic', 'A', 'B')).toEqual({ ok: true, name: 'B', merged: true })
    expect(tasks.tasks.map(t => t.topic)).toEqual(['B', 'B'])
    expect(topics.value).toEqual(['B'])
    expect(styles.styles).toEqual({ B: { hue: 'blue', symbol: null } })
  })

  it('a merge onto a target without a style, and onto a Notion-coloured target, does not copy the source style', () => {
    const tasks = useTasksStore()
    const styles = useTopicStylesStore()
    tasks.setTasks([
      task('a', 'A'), task('b', 'B'), task('c', 'C'),
      task('n', 'Notion', { source: 'notion', externalId: 'n', topicColorCode: 'blue' }),
    ])
    usePropertyOptionsStore().extractOptionsFromTasks(tasks.tasks)
    styles.setStyle('A', { hue: 'red', symbol: 'rocket' })
    styles.setStyle('C', { hue: 'green', symbol: 'flag' })
    const { rename } = useTopicManagement()
    expect(rename('topic', 'A', 'B')).toEqual({ ok: true, name: 'B', merged: true })
    expect(styles.styleOf('B')).toEqual({ hue: null, symbol: null })
    expect(rename('topic', 'C', 'Notion')).toEqual({ ok: true, name: 'Notion', merged: true })
    expect(styles.styleOf('Notion')).toEqual({ hue: null, symbol: null })
    expect(styles.styles).toEqual({})
  })

  it('a non-merge rename onto a name with a stale style entry moves the renamed topic style', () => {
    const tasks = useTasksStore()
    const styles = useTopicStylesStore()
    tasks.setTasks([task('w', 'Work')])
    usePropertyOptionsStore().extractOptionsFromTasks(tasks.tasks)
    styles.setStyle('Work', { hue: 'red', symbol: 'briefcase' })
    styles.setStyle('Home', { hue: 'green', symbol: 'house' })
    expect(useTopicManagement().rename('topic', 'Work', 'Home')).toEqual({ ok: true, name: 'Home', merged: false })
    expect(styles.styles).toEqual({ Home: { hue: 'red', symbol: 'briefcase' } })
  })

  it('renames to and from names like constructor and __proto__ without touching the prototype', () => {
    const tasks = useTasksStore()
    const styles = useTopicStylesStore()
    tasks.setTasks([task('w', 'Work')])
    usePropertyOptionsStore().extractOptionsFromTasks(tasks.tasks)
    styles.setStyle('Work', { hue: 'red' })
    const { rename } = useTopicManagement()
    expect(rename('topic', 'Work', '__proto__').ok).toBe(true)
    expect(styles.styleOf('__proto__')).toEqual({ hue: 'red', symbol: null })
    expect(rename('topic', '__proto__', 'constructor').ok).toBe(true)
    expect(styles.styleOf('constructor')).toEqual({ hue: 'red', symbol: null })
    expect(Object.keys(styles.styles)).toEqual(['constructor'])
    expect(tasks.task('w')?.topic).toBe('constructor')
  })

  it('a Local topic may be merged INTO an owned name', () => {
    const tasks = useTasksStore()
    tasks.setTasks([task('n', 'Owned', { source: 'notion', externalId: 'n' }), task('l', 'Mine')])
    usePropertyOptionsStore().extractOptionsFromTasks(tasks.tasks)
    expect(useTopicManagement().rename('topic', 'Mine', 'Owned')).toEqual({ ok: true, name: 'Owned', merged: true })
    expect(tasks.task('l')?.topic).toBe('Owned')
  })

  it('renames an activity without touching styles', () => {
    const tasks = useTasksStore()
    tasks.setTasks([task('a', 'T', { activity: 'Plan' })])
    usePropertyOptionsStore().extractOptionsFromTasks(tasks.tasks)
    useTopicStylesStore().setStyle('Plan', { hue: 'red' })
    expect(useTopicManagement().rename('activity', 'Plan', 'Planen').ok).toBe(true)
    expect(tasks.task('a')?.activity).toBe('Planen')
    expect(useTopicStylesStore().styles).toEqual({ Plan: { hue: 'red', symbol: null } })
  })
})
