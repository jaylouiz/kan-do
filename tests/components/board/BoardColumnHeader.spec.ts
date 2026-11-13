import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import BoardColumnHeader from '~/components/board/BoardColumnHeader.vue'
import { TaskStatus } from '~/types/taskStatus'

// #248: the Offen header's round add button
const UButton = {
  props: ['disabled'],
  emits: ['click'],
  template: '<button type="button" :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>',
}
// Shows its props as attributes so the test reads the tooltip text and its disabled flag
const UTooltip = {
  props: ['text', 'disabled'],
  template: '<span data-testid="tip" :data-text="text" :data-disabled="String(!!disabled)"><slot /></span>',
}
const render = (props: Record<string, unknown> = {}) =>
  mount(BoardColumnHeader, {
    props: { title: 'Offen', status: TaskStatus.Open, taskCount: 0, ...props },
    global: { stubs: { UButton, UTooltip, UIcon: true } },
  })

describe('BoardColumnHeader add button (#248)', () => {
  it('has no button unless showAdd is set (every other column)', () => {
    expect(render().find('[data-testid="add-task-header-button"]').exists()).toBe(false)
  })

  it('shows one button named "Aufgabe hinzufügen" that emits add on click, outside the title', async () => {
    const w = render({ showAdd: true })
    const button = w.find('[data-testid="add-task-header-button"]')
    expect(button.exists()).toBe(true)
    expect(button.attributes('aria-label')).toBe('Aufgabe hinzufügen')
    expect(w.find('h2').text()).toBe('Offen') // the title stays free of the button
    expect(w.find('h2').find('button').exists()).toBe(false)
    await button.trigger('click')
    expect(w.emitted('add')).toHaveLength(1)
  })

  it('keeps the button in place but disabled while a draft is open: no add event', async () => {
    const w = render({ showAdd: true, addDisabled: true })
    const button = w.find('[data-testid="add-task-header-button"]')
    expect(button.exists()).toBe(true)
    expect(button.attributes('disabled')).toBeDefined()
    await button.trigger('click')
    expect(w.emitted('add')).toBeUndefined()
  })

  it('wraps the button in a tooltip with its name (#264)', () => {
    const tip = render({ showAdd: true }).find('[data-testid="tip"]')
    expect(tip.attributes('data-text')).toBe('Aufgabe hinzufügen')
    expect(tip.find('[data-testid="add-task-header-button"]').exists()).toBe(true)
  })
})
