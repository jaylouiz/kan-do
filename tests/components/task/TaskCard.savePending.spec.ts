import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { onMounted } from 'vue'
import TaskCard from '~/components/task/TaskCard.vue'
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

const render = (current: Task) =>
  mount(TaskCard, {
    props: { task: current },
    global: { stubs: { UCard: { template: '<div><slot /><slot name="footer" /></div>' }, UIcon: { template: '<i v-bind="$attrs" />' }, UBadge: true, TaskProgressChip: true, 'task-priority-badge': true, TaskCarryOverDots: true } },
  })

const cloud = (w: ReturnType<typeof render>) => w.find('[data-testid="task-save-pending"]')

describe('TaskCard cloud "save pending" icon (#319)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('shows while the task has unsaved changes and its source cannot sync, and names the source', () => {
    const tasks = useTasksStore()
    const pending = task()
    tasks.addTask(pending)
    tasks.markPendingSync('t1')
    useIntegrationHealthStore().markOffline('notion', 'Network error')

    const icon = cloud(render(tasks.task('t1')!))

    expect(icon.exists()).toBe(true)
    expect(icon.attributes('aria-label')).toBe('Noch nicht in Notion gespeichert. Die Änderung ist lokal gesichert.')
    expect(icon.attributes('role')).toBe('img')
  })

  it('never shows while the source is healthy, even with the marker set (a write in flight)', () => {
    const tasks = useTasksStore()
    tasks.addTask(task())
    tasks.markPendingSync('t1')
    useIntegrationHealthStore().recordSuccessfulSync('notion')

    expect(cloud(render(tasks.task('t1')!)).exists()).toBe(false)
  })

  it('does not show for a task without unsaved changes, nor for a Local task', () => {
    const tasks = useTasksStore()
    tasks.addTask(task())
    tasks.addTask(task({ id: 'l1', source: 'local', externalId: null }))
    useIntegrationHealthStore().markOffline('notion', 'Network error')

    expect(cloud(render(tasks.task('t1')!)).exists()).toBe(false)
    expect(cloud(render(tasks.task('l1')!)).exists()).toBe(false)
  })
})
