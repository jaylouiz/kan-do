import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { RadioGroupRoot } from 'reka-ui'
import { h } from 'vue'
import ChoiceCard from '~/components/ui/ChoiceCard.vue'

describe('ChoiceCard (kd#178)', () => {
  it('without a value it is one native button with the go-on mark; the click and attributes land on it', async () => {
    const wrapper = mount(ChoiceCard, { props: { icon: 'i-ph-desktop' }, attrs: { 'data-testid': 'card' }, slots: { default: 'Noch nirgends' } })
    expect(wrapper.element.tagName).toBe('BUTTON')
    expect(wrapper.attributes('type')).toBe('button')
    expect(wrapper.attributes('data-testid')).toBe('card')
    expect(wrapper.text()).toBe('Noch nirgends')
    expect(wrapper.find('[class*="rounded-full"]').exists()).toBe(false)
    await wrapper.trigger('click')
    expect(wrapper.emitted('click')).toHaveLength(1)
  })

  it('shows the hint under the label', () => {
    const wrapper = mount(ChoiceCard, { props: { icon: 'i-ph-plus-circle' }, slots: { default: 'Neu starten', hint: 'Leeres Board' } })
    expect(wrapper.text()).toContain('Neu starten')
    expect(wrapper.text()).toContain('Leeres Board')
  })

  it('with a value it is a radio card of the surrounding group, with the radio mark', () => {
    const wrapper = mount({
      render: () => h(RadioGroupRoot, { modelValue: 'fresh' }, () => [
        h(ChoiceCard, { value: 'fresh', icon: 'i-ph-plus-circle' }, () => 'Neu starten'),
        h(ChoiceCard, { value: 'samples', icon: 'i-ph-sparkle' }, () => 'Mit Beispielaufgaben'),
      ]),
    })
    const radios = wrapper.findAll('[role="radio"]')
    expect(radios).toHaveLength(2)
    expect(radios[0]!.attributes('aria-checked')).toBe('true')
    expect(radios[1]!.attributes('aria-checked')).toBe('false')
    expect(radios[0]!.find('[class*="rounded-full"]').exists()).toBe(true)
  })
})
