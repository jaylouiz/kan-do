/**
 * @composable useSourceList
 * @description The rows of the "Verbindungen" page (#324, epic #264 section 6): derived from the sources
 * config (#326) and the per-source health (#318). The page only renders it.
 * @responsibility
 * - `connected`: Lokal always, then every connected integration, each with default flag, status line and the
 *   actions it offers
 * - `more`: the unconnected Notion (connectable) and Todoist (not yet available)
 * - Status per integration: warning "Verbindung prüfen" when broken or degraded, the last-sync line when
 *   healthy or merely offline, neutral "Wird geprüft…" before a first successful sync
 */
import { computed, getCurrentInstance, onBeforeUnmount, ref, type ComputedRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useBoardStore } from '~/store/board'
import { useIntegrationHealthStore } from '~/store/integrationHealth'
import { integrationLabel } from '~/lib/taskSources'
import { INTEGRATION_SOURCE_IDS, type IntegrationSourceId, type SourceId } from '~/types/taskSource'

export type SourceStatusTone = 'muted' | 'warning'

export interface ConnectedSourceRow {
  id: SourceId
  name: string
  icon: string
  isDefault: boolean
  statusText: string
  statusTone: SourceStatusTone
  /** The row offers "Als Standard festlegen": every row but the default one, once a second source is connected */
  canSetDefault: boolean
  /** "Verbindung reparieren": only an integration whose connection needs attention */
  canRepair: boolean
  /** The repair starts at the credentials (token step): the source is broken (rejected token, missing config), not just degraded */
  repairNeedsCredentials: boolean
  /** "<Source>-Einstellungen" and "Trennen": integrations only (Local has neither) */
  canConfigure: boolean
}

export interface MoreSourceRow {
  id: IntegrationSourceId
  name: string
  icon: string
  /** `connectable`: "Verbinden"; `soon`: "bald verfügbar", no button */
  state: 'connectable' | 'soon'
}

/** Source icons, bundled (ADR 012): neutral ink, no brand colour. */
export const SOURCE_ICONS: Record<SourceId, string> = {
  local: 'i-ph-desktop',
  notion: 'i-simple-icons-notion',
  todoist: 'i-simple-icons-todoist',
}

/** The integrations that can be connected from the page today. */
const CONNECTABLE: readonly IntegrationSourceId[] = ['notion']

/** Minutes since `timestamp`, never negative. */
export function minutesSince(timestamp: number, now: number): number {
  return Math.max(0, Math.floor((now - timestamp) / 60000))
}

export function useSourceList(): {
  connected: ComputedRef<ConnectedSourceRow[]>
  more: ComputedRef<MoreSourceRow[]>
} {
  const { t } = useI18n()
  const board = useBoardStore()
  const health = useIntegrationHealthStore()

  // The relative time must not freeze on an open page
  const now = ref(Date.now())
  if (getCurrentInstance()) {
    const timer = setInterval(() => { now.value = Date.now() }, 30_000)
    onBeforeUnmount(() => clearInterval(timer))
  }

  const syncedText = (timestamp: number): string => {
    const minutes = minutesSince(timestamp, now.value)
    if (minutes < 1) return t('sources.status.syncedNow')
    if (minutes < 60) return t('sources.status.syncedMinutes', { n: minutes })
    if (minutes < 60 * 24) return t('sources.status.syncedHours', { n: Math.floor(minutes / 60) })
    return t('sources.status.syncedDays', { n: Math.floor(minutes / (60 * 24)) })
  }

  const statusOf = (id: IntegrationSourceId): { text: string; tone: SourceStatusTone; attention: boolean; broken: boolean } => {
    const { status, lastSuccessfulSync } = health.healthOf(id)
    if (status === 'broken' || status === 'degraded') {
      return { text: t('sources.status.needsAttention'), tone: 'warning', attention: true, broken: status === 'broken' }
    }
    // Offline is not a fault to repair: the last-sync line stays, changes wait for the source
    if (lastSuccessfulSync !== null && status !== 'unconfigured') {
      return { text: syncedText(lastSuccessfulSync), tone: 'muted', attention: false, broken: false }
    }
    return { text: t('sources.status.checking'), tone: 'muted', attention: false, broken: false }
  }

  const connected = computed<ConnectedSourceRow[]>(() => {
    const defaultId = board.defaultSource ?? 'local'
    const ids: SourceId[] = ['local', ...board.connectedIntegrations]
    return ids.map((id): ConnectedSourceRow => {
      const isDefault = id === defaultId
      const base = {
        id,
        icon: SOURCE_ICONS[id],
        isDefault,
        canSetDefault: !isDefault,
      }
      if (id === 'local') {
        return {
          ...base,
          name: t('source.name.local'),
          statusText: t('sources.status.local'),
          statusTone: 'muted',
          canRepair: false,
          repairNeedsCredentials: false,
          canConfigure: false,
        }
      }
      const status = statusOf(id)
      return {
        ...base,
        name: integrationLabel(id),
        statusText: status.text,
        statusTone: status.tone,
        canRepair: status.attention,
        repairNeedsCredentials: status.broken,
        canConfigure: true,
      }
    })
  })

  const more = computed<MoreSourceRow[]>(() =>
    INTEGRATION_SOURCE_IDS
      .filter((id) => !board.isIntegrationConnected(id))
      .map((id) => ({
        id,
        name: integrationLabel(id),
        icon: SOURCE_ICONS[id],
        state: CONNECTABLE.includes(id) ? 'connectable' : 'soon',
      })),
  )

  return { connected, more }
}
