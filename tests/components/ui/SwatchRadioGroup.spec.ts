import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import SwatchRadioGroup from '~/components/ui/SwatchRadioGroup.vue'

const OPTIONS = [
  { key: null, label: 'Keine' },
  { key: 'red', label: 'Rot' },
  { key: 'green', label: 'Grün' },
  { key: 'blue', label: 'Blau' },
]

function mountGroup(modelValue: string | null, extra: Record<string, unknown> = {}) {
  return mount(SwatchRadioGroup, {
    props: { modelValue, options: OPTIONS, label: 'Farbe', itemTestid: 'hue', ...extra },
    attrs: { 'data-testid': 'group' },
    attachTo: document.body,
  })
}
const radios = (wrapper: ReturnType<typeof mountGroup>) => wrapper.findAll('[role="radio"]')

describe('SwatchRadioGroup (#72)', () => {
  it('is a named radiogroup of native radio buttons; the host attribute lands on the group', () => {
    const wrapper = mountGroup('red')
    const group = wrapper.get('[role="radiogroup"]')
    expect(group.attributes('aria-label')).toBe('Farbe')
    expect(group.attributes('data-testid')).toBe('group')
    expect(radios(wrapper).map((r) => r.element.tagName)).toEqual(['BUTTON', 'BUTTON', 'BUTTON', 'BUTTON'])
    expect(radios(wrapper).map((r) => r.attributes('aria-label'))).toEqual(['Keine', 'Rot', 'Grün', 'Blau'])
    expect(wrapper.get('[data-testid="hue-red"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="hue-none"]').exists()).toBe(true)
  })

  it('checks the selected option and makes it the only Tab stop; without a selection the first is', () => {
    const selected = mountGroup('green')
    expect(radios(selected).map((r) => r.attributes('aria-checked'))).toEqual(['false', 'false', 'true', 'false'])
    expect(radios(selected).map((r) => r.attributes('tabindex'))).toEqual(['-1', '-1', '0', '-1'])
    const none = mountGroup('missing')
    expect(radios(none).map((r) => r.attributes('tabindex'))).toEqual(['0', '-1', '-1', '-1'])
  })

  it('a click selects and emits update:modelValue and pick; "none" selects null', async () => {
    const wrapper = mountGroup('red')
    await radios(wrapper)[2]!.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['green'])
    expect(wrapper.emitted('pick')?.[0]).toEqual(['green'])
    await radios(wrapper)[0]!.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[1]).toEqual([null])
  })

  it('arrow keys move focus and selection (wrapping), Home and End jump, and do not emit pick', async () => {
    const wrapper = mountGroup('blue')
    radios(wrapper)[3]!.element.focus()
    await radios(wrapper)[3]!.trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([null])
    expect(document.activeElement).toBe(radios(wrapper)[0]!.element)
    await radios(wrapper)[0]!.trigger('keydown', { key: 'End' })
    expect(wrapper.emitted('update:modelValue')?.[1]).toEqual(['blue'])
    expect(wrapper.emitted('pick')).toBeUndefined()
  })

  it('with columns, ArrowDown moves by a row and stops at the last option', async () => {
    const wrapper = mountGroup('red', { columns: 2, variant: 'glyph' })
    radios(wrapper)[1]!.element.focus()
    await radios(wrapper)[1]!.trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['blue'])
  })

  it('focusSelected() moves focus to the selected option', () => {
    const wrapper = mountGroup('green')
    ;(wrapper.vm as unknown as { focusSelected: () => void }).focusSelected()
    expect(document.activeElement).toBe(radios(wrapper)[2]!.element)
  })
})
