import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { toastAddMock } from '~/tests/mocks/nuxt-imports'
import { NotionIntegration } from '~/integrations/NotionIntegration'
import { useErrorHandler } from '~/composables/useErrorHandler'

const propertyMapping = { title: 'Name', status: 'Status', timeBox: 'TimeBox', timeSpent: 'TimeSpent', priority: 'Priority', topic: 'Topic' }
const statusMapping = { today: 'Heute', doing: 'Jetzt', waiting: 'Wartet', done: 'Erledigt' }

describe('Notion create failure feedback (#167)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    toastAddMock.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('toasts once with the create text when the caller reports the adapter failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      json: () => Promise.resolve({ message: 'Notion API error: task not found' }),
      text: () => Promise.resolve('Notion API error: task not found'),
    }))
    const ni = new NotionIntegration('tkn', 'db1', propertyMapping as any, statusMapping as any, undefined, 'ds-123')

    // Mirrors pages/tasks/add.vue: the caller owns the create toast
    const { handleError } = useErrorHandler()
    await ni.createTask({ title: 'Boom' } as any).catch((error: unknown) => handleError(error as Error, 'task_create'))

    expect(toastAddMock).toHaveBeenCalledTimes(1)
    expect(toastAddMock.mock.calls[0]![0].description).toBe('Die Aufgabe konnte nicht erstellt werden. Versuche es erneut.')
  })
})
