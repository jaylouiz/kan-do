import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTopicColor } from '~/composables/useTopicColor'
import { useTasksStore } from '~/store/tasks'
import { useTopicStylesStore } from '~/store/topicStyles'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

const task = (id: string, source: Task['source'], topic: string | null, color: string | null = null): Task => ({
  id, source, externalId: source === 'local' ? null : id, title: id, status: TaskStatus.Open, activity: null,
  topic, topicColorCode: color, priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null,
})

describe('useTopicColor.markOf (#431)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('shows no mark without an own choice or a source colour', () => {
    useTasksStore().setTasks([task('l', 'local', 'Garten')])
    expect(useTopicColor().markOf('Garten')).toEqual({ hue: null, symbol: null, inherited: false })
    expect(useTopicColor().markOf(null)).toEqual({ hue: null, symbol: null, inherited: false })
    expect(useTopicColor().markOf('  ')).toEqual({ hue: null, symbol: null, inherited: false })
  })

  it('takes the Notion colour (inherited) when the user chose none, and the user choice wins otherwise', () => {
    useTasksStore().setTasks([task('n', 'notion', 'Büro', 'blue'), task('l', 'local', 'Büro')])
    const { markOf } = useTopicColor()
    expect(markOf('Büro')).toEqual({ hue: 'blue', symbol: null, inherited: true })
    expect(markOf('Büro', useTasksStore().task('l'))).toEqual({ hue: 'blue', symbol: null, inherited: true })

    useTopicStylesStore().setStyle('Büro', { hue: 'red' })
    expect(markOf('Büro')).toEqual({ hue: 'red', symbol: null, inherited: false })

    // "keine" returns to the source colour, a symbol alone keeps the inherited hue
    useTopicStylesStore().setStyle('Büro', { hue: null, symbol: 'flag' })
    expect(markOf('Büro')).toEqual({ hue: 'blue', symbol: 'flag', inherited: true })
  })

  it('a Todoist task never borrows a Notion colour, but its own style applies', () => {
    useTasksStore().setTasks([task('n', 'notion', 'Büro', 'blue'), task('t', 'todoist', 'Büro')])
    const { markOf } = useTopicColor()
    expect(markOf('Büro', useTasksStore().task('t')).hue).toBeNull()
    useTopicStylesStore().setStyle('Büro', { hue: 'pink' })
    expect(markOf('Büro', useTasksStore().task('t')).hue).toBe('pink')
  })

  it('a symbol key that no longer exists reads as no symbol', () => {
    useTopicStylesStore().styles = { Büro: { hue: 'green', symbol: 'unicorn' } }
    expect(useTopicColor().markOf('Büro')).toEqual({ hue: 'green', symbol: null, inherited: false })
  })

  it('a Notion disconnect drops the source colour, the style stays', () => {
    const tasks = useTasksStore()
    tasks.setTasks([task('n', 'notion', 'Büro', 'blue')])
    useTopicStylesStore().setStyle('Büro', { symbol: 'code' })
    expect(useTopicColor().markOf('Büro').hue).toBe('blue')
    tasks.setTasks([])
    expect(useTopicColor().markOf('Büro')).toEqual({ hue: null, symbol: 'code', inherited: false })
  })
})
