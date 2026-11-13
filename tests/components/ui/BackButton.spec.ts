import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import BackButton from '~/components/ui/BackButton.vue'
import { ICONS } from '~/lib/icons'

const stubs = {
  UButton: { inheritAttrs: false, props: ['icon', 'to'], template: '<component :is="to ? \'a\' : \'button\'" v-bind="$attrs" :href="to" :data-icon="icon"><slot /></component>' },
}

describe('BackButton (#236)', () => {
  it('is the one step-back control: the label, the arrow icon of the semantic map and the shared test id', () => {
    const w = mount(BackButton, { props: { label: 'Zurück zur Auswahl' }, global: { stubs } })
    expect(w.text()).toBe('Zurück zur Auswahl')
    expect(w.attributes('data-icon')).toBe(ICONS.stepBack)
    expect(w.attributes('data-testid')).toBe('setup-back')
  })

  it('without a target it emits click for a step inside a flow', async () => {
    const w = mount(BackButton, { props: { label: 'Zurück' }, global: { stubs } })
    await w.trigger('click')
    expect(w.emitted('click')).toHaveLength(1)
  })

  it('with a target it is a link to it (a deeper route leads to its parent)', () => {
    const w = mount(BackButton, { props: { label: 'Zurück zu Einstellungen', to: '/settings' }, global: { stubs } })
    expect(w.element.tagName).toBe('A')
    expect(w.attributes('href')).toBe('/settings')
  })

  it('is at least 44 px high and sits on the left', () => {
    const w = mount(BackButton, { props: { label: 'Zurück' }, global: { stubs } })
    expect(w.classes()).toContain('min-h-11')
    expect(w.classes()).toContain('self-start')
  })
})
