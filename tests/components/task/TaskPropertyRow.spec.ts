import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TaskPropertyRow from '~/components/task/TaskPropertyRow.vue'

const renderRow = () =>
  mount(TaskPropertyRow, {
    props: { label: 'Priorität' },
    slots: { default: '<button class="value">Mittel</button>' },
  })

describe('TaskPropertyRow (#161)', () => {
  it('renders the label left and the value slot right', () => {
    const wrapper = renderRow()
    const label = wrapper.get('span')
    expect(label.text()).toBe('Priorität')
    expect(wrapper.get('.value').text()).toBe('Mittel')
    // label first, value second: the DOM order is the reading and Tab order
    const children = Array.from(wrapper.element.children)
    expect(children[0]).toBe(label.element)
    expect(children[1]?.contains(wrapper.get('.value').element)).toBe(true)
  })

  it('uses a fixed label column in the quiet Label role, without icons or dividers', () => {
    const wrapper = renderRow()
    const label = wrapper.get('span')
    expect(label.classes()).toEqual(expect.arrayContaining(['w-22', 'shrink-0', 'text-xs', 'font-medium', 'text-muted']))
    expect(wrapper.find('svg, .iconify, [class*="border"], hr').exists()).toBe(false)
    expect(wrapper.html()).not.toContain('uppercase')
  })

  it('gives label and value the one field height (36 px, 44 px on a phone: the --field-h token)', () => {
    const wrapper = renderRow()
    expect(wrapper.get('span').classes()).toContain('min-h-(--field-h)')
    expect(Array.from(wrapper.element.children[1]!.classList)).toContain('min-h-(--field-h)')
  })

  it('hands the label id to the value slot so the control can be named by it', () => {
    const wrapper = mount(TaskPropertyRow, {
      props: { label: 'Timebox' },
      slots: { default: '<template #default="{ labelId }"><input :aria-labelledby="labelId"></template>' },
    })
    const labelId = wrapper.get('span').attributes('id')
    expect(labelId).toBeTruthy()
    expect(wrapper.get('input').attributes('aria-labelledby')).toBe(labelId)
  })
})
