/**
 * @composable useManualSync
 * @description "Jetzt synchronisieren" from any page (#470): push local changes, then fetch every source. Moved out of
 * pages/tasks.vue so the Mehr panel can run it where the board is not mounted.
 * @responsibility `resync()` (loading flag, `syncPendingChanges()`, `fetchTasks()`, then `forceBackfill()` of the Notion archive, flag cleared in `finally`) and
 * `lastSyncText` ("vor n Min."), the same wording the old sync tooltip used.
 */
import { computed } from 'vue'
import { useTasksStore } from '~/store/tasks'
import { useTaskSync } from '~/composables/useTaskSync'
import { useStatisticsBackfill } from '~/composables/useStatisticsBackfill'
import { useIntegrationManager } from '~/composables/useIntegrationManager'
import { useLocaleFormat } from '~/composables/useLocaleFormat'

export function useManualSync() {
  const tasksStore = useTasksStore()
  const { syncPendingChanges } = useTaskSync()
  const { fetchTasks } = useIntegrationManager()
  const { forceBackfill } = useStatisticsBackfill()
  const { formatMinutesAgo } = useLocaleFormat()

  const isLoading = computed(() => tasksStore.isLoading)

  const lastSyncText = computed((): string => {
    const stamp = tasksStore.lastSyncTimestamp
    if (!stamp) return formatMinutesAgo(null)
    const timestamp = typeof stamp === 'number' ? stamp : new Date(stamp).getTime()
    return formatMinutesAgo(Math.floor((Date.now() - timestamp) / 60000))
  })

  async function resync(): Promise<void> {
    // Push local time tracking to the integration first, then refresh data
    tasksStore.setLoading(true)
    try {
      await syncPendingChanges()
      await fetchTasks()
      // The Statistik page's own sync button is gone (#670): this is the manual archive backfill now (no-op without a Notion archive status)
      await forceBackfill()
    } finally {
      tasksStore.setLoading(false)
    }
  }

  return { resync, lastSyncText, isLoading }
}
