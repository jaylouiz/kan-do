import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { onMounted } from 'vue'
import TaskCard from '~/components/task/TaskCard.vue'
import TaskSourceIcon from '~/components/task/TaskSourceIcon.vue'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import { useTasksStore } from '~/store/tasks'
import { useIntegrationHealthStore } from '~/store/integrationHealth'

vi.mock('~/composables/useStackExpansion', () => ({ useStackExpansion: () => ({ shouldBlockModal: () => false }) }))
vi.mock('~/composables/useSheetSpotlight', () => ({ useSheetSpotlight: () => ({ spotlightTaskId: { value: null } }) }))
vi.mock('~/composables/useCarryOver', () => ({ useTaskCarryOver: () => ({ displayDay: { value: 0 } }) }))
vi.stubGlobal('onMounted', onMounted)
window.matchMedia = ((q: string) => ({ matches: false, media: q })) as unknown as typeof window.matchMedia

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1', source: 'notion', externalId: 'page-1', title: 'Review schreiben', status: TaskStatus.Open, priority: 1,
    activity: null, topic: null, topicColorCode: null, notes: null, timeBoxSeconds: 0, timeSpentSeconds: 0, timerId: null,
    ...overrides,
  }
}

const render = (current: Task, draft = false) =>
  mount(TaskCard, {
    props: { task: current, draft },
    global: { stubs: { UCard: { template: '<div><slot /><slot name="footer" /></div>' }, UIcon: { template: '<i v-bind="$attrs" />' }, UBadge: true, TaskProgressChip: true, 'task-priority-badge': true, TaskCarryOverDots: true } },
  })

const icon = (w: ReturnType<typeof render>) => w.findComponent(TaskSourceIcon)

describe('TaskCard source icon (#323)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('shows none while the board holds one source, and names the source once two are present (a sequence)', async () => {
    const tasks = useTasksStore()
    tasks.addTask(task())
    const w = render(tasks.task('t1')!)
    expect(icon(w).exists()).toBe(false)

    tasks.addTask(task({ id: 't2', source: 'local', externalId: null }))
    await w.vm.$nextTick()
    expect(icon(w).exists()).toBe(true)
    expect(icon(w).attributes('aria-label')).toBe('Notion')
    expect(icon(render(tasks.task('t2')!)).attributes('aria-label')).toBe('Lokal')

    tasks.removeTask('t2')
    await w.vm.$nextTick()
    expect(icon(w).exists()).toBe(false)
  })

  it('shows on a Done card too', () => {
    const tasks = useTasksStore()
    tasks.addTask(task({ status: TaskStatus.Done }))
    tasks.addTask(task({ id: 't2', source: 'local', externalId: null }))
    expect(icon(render(tasks.task('t1')!)).exists()).toBe(true)
  })

  it('never shows on the add sheet draft, even on a mixed board', () => {
    const tasks = useTasksStore()
    tasks.addTask(task())
    tasks.addTask(task({ id: 't2', source: 'local', externalId: null }))
    expect(icon(render(task({ id: 'draft', source: 'local', externalId: null }), true)).exists()).toBe(false)
  })

  it('puts the icon before the cloud, in one group', () => {
    const tasks = useTasksStore()
    tasks.addTask(task())
    tasks.addTask(task({ id: 't2', source: 'local', externalId: null }))
    tasks.markPendingSync('t1')
    useIntegrationHealthStore().markOffline('notion', 'Network error')

    const w = render(tasks.task('t1')!)
    const group = w.find('.gap-1')
    const children = Array.from(group.element.children)
    expect(children.map((el) => el.getAttribute('data-testid'))).toEqual(['task-source-icon', 'task-save-pending'])
  })

  it('keeps the cloud alone (no group change in content) on a one-source board', () => {
    const tasks = useTasksStore()
    tasks.addTask(task())
    tasks.markPendingSync('t1')
    useIntegrationHealthStore().markOffline('notion', 'Network error')
    const w = render(tasks.task('t1')!)
    expect(icon(w).exists()).toBe(false)
    expect(w.find('[data-testid="task-save-pending"]').exists()).toBe(true)
  })

  it('renders the card of a task without source next to a Local task, no error (#360)', () => {
    const tasks = useTasksStore()
    tasks.addTask(task({ id: 't1', source: 'local', externalId: null }))
    tasks.addTask({ ...task({ id: 't2' }), source: undefined } as unknown as Task)
    expect(tasks.hasMultipleSources).toBe(false)
    const w = render(tasks.task('t2')!)
    expect(w.text()).toContain('Review schreiben')
    expect(icon(w).exists()).toBe(false)
    tasks.addTask(task({ id: 't3' }))
    const w2 = render(tasks.task('t2')!)
    expect(w2.text()).toContain('Review schreiben')
    expect(icon(w2).attributes('aria-label')).toBe('Lokal')
  })
})
