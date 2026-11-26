/**
 * #742: the public web instance offers no Notion. A Notion source stored there (an earlier setup, an import) is paused:
 * never fetched, never written, the stored config untouched, the board opens on Local. Sequences: a refresh on a paused
 * board twice, then the same board in a build that has Notion (desktop) fetches it again.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import { setPublicCloud } from '../helpers/publicCloud'

const handleErrorMock = vi.fn()
vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: handleErrorMock, handleSuccess: vi.fn() }),
}))
vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({ recordTaskCompletion: vi.fn(), syncExistingDoneTasks: vi.fn() }),
}))
vi.mock('~/composables/useNotionDataSource', () => ({
  useNotionDataSource: () => ({ ensureDataSourceConfigured: vi.fn().mockResolvedValue(true) }),
}))
const fetchNotion = vi.fn<() => Promise<Task[]>>()
const createInstance = vi.fn(() => ({ fetchActiveBoardTasks: fetchNotion, listReadInParts: false, heldTimeSeconds: (s: number) => s, timeIsWritable: () => Promise.resolve(true) }))
vi.mock('~/composables/useNotionIntegration', () => ({
  useNotionIntegration: () => ({ isConfigured: { value: true }, createInstance }),
}))
vi.mock('~/store/notionConfig', () => ({
  useNotionConfigStore: () => ({ clearConfig: () => Promise.resolve(true), isConfigured: true, hasDataSourceSelected: true, setNotPlannedLimited: () => {}, config: { token: 't', statusMapping: { archive: null } } }),
}))

/* eslint-disable import/first -- order-sensitive: mocks must be registered before the SUT is imported */
import { useIntegrationManager } from '~/composables/useIntegrationManager'
import { useTaskSources } from '~/composables/useTaskSources'
import { useSourceConnections } from '~/composables/useSourceConnections'
import { useSourceList } from '~/composables/useSourceList'
import { useBoardStore } from '~/store/board'
import { useTasksStore } from '~/store/tasks'
import { isNotionAvailable, isSourceAvailable } from '~/utils/publicCloud'
/* eslint-enable import/first */

function task(id: string, source: Task['source']): Task {
  return {
    id, source, externalId: source === 'local' ? null : id, title: `Task ${id}`, status: TaskStatus.Open, activity: null, topic: null,
    topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null,
  }
}

describe('Notion on the public web instance (#742)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    fetchNotion.mockReset()
    createInstance.mockClear()
    handleErrorMock.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => setPublicCloud(false))

  it('availability: only the public build without Tauri lacks Notion; other sources are never affected', () => {
    expect(isNotionAvailable()).toBe(true)
    setPublicCloud(true)
    expect(isNotionAvailable()).toBe(false)
    expect(isSourceAvailable('notion')).toBe(false)
    expect(isSourceAvailable('local')).toBe(true)
    expect(isSourceAvailable('todoist')).toBe(true)
    ;(window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__ = {}
    try {
      expect(isNotionAvailable()).toBe(true) // the desktop app keeps Notion, whatever the flag
    } finally {
      delete (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__
    }
  })

  it('a stored Notion source is paused: Local is the default, nothing fetches or writes Notion, the stored config stays', async () => {
    setPublicCloud(true)
    const board = useBoardStore()
    board.setSources({ connected: ['notion'], default: 'notion' })
    const tasks = useTasksStore()
    tasks.setTasks([task('l1', 'local'), task('n1', 'notion')])

    expect(board.connectedIntegrations).toEqual([])
    expect(board.pausedIntegrations).toEqual(['notion'])
    expect(board.isIntegrationConnected('notion')).toBe(false)
    expect(board.defaultSource).toBe('local')
    expect(useIntegrationManager().isIntegrationConfigured()).toBe(true) // the board opens

    // Refresh twice: no Notion call, no error, and the local data (Notion's cached copy too) is kept
    await useIntegrationManager().fetchTasks()
    await useIntegrationManager().fetchTasks()
    expect(fetchNotion).not.toHaveBeenCalled()
    expect(createInstance).not.toHaveBeenCalled()
    expect(handleErrorMock).not.toHaveBeenCalled()
    expect(tasks.tasks.map((t) => t.id).sort()).toEqual(['l1', 'n1'])

    // A write to a Notion task fails before any request leaves the browser
    const adapter = useTaskSources().adapterFor('notion')
    expect(adapter.isConfigured()).toBe(false)
    await expect(adapter.update(task('n1', 'notion'))).rejects.toThrow()
    expect(createInstance).not.toHaveBeenCalled()

    expect(board.boardConfig.sources).toEqual({ connected: ['notion'], default: 'notion' })

    // The same stored board loaded in a build with Notion (desktop, dev; the flag is a build constant) syncs it again
    const stored = JSON.parse(JSON.stringify(board.boardConfig.sources))
    setPublicCloud(false)
    setActivePinia(createPinia())
    const desktopBoard = useBoardStore()
    desktopBoard.setSources(stored!)
    fetchNotion.mockResolvedValue([task('n1', 'notion')])
    expect(desktopBoard.defaultSource).toBe('notion')
    await useIntegrationManager().fetchTasks()
    expect(fetchNotion).toHaveBeenCalledOnce()
  })

  it('Speicherorte: the paused Notion row says why and offers only Trennen; an unconnected Notion is "Desktop app only" (state cloudUnavailable)', () => {
    setPublicCloud(true)
    const board = useBoardStore()
    board.setSources({ connected: ['notion'], default: 'notion' })
    const { connected, more } = useSourceList()
    expect(connected.value.map((row) => row.id)).toEqual(['local', 'notion'])
    expect(connected.value[0]).toMatchObject({ id: 'local', isDefault: true })
    expect(connected.value[1]).toMatchObject({
      id: 'notion', isDefault: false, statusText: 'Nur in der Desktop-App verfügbar. Deine lokalen Aufgaben bleiben erhalten.',
      canSetDefault: false, canRepair: false, canConfigure: false, canDisconnect: true,
    })
    expect(connected.value[0]).toMatchObject({ canDisconnect: false })
    expect(more.value.map((row) => row.id)).not.toContain('notion')

    board.setSources({ connected: [], default: 'local' })
    expect(more.value.find((row) => row.id === 'notion')).toMatchObject({ state: 'cloudUnavailable' })
  })

  it('a paused Notion source can be disconnected: no sync offer, the stored config and its cached tasks go, Local stays', async () => {
    setPublicCloud(true)
    const board = useBoardStore()
    board.setSources({ connected: ['notion'], default: 'notion' })
    const tasks = useTasksStore()
    tasks.setTasks([task('l1', 'local'), task('n1', 'notion')])
    const { disconnectPlan, disconnectSource } = useSourceConnections()

    expect(disconnectPlan('notion')).toMatchObject({ source: 'notion', taskCount: 1, reachable: false })
    const result = await disconnectSource('notion', { syncFirst: true }) // a sync offer is never made; it must not run
    expect(result).toMatchObject({ ok: true, removedTaskCount: 1 })
    expect(fetchNotion).not.toHaveBeenCalled()
    expect(createInstance).not.toHaveBeenCalled()
    expect(board.pausedIntegrations).toEqual([])
    expect(board.boardConfig.sources).toEqual({ connected: [], default: 'local' })
    expect(tasks.tasks.map((t) => t.id)).toEqual(['l1'])
    expect(disconnectPlan('notion')).toBeNull()
  })
})
