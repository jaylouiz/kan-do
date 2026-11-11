import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ChoiceChip from '~/components/ui/ChoiceChip.vue'

describe('ChoiceChip (#72)', () => {
  it('is one native button; attributes and the click land on it', async () => {
    const wrapper = mount(ChoiceChip, { attrs: { 'data-testid': 'chip', 'aria-keyshortcuts': '1' }, slots: { default: 'Design' } })
    expect(wrapper.element.tagName).toBe('BUTTON')
    expect(wrapper.attributes('type')).toBe('button')
    expect(wrapper.attributes('data-testid')).toBe('chip')
    expect(wrapper.attributes('aria-keyshortcuts')).toBe('1')
    await wrapper.trigger('click')
    expect(wrapper.emitted('click')).toHaveLength(1)
  })

  it('a host can make it a submit button', () => {
    expect(mount(ChoiceChip, { attrs: { type: 'submit' } }).attributes('type')).toBe('submit')
  })

  it('square makes an icon-only chip as wide as it is tall', () => {
    expect(mount(ChoiceChip, { props: { square: true } }).classes()).toContain('choice-chip--square')
    expect(mount(ChoiceChip).classes()).not.toContain('choice-chip--square')
  })

  it('is one chip: no shape or size prop, one class', () => {
    const wrapper = mount(ChoiceChip, { props: { shape: 'icon', large: true } as never })
    expect(wrapper.classes()).toContain('choice-chip')
    expect(wrapper.classes().filter((c) => c.startsWith('choice-chip--'))).toEqual([])
    expect(wrapper.classes()).not.toContain('min-h-8')
  })

  it('picked, current and field are classes the style keys on', () => {
    const wrapper = mount(ChoiceChip, { props: { picked: true, current: true, field: true } })
    expect(wrapper.classes()).toEqual(expect.arrayContaining(['is-picked', 'is-current', 'choice-chip--field']))
    const plain = mount(ChoiceChip)
    expect(plain.classes()).not.toContain('is-picked')
    expect(plain.classes()).not.toContain('choice-chip--field')
  })

  it('a disabled chip does not emit a click', async () => {
    const wrapper = mount(ChoiceChip, { attrs: { disabled: true } })
    await wrapper.trigger('click')
    expect(wrapper.emitted('click')).toBeUndefined()
  })
})
