import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { NotionDatabaseSchema } from '~/types/notion'

const api = vi.hoisted(() => ({
  searchDatabases: vi.fn(),
  searchDataSources: vi.fn(),
  getDataSource: vi.fn(),
  getDatabase: vi.fn(),
}))

vi.mock('~/integrations/NotionClientAPI', () => ({
  NotionClientAPI: vi.fn().mockImplementation(function () {
    return api
  }),
  NotionAPIError: class NotionAPIError extends Error {
    statusCode = 0
  },
}))
vi.mock('~/utils/featureFlags', () => ({ useFeatureFlags: () => ({ notionDataSourceSelection: true }) }))
vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: vi.fn() }),
}))

// eslint-disable-next-line import/first -- order-sensitive: mocks must be defined before importing the SUT
import WizardController from '~/components/notion/setup/wizard/WizardController.vue'
// eslint-disable-next-line import/first -- order-sensitive: mocks must be defined before importing the SUT
import { useNotionConfigStore } from '~/store/notionConfig'
// eslint-disable-next-line import/first -- order-sensitive: mocks must be defined before importing the SUT
import { usePropertyOptionsStore } from '~/store/propertyOptions'

const prop = (name: string, type: string) => ({ id: name, name, type }) as unknown as NotionDatabaseSchema[string]
const databaseSchema: NotionDatabaseSchema = { Name: prop('Name', 'title'), Legacy: prop('Legacy', 'select') }
const sourceASchema: NotionDatabaseSchema = { Name: prop('Name', 'title'), Alpha: prop('Alpha', 'select') }
const sourceBSchema: NotionDatabaseSchema = { Name: prop('Name', 'title'), Beta: prop('Beta', 'select') }

const MappingStepStub = { props: ['databaseSchema', 'defaultMapping'], template: '<div data-testid="mapping" />' }
const stubs = {
  TokenStep: true,
  DatabaseSelectionStep: true,
  CustomPropertiesStep: true,
  PriorityMappingStep: true,
  StatusMappingStep: true,
  MappingStep: MappingStepStub,
}

const databasesWithTwoSources = [
  {
    id: 'db-1',
    title: 'Projekte',
    dataSources: [
      { id: 'ds-a', name: 'A', databaseId: 'db-1', databaseTitle: 'Projekte' },
      { id: 'ds-b', name: 'B', databaseId: 'db-1', databaseTitle: 'Projekte' },
    ],
  },
]

const schemaKeys = (wrapper: ReturnType<typeof mount>) =>
  Object.keys((wrapper.findComponent(MappingStepStub).props('databaseSchema') as NotionDatabaseSchema) ?? {})

describe('WizardController schema source (#313)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.values(api).forEach((fn) => fn.mockReset())
    api.searchDatabases.mockResolvedValue({ results: databasesWithTwoSources })
    api.searchDataSources.mockResolvedValue({ results: [] })
    api.getDatabase.mockResolvedValue({ id: 'db-1', properties: databaseSchema })
    api.getDataSource.mockImplementation(async (id: string) => ({
      id,
      properties: id === 'ds-a' ? sourceASchema : sourceBSchema,
    }))
  })

  const mountSetup = async () => {
    const wrapper = mount(WizardController, { props: { token: 'tkn', mode: 'setup' }, global: { stubs, directives: { 'auto-animate': {} } } })
    await flushPromises()
    return wrapper
  }

  it('maps the properties of the selected data source, not of the database', async () => {
    const wrapper = await mountSetup()
    const vm = wrapper.vm as unknown as { selectedDatabase: string; selectedDataSource: string; nextStep: () => Promise<void> }
    vm.selectedDatabase = 'db-1'
    vm.selectedDataSource = 'ds-b'
    await vm.nextStep()
    await flushPromises()

    expect(api.getDataSource).toHaveBeenCalledWith('ds-b')
    expect(api.getDataSource).not.toHaveBeenCalledWith('ds-a')
    expect(schemaKeys(wrapper)).toEqual(['Name', 'Beta'])
    expect(api.getDatabase).not.toHaveBeenCalled()
  })

  it('falls back to the database schema when the data source has no properties', async () => {
    api.getDataSource.mockResolvedValue({ id: 'ds-b', properties: {} })
    const wrapper = await mountSetup()
    const vm = wrapper.vm as unknown as { selectedDatabase: string; selectedDataSource: string; nextStep: () => Promise<void> }
    vm.selectedDatabase = 'db-1'
    vm.selectedDataSource = 'ds-b'
    await vm.nextStep()
    await flushPromises()

    expect(api.getDatabase).toHaveBeenCalledWith('db-1')
    expect(schemaKeys(wrapper)).toEqual(['Name', 'Legacy'])
  })

  it('falls back to the database schema when the data source read fails', async () => {
    api.getDataSource.mockRejectedValue(new Error('403'))
    const wrapper = await mountSetup()
    const vm = wrapper.vm as unknown as { selectedDatabase: string; selectedDataSource: string; nextStep: () => Promise<void> }
    vm.selectedDatabase = 'db-1'
    vm.selectedDataSource = 'ds-b'
    await vm.nextStep()
    await flushPromises()

    expect(schemaKeys(wrapper)).toEqual(['Name', 'Legacy'])
  })

  describe('settings mode', () => {
    const configure = () => {
      const store = useNotionConfigStore()
      store.config = {
        token: 'tkn',
        databaseId: 'db-1',
        dataSourceId: 'ds-b',
        propertyMapping: { title: 'Name', status: 'Status' },
        statusMapping: { today: 'Today', doing: 'Doing', waiting: 'Waiting', done: 'Done' },
      } as unknown as typeof store.config
    }

    it('initializes topic/activity options from the data source schema', async () => {
      configure()
      const options = usePropertyOptionsStore()
      const init = vi.spyOn(options, 'initializeTopicAndActivityFromSchema')

      mount(WizardController, { props: { token: 'tkn', mode: 'settings' }, global: { stubs, directives: { 'auto-animate': {} } } })
      await flushPromises()

      expect(api.getDataSource).toHaveBeenCalledWith('ds-b')
      // the watchers on database/data source selection may refresh the schema more than once
      expect(init).toHaveBeenCalled()
      for (const call of init.mock.calls) expect(call[0]).toEqual(sourceBSchema)
    })

    it('still initializes topic/activity options on the database fallback path', async () => {
      configure()
      api.getDataSource.mockResolvedValue({ id: 'ds-b', properties: {} })
      const options = usePropertyOptionsStore()
      const init = vi.spyOn(options, 'initializeTopicAndActivityFromSchema')

      mount(WizardController, { props: { token: 'tkn', mode: 'settings' }, global: { stubs, directives: { 'auto-animate': {} } } })
      await flushPromises()

      expect(init).toHaveBeenCalledWith(databaseSchema, expect.objectContaining({ title: 'Name' }))
    })
  })
})
