/**
 * #320: the disconnect dialog states what leaves, what is discarded, and which choices exist: with queued
 * changes "Erst synchronisieren, dann trennen" or "Trotzdem trennen" (the first only while the source can be
 * reached), always "Abbrechen"; a failure keeps the dialog open and says why.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import { setTestLocale } from '../../helpers/i18n'

const disconnectMock = vi.fn()
vi.mock('~/composables/useSourceConnections', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/composables/useSourceConnections')>()
  return { ...actual, useSourceConnections: () => ({ ...actual.useSourceConnections(), disconnectSource: disconnectMock }) }
})
vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: vi.fn(), handleSuccess: vi.fn() }),
}))

/* eslint-disable import/first -- order-sensitive: the mocks must be registered before the SUT is imported */
import DisconnectSourceDialog from '~/components/settings/DisconnectSourceDialog.vue'
import { useBoardStore } from '~/store/board'
import { useTasksStore } from '~/store/tasks'
import { useIntegrationHealthStore } from '~/store/integrationHealth'
/* eslint-enable import/first */

const ModalStub = { props: ['title'], template: '<div><h2>{{ title }}</h2><slot name="body" /><slot name="footer" /></div>' }
const ButtonStub = { props: ['label', 'loading', 'disabled'], template: '<button :disabled="disabled || loading" :data-loading="loading">{{ label }}</button>' }
const AlertStub = { props: ['title', 'description'], template: '<div role="alert"><b>{{ title }}</b> {{ description }}</div>' }

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id, source: 'notion', externalId: id, title: `Task ${id}`, status: TaskStatus.Open, activity: null, topic: null,
    topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, ...overrides,
  }
}

function mountDialog() {
  return mount(DisconnectSourceDialog, {
    props: { open: true, source: 'notion' },
    global: { stubs: { UModal: ModalStub, UButton: ButtonStub, UAlert: AlertStub } },
  })
}

const buttons = (wrapper: ReturnType<typeof mountDialog>) => wrapper.findAll('button').map((b) => b.text())

describe('DisconnectSourceDialog', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    disconnectMock.mockReset()
    setTestLocale('de')
    useBoardStore().setSources({ connected: ['notion'], default: 'notion' })
    useTasksStore().setTasks([task('n-1'), task('n-2', { status: TaskStatus.Done })])
  })

  it('states the task count and the default fallback, and offers a plain "Trennen" when nothing is unsynced', () => {
    const wrapper = mountDialog()
    expect(wrapper.text()).toContain('Notion trennen?')
    expect(wrapper.text()).toContain('2 Aufgaben verlassen das Board. Sie bleiben in Notion.')
    expect(wrapper.text()).toContain('Neue Aufgaben werden danach lokal gespeichert.')
    expect(wrapper.find('[data-testid="disconnect-unsynced"]').exists()).toBe(false)
    expect(buttons(wrapper)).toEqual(['Abbrechen', 'Trennen'])
  })

  it('says nothing about the default when Notion is not the default, and uses the singular for one task', () => {
    useBoardStore().setSources({ connected: ['notion'], default: 'local' })
    useTasksStore().setTasks([task('n-1')])
    const wrapper = mountDialog()
    expect(wrapper.text()).toContain('1 Aufgabe verlässt das Board. Sie bleibt in Notion.')
    expect(wrapper.find('[data-testid="disconnect-default-note"]').exists()).toBe(false)
  })

  it('with queued changes on a reachable source it offers both ways, "Abbrechen" first', () => {
    useTasksStore().markPendingSync('n-1')
    const wrapper = mountDialog()
    expect(wrapper.find('[data-testid="disconnect-unsynced"]').text()).toContain('1 Änderung ist noch nicht in Notion gespeichert')
    expect(buttons(wrapper)).toEqual(['Abbrechen', 'Trotzdem trennen', 'Erst synchronisieren, dann trennen'])
  })

  it('with queued changes on an unreachable source only "Trotzdem trennen" or "Abbrechen" remain', () => {
    useTasksStore().markPendingSync('n-1')
    useIntegrationHealthStore().markOffline('notion')
    const wrapper = mountDialog()
    expect(wrapper.find('[data-testid="disconnect-unsynced"]').text()).toContain('Notion ist gerade nicht erreichbar')
    expect(buttons(wrapper)).toEqual(['Abbrechen', 'Trotzdem trennen'])
  })

  it('names the task whose running timer stops', () => {
    useTasksStore().setTasks([task('n-1', { status: TaskStatus.Progress, timerId: 7, title: 'Bericht schreiben' })])
    const wrapper = mountDialog()
    expect(wrapper.find('[data-testid="disconnect-timer-note"]').text()).toContain('Die laufende Zeiterfassung von „Bericht schreiben“ wird angehalten.')
    expect(buttons(wrapper)).toContain('Erst synchronisieren, dann trennen') // the stop queues its time
  })

  it('a leftover timer id on a task outside Jetzt is no running timer: no note, nothing unsynced', () => {
    useTasksStore().setTasks([task('n-1', { status: TaskStatus.Waiting, timerId: 7 })])
    const wrapper = mountDialog()
    expect(wrapper.find('[data-testid="disconnect-timer-note"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="disconnect-unsynced"]').exists()).toBe(false)
  })

  it('"Erst synchronisieren" asks for the flush; success closes the dialog and reports the result', async () => {
    useTasksStore().markPendingSync('n-1')
    disconnectMock.mockResolvedValue({ ok: true, removedTaskCount: 2 })
    const wrapper = mountDialog()
    await wrapper.find('[data-testid="disconnect-sync-first"]').trigger('click')
    await flushPromises()
    expect(disconnectMock).toHaveBeenCalledWith('notion', { syncFirst: true })
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
    expect(wrapper.emitted('disconnected')?.[0]).toEqual([{ ok: true, removedTaskCount: 2 }])
  })

  it('"Trotzdem trennen" does not flush', async () => {
    useTasksStore().markPendingSync('n-1')
    disconnectMock.mockResolvedValue({ ok: true, removedTaskCount: 2 })
    const wrapper = mountDialog()
    await wrapper.find('[data-testid="disconnect-anyway"]').trigger('click')
    await flushPromises()
    expect(disconnectMock).toHaveBeenCalledWith('notion', { syncFirst: false })
  })

  it('an incomplete sync keeps the dialog open with the reason, and a new opening starts clean', async () => {
    useTasksStore().markPendingSync('n-1')
    disconnectMock.mockResolvedValue({ ok: false, reason: 'sync-incomplete' })
    const wrapper = mountDialog()
    await wrapper.find('[data-testid="disconnect-sync-first"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="disconnect-failure"]').text()).toContain('Nicht alles wurde synchronisiert')
    expect(wrapper.emitted('disconnected')).toBeUndefined()
    expect(wrapper.emitted('update:open')).toBeUndefined()

    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await nextTick()
    expect(wrapper.find('[data-testid="disconnect-failure"]').exists()).toBe(false)
  })

  it('a refused Keychain is stated and the source stays connected', async () => {
    disconnectMock.mockResolvedValue({ ok: false, reason: 'credentials' })
    const wrapper = mountDialog()
    await wrapper.find('[data-testid="disconnect-anyway"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="disconnect-failure"]').text()).toContain('Token konnte nicht gelöscht werden')
  })

  it('blocks a second click while the disconnect runs', async () => {
    let finish!: (value: unknown) => void
    disconnectMock.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const wrapper = mountDialog()
    await wrapper.find('[data-testid="disconnect-anyway"]').trigger('click')
    expect(wrapper.find('[data-testid="disconnect-anyway"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="disconnect-cancel"]').attributes('disabled')).toBeDefined()
    finish({ ok: true, removedTaskCount: 2 })
    await flushPromises()
    expect(disconnectMock).toHaveBeenCalledTimes(1)
  })

  it('is English too', () => {
    setTestLocale('en')
    useTasksStore().markPendingSync('n-1')
    const wrapper = mountDialog()
    expect(wrapper.text()).toContain('Disconnect Notion?')
    expect(wrapper.text()).toContain('2 tasks leave the board. They stay in Notion.')
    expect(wrapper.text()).toContain('New tasks will be saved locally afterwards.')
    expect(buttons(wrapper)).toEqual(['Cancel', 'Disconnect anyway', 'Sync first, then disconnect'])
  })
})
