import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import TaskCarryOverTriage from '~/components/task/TaskCarryOverTriage.vue'
import { useTasksStore } from '~/store/tasks'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import { mapHelpers } from '~/utils/mapHelpers'
import { useBoardStore } from '~/store/board'

vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({ syncExistingDoneTasks: vi.fn(), updateTaskRecord: vi.fn() }),
}))

const UButton = { inheritAttrs: false, emits: ['click'], template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>' }

function makeTask(id: string, status: TaskStatus = TaskStatus.Open): Task {
  return {
    id, title: `Task ${id}`, status, activity: null, topic: null, topicColorCode: null,
    priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null,
  }
}

const render = (props: { taskId: string; compact?: boolean }) =>
  mount(TaskCarryOverTriage, { props, global: { stubs: { UButton, UTooltip: true } } })

describe('TaskCarryOverTriage (#99)', () => {
  let store: ReturnType<typeof useTasksStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useTasksStore()
    store.setTasks([makeTask('a'), makeTask('w', TaskStatus.Waiting), makeTask('fresh')])
    for (let day = 1; day <= 6; day++) store.recordCarryOver(`2026-10-0${day}`)
    store.addTask(makeTask('new'))
  })

  it('sheet block: one sentence with the day count and exactly two buttons (#247)', () => {
    const block = render({ taskId: 'a' }).get('[data-testid="carry-over-triage"]')
    expect(block.classes()).toContain('bg-muted/50')
    expect(block.text()).toContain('Die Aufgabe ist seit 6 Tagen zur Erledigung eingeplant. Ist sie wirklich wichtig?')
    expect(block.findAll('button').map(b => b.text())).toEqual(['Ja, behalten', 'Nein, löschen'])
    expect(block.find('[data-testid="carry-over-smaller"]').exists()).toBe(false)
  })

  it('sheet block: Keep turns the box into a status confirmation with the tip and stays (#247)', async () => {
    const wrapper = render({ taskId: 'a' })
    await wrapper.get('[data-testid="carry-over-keep"]').trigger('click')
    expect(wrapper.emitted('kept')).toHaveLength(1)
    expect(mapHelpers.get(store.carryOverByTaskId, 'a')?.keptAtDays).toBe(5)
    const status = wrapper.get('[data-testid="carry-over-kept-status"]')
    expect(status.attributes('role')).toBe('status')
    expect(status.text()).toContain('Die Aufgabe bleibt auf deinem Board')
    expect(status.text()).toContain('Tipp: Plane zunächst den kleinstmöglichen, ersten Schritt.')
    expect(wrapper.findAll('button')).toHaveLength(0)
  })

  it('sheet block: "Nein, löschen" only emits delete (the host confirms)', async () => {
    const wrapper = render({ taskId: 'a' })
    await wrapper.get('[data-testid="carry-over-delete"]').trigger('click')
    expect(wrapper.emitted('delete')).toHaveLength(1)
    expect(mapHelpers.get(store.carryOverByTaskId, 'a')?.keptAtDays ?? null).toBeNull()
  })

  it('compact: no wash, no heading or dots, the group is named by the nudge sentence', () => {
    const block = render({ taskId: 'a', compact: true }).get('[data-testid="carry-over-triage"]')
    expect(block.classes()).not.toContain('bg-muted/50')
    expect(block.find('h3').exists()).toBe(false)
    expect(block.find('[data-testid="carry-over-dots"]').exists()).toBe(false)
    expect(block.attributes('aria-label')).toBe('Immer noch da: Tag 6 auf dem Board.')
    expect(block.findAll('button')).toHaveLength(3)
  })

  it('compact: all three actions are ghost buttons of the default size (#551)', () => {
    const buttons = render({ taskId: 'a', compact: true }).findAll('button')
    expect(buttons.map(b => b.attributes('variant'))).toEqual(['ghost', 'ghost', 'ghost'])
    expect(buttons.map(b => b.attributes('size'))).toEqual([undefined, undefined, undefined])
  })

  it('emits the same actions in compact mode; Keep silences the nudge', async () => {
    const wrapper = render({ taskId: 'a', compact: true })
    await wrapper.get('[data-testid="carry-over-smaller"]').trigger('click')
    await wrapper.get('[data-testid="carry-over-delete"]').trigger('click')
    expect(wrapper.emitted('smaller')).toHaveLength(1)
    expect(wrapper.emitted('delete')).toHaveLength(1)

    await wrapper.get('[data-testid="carry-over-keep"]').trigger('click')
    expect(wrapper.emitted('kept')).toHaveLength(1)
    expect(mapHelpers.get(store.carryOverByTaskId, 'a')?.keptAtDays).toBe(5)
    expect(wrapper.find('[data-testid="carry-over-triage"]').exists()).toBe(false)
  })

  it('renders nothing for Wartet cards or below the threshold', () => {
    expect(render({ taskId: 'w' }).find('[data-testid="carry-over-triage"]').exists()).toBe(false)
    expect(render({ taskId: 'new' }).find('[data-testid="carry-over-triage"]').exists()).toBe(false)
  })

  it('names the upstream consequence by the task\'s own source on a mixed board whose default is Local (#325)', () => {
    useBoardStore().setSources({ connected: ['notion'], default: 'local' })
    store.updateTask('a', { source: 'notion', externalId: 'a' })
    store.updateTask('w', { source: 'local', externalId: null })
    store.updateTask('fresh', { source: 'local', externalId: null })
    // 'a' is the Notion task, the board default is Local: the label must follow the task
    expect(render({ taskId: 'a', compact: true }).get('[data-testid="carry-over-delete"]').text()).toBe('Löschen, auch in Notion')

    store.updateTask('a', { source: 'local', externalId: null })
    expect(render({ taskId: 'a', compact: true }).get('[data-testid="carry-over-delete"]').text()).toBe('Löschen')

    // And the other way round: a Notion task on a board that defaults to Notion keeps its label, a Local one has none
    useBoardStore().setSources({ connected: ['notion'], default: 'notion' })
    expect(render({ taskId: 'a', compact: true }).get('[data-testid="carry-over-delete"]').text()).toBe('Löschen')
    store.updateTask('a', { source: 'notion', externalId: 'a' })
    expect(render({ taskId: 'a', compact: true }).get('[data-testid="carry-over-delete"]').text()).toBe('Löschen, auch in Notion')
  })
})
