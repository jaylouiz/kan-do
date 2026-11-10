import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import TaskPropertySelect from '~/components/task/TaskPropertySelect.vue'

/**
 * The property select (#114): a soft select with a chevron for a list value, the plain text trigger for a footer line.
 * USelectMenu is stubbed to expose the props and slots the wrapper passes, so the wrapper's own decisions are what run.
 */
const MenuStub = defineComponent({
  name: 'USelectMenu',
  inheritAttrs: false,
  props: ['variant', 'trailing', 'ariaLabel', 'modelValue', 'placeholder'],
  setup(props, { slots }) {
    return () => h('div', {
      'data-stub': 'menu',
      'data-variant': props.variant,
      'data-trailing': String(props.trailing),
      'data-aria-label': props.ariaLabel,
    }, [
      slots.leading ? h('span', { 'data-testid': 'leading' }, slots.leading({})) : null,
    ])
  },
})

const items = [{ label: 'Niedrig', value: 0 }, { label: 'Hoch', value: 2 }]

function mountSelect(props: Record<string, unknown> = {}, slots: Record<string, () => unknown> = {}) {
  return mount(TaskPropertySelect, {
    props: { label: 'Priorität', modelValue: 2, items, valueKey: 'value', ...props },
    slots: slots as never,
    global: { stubs: { USelectMenu: MenuStub, UButton: true } },
  })
}

describe('TaskPropertySelect look (#114)', () => {
  it('renders the soft select with a chevron by default', () => {
    const menu = mountSelect().get('[data-stub="menu"]')
    expect(menu.attributes('data-variant')).toBe('soft')
    expect(menu.attributes('data-trailing')).toBe('true')
  })

  it('plain keeps the text trigger without a chevron', () => {
    const menu = mountSelect({ plain: true }).get('[data-stub="menu"]')
    expect(menu.attributes('data-variant')).toBe('property')
    expect(menu.attributes('data-trailing')).toBe('false')
  })

  it('names the trigger "<label>: <value>" in both looks, and the placeholder when empty', () => {
    expect(mountSelect().get('[data-stub="menu"]').attributes('data-aria-label')).toBe('Priorität: Hoch')
    expect(mountSelect({ plain: true }).get('[data-stub="menu"]').attributes('data-aria-label')).toBe('Priorität: Hoch')
    const empty = mountSelect({ modelValue: null, placeholder: 'Wählen' })
    expect(empty.get('[data-stub="menu"]').attributes('data-aria-label')).toBe('Priorität: Wählen')
  })

  it('puts the value icon inside the select (leading slot), not for the plain trigger', () => {
    const icon = () => h('i', { 'data-testid': 'mark' })
    expect(mountSelect({}, { 'value-leading': icon }).find('[data-testid="mark"]').exists()).toBe(true)
    expect(mountSelect({}, {}).find('[data-testid="leading"]').exists()).toBe(false)
    expect(mountSelect({ plain: true }, { 'value-leading': icon }).find('[data-testid="leading"]').exists()).toBe(false)
  })
})
