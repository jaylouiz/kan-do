import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TaskSheetActions from '~/components/task/TaskSheetActions.vue'
import type { MoveTarget } from '~/composables/useTaskMoveTargets'

const UButton = { inheritAttrs: false, emits: ['click'], template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>' }
const UDropdownMenu = { props: ['items'], template: '<div data-testid="menu"><slot /></div>' }

const target: MoveTarget = { source: 'notion', name: 'Notion', icon: 'i-ph-notion', hint: '', disabled: false }

const render = (props: { openLabel?: string | null; moveTargets?: MoveTarget[]; deleteLabel?: string }) =>
  mount(TaskSheetActions, {
    props: { moveTargets: [], deleteLabel: 'Löschen', ...props },
    global: { stubs: { UButton, UDropdownMenu } },
  })

describe('TaskSheetActions (#244)', () => {
  it('Local board: Delete alone, which only emits', async () => {
    const wrapper = render({})
    expect(wrapper.findAll('button').map(b => b.text())).toEqual(['Löschen'])
    await wrapper.get('[data-testid="task-delete"]').trigger('click')
    expect(wrapper.emitted('delete')).toHaveLength(1)
  })

  it('Notion board: open in source, move to source, Delete last', async () => {
    const wrapper = render({ openLabel: 'In Notion öffnen', moveTargets: [target], deleteLabel: 'Löschen, auch in Notion' })
    const buttons = wrapper.findAll('button')
    expect(buttons.map(b => b.attributes('data-testid'))).toEqual(['task-open-source', 'task-move-source', 'task-delete'])
    expect(buttons[0]!.text()).toBe('In Notion öffnen')
    expect(buttons[2]!.text()).toBe('Löschen, auch in Notion')
    await buttons[0]!.trigger('click')
    expect(wrapper.emitted('open')).toHaveLength(1)
  })

  it('the move menu lists the targets and emits the chosen source; disabled targets stay disabled', () => {
    const wrapper = render({ moveTargets: [target, { ...target, source: 'todoist', name: 'Todoist', hint: 'Wartet', disabled: true }] })
    const items = (wrapper.getComponent(UDropdownMenu).props('items') as Array<Array<{ label: string; disabled: boolean; description?: string; onSelect: () => void }>>)[0]!
    expect(items.map(i => i.label)).toEqual(['Notion', 'Todoist'])
    expect(items[1]!.disabled).toBe(true)
    expect(items[1]!.description).toBe('Wartet')
    items[0]!.onSelect()
    expect(wrapper.emitted('move')).toEqual([['notion']])
  })
})
