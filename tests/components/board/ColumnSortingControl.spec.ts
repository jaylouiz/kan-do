import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import ColumnSortingControl from '~/components/board/ColumnSortingControl.vue'
import { TaskStatus } from '~/types/taskStatus'
import type { ColumnSorting } from '~/types/state'
import { setTestLocale } from '~/tests/helpers/i18n'

interface MenuItem { type?: string; label: string; description?: string; checked?: boolean; onSelect?: () => void }

const DropdownStub = defineComponent({
  props: { items: { type: Array, default: () => [] } },
  emits: ['update:open'],
  setup(_, { slots }) {
    return () => h('div', { 'data-stub': 'menu' }, slots.default?.())
  }
})
const ButtonStub = defineComponent({
  props: { label: String, icon: String, trailingIcon: String },
  setup(props) {
    return () => h('button', { 'data-icon': props.icon, 'data-trailing': props.trailingIcon ?? '' }, props.label)
  }
})

const mountControl = (status: TaskStatus, sorting?: ColumnSorting) =>
  mount(ColumnSortingControl, {
    props: { visible: true, status, sorting },
    global: { stubs: { UDropdownMenu: DropdownStub, UButton: ButtonStub } }
  })

const menuItems = (wrapper: ReturnType<typeof mountControl>) => {
  const groups = wrapper.findComponent(DropdownStub).props('items') as MenuItem[][]
  return groups.flat()
}
const options = (wrapper: ReturnType<typeof mountControl>) => menuItems(wrapper).filter(i => i.type === 'checkbox')

describe('ColumnSortingControl', () => {
  it('renders the trigger without a caret', () => {
    const wrapper = mountControl(TaskStatus.Open)
    expect(wrapper.find('button').attributes('data-trailing')).toBe('')
  })

  it.each([
    [TaskStatus.Open, { field: 'manual', direction: 'asc' }, 'Manuell'],
    [TaskStatus.Open, { field: 'priority', direction: 'desc' }, 'Priorität · höchste zuerst'],
    [TaskStatus.Open, { field: 'dateCreated', direction: 'desc' }, 'Erstellt · neueste zuerst'],
    [TaskStatus.Open, { field: 'dateCreated', direction: 'asc' }, 'Erstellt · älteste zuerst'],
    [TaskStatus.Waiting, { field: 'dateUpdated', direction: 'asc' }, 'Längste Wartezeit'],
    [TaskStatus.Waiting, { field: 'dateUpdated', direction: 'desc' }, 'Kürzeste Wartezeit'],
    [TaskStatus.Done, { field: 'dateCompleted', direction: 'asc' }, 'Zuerst erledigt · älteste oben'],
    [TaskStatus.Done, { field: 'dateCompleted', direction: 'desc' }, 'Zuletzt erledigt · neueste oben']
  ] as const)('shows the active sort in the trigger (%#)', (status, sorting, label) => {
    expect(mountControl(status, sorting as ColumnSorting).find('button').text()).toBe(label)
  })

  it('shows English labels', () => {
    setTestLocale('en')
    const wrapper = mountControl(TaskStatus.Waiting, { field: 'dateUpdated', direction: 'asc' })
    expect(wrapper.find('button').text()).toBe('Longest wait')
    expect(menuItems(wrapper)[0]?.label).toBe('Sort by')
  })

  it('leads with a group label and marks exactly the active option as checked', () => {
    const wrapper = mountControl(TaskStatus.Open, { field: 'dateCreated', direction: 'asc' })
    expect(menuItems(wrapper)[0]).toMatchObject({ type: 'label', label: 'Sortieren nach' })
    const checked = options(wrapper).filter(o => o.checked)
    expect(checked).toHaveLength(1)
    expect(checked[0]).toMatchObject({ label: 'Erstellt', description: 'älteste zuerst' })
  })

  it('treats a missing sorting as manual', () => {
    const wrapper = mountControl(TaskStatus.Open, undefined)
    expect(options(wrapper).find(o => o.checked)?.label).toBe('Manuell')
  })

  it('offers the per-column option sets', () => {
    expect(options(mountControl(TaskStatus.Open)).length).toBe(4)
    expect(options(mountControl(TaskStatus.Waiting)).map(o => o.label)).toEqual(['Manuell', 'Längste Wartezeit', 'Kürzeste Wartezeit'])
    expect(options(mountControl(TaskStatus.Done)).map(o => o.label)).toEqual(['Manuell', 'Zuerst erledigt', 'Zuletzt erledigt'])
  })

  it('emits change(field, direction) per option', () => {
    const wrapper = mountControl(TaskStatus.Open)
    options(wrapper).forEach(o => o.onSelect?.())
    expect(wrapper.emitted('change')).toEqual([
      ['manual', 'asc'], ['priority', 'desc'], ['dateCreated', 'desc'], ['dateCreated', 'asc']
    ])
  })

  it('forwards the open state', () => {
    const wrapper = mountControl(TaskStatus.Open)
    wrapper.findComponent(DropdownStub).vm.$emit('update:open', true)
    expect(wrapper.emitted('open-change')).toEqual([[true]])
  })
})
