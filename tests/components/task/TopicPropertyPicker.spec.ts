import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import TopicPropertyPicker from '~/components/task/TopicPropertyPicker.vue'
import { useTasksStore } from '~/store/tasks'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

// Wraps the real composable to count `countOf` calls (#461: once per edit row per render)
const countOfCalls = vi.hoisted(() => ({ n: 0 }))
vi.mock('~/composables/useTopicManagement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/composables/useTopicManagement')>()
  return {
    ...actual,
    useTopicManagement: (...args: Parameters<typeof actual.useTopicManagement>) => {
      const api = actual.useTopicManagement(...args)
      return { ...api, countOf: (...a: Parameters<typeof api.countOf>) => { countOfCalls.n++; return api.countOf(...a) } }
    },
  }
})

/**
 * The picker wrapper (#443): edit mode in the footer, one button row per name, mode reset on reopen. The shared
 * TaskPropertySelect is stubbed with an open/close surface that renders its slots, so the wrapper's own logic is what runs.
 */

const task = (id: string, topic: string | null): Task => ({
  id, source: 'local', externalId: null, title: id, status: TaskStatus.Open, activity: topic, topic, topicColorCode: null,
  priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null,
})

/** Renders the slots the wrapper fills and exposes the props it passes down; `open` is the v-model:open of the real picker. */
const SelectStub = defineComponent({
  name: 'TaskPropertySelect',
  props: ['items', 'searchPlaceholder', 'clearLabel', 'createItem', 'pickerUi', 'open', 'label', 'modelValue'],
  emits: ['update:open'],
  setup(props, { slots, emit }) {
    // `data-has-extra` tells whether the wrapper passes a footer slot at all (TaskPropertySelect renders its band for it)
    return () => h('div', { 'data-stub': 'select', 'data-has-extra': String(Boolean(slots['content-extra'])) }, [
      h('button', { 'data-testid': 'trigger', onClick: () => emit('update:open', !props.open) }),
      slots['value-leading'] ? h('span', { 'data-testid': 'value-leading' }, slots['value-leading']()) : null,
      props.open ? h('div', { 'data-testid': 'content' }, [slots['content-top']?.(), slots['content-extra']?.({})]) : null,
    ])
  },
})
const ButtonStub = defineComponent({
  name: 'UButton',
  props: ['label', 'icon', 'to'],
  setup(props, { attrs }) {
    return () => h('button', { type: 'button', ...attrs, 'data-icon': props.icon }, props.label)
  },
})

function mountPicker(props: Record<string, unknown> = {}) {
  return mount(TopicPropertyPicker, {
    props: { kind: 'topic', label: 'Thema', modelValue: 'Wrk', items: ['Home', 'Wrk'], ...props },
    global: { stubs: { TaskPropertySelect: SelectStub, UButton: ButtonStub, UIcon: true, TopicMark: true } },
  })
}
const mountedMark = (w: ReturnType<typeof mountPicker>) => w.find('[data-testid="value-leading"]')
const open = (w: ReturnType<typeof mountPicker>) => w.get('[data-testid="trigger"]').trigger('click')
const toggle = (w: ReturnType<typeof mountPicker>) => w.get('[data-testid="topic-edit-toggle"]')

describe('TopicPropertyPicker edit mode (#443)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useTasksStore().setTasks([task('a', 'Wrk'), task('b', 'Wrk'), task('c', 'Home')])
  })

  it('opens in picking mode: "Bearbeiten" and "Themen verwalten" in the footer, no rows, the list passed through', async () => {
    const w = mountPicker()
    await open(w)
    expect(toggle(w).text()).toBe('Bearbeiten')
    expect(toggle(w).attributes('aria-pressed')).toBeUndefined()
    expect(w.find('[data-testid="topic-manage-link"]').exists()).toBe(true)
    expect(w.find('[data-picker-edit-row]').exists()).toBe(false)
    expect(w.getComponent(SelectStub).props('items')).toEqual(['Home', 'Wrk'])
  })

  it('edit mode: rows with the name, the usage count and a screen-reader suffix; the list, search, create and clear go away', async () => {
    const w = mountPicker({ searchPlaceholder: 'Suchen', clearLabel: 'Thema entfernen', createItem: true })
    await open(w)
    await toggle(w).trigger('click')
    expect(toggle(w).text()).toBe('Fertig')
    expect(toggle(w).attributes('data-icon')).toBe('i-ph-check')
    const rows = w.findAll('[data-picker-edit-row]')
    expect(rows.map((r) => r.text().replace(/\s+/g, ' '))).toEqual(['Home 1 Aufgabe bearbeiten', 'Wrk 2 Aufgaben bearbeiten'])
    expect(rows.every((r) => r.element.tagName === 'BUTTON')).toBe(true)
    expect(w.get('ul').attributes('aria-labelledby')).toBe(w.get('p').attributes('id'))
    expect(w.get('p').text()).toBe('Thema bearbeiten')
    const select = w.getComponent(SelectStub)
    expect(select.props('items')).toEqual([])
    expect(select.props('searchPlaceholder')).toBeUndefined()
    expect(select.props('clearLabel')).toBeUndefined()
    expect(select.props('createItem')).toBe(false)
    // No empty listbox / empty message left in the mode
    expect(select.props('pickerUi')).toEqual({ viewport: 'hidden', empty: 'hidden' })
    expect(w.find('[data-testid="topic-manage-link"]').exists()).toBe(false)
  })

  it('Bearbeiten -> Fertig -> Bearbeiten -> Fertig returns to the plain picker each time', async () => {
    const w = mountPicker({ searchPlaceholder: 'Suchen' })
    await open(w)
    for (let round = 0; round < 2; round++) {
      await toggle(w).trigger('click')
      expect(w.findAll('[data-picker-edit-row]')).toHaveLength(2)
      await toggle(w).trigger('click')
      expect(w.find('[data-picker-edit-row]').exists()).toBe(false)
      expect(toggle(w).text()).toBe('Bearbeiten')
      expect(w.getComponent(SelectStub).props('searchPlaceholder')).toBe('Suchen')
      expect(w.getComponent(SelectStub).props('pickerUi')).toBeUndefined()
    }
  })

  it('the mode does not survive a close: a reopen starts in picking mode (Escape, outside click and a pick all just close)', async () => {
    const w = mountPicker()
    await open(w)
    await toggle(w).trigger('click')
    await open(w) // closes
    expect(w.find('[data-testid="content"]').exists()).toBe(false)
    await open(w)
    expect(toggle(w).text()).toBe('Bearbeiten')
    expect(w.find('[data-picker-edit-row]').exists()).toBe(false)
  })

  it('the mode is kept while the popover closes (the exit animation must not re-render the search field and steal focus)', async () => {
    const w = mountPicker()
    await open(w)
    await toggle(w).trigger('click')
    w.getComponent(SelectStub).vm.$emit('update:open', false)
    await w.vm.$nextTick()
    expect(w.getComponent(SelectStub).props('items')).toEqual([])
  })

  it('a row emits edit with the name, closes the picker and blurs itself first', async () => {
    const w = mountPicker({ kind: 'activity' })
    document.body.appendChild(w.element)
    await open(w)
    await w.get('[data-testid="activity-edit-toggle"]').trigger('click')
    const row = w.findAll('[data-picker-edit-row]')[1]!
    ;(row.element as HTMLElement).focus()
    expect(document.activeElement).toBe(row.element)
    await row.trigger('click')
    expect(w.emitted('edit')).toEqual([['Wrk']])
    expect(document.activeElement).not.toBe(row.element)
    expect(w.getComponent(SelectStub).props('open')).toBe(false)
    w.unmount()
  })

  it('an empty list hides "Bearbeiten" (the create row of the picker stays), one option gives one row, the last name vanishing leaves the mode', async () => {
    const empty = mountPicker({ items: [], createItem: true })
    await open(empty)
    expect(empty.find('[data-testid="topic-edit-toggle"]').exists()).toBe(false)
    expect(empty.find('[data-testid="topic-manage-link"]').exists()).toBe(true)
    expect(empty.getComponent(SelectStub).props('createItem')).toBe(true)

    const one = mountPicker({ items: ['Home'] })
    await open(one)
    await toggle(one).trigger('click')
    expect(one.findAll('[data-picker-edit-row]')).toHaveLength(1)
    await one.setProps({ items: [] })
    expect(one.find('[data-picker-edit-row]').exists()).toBe(false)
    expect(one.find('[data-testid="topic-edit-toggle"]').exists()).toBe(false)
  })

  it('editable false (add dialog preview): the plain picker, no "Bearbeiten", no "Themen verwalten"', async () => {
    const w = mountPicker({ editable: false })
    await open(w)
    expect(w.find('[data-testid="topic-edit-toggle"]').exists()).toBe(false)
    expect(w.find('[data-testid="topic-manage-link"]').exists()).toBe(false)
    expect(w.getComponent(SelectStub).props('items')).toEqual(['Home', 'Wrk'])
  })

  it('an activity picker uses the activity wording and has no "Themen verwalten"', async () => {
    const w = mountPicker({ kind: 'activity', label: 'Aktivität' })
    await open(w)
    await w.get('[data-testid="activity-edit-toggle"]').trigger('click')
    expect(w.get('p').text()).toBe('Aktivität bearbeiten')
    await w.get('[data-testid="activity-edit-toggle"]').trigger('click')
    expect(w.find('[data-testid="topic-manage-link"]').exists()).toBe(false)
  })

  it('an empty activity picker passes no footer slot, so no empty band follows "Keine Daten" (#461)', async () => {
    const empty = mountPicker({ kind: 'activity', label: 'Aktivität', items: [], modelValue: null })
    await open(empty)
    expect(empty.get('[data-stub="select"]').attributes('data-has-extra')).toBe('false')
    // The topic picker keeps its footer for "Themen verwalten"; a non-empty activity list keeps it for "Bearbeiten"
    const emptyTopic = mountPicker({ items: [] })
    expect(emptyTopic.get('[data-stub="select"]').attributes('data-has-extra')).toBe('true')
    const activity = mountPicker({ kind: 'activity', label: 'Aktivität' })
    expect(activity.get('[data-stub="select"]').attributes('data-has-extra')).toBe('true')
  })

  it('edit rows count each name once per render (#461)', async () => {
    const w = mountPicker()
    await open(w)
    countOfCalls.n = 0
    await toggle(w).trigger('click')
    expect(w.findAll('[data-picker-edit-row]')).toHaveLength(2)
    expect(countOfCalls.n).toBe(2)
  })

  it('the topic mark sits inside the select through the value-leading slot, only for a set topic (#114)', () => {
    expect(mountedMark(mountPicker()).exists()).toBe(true)
    expect(mountedMark(mountPicker({ modelValue: null })).exists()).toBe(false)
    expect(mountedMark(mountPicker({ modelValue: undefined })).exists()).toBe(false)
    expect(mountedMark(mountPicker({ kind: 'activity', label: 'Aktivität' })).exists()).toBe(false)
  })
})
