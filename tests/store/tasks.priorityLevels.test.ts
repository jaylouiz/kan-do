import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

const make = (id: string, priority: number): Task => ({
  id, source: 'local', externalId: null, title: id, notes: null, status: TaskStatus.Open, priority,
  activity: null, timeBoxSeconds: null, timeSpentSeconds: 0, topic: null, topicColorCode: null, timerId: null,
})

describe('sorting by priority with three levels (#617)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('treats a stored 4 and a 3 as equal (stable), High before Regular (a task without a priority is Regular, #653) before Low', () => {
    const tasks = useTasksStore()
    const board = useBoardStore()
    tasks.setTasks([make('low', 1), make('high', 3), make('none', 0), make('urgent', 4), make('regular', 2)])
    board.reconcileColumnsWithTasks(tasks.tasks)
    board.setColumnSorting(TaskStatus.Open, 'priority', 'desc')
    expect(tasks.tasksOpen.map(task => task.id)).toEqual(['high', 'urgent', 'none', 'regular', 'low'])
  })
})
