/**
 * Rename actions of #430: one name rewritten on every store that holds it, with no upstream side effects.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useTasksStore } from '~/store/tasks'
import { useTrashStore } from '~/store/trash'
import { useTaskStatisticsStore } from '~/store/taskStatistics'
import { usePropertyOptionsStore } from '~/store/propertyOptions'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import type { TrashEntry } from '~/types/trash'

const make = (id: string, status: TaskStatus, topic: string | null, activity: string | null = null): Task => ({
  id, source: 'local', externalId: null, title: id, status, activity, topic, topicColorCode: null, priority: 1, notes: null,
  timeBoxSeconds: 600, timeSpentSeconds: 60, timerId: null, completedAt: status === TaskStatus.Done ? new Date() : null,
  updatedAt: new Date('2026-01-01T00:00:00Z'),
})

describe('renameValue (#430)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  describe('tasks store', () => {
    it('renames a topic on tasks of every status and the undo-window snapshot, without pendingSync', () => {
      const tasks = useTasksStore()
      tasks.setTasks([
        make('open', TaskStatus.Open, 'Wrk'),
        make('now', TaskStatus.Progress, ' Wrk '),
        make('wait', TaskStatus.Waiting, 'Wrk'),
        make('done', TaskStatus.Done, 'Wrk'),
        make('other', TaskStatus.Open, 'Home'),
        make('none', TaskStatus.Open, null),
      ])
      tasks.addPendingDelete({ taskId: 'gone', task: make('gone', TaskStatus.Open, 'Wrk'), carryOver: null, state: 'waiting', requestedAt: 1 })

      const changed = tasks.renameValue('topic', 'Wrk', 'Work')

      expect(changed).toBe(5)
      expect(tasks.tasks.map(t => t.topic)).toEqual(['Work', 'Work', 'Work', 'Work', 'Home', null])
      expect(tasks.pendingDeletes.gone?.task.topic).toBe('Work')
      expect(tasks.tasks.some(t => t.pendingSync)).toBe(false)
      expect(tasks.tasks[0]?.updatedAt).toEqual(new Date('2026-01-01T00:00:00Z'))
    })

    it('renames an activity only in the activity field', () => {
      const tasks = useTasksStore()
      tasks.setTasks([make('a', TaskStatus.Open, 'Wrk', 'Wrk'), make('b', TaskStatus.Done, null, 'Wrk')])
      expect(tasks.renameValue('activity', 'Wrk', 'Work')).toBe(2)
      expect(tasks.tasks.map(t => [t.topic, t.activity])).toEqual([['Wrk', 'Work'], [null, 'Work']])
    })

    it('is a no-op (and returns 0) when nothing matches', () => {
      const tasks = useTasksStore()
      tasks.setTasks([make('a', TaskStatus.Open, 'Home')])
      const before = tasks.tasks[0]
      expect(tasks.renameValue('topic', 'Wrk', 'Work')).toBe(0)
      expect(tasks.tasks[0]).toBe(before)
    })

    it('rename A -> B -> A leaves the original names', () => {
      const tasks = useTasksStore()
      tasks.setTasks([make('a', TaskStatus.Open, 'A'), make('b', TaskStatus.Done, 'A')])
      tasks.renameValue('topic', 'A', 'B')
      tasks.renameValue('topic', 'B', 'A')
      expect(tasks.tasks.map(t => t.topic)).toEqual(['A', 'A'])
    })
  })

  describe('trash store', () => {
    it('renames the snapshot so a restore carries the new name', () => {
      const trash = useTrashStore()
      const entry = (id: string, topic: string): TrashEntry => ({ taskId: id, task: make(id, TaskStatus.Open, topic), deletedAt: Date.now(), fromStatus: TaskStatus.Open, carryOver: null })
      trash.add(entry('a', 'Wrk'))
      trash.add(entry('b', 'Home'))
      expect(trash.renameValue('topic', 'Wrk', 'Work')).toBe(1)
      expect(trash.entry('a')?.task.topic).toBe('Work')
      expect(trash.entry('b')?.task.topic).toBe('Home')
      expect(trash.renameValue('topic', 'Wrk', 'Work')).toBe(0)
    })
  })

  describe('statistics store', () => {
    it('renames completion records of topic and activity', () => {
      const stats = useTaskStatisticsStore()
      stats.recordTaskCompletion(make('a', TaskStatus.Done, 'Wrk', 'Plan'))
      stats.recordTaskCompletion(make('b', TaskStatus.Done, 'Home', 'Wrk'))
      expect(stats.renameValue('topic', 'Wrk', 'Work')).toBe(1)
      expect(stats.renameValue('activity', 'Wrk', 'Work')).toBe(1)
      expect(stats.completionRecords.map(r => [r.topic, r.activity])).toEqual([['Work', 'Plan'], ['Home', 'Work']])
    })
  })

  describe('propertyOptions store', () => {
    it('renames in the runtime list, merges into an existing name and is not resurrected by extractOptionsFromTasks', () => {
      const options = usePropertyOptionsStore()
      options.addTopicOption('Wrk')
      options.addTopicOption('Home')
      options.renameOption('topic', 'Wrk', 'Work')
      expect(options.getTopicOptions).toEqual(['Home', 'Work'])

      options.renameOption('topic', 'Home', 'Work')
      expect(options.getTopicOptions).toEqual(['Work'])

      // After a rename every task carries the new name, so re-extracting the tasks cannot bring the old one back
      options.extractOptionsFromTasks([{ topic: 'Work' }])
      expect(options.getTopicOptions).toEqual(['Work'])
    })

    it('renames the schema list too and mergeWithExternalOptions only re-adds what the source sends', () => {
      const options = usePropertyOptionsStore()
      options.initializeFromSchema(
        { Activity: { id: 'a', name: 'Activity', type: 'select', select: { options: [{ id: '1', name: 'Wrk', color: 'blue' }] } } } as never,
        { title: 'Name', status: 'Status', activity: 'Activity' } as never,
      )
      options.renameOption('activity', 'Wrk', 'Work')
      expect(options.getActivityOptions).toEqual(['Work'])
      options.mergeWithExternalOptions({ activities: ['Work'] })
      expect(options.getActivityOptions).toEqual(['Work'])
    })
  })
})
