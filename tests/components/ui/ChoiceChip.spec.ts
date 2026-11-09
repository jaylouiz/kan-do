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
    expect(mount(ChoiceChip, { attrs: { type: 'submit' }, props: { shape: 'icon' } }).attributes('type')).toBe('submit')
  })

  it.each(['pill', 'chip', 'icon'] as const)('shape %s takes its own geometry class', (shape) => {
    expect(mount(ChoiceChip, { props: { shape } }).classes()).toContain(`choice-chip--${shape}`)
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

  it('the row is a list row: 32 px, or 44 px with larger text when large, and marks aria-current', () => {
    const row = mount(ChoiceChip, { props: { shape: 'row' }, attrs: { 'aria-current': 'true' } })
    expect(row.classes()).toEqual(expect.arrayContaining(['choice-chip--row', 'min-h-8', 'text-sm', 'w-full']))
    expect(row.attributes('aria-current')).toBe('true')
    const large = mount(ChoiceChip, { props: { shape: 'row', large: true } })
    expect(large.classes()).toEqual(expect.arrayContaining(['min-h-11', 'text-base']))
    expect(large.classes()).not.toContain('min-h-8')
  })
})
