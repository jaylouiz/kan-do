import { describe, it, expect, beforeEach, vi } from 'vitest'
import { LocalizedError } from '~/lib/errorMessages'
import { useBoardStore } from '~/store/board'
import { setActivePinia, createPinia } from 'pinia'
import { defineComponent, h, provide } from 'vue'
import { mount } from '@vue/test-utils'
import { setTestLocale } from '~/tests/helpers/i18n'
import { injected, toastAddMock, toastMaxInjectionKey } from '~/tests/mocks/nuxt-imports'

const markNotionBrokenMock = vi.fn()
const markNotionOfflineMock = vi.fn()
const healthState = { isNotionBroken: false, isNotionOffline: false }
vi.mock('~/store/integrationHealth', () => ({
  useIntegrationHealthStore: () => ({
    isBroken: () => healthState.isNotionBroken,
    isOffline: () => healthState.isNotionOffline,
    markBroken: markNotionBrokenMock,
    markOffline: markNotionOfflineMock,
  }),
}))


// eslint-disable-next-line import/first -- order-sensitive: vi.mock must run before importing SUT
import { useErrorHandler } from '~/composables/useErrorHandler'

describe('useErrorHandler', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    // A Notion board: an error without a source of its own belongs to the default source
    useBoardStore().setSingleSource('notion')
    toastAddMock.mockReset()
    markNotionBrokenMock.mockReset()
  })

  it('marks health broken when context is notion_setup, without opening the setup dialog (#319)', () => {
    const { handleError } = useErrorHandler()
    handleError('Some Notion config error', 'notion_setup')

    expect(markNotionBrokenMock).toHaveBeenCalledTimes(1)
    expect(toastAddMock).toHaveBeenCalledTimes(1)
    const toastArg = toastAddMock.mock.calls[0]![0]
    expect(toastArg.description).toBe('Die Synchronisation mit Notion konnte nicht abgeschlossen werden.')
    expect(toastArg.title).toBe('Fehler')
  })

  it('marks health broken only on clear auth failures (401), never opening the setup dialog (#319)', () => {
    const { handleError } = useErrorHandler()
    // Should NOT trigger on generic message alone anymore
    handleError('invalid token provided by Notion API')
    expect(markNotionBrokenMock).toHaveBeenCalledTimes(0)

    // SHOULD trigger when structured error indicates 401
    handleError(Object.assign(new Error('Unauthorized'), { statusCode: 401 }))
    expect(markNotionBrokenMock).toHaveBeenCalledTimes(1)
  })

  it('suppresses generic sync toast when Notion is already marked as broken', async () => {
    await vi.resetModules()
    toastAddMock.mockReset()

    // Remock store: notion is broken
    vi.doMock('~/store/integrationHealth', () => ({
      useIntegrationHealthStore: () => ({
        isBroken: () => true,
        isOffline: () => false,
        markBroken: markNotionBrokenMock,
      }),
    }))

    const mod = await import('~/composables/useErrorHandler')
    const { handleError } = mod.useErrorHandler()

    handleError('Notion sync failed', 'task_sync')
    expect(toastAddMock).not.toHaveBeenCalled()
  })

  it('suppresses the sync toast in English too when Notion is broken', async () => {
    await vi.resetModules()
    toastAddMock.mockReset()
    setTestLocale('en')
    vi.doMock('~/store/integrationHealth', () => ({
      useIntegrationHealthStore: () => ({
        isBroken: () => true,
        isOffline: () => false,
        markBroken: markNotionBrokenMock,
      }),
    }))
    const mod = await import('~/composables/useErrorHandler')
    mod.useErrorHandler().handleError('Notion sync failed again', 'task_sync')
    expect(toastAddMock).not.toHaveBeenCalled()
  })

  it('shows a German description and title for a not-found message', () => {
    const { handleError } = useErrorHandler()
    handleError('Task not found 404', 'task_sync')
    const arg = toastAddMock.mock.calls[0]![0]
    expect(arg.title).toBe('Fehler')
    expect(arg.description).toBe('Aufgabe nicht gefunden.')
  })

  it('shows English title and description in en', () => {
    setTestLocale('en')
    const { handleError } = useErrorHandler()
    handleError('Task not found 405', 'task_sync')
    const arg = toastAddMock.mock.calls[0]![0]
    expect(arg.title).toBe('Error')
    expect(arg.description).toBe('Task not found.')
  })

  it('translates success and warning titles', () => {
    setTestLocale('en')
    const { handleSuccess, handleWarning } = useErrorHandler()
    handleSuccess('ok')
    handleWarning('careful')
    expect(toastAddMock.mock.calls[0]![0].title).toBe('Done')
    expect(toastAddMock.mock.calls[1]![0].title).toBe('Warning')
  })

  it.each(['de', 'en'] as const)('maps a LocalizedError by context in %s (selectDatabase, notion_setup)', (locale) => {
    setTestLocale(locale)
    const { handleError } = useErrorHandler()
    handleError(new LocalizedError('errors.selectDatabase'), 'notion_setup')
    const arg = toastAddMock.mock.calls[0]![0]
    // Old behaviour: "Bitte wähle eine Datenbank aus" fell through to the sync-failed message
    expect(arg.description).toBe(locale === 'de' ? 'Die Synchronisation mit Notion konnte nicht abgeschlossen werden.' : 'The sync with Notion could not be completed.')
  })

  it.each(['de', 'en'] as const)('maps notionNotConfiguredShort to the not-configured message in %s, whatever the context (#487)', (locale) => {
    setTestLocale(locale)
    const { handleError } = useErrorHandler()
    handleError(new LocalizedError('errors.notionNotConfiguredShort'), 'task_operation')
    const arg = toastAddMock.mock.calls[0]![0]
    expect(arg.description).toBe(locale === 'de' ? 'Notion ist nicht eingerichtet. Richte Notion in den Einstellungen ein.' : 'Notion is not set up. Set up Notion in the settings.')
  })

  it('does not trigger a Vue inject() warning when called outside component setup', () => {
    // Integration classes call useErrorHandler() after an await, with no active component.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { handleError } = useErrorHandler()
      handleError('Some error', 'task_sync')

      const injectWarnings = warnSpy.mock.calls.filter(args => String(args[0]).includes('inject()'))
      expect(injectWarnings).toHaveLength(0)
      expect(toastAddMock).toHaveBeenCalledTimes(1)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('resolves component provides (Toaster max) when called inside component setup', () => {
    const Child = defineComponent({
      setup() {
        useErrorHandler()
        return () => null
      },
    })
    const Parent = defineComponent({
      setup() {
        provide(toastMaxInjectionKey, 3)
        return () => h(Child)
      },
    })
    mount(Parent)

    expect(injected.toastMax).toBe(3)
  })

  describe('task_create', () => {
    beforeEach(() => {
      markNotionOfflineMock.mockReset()
      healthState.isNotionBroken = false
      healthState.isNotionOffline = false
    })

    it('shows the create message for an API-looking failure', () => {
      const { handleError } = useErrorHandler()
      handleError('Notion API error: task not found', 'task_create')
      expect(toastAddMock.mock.calls[0]![0].description).toBe('Die Aufgabe konnte nicht erstellt werden. Versuche es erneut.')
    })

    it('toasts again on an identical retry within the dedup window', () => {
      const { handleError } = useErrorHandler()
      handleError('Create boom', 'task_create')
      handleError('Create boom', 'task_create')
      expect(toastAddMock).toHaveBeenCalledTimes(2)
    })

    it('still deduplicates other contexts', () => {
      const { handleError } = useErrorHandler()
      handleError('Same boom', 'task_operation')
      handleError('Same boom', 'task_operation')
      expect(toastAddMock).toHaveBeenCalledTimes(1)
    })

    it('shows the create text for a network failure while already offline', () => {
      healthState.isNotionOffline = true
      const { handleError } = useErrorHandler()
      handleError(new TypeError('Failed to fetch'), 'task_create')
      expect(toastAddMock).toHaveBeenCalledTimes(1)
      expect(toastAddMock.mock.calls[0]![0].description).toBe('Die Aufgabe konnte nicht erstellt werden. Versuche es erneut.')
    })

    it('keeps the offline toast for a first network failure and marks offline', () => {
      const { handleError } = useErrorHandler()
      handleError(new TypeError('Failed to fetch'), 'task_create')
      expect(markNotionOfflineMock).toHaveBeenCalledTimes(1)
      expect(toastAddMock).toHaveBeenCalledTimes(1)
      expect(toastAddMock.mock.calls[0]![0].title).toBe('Offline')
    })

    it('does not toast again for other contexts when already offline', () => {
      healthState.isNotionOffline = true
      const { handleError } = useErrorHandler()
      handleError(new TypeError('Failed to fetch'), 'task_operation')
      expect(toastAddMock).not.toHaveBeenCalled()
    })

    it('on 401 keeps the specific create toast while Notion is broken and never opens the setup dialog (#319)', () => {
      healthState.isNotionBroken = true
      const { handleError } = useErrorHandler()
      handleError(Object.assign(new Error('Unauthorized'), { statusCode: 401 }), 'task_create')
      expect(markNotionBrokenMock).toHaveBeenCalledTimes(1)
      expect(toastAddMock).toHaveBeenCalledTimes(1)
      expect(toastAddMock.mock.calls[0]![0].description).toBe('Notion-Token ist ungültig. Überprüfe dein Token.')
    })

    it('keeps the specific text of a LocalizedError setup failure', () => {
      const { handleError } = useErrorHandler()
      handleError(new LocalizedError('errors.notionNotConfiguredShort'), 'task_create')
      expect(toastAddMock).toHaveBeenCalledTimes(1)
      expect(toastAddMock.mock.calls[0]![0].description).toBe('Notion ist nicht eingerichtet')
    })
  })
})
