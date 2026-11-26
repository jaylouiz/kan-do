import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TaskSheetMenu from '~/components/task/TaskSheetMenu.vue'
import type { MoveTarget } from '~/composables/useTaskMoveTargets'

const UButton = { inheritAttrs: false, template: '<button v-bind="$attrs"><slot /></button>' }
const UDropdownMenu = { props: ['items'], template: '<div data-testid="menu"><slot /></div>' }

const target: MoveTarget = { source: 'notion', name: 'Notion', menuName: 'Notion', targetPhrase: 'zu Notion', icon: 'i-ph-notion', hint: '', disabled: false }

type Item = { label: string; type?: string; checked?: boolean; onUpdateChecked?: (on: boolean) => void; color?: string; disabled?: boolean; description?: string; children?: Item[]; onSelect?: (event?: Event) => void }

const render = (props: { openLabel?: string | null; moveTargets?: MoveTarget[]; deleteLabel?: string | null; adhoc?: boolean }) =>
  mount(TaskSheetMenu, {
    props: { moveTargets: [], deleteLabel: 'Löschen', ...props },
    global: { stubs: { UButton, UDropdownMenu } },
  })

const groupsOf = (wrapper: ReturnType<typeof render>) => wrapper.getComponent(UDropdownMenu).props('items') as Item[][]

describe('TaskSheetMenu (#705)', () => {
  it('Local board: the task\'s own entries, then Delete in the error tone, which only emits', () => {
    const wrapper = render({})
    const groups = groupsOf(wrapper)
    expect(groups.map(group => group.map(item => item.label))).toEqual([['Ad-hoc/Ungeplant', 'ID kopieren'], ['Löschen']])
    expect(groups[1]![0]!.color).toBe('error')
    groups[1]![0]!.onSelect!()
    expect(wrapper.emitted('delete')).toHaveLength(1)
  })

  it('ad-hoc work is a checked entry that emits the new state and keeps the menu open (#846)', () => {
    const off = render({})
    const entry = groupsOf(off)[0]![0]!
    expect(entry).toMatchObject({ type: 'checkbox', checked: false })
    entry.onUpdateChecked!(true)
    expect(off.emitted('update:adhoc')).toEqual([[true]])
    const event = new Event('select', { cancelable: true })
    entry.onSelect!(event)
    expect(event.defaultPrevented).toBe(true)

    const on = render({ adhoc: true })
    expect(groupsOf(on)[0]![0]!.checked).toBe(true)
    groupsOf(on)[0]![0]!.onUpdateChecked!(false)
    expect(on.emitted('update:adhoc')).toEqual([[false]])
  })

  it('copy id only emits: the host copies and reports (#846)', () => {
    const wrapper = render({})
    groupsOf(wrapper)[0]![1]!.onSelect!()
    expect(wrapper.emitted('copy-id')).toHaveLength(1)
  })

  it('Notion board: open in source and move to source, then Delete in its own group', () => {
    const wrapper = render({ openLabel: 'In Notion öffnen', moveTargets: [target], deleteLabel: 'Löschen, auch in Notion' })
    const groups = groupsOf(wrapper)
    expect(groups.map(group => group.map(item => item.label))).toEqual([['In Notion öffnen', 'Verschieben zu …'], ['Ad-hoc/Ungeplant', 'ID kopieren'], ['Löschen, auch in Notion']])
    groups[0]![0]!.onSelect!()
    expect(wrapper.emitted('open')).toHaveLength(1)
  })

  it('the move sub-menu lists the targets and emits the chosen source; disabled targets stay disabled with their hint', () => {
    const wrapper = render({ moveTargets: [target, { ...target, source: 'local', name: 'Lokal', menuName: 'lokalem Speicher', targetPhrase: 'zum lokalen Speicher', hint: 'Wartet', disabled: true }] })
    const children = groupsOf(wrapper)[0]![0]!.children!
    expect(children.map(item => item.label)).toEqual(['Notion', 'lokalem Speicher'])
    expect(children[1]!.disabled).toBe(true)
    expect(children[1]!.description).toBe('Wartet')
    children[0]!.onSelect!()
    expect(wrapper.emitted('move')).toEqual([['notion']])
  })

  it('a task that cannot be deleted shows no Delete; the task\'s own entries keep the button (#846)', () => {
    const labels = (wrapper: ReturnType<typeof render>) => groupsOf(wrapper).map(group => group.map(item => item.label))
    expect(labels(render({ openLabel: 'In Reminders öffnen', deleteLabel: null }))).toEqual([['In Reminders öffnen'], ['Ad-hoc/Ungeplant', 'ID kopieren']])
    const readOnly = render({ deleteLabel: null })
    expect(labels(readOnly)).toEqual([['Ad-hoc/Ungeplant', 'ID kopieren']])
    expect(readOnly.find('[data-testid="task-menu"]').exists()).toBe(true)
  })

  it('the trigger is named for screen readers', () => {
    expect(render({}).get('[data-testid="task-menu"]').attributes('aria-label')).toBe('Aufgabenmenü')
  })
})
