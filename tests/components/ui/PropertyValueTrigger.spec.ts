import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PropertyValueTrigger from '~/components/ui/PropertyValueTrigger.vue'

describe('PropertyValueTrigger (#72)', () => {
  it('is one native button with the shared property-value rule and the sheet row heights', async () => {
    const wrapper = mount(PropertyValueTrigger, { attrs: { 'data-testid': 'trigger' }, slots: { default: '30 min' } })
    expect(wrapper.element.tagName).toBe('BUTTON')
    expect(wrapper.attributes('type')).toBe('button')
    expect(wrapper.classes()).toEqual(expect.arrayContaining(['task-property-value', 'min-h-8', 'max-md:min-h-11']))
    expect(wrapper.text()).toBe('30 min')
    await wrapper.trigger('click')
    expect(wrapper.emitted('click')).toHaveLength(1)
  })

  it.each([
    ['value', 'text-default'],
    ['empty', 'text-muted'],
    ['action', 'hover:text-default'],
    ['picked', 'font-semibold'],
  ] as const)('tone %s sets %s', (tone, cls) => {
    expect(mount(PropertyValueTrigger, { props: { tone } }).classes()).toContain(cls)
  })

  it('inset adds the row padding; the default has none', () => {
    expect(mount(PropertyValueTrigger, { props: { inset: true } }).classes()).toContain('px-2')
    expect(mount(PropertyValueTrigger).classes()).not.toContain('px-2')
  })

  it('passes aria-pressed and disabled through to the button', () => {
    const wrapper = mount(PropertyValueTrigger, { attrs: { 'aria-pressed': 'true', disabled: true } })
    expect(wrapper.attributes('aria-pressed')).toBe('true')
    expect(wrapper.attributes('disabled')).toBeDefined()
  })
})
