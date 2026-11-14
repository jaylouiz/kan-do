/**
 * @module lib/taskSources
 * @description Task source shape, its migration and the id an integration receives (epic #264, D1/D2).
 *
 * The normalisers are pure and idempotent. The same functions serve both migration paths so they
 * cannot drift: hydrate-time normalisation in the stores (web and desktop) and the desktop envelope
 * migration 1 -> 2 (`utils/dataFile/migrations.ts`). A normaliser returns its input untouched
 * (same reference) when nothing needs to change, which lets hydration skip the write-back (#273).
 */
import type { IBoardConfig } from '~/types/state'
import type { PendingMove, PendingSync, Task } from '~/types/task'
import {
  INTEGRATION_SOURCE_IDS,
  SOURCE_IDS,
  type IntegrationSourceId,
  type SourceId,
  type TaskSourcesConfig,
} from '~/types/taskSource'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isSourceId(value: unknown): value is SourceId {
  return (SOURCE_IDS as readonly unknown[]).includes(value)
}

export function isIntegrationSourceId(value: unknown): value is IntegrationSourceId {
  return (INTEGRATION_SOURCE_IDS as readonly unknown[]).includes(value)
}

/** The sources config of a board with exactly one source: Local alone, or one integration as default. */
export function singleSource(source: SourceId): TaskSourcesConfig {
  return source === 'local' ? { connected: [], default: 'local' } : { connected: [source], default: source }
}

/**
 * Old `boardConfig.taskService` -> sources. `null` (never onboarded) and anything unknown, such as the
 * removed Linear integration, stay "never onboarded" so the user lands in the welcome flow.
 */
export function sourcesFromLegacyService(service: unknown): TaskSourcesConfig | null {
  if (service === 'notion' || service === 'todoist') return singleSource(service)
  if (service === 'local' || service === 'example') return singleSource('local')
  return null
}

/** Validates a stored `sources` value: unknown or duplicate connections go, an unusable default becomes Local. */
export function normalizeSources(raw: unknown): TaskSourcesConfig | null {
  if (!isRecord(raw)) return null
  const connected = Array.isArray(raw.connected)
    ? [...new Set(raw.connected.filter(isIntegrationSourceId))]
    : []
  const wanted = raw.default
  const usable = wanted === 'local' || (isIntegrationSourceId(wanted) && connected.includes(wanted))
  const next: TaskSourcesConfig = { connected, default: usable ? (wanted as SourceId) : 'local' }
  const unchanged =
    Array.isArray(raw.connected)
    && raw.connected.length === connected.length
    && raw.connected.every((id, index) => id === connected[index])
    && raw.default === next.default
  return unchanged ? (raw as unknown as TaskSourcesConfig) : next
}

/**
 * Normalises a persisted board config: maps `taskService` to `sources`, drops it, and drops state of the
 * removed Linear integration (`linearApiKey`). An existing well-formed `sources` wins over a stale `taskService`.
 * `pendingSourceSwitch` (ADR 015) survives only as `true` next to an integration default; absent stays absent.
 */
export function normalizeBoardConfig(raw: unknown): IBoardConfig {
  if (!isRecord(raw)) return { sources: null }
  const {
    linearApiKey: _legacyLinearApiKey,
    taskService,
    sources,
    pendingSourceSwitch,
    ...rest
  } = raw
  // `sources` without a `connected` list and a `default` is half-written: fall back to `taskService`
  const hasSources = isRecord(sources) && Array.isArray(sources.connected) && typeof sources.default === 'string'
  const next = hasSources ? normalizeSources(sources) : sourcesFromLegacyService(taskService)
  // The one-shot switch marker only means something while an integration is the default source
  const switchPending = pendingSourceSwitch === true && next !== null && next.default !== 'local'
  return { ...rest, sources: next, ...(switchPending ? { pendingSourceSwitch: true } : {}) } as IBoardConfig
}

/** Source a legacy, source-less task belongs to: the board's only source before this change. */
export function legacyTaskSource(sources: TaskSourcesConfig | null): SourceId {
  return sources?.default ?? 'local'
}

/** Sources whose upstream stores time spent on a task (Notion). The adapters' `syncsTime` reads this. */
const TIME_SYNCING_SOURCES: readonly SourceId[] = ['notion']

/** Whether the source stores a task's time spent, i.e. whether a timer tick leaves something to push. */
export function sourceSyncsTime(source: SourceId): boolean {
  return TIME_SYNCING_SOURCES.includes(source)
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/**
 * A stored `pendingSync` made valid; the input itself when it already is, `undefined` when there is
 * nothing to keep (not a record). Missing parts take their neutral value so a half-written marker still
 * leads to a push.
 */
export function normalizePendingSync(raw: unknown): PendingSync | undefined {
  if (!isRecord(raw)) return undefined
  const since = isCount(raw.since) ? raw.since : 0
  const attempts = isCount(raw.attempts) ? Math.floor(raw.attempts) : 0
  const lastError = typeof raw.lastError === 'string' ? raw.lastError : null
  const upstreamDone = typeof raw.upstreamDone === 'boolean' ? raw.upstreamDone : undefined
  const exact = raw.since === since && raw.attempts === attempts && raw.lastError === lastError
    && raw.upstreamDone === upstreamDone && Object.keys(raw).length === (upstreamDone === undefined ? 3 : 4)
  return exact ? (raw as unknown as PendingSync) : { since, attempts, lastError, ...(upstreamDone === undefined ? {} : { upstreamDone }) }
}

function normalizePendingMove(raw: unknown): PendingMove | undefined {
  if (!isRecord(raw) || !isSourceId(raw.fromSource) || !isSourceId(raw.toSource)) return undefined
  const fromExternalId = typeof raw.fromExternalId === 'string' ? raw.fromExternalId : null
  const exact = raw.fromExternalId === fromExternalId && Object.keys(raw).length === 3
  return exact ? (raw as unknown as PendingMove) : { fromSource: raw.fromSource, fromExternalId, toSource: raw.toSource }
}

/**
 * Stamps `source` and `externalId` on tasks that lack them (or have only one). Legacy tasks take
 * `fallback`; an integration task's `externalId` is its `id` (the page id for Notion), a Local task has none.
 * The one exception is an integration task created while its source was unreachable: it carries `pendingSync`
 * and no `externalId` yet (#319); so is one moved here whose page is not created yet (`pendingMove`, #322). A Local
 * task has no upstream, so a marker on it goes; a `pendingMove` stays on any task (a move to Local still has the
 * origin copy to remove). `sourceData`, the raw upstream object the integrations once copied onto every task, goes (#334).
 * Returns the input array itself when no task changed.
 */
export function normalizeTasks<T>(tasks: T[], fallback: SourceId): T[] {
  let changed = false
  const next = tasks.map((task) => {
    if (!isRecord(task)) return task
    const source = isSourceId(task.source) ? task.source : fallback
    const pendingSync = source === 'local' ? undefined : normalizePendingSync(task.pendingSync)
    const pendingMove = normalizePendingMove(task.pendingMove)
    // An integration task with no `externalId` yet: made offline (marker) or moved here and not created (move)
    const uncreated = (pendingSync !== undefined || pendingMove !== undefined) && task.externalId === null
    const externalId = source === 'local'
      ? null
      : uncreated ? null
      : typeof task.externalId === 'string' && task.externalId !== '' ? task.externalId : task.id
    if (
      task.source === source
      && task.externalId === externalId
      && task.pendingSync === pendingSync
      && task.pendingMove === pendingMove
      && !('sourceData' in task)
    ) return task
    changed = true
    const { pendingSync: _sync, pendingMove: _move, sourceData: _sourceData, ...rest } = task
    return {
      ...rest,
      source,
      externalId,
      ...(pendingSync ? { pendingSync } : {}),
      ...(pendingMove ? { pendingMove } : {}),
    } as T
  })
  return changed ? next : tasks
}

/**
 * Pending deletes carried `service` before; the snapshot's `source` replaces it. Returns the input
 * record itself when nothing changed.
 */
export function normalizePendingDeletes<T>(pending: Record<string, T>, fallback: SourceId): Record<string, T> {
  let changed = false
  const next: Record<string, T> = {}
  for (const [key, entry] of Object.entries(pending)) {
    if (!isRecord(entry)) {
      next[key] = entry
      continue
    }
    const { service, task, ...rest } = entry
    const [normalizedTask] = normalizeTasks([task], isSourceId(service) ? service : fallback)
    if (!('service' in entry) && normalizedTask === task) {
      next[key] = entry as T
      continue
    }
    changed = true
    next[key] = { ...rest, task: normalizedTask } as T
  }
  return changed ? next : pending
}

/**
 * The id the task's integration knows it by. Integrations receive this, never `Task.id` (D1).
 * A Local task has none: reaching an integration with one is a bug, so this throws.
 */
export function externalIdOf(task: Pick<Task, 'id' | 'source' | 'externalId'>): string {
  if (task.externalId === null || task.externalId === undefined) {
    throw new Error(`Task ${task.id} (${task.source}) has no externalId`)
  }
  return task.externalId
}

/**
 * The page of a task at its source (#296): Notion's page, Todoist's task. `Task` carries no URL, so it is derived
 * from `source` + `externalId`. `null` for Local and for a task the source does not hold yet (create still pending).
 * The Todoist link shape (`app.todoist.com/app/task/<id>`) is unverified against a live account.
 */
export function sourceTaskUrl(task: Pick<Task, 'source' | 'externalId'>): string | null {
  if (!task.externalId) return null
  if (task.source === 'notion') return `https://www.notion.so/${task.externalId.replace(/-/g, '')}`
  if (task.source === 'todoist') return `https://app.todoist.com/app/task/${task.externalId}`
  return null
}

/** Whether the add form can create tasks in a source. Todoist cannot yet (no connect UI, no create): new tasks stay Local there. */
export function sourceCanCreate(source: SourceId): boolean {
  return source !== 'todoist'
}

/** i18n key of the delete label for a task of this source: Notion and Todoist say they delete upstream too, Local does not (#325). */
export function deleteLabelKey(source: SourceId): string {
  switch (source) {
    case 'notion': return 'task.delete.notion'
    case 'todoist': return 'task.delete.todoist'
    default: return 'task.delete.local'
  }
}

/** i18n key of the closing sheet's "goes to the trash" line for a deselected task: it names the source that is deleted from too (#237). */
export function deleteTrashKey(source: SourceId): string {
  switch (source) {
    case 'notion': return 'dayClose.trash.notion'
    case 'todoist': return 'dayClose.trash.todoist'
    default: return 'dayClose.trash.local'
  }
}

/** Display name of an integration. Brand names are not translated. */
export function integrationLabel(source: IntegrationSourceId): string {
  return source === 'notion' ? 'Notion' : 'Todoist'
}

/**
 * Where the user repairs a source's connection (the "Verbindung reparieren" entry of the sync popover, #319):
 * the Einstellungen page's Aufgabenquellen tab (`/settings?tab=sources`, #324, #394, #691), whose source row offers the repair; null for a source without one.
 */
export function repairRouteOf(source: IntegrationSourceId): string | null {
  return source === 'notion' ? '/settings?tab=sources' : null
}

/** A fresh app-level id for a Local-born task, or for an external task whose `externalId` is already taken as an `id`. */
export function generateTaskId(): string {
  return `local_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}
