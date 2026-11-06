import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { onMounted, ref } from 'vue'
import TaskCard from '~/components/task/TaskCard.vue'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import { useTasksStore } from '~/store/tasks'
import { useTaskDraft } from '~/composables/useTaskDraft'
import { useTopicStylesStore } from '~/store/topicStyles'

vi.mock('~/composables/useStackExpansion', () => ({ useStackExpansion: () => ({ shouldBlockModal: () => false }) }))
vi.mock('~/composables/useSheetSpotlight', () => ({ useSheetSpotlight: () => ({ spotlightTaskId: { value: null } }) }))
vi.mock('~/composables/useCarryOver', () => ({ useTaskCarryOver: () => ({ displayDay: { value: 0 } }) }))
vi.stubGlobal('onMounted', onMounted)
window.matchMedia = ((q: string) => ({ matches: false, media: q })) as unknown as typeof window.matchMedia

function task(id: string, source: Task['source'], topic: string | null, color: string | null = null): Task {
  return {
    id, source, externalId: source === 'local' ? null : id, title: `Aufgabe ${id}`, status: TaskStatus.Open, priority: 1,
    activity: null, topic, topicColorCode: color, notes: null, timeBoxSeconds: 0, timeSpentSeconds: 0, timerId: null,
  }
}

const render = (current: Task, props: Record<string, unknown> = {}) =>
  mount(TaskCard, {
    props: { task: current, ...props },
    global: { stubs: { UCard: { template: '<div><slot /><slot name="footer" /></div>' }, UIcon: true, UBadge: true, TaskProgressChip: true, 'task-priority-badge': true, TaskCarryOverDots: true } },
  })

const mark = (wrapper: ReturnType<typeof render>) => wrapper.find('[data-testid="topic-mark"]')
const topicLine = (wrapper: ReturnType<typeof render>) => wrapper.find('.task-topic')

describe('topic mark on the card (#321, #431)', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    useTasksStore().setTasks([task('n1', 'notion', 'Büro', 'blue'), task('l1', 'local', 'Büro'), task('l2', 'local', 'Garten')])
  })

  it('a Local card takes the mark of the same-named Notion topic, otherwise shows no mark and no gap', () => {
    expect(mark(render(useTasksStore().task('l1')!)).attributes('data-hue')).toBe('blue')
    const plain = render(useTasksStore().task('l2')!)
    expect(mark(plain).exists()).toBe(false)
    expect(topicLine(plain).text()).toBe('Garten')
  })

  it('a Notion card keeps its own colour, mapped onto the nearest hue, in a visible mark (the old inline dot rendered nothing)', () => {
    const wrapper = render(useTasksStore().task('n1')!)
    expect(mark(wrapper).attributes('data-hue')).toBe('blue')
    expect(wrapper.find('.topic-dot').exists()).toBe(false)
    expect(mark(wrapper).attributes('aria-hidden')).toBe('true')
  })

  it('a hex colour from another source shows the nearest hue', () => {
    useTasksStore().addTask(task('n2', 'notion', 'Server', '#10b981'))
    expect(mark(render(useTasksStore().task('n2')!)).attributes('data-hue')).toBe('green')
  })

  it('the user\'s colour and symbol win over the source colour and apply to every card of the topic', () => {
    useTopicStylesStore().setStyle('Büro', { hue: 'red', symbol: 'briefcase' })
    for (const id of ['n1', 'l1']) {
      const wrapper = render(useTasksStore().task(id)!)
      expect(mark(wrapper).attributes('data-hue')).toBe('red')
      expect(mark(wrapper).attributes('data-symbol')).toBe('briefcase')
    }
  })

  it('a symbol without a hue is a muted glyph', () => {
    useTopicStylesStore().setStyle('Garten', { symbol: 'leaf' })
    const wrapper = render(useTasksStore().task('l2')!)
    expect(mark(wrapper).attributes('data-symbol')).toBe('leaf')
    expect(mark(wrapper).attributes('data-hue')).toBeUndefined()
  })

  it('the draft card follows the topic typed into the form', () => {
    const draft = useTaskDraft()
    draft.startDraft()
    draft.updateDraft({ topic: 'Büro' })
    expect(mark(render(draft.draftTask.value!, { draft: true })).attributes('data-hue')).toBe('blue')
    draft.updateDraft({ topic: 'Garten' })
    expect(mark(render(draft.draftTask.value!, { draft: true })).exists()).toBe(false)
    draft.clearDraft()
  })

  it('the topic name stays plain muted text and is masked in feedback screenshots', () => {
    const line = topicLine(render(useTasksStore().task('n1')!))
    expect(line.attributes('data-private')).toBeDefined()
    expect(line.text()).toBe('Büro')
  })
})
