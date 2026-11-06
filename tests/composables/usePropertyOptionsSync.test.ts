/**
 * #341: the tasks page's background read of the Notion property schema is not a setup flow. A 401 on it marks
 * Notion as broken (the sync button's popover offers the repair) and opens nothing by itself.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const getDatabaseSchema = vi.fn()
vi.mock('~/composables/useNotionIntegration', () => ({
  useNotionIntegration: () => ({ createInstance: () => ({ getDatabaseSchema }) }),
}))
const handleErrorMock = vi.fn()
vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: handleErrorMock }),
}))
vi.mock('~/store/notionConfig', () => ({
  useNotionConfigStore: () => ({ isConfigured: true, config: { databaseId: 'db-1', propertyMapping: {} } }),
}))

/* eslint-disable import/first -- order-sensitive: mocks must be registered before the SUT is imported */
import { usePropertyOptionsSync } from '~/composables/usePropertyOptionsSync'
import { useIntegrationHealthStore } from '~/store/integrationHealth'
/* eslint-enable import/first */

const rejected = (error: unknown) => getDatabaseSchema.mockRejectedValue(error)

describe('usePropertyOptionsSync.fetchSchemaOptions failures (#341)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    getDatabaseSchema.mockReset()
    handleErrorMock.mockReset()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('reads the schema without letting the integration report a failure', async () => {
    getDatabaseSchema.mockResolvedValue({})

    await usePropertyOptionsSync().fetchSchemaOptions()

    expect(getDatabaseSchema).toHaveBeenCalledWith('db-1', { report: false })
  })

  it('a 401 marks Notion broken and reports nothing itself', async () => {
    rejected(Object.assign(new Error('Unauthorized'), { statusCode: 401 }))

    await usePropertyOptionsSync().fetchSchemaOptions()

    const health = useIntegrationHealthStore()
    expect(health.statusOf('notion')).toBe('broken')
    expect(health.healthOf('notion').lastError).toBe('Unauthorized')
    expect(handleErrorMock).not.toHaveBeenCalled()
  })

  it('no connection marks Notion offline', async () => {
    rejected(Object.assign(new Error('Network error'), { statusCode: 0 }))

    await usePropertyOptionsSync().fetchSchemaOptions()

    expect(useIntegrationHealthStore().statusOf('notion')).toBe('offline')
  })

  it('any other failure of this one read leaves the health of the source alone', async () => {
    useIntegrationHealthStore().recordSuccessfulSync('notion')
    rejected(Object.assign(new Error('Bad gateway'), { statusCode: 502 }))

    await usePropertyOptionsSync().fetchSchemaOptions()

    expect(useIntegrationHealthStore().statusOf('notion')).toBe('healthy')
  })
})
