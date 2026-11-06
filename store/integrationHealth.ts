import { defineStore, acceptHMRUpdate } from 'pinia'
import { ref } from 'vue'
import type { IntegrationHealth, SourceHealth, SourceHealthMap } from '../types/integration'
import type { IntegrationSourceId, SourceId } from '../types/taskSource'
import { classifySyncFailure, emptySourceHealthMap, normalizeIntegrationHealthState, sourceProblems } from '../lib/integrationHealth'
import type { SourceProblem } from '../lib/integrationHealth'
import { appStorage } from '../lib/dataStorage'

/** What `healthOf` answers for Local: it has no upstream that can fail. */
const LOCAL_HEALTH: SourceHealth = { status: 'healthy', lastError: null, lastSuccessfulSync: null }

/** The board's last sync as the tasks store persisted it (epoch ms); the legacy health state had no per-source time. */
function storedLastSyncTimestamp(): number | null {
  try {
    const stored = appStorage.getItem('tasks-store')
    const time = stored ? Date.parse((JSON.parse(stored) as { lastSyncTimestamp?: unknown }).lastSyncTimestamp as string) : NaN
    return Number.isFinite(time) ? time : null
  } catch {
    return null
  }
}

/** Set by the deserializer while a stored blob in the old shape is read, consumed by `afterHydrate` right after. */
let hydratedLegacyShape = false

export const useIntegrationHealthStore = defineStore('integrationHealth', () => {
  // State: one entry per integration source (#318)
  const sources = ref<SourceHealthMap>(emptySourceHealthMap())

  // Getters (functions, so callers pass the source)
  const healthOf = (source: SourceId): SourceHealth => (source === 'local' ? LOCAL_HEALTH : sources.value[source])
  const statusOf = (source: SourceId): IntegrationHealth => healthOf(source).status
  const isBroken = (source: SourceId) => statusOf(source) === 'broken'
  const isOffline = (source: SourceId) => statusOf(source) === 'offline'
  /** A source whose last fetch failed in a way the user may have to act on. */
  const needsAttention = (source: SourceId) => ['broken', 'offline', 'degraded'].includes(statusOf(source))

  /** The connected sources that cannot sync, worst first (#319). */
  const problemsOf = (connected: readonly IntegrationSourceId[]): SourceProblem[] => sourceProblems(sources.value, connected)

  // Actions
  function set(source: IntegrationSourceId, patch: Partial<SourceHealth>) {
    sources.value[source] = { ...sources.value[source], ...patch }
  }

  function markBroken(source: IntegrationSourceId, reason?: string) {
    set(source, { status: 'broken', lastError: reason || null })
  }

  function markOffline(source: IntegrationSourceId, reason?: string) {
    set(source, { status: 'offline', lastError: reason || null })
  }

  function markDegraded(source: IntegrationSourceId, reason?: string) {
    set(source, { status: 'degraded', lastError: reason || null })
  }

  function markHealthy(source: IntegrationSourceId) {
    set(source, { status: 'healthy', lastError: null })
  }

  /**
   * Records a failed call to the source (a fetch, a write, a schema read) as the state it says: `offline`,
   * `broken` or `degraded`. Resolves to the status before, so a caller can tell the transition from healthy
   * (worth a toast) from a source that was already known to be down (quiet, #319).
   */
  function recordFailure(source: IntegrationSourceId, error: unknown): IntegrationHealth {
    const before = sources.value[source].status
    const message = error instanceof Error ? error.message : String(error)
    const failure = classifySyncFailure(error)
    if (failure === 'offline') markOffline(source, message)
    else if (failure === 'broken') markBroken(source, message)
    else markDegraded(source, message)
    return before
  }

  /** Disconnected or never set up: no status, no error. The last successful sync stays for the settings page. */
  function markUnconfigured(source: IntegrationSourceId) {
    set(source, { status: 'unconfigured', lastError: null })
  }

  /** A fresh connect (#320): no status, no error, no last sync of an earlier connection. */
  function resetSource(source: IntegrationSourceId) {
    set(source, { status: 'unconfigured', lastError: null, lastSuccessfulSync: null })
  }

  /** A sync of this source was merged into the board. */
  function recordSuccessfulSync(source: IntegrationSourceId, at: number = Date.now()) {
    set(source, { status: 'healthy', lastError: null, lastSuccessfulSync: at })
  }

  return {
    // State
    sources,

    // Getters
    healthOf,
    statusOf,
    isBroken,
    isOffline,
    needsAttention,
    problemsOf,

    // Actions
    markBroken,
    markOffline,
    markDegraded,
    markHealthy,
    markUnconfigured,
    resetSource,
    recordSuccessfulSync,
    recordFailure,
  }
}, {
  persist: {
    key: 'integration-health-store',
    // Pre-#318 state carried `notion` and `notionLastErrorReason`, which `$patch` would not even apply:
    // convert the stored blob while it is read, and write back only when that changed something (#273).
    serializer: {
      serialize: (state: unknown) => JSON.stringify(state),
      deserialize: (stored: string) => {
        const parsed: unknown = JSON.parse(stored)
        const normalised = normalizeIntegrationHealthState(parsed, storedLastSyncTimestamp())
        hydratedLegacyShape = normalised !== parsed
        return normalised
      },
    },
    afterHydrate: (ctx: { store: { $persist: () => void } }) => {
      if (!hydratedLegacyShape) return
      hydratedLegacyShape = false
      try {
        ctx.store.$persist()
      } catch {
        // Storage unavailable - the converted shape is persisted on the next mutation instead.
      }
    },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any)

// HMR support
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useIntegrationHealthStore, import.meta.hot))
}
