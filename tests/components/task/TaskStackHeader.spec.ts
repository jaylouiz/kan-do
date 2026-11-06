import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import TaskStackHeader from '~/components/task/TaskStackHeader.vue'

let wrapper: VueWrapper | null = null
const UButton = { props: ['label', 'icon'], template: '<button type="button" class="u-button" :data-icon="icon">{{ label }}</button>' }
const mountHeader = (count = 3) => {
  wrapper = mount(TaskStackHeader, {
    props: { groupKey: 'Design', label: 'Design', count },
    global: { stubs: { UButton, UIcon: true } },
  })
  return wrapper
}

beforeEach(() => setActivePinia(createPinia()))
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('TaskStackHeader (#148, #578)', () => {
  it('shows the stack pill as the title and a round X without visible text: no caption, no "Schließen"', () => {
    mountHeader()
    expect(wrapper!.find('.task-stack-pill').text()).toContain('Design')
    expect(wrapper!.find('.task-stack-pill').text()).toContain('3')
    expect(wrapper!.find('.task-stack-caption').exists()).toBe(false)
    const button = wrapper!.find('.u-button')
    expect(button.text()).toBe('')
    expect(button.attributes('data-icon')).toBe('i-ph-x')
    expect(wrapper!.text()).not.toContain('Schließen')
  })

  it('is a labelled group named by the caption text; the X is named "Gruppe <group> schließen" and has no aria-expanded (#154)', () => {
    mountHeader()
    const root = wrapper!.find('.task-stack-header')
    expect(root.attributes('role')).toBe('group')
    expect(root.attributes('aria-label')).toBe('Design · 3 Aufgaben')
    const button = wrapper!.find('.u-button')
    expect(button.attributes('aria-label')).toBe('Gruppe Design schließen')
    expect(button.attributes('aria-expanded')).toBeUndefined()
  })

  it('speaks English', async () => {
    const { setTestLocale } = await import('~/tests/helpers/i18n')
    setTestLocale('en')
    mountHeader()
    expect(wrapper!.find('.task-stack-header').attributes('aria-label')).toBe('Design · 3 tasks')
    expect(wrapper!.find('.u-button').attributes('aria-label')).toBe('Close group Design')
  })

  it('is not a sortable and carries no task id: dnd-kit and the drop mapping never see it', () => {
    mountHeader()
    const root = wrapper!.find('.task-stack-header')
    expect(root.attributes('data-stack-header')).toBe('Design')
    expect(root.attributes('data-task-id')).toBeUndefined()
    expect(root.classes()).not.toContain('task-wrapper')
  })

  it('asks the column to close the group', async () => {
    mountHeader()
    await wrapper!.find('.u-button').trigger('click')
    expect(wrapper!.emitted('close')).toHaveLength(1)
  })

  it('tells the column whether the close came from the keyboard (click detail 0) or a pointer', async () => {
    mountHeader()
    const button = wrapper!.find('.u-button').element
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(wrapper!.emitted('close')).toEqual([['keyboard'], ['pointer']])
  })
})
