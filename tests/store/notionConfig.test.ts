import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useNotionConfigStore } from '~/store/notionConfig'
import type { NotionConfig } from '~/types/notion'

// Mock useStatisticsBackfill before importing the store
const runConfigChangeBackfillMock = vi.fn().mockResolvedValue(undefined)
vi.mock('~/composables/useStatisticsBackfill', () => ({
  useStatisticsBackfill: () => ({
    runConfigChangeBackfill: runConfigChangeBackfillMock,
  }),
}))

const secretsMock = { available: false, remove: vi.fn().mockResolvedValue(undefined) }
vi.mock('~/composables/useSecrets', () => ({ useSecrets: () => secretsMock }))
const handleErrorMock = vi.fn()
vi.mock('~/composables/useErrorHandler', () => ({ useErrorHandler: () => ({ handleError: handleErrorMock }) }))

// import.meta.client is false in Node test environment, so backfill won't auto-trigger.
// We test backfill scheduling logic separately.

function makeConfig(overrides: Partial<NotionConfig> = {}): NotionConfig {
  return {
    token: 'test-token',
    databaseId: 'db-123',
    dataSourceId: null,
    propertyMapping: {
      title: 'Name',
      status: 'Status',
    },
    statusMapping: {
      today: 'Today',
      doing: 'Doing',
      done: 'Done',
    },
    ...overrides,
  }
}

describe('useNotionConfigStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    runConfigChangeBackfillMock.mockReset()
    secretsMock.available = false
    secretsMock.remove.mockReset().mockResolvedValue(undefined)
    handleErrorMock.mockReset()
  })

  describe('isConfigured', () => {
    it('returns false when config is null', () => {
      const store = useNotionConfigStore()
      expect(store.isConfigured).toBe(false)
    })

    it('returns false when token is missing', () => {
      const store = useNotionConfigStore()
      store.setConfig(makeConfig({ token: '' }))
      expect(store.isConfigured).toBe(false)
    })

    it('returns false when databaseId is missing', () => {
      const store = useNotionConfigStore()
      store.setConfig(makeConfig({ databaseId: '' }))
      expect(store.isConfigured).toBe(false)
    })

    it('returns true when token, databaseId, and propertyMapping are present', () => {
      const store = useNotionConfigStore()
      store.setConfig(makeConfig())
      expect(store.isConfigured).toBe(true)
    })
  })

  describe('hasDataSourceSelected', () => {
    it('returns false when config is null', () => {
      const store = useNotionConfigStore()
      expect(store.hasDataSourceSelected).toBe(false)
    })

    it('returns false when dataSourceId is null', () => {
      const store = useNotionConfigStore()
      store.setConfig(makeConfig({ dataSourceId: null }))
      expect(store.hasDataSourceSelected).toBe(false)
    })

    it('returns true when dataSourceId is set', () => {
      const store = useNotionConfigStore()
      store.setConfig(makeConfig({ dataSourceId: 'ds-456' }))
      expect(store.hasDataSourceSelected).toBe(true)
    })
  })

  describe('needsDataSourceMigration', () => {
    it('returns false when config is null', () => {
      const store = useNotionConfigStore()
      expect(store.needsDataSourceMigration).toBe(false)
    })

    it('returns true when config exists but dataSourceId is null', () => {
      const store = useNotionConfigStore()
      store.setConfig(makeConfig({ dataSourceId: null }))
      expect(store.needsDataSourceMigration).toBe(true)
    })

    it('returns false when dataSourceId is set', () => {
      const store = useNotionConfigStore()
      store.setConfig(makeConfig({ dataSourceId: 'ds-456' }))
      expect(store.needsDataSourceMigration).toBe(false)
    })
  })

  describe('setConfig', () => {
    it('stores the config value', () => {
      const store = useNotionConfigStore()
      const cfg = makeConfig({ dataSourceId: 'ds-1' })
      store.setConfig(cfg)
      expect(store.config).toEqual(cfg)
    })

    it('overwrites an existing config', () => {
      const store = useNotionConfigStore()
      store.setConfig(makeConfig({ dataSourceId: 'ds-1' }))
      store.setConfig(makeConfig({ dataSourceId: 'ds-2' }))
      expect(store.config?.dataSourceId).toBe('ds-2')
    })
  })

  describe('clearConfig', () => {
    it('sets config to null', async () => {
      const store = useNotionConfigStore()
      store.setConfig(makeConfig())
      expect(await store.clearConfig()).toBe(true)
      expect(store.config).toBeNull()
    })

    it('on desktop awaits the Keychain delete before clearing the config (#223 M2)', async () => {
      secretsMock.available = true
      let finishDelete: () => void = () => undefined
      secretsMock.remove.mockReturnValue(new Promise<void>((resolve) => { finishDelete = resolve }))
      const store = useNotionConfigStore()
      store.setConfig(makeConfig())

      const pending = store.clearConfig()
      await Promise.resolve()
      expect(store.config).not.toBeNull()
      finishDelete()
      expect(await pending).toBe(true)
      expect(secretsMock.remove).toHaveBeenCalledWith('notion-token')
      expect(store.config).toBeNull()
    })

    it('on desktop a failed Keychain delete keeps the config and reports the reset-specific message (#223 M2, #245 N2)', async () => {
      secretsMock.available = true
      const failure = new Error('keychain')
      secretsMock.remove.mockRejectedValue(failure)
      const store = useNotionConfigStore()
      store.setConfig(makeConfig())

      const before = JSON.stringify(store.config)
      expect(await store.clearConfig()).toBe(false)
      expect(JSON.stringify(store.config)).toBe(before)
      expect(handleErrorMock).toHaveBeenCalledWith(failure, 'secrets_reset')
    })
  })

  describe('updateDataSource', () => {
    it('throws when no existing config', () => {
      const store = useNotionConfigStore()
      expect(() => store.updateDataSource('ds-1')).toThrow()
    })

    it('updates dataSourceId on existing config', () => {
      const store = useNotionConfigStore()
      store.setConfig(makeConfig({ dataSourceId: null }))
      store.updateDataSource('ds-new')
      expect(store.config?.dataSourceId).toBe('ds-new')
    })

    it('updates dataSourceName when provided', () => {
      const store = useNotionConfigStore()
      store.setConfig(makeConfig())
      store.updateDataSource('ds-new', 'My Source')
      expect(store.config?.dataSourceName).toBe('My Source')
    })

    it('preserves existing dataSourceName when name not provided', () => {
      const store = useNotionConfigStore()
      store.setConfig(makeConfig({ dataSourceId: 'ds-old', dataSourceName: 'Old Name' }))
      store.updateDataSource('ds-new')
      expect(store.config?.dataSourceName).toBe('Old Name')
    })

    it('preserves existing dataSourceName when null is passed (null coalesces to existing)', () => {
      const store = useNotionConfigStore()
      store.setConfig(makeConfig({ dataSourceName: 'Old Name' }))
      store.updateDataSource('ds-new', null)
      // null ?? existingValue evaluates to existingValue, so the existing name is kept
      expect(store.config?.dataSourceName).toBe('Old Name')
    })
  })

  describe('checkNeedsDataSourceMigration', () => {
    it('returns false when config is null', () => {
      const store = useNotionConfigStore()
      expect(store.checkNeedsDataSourceMigration()).toBe(false)
    })

    it('returns true when config exists without dataSourceId', () => {
      const store = useNotionConfigStore()
      store.setConfig(makeConfig({ dataSourceId: null }))
      expect(store.checkNeedsDataSourceMigration()).toBe(true)
    })

    it('returns false when dataSourceId is present', () => {
      const store = useNotionConfigStore()
      store.setConfig(makeConfig({ dataSourceId: 'ds-1' }))
      expect(store.checkNeedsDataSourceMigration()).toBe(false)
    })
  })

  describe('fixUnplannedPropertyType', () => {
    it('does nothing when no unplanned mapping', () => {
      const store = useNotionConfigStore()
      store.setConfig(makeConfig())
      // Should not throw
      store.fixUnplannedPropertyType('select')
      expect(store.config?.propertyMapping.unplanned).toBeUndefined()
    })

    it('updates propertyType on existing unplanned mapping', () => {
      const store = useNotionConfigStore()
      store.setConfig(makeConfig({
        propertyMapping: {
          title: 'Name',
          status: 'Status',
          unplanned: {
            mode: 'value',
            valuePropertyName: 'Tags',
            matchValue: 'Unplanned',
            // propertyType intentionally omitted (the bug scenario)
          },
        },
      }))

      store.fixUnplannedPropertyType('multi_select')
      expect(store.config?.propertyMapping.unplanned?.propertyType).toBe('multi_select')
    })
  })
})
