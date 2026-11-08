import { describe, it, expect, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import NewCardOptionList from '~/components/board/NewCardOptionList.vue'

const stubs = {
  TopicMark: true,
  UIcon: true,
  UInput: {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    setup(_: unknown, { expose }: { expose: (e: Record<string, unknown>) => void }) {
      const inputRef = ref<HTMLInputElement | null>(null)
      expose({ inputRef })
      return { inputRef }
    },
    template: '<input ref="inputRef" :value="modelValue" v-bind="$attrs" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
}

const local = { maxLength: null, stripCommas: false }
const notion = { maxLength: 100, stripCommas: true }

let w: VueWrapper
const mountList = (props: Record<string, unknown> = {}) => {
  w = mount(NewCardOptionList, {
    props: {
      values: ['Büro', 'Kunde A', 'Kunde B'],
      all: ['Design', 'Backend', 'Marketing', 'Büro', 'Kunde A', 'Kunde B'],
      current: null,
      searchable: true,
      newValues: local,
      showMark: true,
      label: 'Thema?',
      optionLabel: (value: string) => value,
      ...props,
    },
    global: { stubs },
    attachTo: document.body,
  })
  return w
}
const search = () => w.get('[data-testid="new-card-search"]')
const names = () => w.findAll('button').map((button) => button.text())

afterEach(() => w?.unmount())

describe('NewCardOptionList (#16)', () => {
  it('lists the values behind the pills and filters them by the typed text, any case', async () => {
    mountList()
    expect(names()).toEqual(['Büro', 'Kunde A', 'Kunde B'])
    await search().setValue('KUNDE')
    expect(names()).toEqual(['Neu: „KUNDE“', 'Kunde A', 'Kunde B'])
  })

  it('shows "Neu" only when no value has that name, pills included', async () => {
    mountList()
    await search().setValue('design')
    expect(w.find('[data-testid="new-card-new"]').exists()).toBe(false)
    expect(w.find('[data-testid="new-card-no-match"]').exists()).toBe(false) // an existing value, only a pill
    await search().setValue('Design 2')
    expect(w.get('[data-testid="new-card-new"]').text()).toBe('Neu: „Design 2“')
  })

  it('shows the text a Notion value is created with: commas become spaces, the name is cut at 100 characters', async () => {
    mountList({ newValues: notion })
    await search().setValue('A, B')
    expect(w.get('[data-testid="new-card-new"]').text()).toBe('Neu: „A B“')
    await search().setValue('x'.repeat(130))
    expect(w.get('[data-testid="new-card-new"]').text()).toBe(`Neu: „${'x'.repeat(100)}“`)
  })

  it('without free values the field only searches: no "Neu" row, a status line when nothing matches', async () => {
    mountList({ newValues: null })
    await search().setValue('xyz')
    expect(w.find('[data-testid="new-card-new"]').exists()).toBe(false)
    expect(w.get('[data-testid="new-card-no-match"]').text()).toBe('Keine Treffer gefunden.')
    expect(search().attributes('placeholder')).toBe('Suchen …')
  })

  it('Enter picks the exact match, else the first match, else creates the text; a partial match never creates by accident', async () => {
    mountList()
    await search().setValue('Frisch')
    await search().trigger('keydown', { key: 'Enter' })
    expect(w.emitted('create')).toEqual([['Frisch']])
    await search().setValue('kunde b')
    await search().trigger('keydown', { key: 'Enter' })
    expect(w.emitted('pick')).toEqual([['Kunde B']])
    await search().setValue('kun')
    await search().trigger('keydown', { key: 'Enter' })
    expect(w.emitted('create')).toHaveLength(1)
    expect(w.emitted('pick')![1]).toEqual(['Kunde A'])
    // the "Neu" row is still one arrow key away
    ;(search().element as HTMLInputElement).focus()
    await search().trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement).toBe(w.get('[data-testid="new-card-new"]').element)
  })

  it('without a search field (Timebox) it is the plain list of the values', () => {
    mountList({ searchable: false, newValues: null, values: ['15', '30'], optionLabel: (value: string) => `${value} min`, showMark: false })
    expect(w.find('[data-testid="new-card-search"]').exists()).toBe(false)
    expect(names()).toEqual(['15 min', '30 min'])
  })

  it('arrows walk field and options with wrapping; Home and End keep their caret job in the field', async () => {
    mountList()
    const input = search().element as HTMLInputElement
    input.focus()
    await search().trigger('keydown', { key: 'ArrowDown' })
    const buttons = w.findAll('button').map((b) => b.element)
    expect(document.activeElement).toBe(buttons[0])
    await w.get('[data-testid="new-card-more-list"]').trigger('keydown', { key: 'ArrowUp' })
    expect(document.activeElement).toBe(input)
    await search().trigger('keydown', { key: 'ArrowUp' })
    expect(document.activeElement).toBe(buttons[buttons.length - 1])
    // Home inside the field is not handled (caret key)
    input.focus()
    const home = new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true })
    input.dispatchEvent(home)
    expect(home.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(input)
    // End from an option jumps to the last one
    buttons[0]!.focus()
    await w.get('[data-testid="new-card-more-list"]').trigger('keydown', { key: 'End' })
    expect(document.activeElement).toBe(buttons[buttons.length - 1])
  })
})
