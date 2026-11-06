import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTopicColor } from '~/composables/useTopicColor'
import { useTasksStore } from '~/store/tasks'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

function task(id: string, source: Task['source'], topic: string | null, color: string | null = null): Task {
  return {
    id, source, externalId: source === 'local' ? null : id, title: id, status: TaskStatus.Open, activity: null,
    topic, topicColorCode: color, priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null,
  }
}

describe('useTopicColor (#321)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('a Notion task keeps its own colour', () => {
    useTasksStore().setTasks([task('n1', 'notion', 'Büro', 'blue'), task('n2', 'notion', 'Büro', 'red')])
    expect(useTopicColor().topicColorOf(useTasksStore().task('n2'))).toBe('red')
  })

  it('a Local topic takes the colour of a same-named Notion topic (exact, trimmed), else none', () => {
    useTasksStore().setTasks([
      task('n1', 'notion', 'Büro', 'blue'),
      task('l1', 'local', 'Büro'),
      task('l2', 'local', ' Büro '),
      task('l3', 'local', 'büro'),
      task('l4', 'local', 'Garten'),
      task('l5', 'local', null),
    ])
    const { topicColorOf } = useTopicColor()
    const get = (id: string) => topicColorOf(useTasksStore().task(id))
    expect(get('l1')).toBe('blue')
    expect(get('l2')).toBe('blue')
    expect(get('l3')).toBeNull()
    expect(get('l4')).toBeNull()
    expect(get('l5')).toBeNull()
  })

  it('is derived when read: it follows a Notion recolour and a later connection, and nothing is stored on the Local task', () => {
    const tasks = useTasksStore()
    tasks.setTasks([task('l1', 'local', 'Büro')])
    const { topicColorOf } = useTopicColor()
    expect(topicColorOf(tasks.task('l1'))).toBeNull()

    tasks.addTask(task('n1', 'notion', 'Büro', 'blue'))
    expect(topicColorOf(tasks.task('l1'))).toBe('blue')
    tasks.updateTask('n1', { topicColorCode: 'green' })
    expect(topicColorOf(tasks.task('l1'))).toBe('green')
    expect(tasks.task('l1')?.topicColorCode).toBeNull()
  })

  it('colorCodeFor: a new task takes the colour its siblings with the topic show (#672)', () => {
    useTasksStore().setTasks([
      task('l1', 'local', 'Design', '#6366f1'),
      task('n1', 'notion', 'Büro', 'blue'),
      task('l2', 'local', 'Büro', 'red'),
      task('l3', 'local', 'Garten'),
    ])
    const { colorCodeFor } = useTopicColor()
    expect(colorCodeFor('Design', 'local')).toBe('#6366f1')
    expect(colorCodeFor(' Design ', 'local')).toBe('#6366f1')
    // a name Notion colours is derived for a Local task (it follows a recolour), never stored; a Notion task takes Notion's
    expect(colorCodeFor('Büro', 'local')).toBeNull()
    expect(useTopicColor().topicColorOf({ source: 'local', topic: 'Büro', topicColorCode: null })).toBe('blue')
    expect(colorCodeFor('Büro', 'notion')).toBe('blue')
    expect(colorCodeFor('Design', 'notion')).toBeNull()
    // no colour, no topic, a Todoist task (project colour is the project's)
    expect(colorCodeFor('Garten', 'local')).toBeNull()
    expect(colorCodeFor('Neu', 'local')).toBeNull()
    expect(colorCodeFor(null, 'local')).toBeNull()
    expect(colorCodeFor('Design', 'todoist')).toBeNull()
  })

  it('works for a draft that is not in the store, and for no task', () => {
    useTasksStore().setTasks([task('n1', 'notion', 'Büro', 'blue')])
    const { topicColorOf } = useTopicColor()
    expect(topicColorOf({ source: 'local', topic: 'Büro', topicColorCode: null })).toBe('blue')
    expect(topicColorOf(null)).toBeNull()
  })

  it('a Todoist task never borrows a Notion colour', () => {
    useTasksStore().setTasks([task('n1', 'notion', 'Büro', 'blue'), task('t1', 'todoist', 'Büro')])
    expect(useTopicColor().topicColorOf(useTasksStore().task('t1'))).toBeNull()
  })
})
