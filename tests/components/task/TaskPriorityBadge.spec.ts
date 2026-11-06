import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { computed } from 'vue'
import TaskPriorityBadge from '~/components/task/TaskPriorityBadge.vue'

// The badge relies on Nuxt auto-imports
;(globalThis as unknown as { computed: typeof computed }).computed = computed

const STUBS = {
  UTooltip: { template: '<div><slot /></div>' },
  UBadge: { props: ['icon'], template: '<span :data-icon="icon"><slot /></span>' },
}

function render(priority: number | string) {
  return mount(TaskPriorityBadge, { props: { priority }, global: { stubs: STUBS } })
}

describe('TaskPriorityBadge (#617)', () => {
  it('only High carries the tint, by level alone (whatever else is on the board)', () => {
    expect(render(3).find('.priority').classes()).toContain('priority-high')
    for (const level of [1, 2]) expect(render(level).find('.priority').classes()).not.toContain('priority-high')
  })

  it('a stored 4 (the former urgent) reads as High: label, icon and tint', () => {
    const badge = render(4)
    expect(badge.find('.priority').classes()).toContain('priority-high')
    expect(badge.text()).toBe('Hoch')
    expect(badge.find('.priority').attributes('data-icon')).toBe(render(3).find('.priority').attributes('data-icon'))
  })

  it('names Low and Regular; no priority reads as Normal (#653)', () => {
    expect(render(1).text()).toBe('Niedrig')
    expect(render(2).text()).toBe('Normal')
    expect(render(0).text()).toBe('Normal')
  })
})
