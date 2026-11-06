import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, nextTick, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useTaskDraft } from '~/composables/useTaskDraft'
import { TaskStatus } from '~/types/taskStatus'
import { toastAddMock } from '~/tests/mocks/nuxt-imports'

// Reactive, so a query change on the mounted page reaches its watchers
const route = await vi.hoisted(async () => {
  const { reactive } = await import('vue')
  return reactive({ query: {} as Record<string, string> })
})
vi.mock('nuxt/app', () => ({ useRoute: () => route }))

const tasksStore = vi.hoisted(() => ({ tasksProgress: [] as { id: string }[], addTask: vi.fn() }))
vi.mock('~/store/tasks', () => ({ useTasksStore: () => tasksStore }))
// Sources of the board: a mixed board is `sources.connected = ['notion']`
const sources = vi.hoisted(() => ({ connected: [] as string[], default: 'local' as string }))
const nudge = vi.hoisted(() => ({ startTimeboxNudge: vi.fn() }))
vi.mock('~/store/board', () => ({
  useBoardStore: () => ({
    get defaultSource() { return sources.default },
    get connectedIntegrations() { return sources.connected },
    updateTaskPosition: vi.fn(),
    startTimeboxNudge: nudge.startTimeboxNudge,
  }),
}))

// createTask is covered by useTaskSync.createTask.test.ts: here it records the source and adds the task
const sync = vi.hoisted(() => ({
  createTask: vi.fn(async (draft: Record<string, unknown>, source: string) => {
    const task = { ...draft, id: `task-${sync.createTask.mock.calls.length}`, source }
    tasksStore.addTask(task)
    return task as { id: string }
  }),
}))
vi.mock('~/composables/useTaskSync', () => ({ useTaskSync: () => ({ createTask: sync.createTask }) }))
vi.mock('~/store/notionConfig', () => ({ useNotionConfigStore: () => ({}) }))
vi.mock('~/composables/useNotionIntegration', () => ({ useNotionIntegration: () => ({}) }))

const footer = vi.hoisted(() => ({ setFooter: vi.fn() }))
const operations = vi.hoisted(() => ({
  moveTaskToStatus: vi.fn(async () => true),
  notifyWipRefused: vi.fn(),
}))
vi.mock('~/composables/useTaskOperations', () => ({ useTaskOperations: () => operations }))
vi.mock('~/composables/useModalFooter', () => ({
  useModalFooter: () => ({ setFooter: footer.setFooter, clearFooter: vi.fn(), updateAction: vi.fn() }),
}))

const sheet = vi.hoisted(() => ({ closeTaskSheet: vi.fn(async () => {}), dismissed: null as null | { value: boolean } }))
vi.mock('~/composables/useTaskSheet', async () => {
  const { ref: vueRef } = await import('vue')
  sheet.dismissed = vueRef(false)
  return { useTaskSheet: () => ({ closeTaskSheet: sheet.closeTaskSheet, isDismissed: sheet.dismissed }) }
})

// The real useErrorHandler resolves useToast via '#imports' (toastAddMock), so the page and the
// handler share one spy and a duplicate toast cannot hide
const toast = { add: toastAddMock }
vi.stubGlobal('useToast', () => toast)

const form = vi.hoisted(() => ({ resetSubmitting: vi.fn() }))

const TaskFormStub = defineComponent({
  name: 'TaskForm',
  props: { source: { type: String, default: undefined } },
  emits: ['success', 'draft'],
  setup(_, { expose }) {
    expose({ resetSubmitting: form.resetSubmitting, submitFormExternal: vi.fn(), isSubmitting: ref(false) })
    return {}
  },
  template: '<form />',
})

const mountPage = async () => {
  const { default: TaskAddPage } = await import('~/pages/tasks/add.vue')
  return mount(TaskAddPage, { global: { stubs: { TaskForm: TaskFormStub, 'task-form': TaskFormStub } } })
}

const save = async (wrapper: Awaited<ReturnType<typeof mountPage>>, title = 'Rückruf') => {
  wrapper.findComponent(TaskFormStub).vm.$emit('success', { title, status: TaskStatus.Open })
  await flushPromises()
}

describe('pages/tasks/add (#110, #125)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    route.query = {}
    sources.connected = []
    sources.default = 'local'
    sync.createTask.mockClear()
    footer.setFooter.mockClear()
    tasksStore.tasksProgress = []
    tasksStore.addTask.mockClear()
    operations.moveTaskToStatus.mockClear()
    operations.notifyWipRefused.mockClear()
    nudge.startTimeboxNudge.mockClear()
    setActivePinia(createPinia())
    sheet.closeTaskSheet.mockClear()
    toast.add.mockReset()
    form.resetSubmitting.mockClear()
    if (sheet.dismissed) sheet.dismissed.value = false
  })

  afterEach(() => {
    useTaskDraft().clearDraft()
    vi.useRealTimers()
  })

  it('starts an Offen draft for a regular add and clears it when the sheet is dismissed', async () => {
    await mountPage()
    expect(useTaskDraft().draftTask.value?.status).toBe(TaskStatus.Open)
    sheet.dismissed!.value = true
    await nextTick()
    expect(useTaskDraft().draftTask.value).toBeNull()
  })

  it('starts a Jetzt draft for add-and-start and mirrors the running time into it', async () => {
    route.query = { mode: 'adhoc' }
    await mountPage()
    expect(useTaskDraft().draftTask.value?.status).toBe(TaskStatus.Progress)
    vi.advanceTimersByTime(3000)
    await nextTick()
    expect(useTaskDraft().draftTask.value?.timeSpentSeconds).toBe(3)
  })

  it('saves add-and-start into Jetzt with the elapsed time (the driver times it) and focuses the new card', async () => {
    route.query = { mode: 'adhoc' }
    const wrapper = await mountPage()
    vi.advanceTimersByTime(5000)
    await save(wrapper)

    const saved = tasksStore.addTask.mock.calls[0]![0]
    expect(saved).toMatchObject({ status: TaskStatus.Progress, timeSpentSeconds: 5, isUnplanned: true })
    expect(operations.notifyWipRefused).not.toHaveBeenCalled()
    // No "created" toast (#136): the focused card in Jetzt is the confirmation
    expect(toast.add).not.toHaveBeenCalled()
    expect(sheet.closeTaskSheet).toHaveBeenCalledWith({ focusTaskId: saved.id })
    expect(useTaskDraft().draftTask.value).toBeNull()
    expect(useTaskDraft().draftSaved.value).toBe(true)
  })

  it('asks for a timebox on the new Jetzt card only once the add sheet has closed (#389)', async () => {
    route.query = { mode: 'adhoc' }
    let closed = false
    sheet.closeTaskSheet.mockImplementationOnce(async () => {
      expect(nudge.startTimeboxNudge).not.toHaveBeenCalled()
      closed = true
    })
    const wrapper = await mountPage()
    await save(wrapper)

    expect(closed).toBe(true)
    const saved = tasksStore.addTask.mock.calls[0]![0]
    expect(nudge.startTimeboxNudge).toHaveBeenCalledWith(saved.id)
  })

  it.each([
    ['a regular add into Offen', {}],
    ['an add-and-start that Jetzt refused', { mode: 'adhoc' }],
  ])('starts no timebox nudge for %s (#389)', async (_label, query) => {
    route.query = query
    if (query.mode) tasksStore.tasksProgress = [{ id: 'busy' }]
    const wrapper = await mountPage()
    await save(wrapper)
    expect(nudge.startTimeboxNudge).not.toHaveBeenCalled()
  })

  it('keeps the task in Offen (with its time) when Jetzt filled up meanwhile: the WIP rule applies', async () => {
    route.query = { mode: 'adhoc' }
    tasksStore.tasksProgress = [{ id: 'busy' }]
    const wrapper = await mountPage()
    vi.advanceTimersByTime(2000)
    await save(wrapper)

    const saved = tasksStore.addTask.mock.calls[0]![0]
    expect(saved).toMatchObject({ status: TaskStatus.Open, timeSpentSeconds: 2 })
    expect(operations.notifyWipRefused).toHaveBeenCalledTimes(1)
  })

  it('sends the task back to Offen (with its time) when Jetzt filled during the save', async () => {
    route.query = { mode: 'adhoc' }
    // A sync fills Jetzt while the save runs; the saved task lands there too
    tasksStore.addTask.mockImplementationOnce((task: { id: string }) => {
      tasksStore.tasksProgress = [{ id: 'synced' }, { id: task.id }]
    })
    const wrapper = await mountPage()
    vi.advanceTimersByTime(4000)
    await save(wrapper)

    const saved = tasksStore.addTask.mock.calls[0]![0]
    expect(saved).toMatchObject({ status: TaskStatus.Progress, timeSpentSeconds: 4 })
    expect(operations.moveTaskToStatus).toHaveBeenCalledWith(saved.id, TaskStatus.Open)
    expect(operations.notifyWipRefused).toHaveBeenCalledTimes(1)
    expect(toast.add).not.toHaveBeenCalled()
  })

  it('leaves no Offen draft behind when the route drops ?mode=adhoc after a save', async () => {
    route.query = { mode: 'adhoc' }
    const wrapper = await mountPage()
    await save(wrapper)

    route.query = {}
    await nextTick()
    expect(useTaskDraft().draftTask.value).toBeNull()
    expect(useTaskDraft().draftSaved.value).toBe(true)
  })

  it('leaves no Offen draft behind when the route drops ?mode=adhoc after a cancel', async () => {
    route.query = { mode: 'adhoc' }
    await mountPage()
    sheet.dismissed!.value = true
    await nextTick()

    route.query = {}
    await nextTick()
    expect(useTaskDraft().draftTask.value).toBeNull()
  })

  it('focuses the new card after a regular save, without a "created" toast', async () => {
    const wrapper = await mountPage()
    await save(wrapper, 'Neue Aufgabe')
    const saved = tasksStore.addTask.mock.calls[0]![0]
    expect(saved.status).toBe(TaskStatus.Open)
    expect(sheet.closeTaskSheet).toHaveBeenCalledWith({ focusTaskId: saved.id })
    expect(toast.add).not.toHaveBeenCalled()
  })

  it('keeps the draft and the form open when the save fails', async () => {
    route.query = { mode: 'adhoc' }
    const failure = new Error('create rejected by upstream (#138)')
    tasksStore.addTask.mockImplementationOnce(() => { throw failure })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = await mountPage()
    await save(wrapper)
    expect(sheet.closeTaskSheet).not.toHaveBeenCalled()
    expect(useTaskDraft().draftTask.value).not.toBeNull()
    // Real useErrorHandler: exactly one toast for the failed create (#138)
    expect(toast.add).toHaveBeenCalledTimes(1)
    expect(toast.add).toHaveBeenCalledWith(expect.objectContaining({ color: 'error' }))
    // The time keeps running in the draft
    vi.advanceTimersByTime(2000)
    await nextTick()
    expect(useTaskDraft().draftTask.value?.timeSpentSeconds).toBe(2)
  })

  it('counts the time a failed save took into the running time', async () => {
    route.query = { mode: 'adhoc' }
    tasksStore.addTask.mockImplementationOnce(() => {
      vi.advanceTimersByTime(3000)
      throw new Error('offline')
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = await mountPage()
    vi.advanceTimersByTime(2000)
    await save(wrapper)
    await nextTick()
    expect(useTaskDraft().draftTask.value?.timeSpentSeconds).toBe(5)
    expect(form.resetSubmitting).toHaveBeenCalledTimes(1)

    // The retry saves the full time
    await save(wrapper)
    expect(tasksStore.addTask.mock.calls.at(-1)![0]).toMatchObject({ timeSpentSeconds: 5 })
  })

  it('never re-enables the form once the task exists, even when a later step throws', async () => {
    route.query = { mode: 'adhoc' }
    tasksStore.tasksProgress = [{ id: 'busy' }]
    operations.notifyWipRefused.mockImplementationOnce(() => { throw new Error('toast failed') })
    const wrapper = await mountPage()
    vi.advanceTimersByTime(2000)
    await save(wrapper)

    const saved = tasksStore.addTask.mock.calls[0]![0]
    expect(tasksStore.addTask).toHaveBeenCalledTimes(1)
    expect(operations.notifyWipRefused).toHaveBeenCalledTimes(1)
    expect(form.resetSubmitting).not.toHaveBeenCalled()
    expect(useTaskDraft().draftTask.value).toBeNull()
    expect(sheet.closeTaskSheet).toHaveBeenCalledWith({ focusTaskId: saved.id })

    // No local timer restarted behind the closing sheet: no draft comes back
    vi.advanceTimersByTime(3000)
    await nextTick()
    expect(useTaskDraft().draftTask.value).toBeNull()
  })

  it('follows a mode change on the mounted page: the draft moves with its title, the time restarts', async () => {
    const wrapper = await mountPage()
    useTaskDraft().updateDraft({ title: 'Rückruf' })

    route.query = { mode: 'adhoc' }
    await nextTick()
    expect(useTaskDraft().draftTask.value).toMatchObject({ status: TaskStatus.Progress, title: 'Rückruf', timeSpentSeconds: 0 })
    vi.advanceTimersByTime(2000)
    await nextTick()
    expect(useTaskDraft().draftTask.value?.timeSpentSeconds).toBe(2)

    route.query = {}
    await nextTick()
    expect(useTaskDraft().draftTask.value).toMatchObject({ status: TaskStatus.Open, title: 'Rückruf', timeSpentSeconds: 0 })
    vi.advanceTimersByTime(2000)
    await nextTick()
    expect(useTaskDraft().draftTask.value?.timeSpentSeconds).toBe(0)

    await save(wrapper)
    expect(tasksStore.addTask.mock.calls[0]![0]).toMatchObject({ status: TaskStatus.Open })
    wrapper.unmount()
  })
})

describe('pages/tasks/add: where the task is saved (#321)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    route.query = {}
    sources.connected = ['notion']
    sources.default = 'notion'
    sync.createTask.mockClear()
    footer.setFooter.mockClear()
    tasksStore.addTask.mockClear()
    tasksStore.tasksProgress = []
    setActivePinia(createPinia())
    sheet.closeTaskSheet.mockClear()
    if (sheet.dismissed) sheet.dismissed.value = false
  })

  afterEach(() => {
    useTaskDraft().clearDraft()
    vi.useRealTimers()
  })

  it('creates through useTaskSync in the default source, starting on it', async () => {
    const wrapper = await mountPage()
    await save(wrapper)
    expect(sync.createTask).toHaveBeenCalledTimes(1)
    expect(sync.createTask.mock.calls[0]![1]).toBe('notion')
    expect(wrapper.findComponent(TaskFormStub).props('source')).toBe('notion')
  })

  it('saves to the target the switch chose and keeps it after a failed save', async () => {
    const { useAddTarget } = await import('~/composables/useAddTarget')
    const wrapper = await mountPage()
    useAddTarget().setTarget('local')
    await nextTick()
    expect(wrapper.findComponent(TaskFormStub).props('source')).toBe('local')

    sync.createTask.mockRejectedValueOnce(new Error('rejected (400)'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await save(wrapper)
    expect(useAddTarget().targetSource.value).toBe('local')
    await save(wrapper)
    expect(sync.createTask.mock.calls.map((call) => call[1])).toEqual(['local', 'local'])
  })

  it('starts on the default again each time the sheet opens, also when the default is Local', async () => {
    const { useAddTarget } = await import('~/composables/useAddTarget')
    const first = await mountPage()
    useAddTarget().setTarget('local')
    first.unmount()

    const second = await mountPage()
    expect(useAddTarget().targetSource.value).toBe('notion')
    second.unmount()

    sources.default = 'local'
    await mountPage()
    expect(useAddTarget().targetSource.value).toBe('local')
  })

  it('saves the ad-hoc add to the default source whatever the switch holds, and resets it on the mode change', async () => {
    const { useAddTarget } = await import('~/composables/useAddTarget')
    const wrapper = await mountPage()
    useAddTarget().setTarget('local')

    route.query = { mode: 'adhoc' }
    await nextTick()
    expect(useAddTarget().targetSource.value).toBe('notion')
    await save(wrapper)
    expect(sync.createTask.mock.calls[0]![1]).toBe('notion')
  })

  it('registers the switch as the footer lead', async () => {
    await mountPage()
    expect(footer.setFooter).toHaveBeenCalledWith(expect.objectContaining({ lead: expect.anything() }))
  })
})
