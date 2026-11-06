import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import TopicMark from '~/components/topic/TopicMark.vue'
import { useTasksStore } from '~/store/tasks'
import { useTopicStylesStore } from '~/store/topicStyles'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

const task = (id: string, source: Task['source'], topic: string, color: string | null): Task => ({
  id, source, externalId: source === 'local' ? null : id, title: id, status: TaskStatus.Open, activity: null,
  topic, topicColorCode: color, priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null,
})

const mountMark = (props: Record<string, unknown>) => mount(TopicMark, { props, global: { stubs: { UIcon: { props: ['name'], template: '<i :data-icon="name" />' } } } })

describe('TopicMark (#431)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('renders nothing for a topic with neither hue nor symbol (no mark, no gap)', () => {
    expect(mountMark({ topic: 'Garten' }).find('[data-testid="topic-mark"]').exists()).toBe(false)
    expect(mountMark({ topic: null }).html()).toBe('<!--v-if-->')
  })

  it('renders a hue dot from the source colour, aria-hidden', () => {
    useTasksStore().setTasks([task('n', 'notion', 'Büro', 'blue')])
    const wrapper = mountMark({ topic: 'Büro' })
    const mark = wrapper.find('[data-testid="topic-mark"]')
    expect(mark.attributes('data-hue')).toBe('blue')
    expect(mark.attributes('aria-hidden')).toBe('true')
    expect(mark.attributes('style')).toContain('var(--topic-blue)')
    expect(wrapper.find('.topic-mark__dot').exists()).toBe(true)
    expect(wrapper.find('i').exists()).toBe(false)
  })

  it('renders the fill glyph in the hue, and a muted glyph without a hue', () => {
    useTopicStylesStore().setStyle('Work', { hue: 'green', symbol: 'briefcase' })
    useTopicStylesStore().setStyle('Plain', { symbol: 'leaf' })
    const work = mountMark({ topic: 'Work' })
    expect(work.find('i').attributes('data-icon')).toBe('i-ph-briefcase-fill')
    expect(work.find('[data-testid="topic-mark"]').attributes('style')).toContain('var(--topic-green)')
    expect(work.find('.topic-mark__dot').exists()).toBe(false)

    const plain = mountMark({ topic: 'Plain' })
    expect(plain.find('i').attributes('data-icon')).toBe('i-ph-leaf-fill')
    expect(plain.find('[data-testid="topic-mark"]').attributes('style')).toContain('var(--ui-text-muted)')
  })

  it('shows an explicit hue and symbol (the editor preview) without asking the resolver', () => {
    const wrapper = mountMark({ hue: 'pink', symbol: 'star' })
    expect(wrapper.find('[data-testid="topic-mark"]').attributes('data-hue')).toBe('pink')
    expect(wrapper.find('i').attributes('data-icon')).toBe('i-ph-star-fill')
    expect(mountMark({ hue: null, symbol: null }).find('[data-testid="topic-mark"]').exists()).toBe(false)
  })

  it('an unknown symbol key falls back to the dot (or nothing)', () => {
    useTopicStylesStore().styles = { A: { hue: 'red', symbol: 'unicorn' }, B: { hue: null, symbol: 'unicorn' } }
    expect(mountMark({ topic: 'A' }).find('.topic-mark__dot').exists()).toBe(true)
    expect(mountMark({ topic: 'B' }).find('[data-testid="topic-mark"]').exists()).toBe(false)
  })
})
