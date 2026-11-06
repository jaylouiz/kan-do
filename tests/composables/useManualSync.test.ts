import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTasksStore } from '~/store/tasks'

import { useManualSync } from '~/composables/useManualSync'

const calls: string[] = []
const syncPendingChanges = vi.fn(async () => { calls.push('push') })
const fetchTasks = vi.fn(async () => { calls.push('fetch') })
vi.mock('~/composables/useTaskSync', () => ({ useTaskSync: () => ({ syncPendingChanges }) }))
const forceBackfill = vi.fn(async () => { calls.push('backfill') })
vi.mock('~/composables/useStatisticsBackfill', () => ({ useStatisticsBackfill: () => ({ forceBackfill }) }))
vi.mock('~/composables/useIntegrationManager', () => ({ useIntegrationManager: () => ({ fetchTasks }) }))

describe('useManualSync', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    calls.length = 0
    syncPendingChanges.mockClear()
    fetchTasks.mockClear()
    forceBackfill.mockClear()
  })

  it('pushes pending changes, fetches, then backfills the archive (#670: the Statistik button is gone), with the loading flag held around both', async () => {
    const tasks = useTasksStore()
    const { resync } = useManualSync()
    const seenLoading: boolean[] = []
    syncPendingChanges.mockImplementationOnce(async () => { seenLoading.push(tasks.isLoading); calls.push('push') })
    fetchTasks.mockImplementationOnce(async () => { seenLoading.push(tasks.isLoading); calls.push('fetch') })
    forceBackfill.mockImplementationOnce(async () => { seenLoading.push(tasks.isLoading); calls.push('backfill') })

    await resync()

    expect(calls).toEqual(['push', 'fetch', 'backfill'])
    expect(seenLoading).toEqual([true, true, true])
    expect(tasks.isLoading).toBe(false)
  })

  it('clears the loading flag when the fetch fails', async () => {
    const tasks = useTasksStore()
    fetchTasks.mockRejectedValueOnce(new Error('offline'))

    await expect(useManualSync().resync()).rejects.toThrow('offline')

    expect(tasks.isLoading).toBe(false)
    expect(forceBackfill).not.toHaveBeenCalled()
  })

  it('says "not updated yet" before the first sync and counts minutes afterwards', () => {
    const tasks = useTasksStore()
    const { lastSyncText } = useManualSync()
    expect(lastSyncText.value).toBe('Noch nicht aktualisiert')

    tasks.lastSyncTimestamp = new Date(Date.now() - 3 * 60000)
    expect(lastSyncText.value).toBe('Vor 3 Minuten aktualisiert')
  })
})
