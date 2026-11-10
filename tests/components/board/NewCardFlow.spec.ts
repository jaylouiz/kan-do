import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import { toastAddMock } from '~/tests/mocks/nuxt-imports'
import NewCardFlow from '~/components/board/NewCardFlow.vue'

vi.mock('nuxt/app', () => ({ navigateTo: vi.fn(), useRoute: () => ({ query: {}, name: 'tasks' }) }))

const tasks = vi.hoisted(() => ({ list: [] as Array<{ topic: string | null; activity: string | null }> }))
vi.mock('~/store/tasks', () => ({ useTasksStore: () => ({ get tasks() { return tasks.list } }) }))
const options = vi.hoisted(() => ({ topics: [] as string[], activities: [] as string[] }))
vi.mock('~/store/propertyOptions', () => ({
  usePropertyOptionsStore: () => ({
    get getTopicOptions() { return options.topics },
    get getActivityOptions() { return options.activities },
  }),
}))
vi.mock('~/store/notionConfig', () => ({ useNotionConfigStore: () => ({ config: null }) }))

const target = vi.hoisted(() => ({ source: 'local' as string }))
vi.mock('~/composables/useAddTarget', () => ({ useAddTarget: () => ({ defaultSource: { get value() { return target.source } } }) }))
const sync = vi.hoisted(() => ({ createTask: vi.fn() }))
vi.mock('~/composables/useTaskSync', () => ({ useTaskSync: () => ({ createTask: sync.createTask }) }))
const errors = vi.hoisted(() => ({ handleError: vi.fn() }))
vi.mock('~/composables/useErrorHandler', () => ({ useErrorHandler: () => errors }))
vi.mock('~/composables/useTimeboxSuggestion', () => ({ useTimeboxSuggestion: () => ({ calculateSuggestion: () => null }) }))
vi.mock('~/composables/usePropertyOptionsSync', () => ({ usePropertyOptionsSync: () => ({ ensureOptionsAvailable: vi.fn() }) }))
const topicColor = vi.hoisted(() => ({ colors: {} as Record<string, string> }))
vi.mock('~/composables/useTopicColor', () => ({
  useTopicColor: () => ({ colorCodeFor: (topic: string | null, source: string) => (source === 'todoist' ? null : topicColor.colors[topic ?? ''] ?? null) }),
}))
vi.mock('~/composables/useIsDesktop', () => ({ useIsDesktop: () => ref(true), isPhoneNow: () => false }))

const stubs = {
  TaskCard: { props: ['task'], template: '<div class="task-face" :data-title="task.title" :data-topic="task.topic" :data-color="task.topicColorCode"><p class="task-title-text" /></div>' },
  TopicMark: true,
  UIcon: true,
  // The real UButton is a Nuxt UI component the unit environment does not register: a native button with the same disabled behaviour.
  UButton: { props: ['disabled', 'color', 'variant', 'size'], template: '<button v-bind="$attrs" :disabled="disabled"><slot /></button>' },
  UPopover: { template: '<div><slot /><slot name="content" /></div>' },
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
  UDrawer: true,
  Transition: { template: '<slot />' },
}

let w: VueWrapper
const mountFlow = () => {
  w = mount(NewCardFlow, { global: { stubs }, attachTo: document.body })
  return w
}
const title = () => w.get('[data-testid="new-card-title"]')
const stepKey = () => w.find('[data-testid="new-card-step"]').attributes('data-step')
const pressOnPanel = (key: string) => w.get('[data-testid="new-card-step"]').trigger('keydown', { key })

async function confirmTitle(text = 'Angebot schreiben') {
  await title().setValue(text)
  await w.get('form').trigger('submit')
  await nextTick()
}
/** A pick advances after a short beat (200 ms, 0 under reduced motion) */
async function afterPick() {
  await vi.advanceTimersByTimeAsync(250)
  await nextTick()
}

beforeEach(() => {
  vi.useFakeTimers()
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  tasks.list = [
    { topic: 'Design', activity: 'Planung' },
    { topic: 'Design', activity: 'Planung' },
    { topic: 'Backend', activity: 'Entwicklung' },
    { topic: 'Büro', activity: 'Abstimmung' },
  ]
  options.topics = ['Büro', 'Backend', 'Design']
  options.activities = ['Abstimmung', 'Entwicklung', 'Planung']
  target.source = 'local'
  topicColor.colors = { Design: '#6366f1' }
  sync.createTask.mockReset()
  sync.createTask.mockImplementation(async (draft: Record<string, unknown>) => ({ ...draft, id: 'local_1' }))
  errors.handleError.mockReset()
  toastAddMock.mockReset()
})
afterEach(() => {
  w?.unmount()
  vi.useRealTimers()
})

describe('NewCardFlow (#649)', () => {
  it('starts on the title with the check disabled while it is blank', async () => {
    mountFlow()
    expect(w.get('[data-testid="new-card-confirm-title"]').attributes('disabled')).toBeDefined()
    expect(w.find('[data-testid="new-card-step"]').exists()).toBe(false)
    await title().setValue('  ')
    expect(w.get('[data-testid="new-card-confirm-title"]').attributes('disabled')).toBeDefined()
    await title().setValue('Etwas')
    expect(w.get('[data-testid="new-card-confirm-title"]').attributes('disabled')).toBeUndefined()
  })

  it('walks Thema, Aktivität, Timebox and Notiz with the keys and saves the picked values', async () => {
    mountFlow()
    await confirmTitle()
    expect(stepKey()).toBe('topic')
    // Design is the most used topic: key 1
    await pressOnPanel('1')
    await afterPick()
    expect(stepKey()).toBe('activity')
    // Planung leads under Design; key 2 = the second suggestion
    const pills = w.get('[data-testid="new-card-options"]').findAll('button.ncf__pill')
    expect(pills[0]!.text()).toContain('Planung')
    await pressOnPanel('2')
    await afterPick()
    expect(stepKey()).toBe('timebox')
    await pressOnPanel('2') // 30 min
    await afterPick()
    expect(stepKey()).toBe('notes')
    await w.get('[data-testid="new-card-notes"]').setValue('Mit Preisliste')
    await w.get('form.ncf__row').trigger('submit')
    await flushPromises()

    expect(sync.createTask).toHaveBeenCalledTimes(1)
    const [draft, source] = sync.createTask.mock.calls[0]!
    expect(source).toBe('local')
    expect(draft).toMatchObject({ title: 'Angebot schreiben', status: 0, topic: 'Design', topicColorCode: '#6366f1', timeBoxSeconds: 1800, notes: 'Mit Preisliste', priority: 2 })
    expect(draft.activity).toBe(pills[1]!.text().replace(/\s*2$/, '').trim())
    expect(w.emitted('saved')![0]).toEqual(['local_1'])
    expect(toastAddMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Aufgabe hinzugefügt' }))
    // One row (title and Details): no description line that wraps over the saved card at 390 px (#665)
    expect(toastAddMock.mock.calls[0]![0]).not.toHaveProperty('description')
  })

  it('skip keeps a field empty; an empty note saves without one', async () => {
    mountFlow()
    await confirmTitle()
    await pressOnPanel('Enter') // skip Thema
    await pressOnPanel('Enter') // skip Aktivität
    await pressOnPanel('Enter') // skip Timebox
    expect(stepKey()).toBe('notes')
    await w.get('form.ncf__row').trigger('submit')
    await flushPromises()
    expect(sync.createTask.mock.calls[0]![0]).toMatchObject({ topic: null, activity: null, timeBoxSeconds: null, notes: null })
  })

  it('a held key does not skip through the steps', async () => {
    mountFlow()
    await confirmTitle()
    await w.get('[data-testid="new-card-step"]').trigger('keydown', { key: 'Enter', repeat: true })
    await w.get('[data-testid="new-card-step"]').trigger('keydown', { key: '1', repeat: true })
    expect(stepKey()).toBe('topic')
    await pressOnPanel('Enter')
    expect(stepKey()).toBe('activity')
  })

  it('a held Esc does not walk back through the steps or cancel the card', async () => {
    mountFlow()
    await confirmTitle('Bleibt')
    await pressOnPanel('Enter')
    expect(stepKey()).toBe('activity')
    const panel = () => w.get('[data-testid="new-card-step"]')
    await panel().trigger('keydown', { key: 'Escape', repeat: true })
    await panel().trigger('keydown', { key: 'Escape', repeat: true })
    expect(stepKey()).toBe('activity')
    await pressOnPanel('Escape')
    expect(stepKey()).toBe('topic')
    await pressOnPanel('Escape')
    await title().trigger('keydown', { key: 'Escape', repeat: true })
    expect(w.emitted('cancel')).toBeUndefined()
    expect((title().element as HTMLInputElement).value).toBe('Bleibt')
  })

  it('Enter right after a pick moves on one step only and never saves from Timebox', async () => {
    mountFlow()
    await confirmTitle()
    await pressOnPanel('Enter') // Thema
    await pressOnPanel('Enter') // Aktivität
    expect(stepKey()).toBe('timebox')
    await pressOnPanel('2') // pick: the advance timer is pending
    await pressOnPanel('Enter')
    expect(stepKey()).toBe('notes')
    await afterPick() // the pending timer must not advance again from Notiz
    expect(stepKey()).toBe('notes')
    expect(sync.createTask).not.toHaveBeenCalled()
  })

  it('Esc right after a pick goes back and the pending advance does not undo it', async () => {
    mountFlow()
    await confirmTitle()
    await pressOnPanel('Enter') // Thema skipped
    expect(stepKey()).toBe('activity')
    await pressOnPanel('1') // pick: the advance timer is pending
    await pressOnPanel('Escape')
    expect(stepKey()).toBe('topic')
    await afterPick()
    expect(stepKey()).toBe('topic')
  })

  it('Esc steps back one step keeping the input; on the title step it cancels', async () => {
    mountFlow()
    await confirmTitle('Bleibt')
    await pressOnPanel('Enter')
    expect(stepKey()).toBe('activity')
    await pressOnPanel('Escape')
    expect(stepKey()).toBe('topic')
    await pressOnPanel('Escape')
    expect(w.find('[data-testid="new-card-step"]').exists()).toBe(false)
    expect((title().element as HTMLInputElement).value).toBe('Bleibt')
    await title().trigger('keydown', { key: 'Escape' })
    expect(w.emitted('cancel')).toHaveLength(1)
  })

  it('#668: the title field follows the face title down under the topic row after Thema and back', async () => {
    mountFlow()
    // jsdom has no layout: the face's title stands 30 px down once a topic row exists, like a card
    const layout = vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('task-title-text') ? (w.get('.task-face').attributes('data-topic') ? 30 : 8) : 0
    })
    const parent = vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('task-title-text') ? w.get('[data-testid="new-card-flow"]').element : null
    })
    await confirmTitle()
    await pressOnPanel('1') // Thema Design
    await afterPick()
    await pressOnPanel('Escape') // Aktivität → Thema
    await pressOnPanel('Escape') // Thema → title
    const form = w.get('.ncf__title-form').element as HTMLElement
    expect(form.style.getPropertyValue('--ncf-title-top')).toBe('30px')
    layout.mockRestore()
    parent.mockRestore()
  })

  it('#665: line breaks never enter the title, Enter confirms and Shift+Enter does not break the line', async () => {
    mountFlow()
    await title().setValue('Erste\nZweite  \r\n  Dritte')
    expect((title().element as HTMLTextAreaElement).value).toBe('Erste Zweite Dritte')
    await title().trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(w.find('[data-testid="new-card-step"]').exists()).toBe(false)
    await title().trigger('keydown', { key: 'Enter' })
    await nextTick()
    expect(stepKey()).toBe('topic')
  })

  it('#665: the title field grows with its text', async () => {
    mountFlow()
    const el = title().element as HTMLTextAreaElement
    Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 64 })
    await title().setValue('Ein sehr langer Titel, der in der Karte umbricht und gelesen werden soll')
    expect(el.style.height).toBe('64px')
  })

  it('#668: the Enter that commits an IME composition does not confirm the title (WebKit: isComposing false, keyCode 229)', async () => {
    mountFlow()
    await title().setValue('にほん')
    await title().trigger('keydown', { key: 'Enter', isComposing: true })
    await title().trigger('keydown', { key: 'Enter', keyCode: 229 })
    await nextTick()
    expect(w.find('[data-testid="new-card-step"]').exists()).toBe(false)
    await title().trigger('keydown', { key: 'Enter' })
    await nextTick()
    expect(stepKey()).toBe('topic')
  })

  it('#668: the field is never taller than the face title, which is what the card shows of a long title', async () => {
    mountFlow()
    const el = title().element as HTMLTextAreaElement
    Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 117 })
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { height: this.classList.contains('task-title-text') ? 58.5 : 0 } as DOMRect
    })
    await title().setValue('Ein sehr langer Titel, den die Karte nach drei Zeilen abschneidet, weil unter dem Thema nicht mehr Platz ist')
    expect(el.style.maxHeight).toBe('58.5px')
    rect.mockRestore()
  })

  it('#665: Esc on a typed title hands it to the slot, a blank one cancels without a draft', async () => {
    mountFlow()
    await title().trigger('keydown', { key: 'Escape' })
    expect(w.emitted('cancel')![0]).toEqual([undefined])
    await title().setValue('  Tippfehler  ')
    await title().trigger('keydown', { key: 'Escape' })
    expect(w.emitted('cancel')![1]).toEqual([{ title: 'Tippfehler' }])
  })

  it('#665: the card opens with an initial title, caret at the end', async () => {
    w = mount(NewCardFlow, { props: { initialTitle: 'Zurück' }, global: { stubs }, attachTo: document.body })
    await nextTick()
    expect((title().element as HTMLTextAreaElement).value).toBe('Zurück')
    expect(w.get('.task-face').attributes('data-title')).toBe('Zurück')
  })

  it('#665: Cmd/Ctrl+Enter saves what is entered from the title step and from a choice step', async () => {
    mountFlow()
    await title().trigger('keydown', { key: 'Enter', ctrlKey: true })
    await flushPromises()
    expect(sync.createTask).not.toHaveBeenCalled() // a blank title saves nothing
    await title().setValue('Sofort')
    await title().trigger('keydown', { key: 'Enter', ctrlKey: true })
    await flushPromises()
    expect(sync.createTask).toHaveBeenCalledTimes(1)
    expect(sync.createTask.mock.calls[0]![0]).toMatchObject({ title: 'Sofort', topic: null, notes: null })
    expect(w.emitted('saved')![0]).toEqual(['local_1'])
    w.unmount()

    sync.createTask.mockClear()
    mountFlow()
    await confirmTitle('Mit Thema')
    await pressOnPanel('1') // pick: its advance is pending
    await w.get('[data-testid="new-card-step"]').trigger('keydown', { key: 'Enter', metaKey: true })
    await flushPromises()
    await afterPick() // the pending advance must not fire a second save
    expect(sync.createTask).toHaveBeenCalledTimes(1)
    expect(sync.createTask.mock.calls[0]![0]).toMatchObject({ title: 'Mit Thema', topic: 'Design' })
  })

  it('#665: a held Cmd/Ctrl+Enter saves once and a failed save keeps the card where it was', async () => {
    sync.createTask.mockRejectedValueOnce(new Error('offline'))
    mountFlow()
    await title().setValue('Bleibt')
    await title().trigger('keydown', { key: 'Enter', ctrlKey: true })
    await title().trigger('keydown', { key: 'Enter', ctrlKey: true, repeat: true })
    await flushPromises()
    expect(sync.createTask).toHaveBeenCalledTimes(1)
    expect(w.emitted('saved')).toBeUndefined()
    expect((title().element as HTMLTextAreaElement).value).toBe('Bleibt')
    await title().trigger('keydown', { key: 'Enter', ctrlKey: true })
    await flushPromises()
    expect(sync.createTask).toHaveBeenCalledTimes(2)
    expect(w.emitted('saved')).toHaveLength(1)
  })

  it('shows the topic on the face behind the wash once it is picked', async () => {
    mountFlow()
    await confirmTitle()
    expect(w.get('.task-face').attributes('data-topic')).toBeUndefined()
    await pressOnPanel('1')
    expect(w.get('.task-face').attributes('data-topic')).toBe('Design')
    expect(w.get('.task-face').attributes('data-title')).toBe('Angebot schreiben')
    // the colour its siblings with the topic show, already on the face (#672)
    expect(w.get('.task-face').attributes('data-color')).toBe('#6366f1')
  })

  it('#672: a topic without a colour saves without one', async () => {
    topicColor.colors = {}
    mountFlow()
    await confirmTitle()
    await pressOnPanel('1')
    expect(w.get('.task-face').attributes('data-color')).toBeUndefined()
    await afterPick()
    await pressOnPanel('Enter')
    await pressOnPanel('Enter')
    await w.get('form.ncf__row').trigger('submit')
    await flushPromises()
    expect(sync.createTask.mock.calls[0]![0]).toMatchObject({ topic: 'Design', topicColorCode: null })
  })

  it('kd#16: Thema and Aktivität show up to three pills and the Mehr cell (key 4); Timebox shows three pills and "···" (key 4, kd#119)', async () => {
    mountFlow()
    await confirmTitle()
    const pills = () => w.get('[data-testid="new-card-options"]').findAll('button.ncf__pill:not(.ncf__pill--more)')
    expect(pills().map((pill) => pill.text())).toEqual(['Design', 'Backend', 'Büro'].map((v) => expect.stringContaining(v)))
    expect(pills().map((pill) => pill.attributes('aria-keyshortcuts'))).toEqual(['1', '2', '3'])
    const more = w.get('[data-testid="new-card-more"]')
    expect(more.classes()).toContain('choice-chip--field')
    expect(more.text()).toBe('Mehr')
    expect(more.attributes('aria-keyshortcuts')).toBe('4')
    await pressOnPanel('Enter')
    expect(w.get('[data-testid="new-card-more"]').attributes('aria-keyshortcuts')).toBe('4')
    await pressOnPanel('Enter')
    expect(stepKey()).toBe('timebox')
    expect(pills().map((pill) => pill.text())).toEqual(['15 min', '30 min', '60 min'].map((v) => expect.stringContaining(v)))
    expect(w.get('[data-testid="new-card-more"]').attributes('aria-keyshortcuts')).toBe('4')
    expect(w.get('[data-testid="new-card-more"]').classes()).not.toContain('choice-chip--field')
  })

  it('kd#16: key 3 picks the third value; with one value Mehr stays for the new one, a step without values is still skipped', async () => {
    mountFlow()
    await confirmTitle()
    await pressOnPanel('3') // the third topic by use: Büro
    expect(w.get('.task-face').attributes('data-topic')).toBe('Büro')
    w.unmount()

    options.topics = ['Design']
    tasks.list = [{ topic: 'Design', activity: null }]
    options.activities = []
    mountFlow()
    await confirmTitle()
    expect(stepKey()).toBe('topic')
    expect(w.find('[data-testid="new-card-more"]').exists()).toBe(true)
    await pressOnPanel('Enter')
    expect(stepKey()).toBe('timebox') // no activities at all: the step is not asked
  })

  it('kd#16: a source without free values shows no Mehr cell when three values fit the pills', async () => {
    target.source = 'todoist'
    mountFlow()
    await confirmTitle()
    expect(stepKey()).toBe('topic')
    expect(w.find('[data-testid="new-card-more"]').exists()).toBe(false)
    w.unmount()

    options.topics = ['A', 'B', 'C', 'D']
    mountFlow()
    await confirmTitle()
    expect(w.find('[data-testid="new-card-more"]').exists()).toBe(true) // the fourth value is behind Mehr, search only
    expect(w.find('[data-testid="new-card-new"]').exists()).toBe(false)
  })

  it('kd#16: a new topic typed into the Mehr list is picked and saved as typed', async () => {
    mountFlow()
    await confirmTitle()
    const search = w.get('[data-testid="new-card-search"]')
    await search.setValue('  Frisch  ')
    expect(w.get('[data-testid="new-card-new"]').text()).toBe('Neu: „Frisch“')
    await search.trigger('keydown', { key: 'Enter' })
    await afterPick()
    expect(stepKey()).toBe('activity')
    await pressOnPanel('Enter')
    await pressOnPanel('Enter')
    await w.get('form.ncf__row').trigger('submit')
    await flushPromises()
    expect(sync.createTask.mock.calls[0]![0]).toMatchObject({ topic: 'Frisch' })
  })

  it('kd#16: Enter on a name an existing topic has picks that one, with its own spelling', async () => {
    mountFlow()
    await confirmTitle()
    await w.get('[data-testid="new-card-search"]').setValue('design')
    expect(w.find('[data-testid="new-card-new"]').exists()).toBe(false)
    await w.get('[data-testid="new-card-search"]').trigger('keydown', { key: 'Enter' })
    expect(w.get('.task-face').attributes('data-topic')).toBe('Design')
  })

  it('skips Thema and Aktivität on a board without values and when the source lacks the field', async () => {
    options.topics = []
    options.activities = []
    tasks.list = []
    mountFlow()
    await confirmTitle()
    expect(stepKey()).toBe('timebox')
    w.unmount()

    // Todoist: priority and topic only, no timebox or activity
    options.topics = ['Design']
    options.activities = ['Planung']
    target.source = 'todoist'
    mountFlow()
    await confirmTitle()
    expect(stepKey()).toBe('topic')
    await pressOnPanel('Enter')
    expect(stepKey()).toBe('notes')
  })

  it('a failed save keeps the card on Notiz with everything entered and saves again', async () => {
    sync.createTask.mockRejectedValueOnce(new Error('offline'))
    mountFlow()
    await confirmTitle()
    await pressOnPanel('1')
    await afterPick()
    await pressOnPanel('1')
    await afterPick()
    await pressOnPanel('1')
    await afterPick()
    await w.get('[data-testid="new-card-notes"]').setValue('Bleibt')
    await w.get('form.ncf__row').trigger('submit')
    await flushPromises()

    expect(errors.handleError).toHaveBeenCalledWith(expect.any(Error), 'task_create')
    expect(w.emitted('saved')).toBeUndefined()
    expect(stepKey()).toBe('notes')
    expect((w.get('[data-testid="new-card-notes"]').element as HTMLInputElement).value).toBe('Bleibt')
    expect(w.get('[data-testid="new-card-save"]').attributes('disabled')).toBeUndefined()

    await w.get('form.ncf__row').trigger('submit')
    await flushPromises()
    expect(sync.createTask).toHaveBeenCalledTimes(2)
    expect(sync.createTask.mock.calls[1]![0]).toEqual(sync.createTask.mock.calls[0]![0])
    expect(w.emitted('saved')).toHaveLength(1)
  })

  it('a press outside cancels a blank card only', async () => {
    mountFlow()
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(w.emitted('cancel')).toHaveLength(1)
    w.unmount()

    mountFlow()
    await title().setValue('Text')
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(w.emitted('cancel')).toBeUndefined()
  })

  it('does not save twice while a save runs', async () => {
    let resolve!: (task: { id: string }) => void
    sync.createTask.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    mountFlow()
    await confirmTitle()
    await pressOnPanel('Enter')
    await pressOnPanel('Enter')
    await pressOnPanel('Enter')
    await w.get('form.ncf__row').trigger('submit')
    await w.get('form.ncf__row').trigger('submit')
    expect(sync.createTask).toHaveBeenCalledTimes(1)
    resolve({ id: 'local_9' })
    await flushPromises()
    expect(w.emitted('saved')).toHaveLength(1)
  })
})
