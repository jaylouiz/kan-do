import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import TaskForm from '~/components/task/TaskForm.vue'
import { useBoardStore } from '~/store/board'
import { useNotionConfigStore } from '~/store/notionConfig'
import { useTasksStore } from '~/store/tasks'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

vi.mock('~/composables/usePropertyOptionsSync', () => ({
  usePropertyOptionsSync: () => ({ ensureOptionsAvailable: vi.fn() }),
}))

function task(source: Task['source']): Task {
  return {
    id: 't-1',
    source,
    externalId: source === 'local' ? null : 't-1',
    title: 'Card',
    status: TaskStatus.Open,
    activity: 'Calls',
    topic: 'Ops',
    topicColorCode: null,
    priority: 3,
    notes: null,
    timeBoxSeconds: 1800,
    timeSpentSeconds: 0,
    timerId: null,
  }
}

/** The last draft the form emitted: it carries only the fields the form offers for its source. */
function lastDraft(wrapper: ReturnType<typeof mountForm>): Partial<Task> {
  return wrapper.emitted('draft')!.at(-1)![0] as Partial<Task>
}

function mountForm(props: { task?: Task; source?: Task['source'] } = {}) {
  return mount(TaskForm, {
    props,
    global: { stubs: { UForm: true, UFormField: true, UInput: true, UTextarea: true, UButton: true, USelect: true, USwitch: true, UCheckbox: true, UIcon: true, UCollapsible: true, UFieldGroup: true } },
  })
}

describe('TaskForm field gating follows the source of the edited task (#326)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    // Notion is configured without priority, timebox, activity and topic columns
    useNotionConfigStore().$patch({
      config: { token: 't', databaseId: 'db', propertyMapping: { title: 'Name', status: 'Status' } },
    } as never)
  })

  it('a Notion task on a Local-default board is gated by the Notion mapping', () => {
    useBoardStore().setSources({ connected: ['notion'], default: 'local' })
    const draft = lastDraft(mountForm({ task: task('notion') }))
    expect(draft.priority).toBe(2)
    expect(draft.timeBoxSeconds).toBeNull()
    expect(draft.activity).toBeNull()
    expect(draft.topic).toBeNull()
  })

  it('a Local task on a Notion-default board keeps every field', () => {
    useBoardStore().setSources({ connected: ['notion'], default: 'notion' })
    const draft = lastDraft(mountForm({ task: task('local') }))
    expect(draft.priority).toBe(3)
    expect(draft.timeBoxSeconds).toBe(1800)
    expect(draft.activity).toBe('Calls')
    expect(draft.topic).toBe('Ops')
  })

  it('a new task follows the default source', () => {
    const board = useBoardStore()
    board.setSources({ connected: ['notion'], default: 'notion' })
    expect(lastDraft(mountForm()).priority).toBe(2)
    board.setSources({ connected: ['notion'], default: 'local' })
    expect(lastDraft(mountForm()).priority).toBe(2)
  })
})

describe('TaskForm follows the chosen target of the add form (#321)', () => {
  type FormState = {
    formData: { title: string; topic: string; activity: string; priority: number }
    customValues: Record<string, unknown>
    timeboxInMinutes: number
  }
  const state = (wrapper: ReturnType<typeof mountForm>) => wrapper.vm as unknown as FormState

  beforeEach(() => {
    setActivePinia(createPinia())
    useBoardStore().setSources({ connected: ['notion'], default: 'notion' })
    // Notion maps priority and topic only, plus one enabled and one disabled custom property
    useNotionConfigStore().$patch({
      config: {
        token: 't',
        databaseId: 'db',
        propertyMapping: {
          title: 'Name',
          status: 'Status',
          priority: 'Prio',
          topic: 'Projekt',
          customProperties: [
            { key: 'projekt-nr', name: 'Projekt-Nr', type: 'text', enabled: true },
            { key: 'intern', name: 'Intern', type: 'text', enabled: false },
          ],
        },
      },
    } as never)
  })

  const submit = async (wrapper: ReturnType<typeof mountForm>): Promise<Partial<Task>> => {
    const before = wrapper.emitted('success')?.length ?? 0
    ;(wrapper.vm as unknown as { submitFormExternal: () => void }).submitFormExternal()
    await wrapper.vm.$nextTick()
    const emitted = wrapper.emitted('success')!
    expect(emitted).toHaveLength(before + 1)
    return emitted.at(-1)![0] as Partial<Task>
  }

  it('shows the Local rows for a Local target and the mapped rows plus Eigenschaften for Notion', async () => {
    const wrapper = mount(TaskForm, {
      props: { source: 'local' },
      global: { stubs: { UForm: { template: '<form><slot /></form>' }, UInput: true, UTextarea: true, UButton: true, UCheckbox: true, UIcon: true, TaskPropertySelect: { template: '<span v-bind="$attrs" />' } } },
    })
    expect(wrapper.find('[data-testid="add-task-timebox"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="add-task-activity-select"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Projekt-Nr')

    await wrapper.setProps({ source: 'notion' })
    expect(wrapper.find('[data-testid="add-task-timebox"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="add-task-activity-select"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="add-task-topic-select"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Projekt-Nr')
    expect(wrapper.text()).not.toContain('Intern')
  })

  it('switching back and forth keeps what was typed; unsupported fields are neither saved nor mirrored to the draft', async () => {
    const wrapper = mountForm({ source: 'local' })
    Object.assign(state(wrapper).formData, { title: 'Rückruf', topic: 'Büro', activity: 'Calls', priority: 4 })
    state(wrapper).timeboxInMinutes = 30
    state(wrapper).customValues['projekt-nr'] = 'P-7'
    await wrapper.vm.$nextTick()

    // Local target: custom values are not part of the task, the Notion-only row is gone
    expect(await submit(wrapper)).toMatchObject({ title: 'Rückruf', topic: 'Büro', activity: 'Calls', priority: 4, timeBoxSeconds: 1800 })
    expect((await submit(wrapper)).custom).toBeUndefined()

    await wrapper.setProps({ source: 'notion' })
    expect(lastDraft(wrapper)).toMatchObject({ title: 'Rückruf', topic: 'Büro', activity: null, priority: 4, timeBoxSeconds: null })
    const toNotion = await submit(wrapper)
    expect(toNotion).toMatchObject({ title: 'Rückruf', topic: 'Büro', activity: null, timeBoxSeconds: null })
    expect(toNotion.custom?.['projekt-nr']).toMatchObject({ value: { type: 'text', value: 'P-7' } })

    await wrapper.setProps({ source: 'local' })
    expect(lastDraft(wrapper)).toMatchObject({ activity: 'Calls', timeBoxSeconds: 1800 })
    const back = await submit(wrapper)
    expect(back).toMatchObject({ activity: 'Calls', timeBoxSeconds: 1800, topic: 'Büro' })
    expect(back.custom).toBeUndefined()

    await wrapper.setProps({ source: 'notion' })
    expect((await submit(wrapper)).custom?.['projekt-nr']).toBeDefined()
  })

  it('does not reset the title when the source changes', async () => {
    const wrapper = mountForm({ source: 'notion' })
    state(wrapper).formData.title = 'Bleibt'
    await wrapper.setProps({ source: 'local' })
    expect(state(wrapper).formData.title).toBe('Bleibt')
  })
})

/** Like mountForm, but UForm renders its slot so the property rows are present */
function mountFormBody(props: { task?: Task; source?: Task['source'] } = {}) {
  return mount(TaskForm, {
    props,
    global: { stubs: { UForm: { template: '<form><slot /></form>' }, UInput: true, UTextarea: true, UButton: true, UCheckbox: true, UIcon: true, TaskPropertySelect: { template: '<span v-bind="$attrs" />' } } },
  })
}

describe('TaskForm timebox defaults to none, never 0 (#663)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useBoardStore().setSources({ connected: [], default: 'local' })
  })

  it('a new form has an empty timebox input and no timebox in its draft', () => {
    const wrapper = mountFormBody()
    expect((wrapper.find('[data-testid="add-task-timebox-input"]').element as HTMLInputElement).value).toBe('')
    expect(lastDraft(wrapper).timeBoxSeconds).toBeNull()
  })

  it('typing sets the timebox, clearing or typing 0 returns to none', async () => {
    const wrapper = mountFormBody()
    const input = wrapper.find('[data-testid="add-task-timebox-input"]')
    await input.setValue('25')
    expect(lastDraft(wrapper).timeBoxSeconds).toBe(1500)
    await input.setValue('')
    expect(lastDraft(wrapper).timeBoxSeconds).toBeNull()
    await input.setValue('0')
    expect(lastDraft(wrapper).timeBoxSeconds).toBeNull()
  })

  it('an edited task keeps its timebox', () => {
    const wrapper = mountFormBody({ task: task('local') })
    expect((wrapper.find('[data-testid="add-task-timebox-input"]').element as HTMLInputElement).value).toBe('30')
  })
})

describe('TaskForm carries the colour siblings show for the topic (#672)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('a new task takes the colour of a same-named topic for the draft card and the save; a colourless topic stays null', async () => {
    useTasksStore().setTasks([{ ...task('local'), id: 'sibling', topic: 'Ops', topicColorCode: '#6366f1' }])
    const wrapper = mountForm({ source: 'local' })
    ;(wrapper.vm as unknown as { formData: { title: string; topic: string } }).formData.title = 'Neu'
    ;(wrapper.vm as unknown as { formData: { title: string; topic: string } }).formData.topic = 'Ops'
    await nextTick()
    expect(lastDraft(wrapper).topicColorCode).toBe('#6366f1')

    ;(wrapper.vm as unknown as { submitFormExternal: () => void }).submitFormExternal()
    await nextTick()
    expect((wrapper.emitted('success')!.at(-1)![0] as Partial<Task>).topicColorCode).toBe('#6366f1')

    ;(wrapper.vm as unknown as { formData: { topic: string } }).formData.topic = 'Unbekannt'
    await nextTick()
    expect(lastDraft(wrapper).topicColorCode).toBeNull()
  })

  it('a Local task whose topic Notion colours stores no colour (it keeps following Notion); an edit that changes the topic re-derives', async () => {
    useTasksStore().setTasks([
      { ...task('notion'), id: 'n1', topic: 'Ops', topicColorCode: 'blue' },
      { ...task('local'), id: 'sibling', topic: 'Büro', topicColorCode: '#6366f1' },
    ])
    const wrapper = mountForm({ task: { ...task('local'), topic: 'Büro', topicColorCode: null } })
    ;(wrapper.vm as unknown as { formData: { topic: string } }).formData.topic = 'Ops'
    await nextTick()
    expect(lastDraft(wrapper).topicColorCode).toBeNull()
    ;(wrapper.vm as unknown as { formData: { topic: string } }).formData.topic = 'Büro'
    await nextTick()
    expect(lastDraft(wrapper).topicColorCode).toBeNull() // the task's own (null) colour, unchanged topic
    ;(wrapper.vm as unknown as { formData: { topic: string } }).formData.topic = 'Büro '
    await nextTick()
    expect(lastDraft(wrapper).topicColorCode).toBeNull()
  })

  it('an edit that keeps the topic keeps the colour the task has', async () => {
    useTasksStore().setTasks([{ ...task('local'), id: 'sibling', topic: 'Ops', topicColorCode: '#6366f1' }])
    const wrapper = mountForm({ task: { ...task('local'), topic: 'Ops', topicColorCode: '#10b981' } })
    expect(lastDraft(wrapper).topicColorCode).toBe('#10b981')
    ;(wrapper.vm as unknown as { submitFormExternal: () => void }).submitFormExternal()
    await nextTick()
    expect((wrapper.emitted('success')!.at(-1)![0] as Partial<Task>).topicColorCode).toBe('#10b981')
  })
})
