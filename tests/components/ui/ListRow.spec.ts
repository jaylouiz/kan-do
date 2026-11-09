import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ListRow from '~/components/ui/ListRow.vue'

describe('ListRow (#76)', () => {
  it('a static row is a plain <li> with the density padding and the attrs on the <li>', () => {
    const wrapper = mount(ListRow, { props: { density: 'roomy' }, attrs: { 'data-testid': 'row' }, slots: { default: 'Lokal' } })
    expect(wrapper.element.tagName).toBe('LI')
    expect(wrapper.attributes('data-testid')).toBe('row')
    expect(wrapper.classes()).toContain('py-4')
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it.each([
    ['roomy', 'py-4'],
    ['cozy', 'py-2.5'],
    ['compact', 'py-1.5'],
  ] as const)('density %s sets %s', (density, cls) => {
    expect(mount(ListRow, { props: { density } }).classes()).toContain(cls)
  })

  it('an action row is one button: click emits, aria-expanded and label follow the props, the testid names the button', async () => {
    const wrapper = mount(ListRow, {
      props: { action: true, expanded: true, label: 'Bearbeiten: Arbeit', buttonTestid: 'row-button' },
      attrs: { 'data-testid': 'row' },
      slots: { default: 'Arbeit', after: '<p class="after">Editor</p>' },
    })
    const button = wrapper.get('[data-testid="row-button"]')
    expect(button.attributes('type')).toBe('button')
    expect(button.attributes('aria-expanded')).toBe('true')
    expect(button.attributes('aria-label')).toBe('Bearbeiten: Arbeit')
    expect(button.classes()).toEqual(expect.arrayContaining(['focus-ring', 'min-h-11', 'w-full']))
    expect(wrapper.attributes('data-testid')).toBe('row')
    expect(wrapper.find('.after').exists()).toBe(true)
    await button.trigger('click')
    expect(wrapper.emitted('click')).toHaveLength(1)
  })

  it('exposes focus() so a host can return focus to the row (topic editor close)', () => {
    const wrapper = mount(ListRow, { props: { action: true }, slots: { default: 'x' }, attachTo: document.body })
    ;(wrapper.vm as unknown as { focus: () => void }).focus()
    expect(document.activeElement).toBe(wrapper.get('button').element)
    wrapper.unmount()
  })

  it('leaves aria-expanded off a row that does not expand', () => {
    const wrapper = mount(ListRow, { props: { action: true }, slots: { default: 'x' } })
    expect(wrapper.get('button').attributes('aria-expanded')).toBeUndefined()
  })
})
