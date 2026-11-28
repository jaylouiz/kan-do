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
import { translate } from '~/lib/i18n'
import type { ErrorContext } from '~/lib/errorMessages'
import { SOURCE_META } from '~/utils/sourceMeta'
import type { CreateUncertain, PendingClear, PendingMove, PendingSync, Task } from '~/types/task'
import {
  INTEGRATION_SOURCE_IDS,
  SOURCE_IDS,
  type IntegrationSourceId,
  type SourceCapabilities,
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

/**
 * The sources config of a board with exactly one source: Local alone, or one integration as default. A source that
 * can never be the default (Apple Reminders, `sourceCanBeDefault`) is connected beside Local, which stays the default.
 */
export function singleSource(source: SourceId): TaskSourcesConfig {
  if (source === 'local') return { connected: [], default: 'local' }
  return { connected: [source], default: sourceCanBeDefault(source) ? source : 'local' }
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
  const usable = wanted === 'local' || (isIntegrationSourceId(wanted) && connected.includes(wanted) && sourceCanBeDefault(wanted))
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

/** A stored create doubt (#528) when it is well formed, else `undefined`; the input itself when it is already exact. */
export function normalizeCreateUncertain(raw: unknown): CreateUncertain | undefined {
  return isRecord(raw) && isCount(raw.since) && typeof raw.title === 'string' && (raw.at === undefined || isCount(raw.at))
    ? raw as unknown as CreateUncertain
    : undefined
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
  // #528: a malformed value reads as none, which only costs the lookup before the next create
  const doubt = normalizeCreateUncertain(raw.createUncertain)
  // #553: the day a failed date write is retried for; an older `true` or any non-day value reads as none (never writes)
  const dateWrite = typeof raw.dateWrite === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.dateWrite) ? raw.dateWrite : undefined
  // #780: the clears a push still has to write; unknown entries are dropped, a malformed value reads as none
  const clears = normalizeClears(raw.clears)
  const exact = raw.since === since && raw.attempts === attempts && raw.lastError === lastError
    && raw.upstreamDone === upstreamDone && raw.createUncertain === doubt && (doubt === undefined || Object.keys(doubt).length === (doubt.at === undefined ? 2 : 3))
    && raw.dateWrite === dateWrite && raw.clears === clears
    && Object.keys(raw).length === 3 + (upstreamDone === undefined ? 0 : 1) + (doubt === undefined ? 0 : 1) + (dateWrite === undefined ? 0 : 1) + (clears === undefined ? 0 : 1)
  return exact ? (raw as unknown as PendingSync) : {
    since, attempts, lastError,
    ...(upstreamDone === undefined ? {} : { upstreamDone }),
    ...(doubt === undefined ? {} : { createUncertain: { since: doubt.since, ...(doubt.at === undefined ? {} : { at: doubt.at }), title: doubt.title } }),
    ...(dateWrite === undefined ? {} : { dateWrite }),
    ...(clears === undefined ? {} : { clears }),
  }
}

const PENDING_CLEARS: readonly PendingClear[] = ['timeBox', 'unplanned']

/**
 * The clears a stored marker still has to write (#780): a well-formed list comes back as it is (no write at hydration),
 * unknown or repeated entries are dropped, anything else (and an empty list) reads as none.
 */
function normalizeClears(raw: unknown): PendingClear[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const kept = PENDING_CLEARS.filter((field) => raw.includes(field))
  if (kept.length === 0) return undefined
  return kept.length === raw.length ? (raw as PendingClear[]) : kept
}

/**
 * A stored `pendingMove`, or `undefined` when it is not one. Every optional field is additive and a malformed value
 * reads as none: `fromSourceNotPlanned` (#357) survives the read, `fromCreateUncertain` (#538) only while the origin
 * page has no id, and `fromUpstreamDone` (#781, the origin's done state for the way back) reads as "not completed".
 */
function normalizePendingMove(raw: unknown): PendingMove | undefined {
  if (!isRecord(raw) || !isSourceId(raw.fromSource) || !isSourceId(raw.toSource)) return undefined
  const fromExternalId = typeof raw.fromExternalId === 'string' ? raw.fromExternalId : null
  const fromSourceNotPlanned = typeof raw.fromSourceNotPlanned === 'string' ? raw.fromSourceNotPlanned : undefined
  // #781: what the origin held the task as; a malformed value reads as none ("not completed" on the way back)
  const fromUpstreamDone = typeof raw.fromUpstreamDone === 'boolean' ? raw.fromUpstreamDone : undefined
  // #538: the doubt of an origin create is kept only while the origin page has no id; a malformed value reads as none
  const held = fromExternalId === null ? normalizeCreateUncertain(raw.fromCreateUncertain) : undefined
  const doubt = held === undefined ? undefined : { since: held.since, ...(held.at === undefined ? {} : { at: held.at }), title: held.title }
  const exact = raw.fromExternalId === fromExternalId && raw.fromSourceNotPlanned === fromSourceNotPlanned
    && raw.fromUpstreamDone === fromUpstreamDone
    && (doubt === undefined || held === undefined ? raw.fromCreateUncertain === undefined : (held === raw.fromCreateUncertain && Object.keys(held).length === Object.keys(doubt).length))
    && Object.keys(raw).length === 3 + (fromSourceNotPlanned === undefined ? 0 : 1) + (doubt === undefined ? 0 : 1)
      + (fromUpstreamDone === undefined ? 0 : 1)
  return exact ? (raw as unknown as PendingMove) : {
    fromSource: raw.fromSource, fromExternalId, toSource: raw.toSource,
    ...(fromSourceNotPlanned === undefined ? {} : { fromSourceNotPlanned }),
    ...(fromUpstreamDone === undefined ? {} : { fromUpstreamDone }),
    ...(doubt === undefined ? {} : { fromCreateUncertain: doubt }),
  }
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

/**
 * Where a source lives, for "<Source> öffnen" (#369): Notion's database page (needs the database id; `null` without
 * it), Todoist's app, `null` for Local. The Todoist address is unverified against a live account, like `sourceTaskUrl`'s.
 */
export function sourceHomeUrl(source: SourceId, ids: { notionDatabaseId?: string | null } = {}): string | null {
  if (source === 'notion') return ids.notionDatabaseId ? `https://www.notion.so/${ids.notionDatabaseId.replace(/-/g, '')}` : null
  if (source === 'todoist') return 'https://app.todoist.com/app/today'
  return null
}

/**
 * What a source does not allow (#551). A source that is not listed allows everything (Local, Notion). Todoist cannot create
 * yet (no connect UI, no create): new tasks stay Local there. Apple Reminders is read-only in kan-do: a done tick is the one
 * write (title and notes stay Reminders', no create, no delete, no move out). These are the same flags the adapters expose as
 * `TaskSourceAdapter.capabilities`; the consumers (move targets, add target, menus, sheet) ask `sourceCan`, never the
 * source's name.
 */
export const SOURCE_CAPABILITIES: Partial<Record<SourceId, SourceCapabilities>> = {
  todoist: { create: false, remove: true, moveOut: true, editText: true },
  reminders: { create: false, remove: false, moveOut: false, editText: false },
}

/** Whether `source` allows `capability` (absent from the table: yes). */
export function sourceCan(source: SourceId, capability: keyof SourceCapabilities): boolean {
  return SOURCE_CAPABILITIES[source]?.[capability] ?? true
}

/** Sources that are never the board's default source: Reminders is read-only (no create), and a cold start reads its permission as unconfigured. */
const NEVER_DEFAULT_SOURCES: readonly SourceId[] = ['reminders']

/** Whether `source` may be the default source (settings row, `setDefaultSource`, a stored or imported config). */
export function sourceCanBeDefault(source: SourceId): boolean {
  return !NEVER_DEFAULT_SOURCES.includes(source)
}

/**
 * Sources whose date is the plan (#553, `TaskSourceAdapter.planningByDate`, which reads this table): their
 * `Task.sourceNotPlanned` is what the date says, not a status kan-do wrote, so a status write leaves it as it is.
 */
const PLANS_BY_DATE_SOURCES: readonly SourceId[] = ['reminders']

/** Whether `source` plans by date (Apple Reminders). The store asks here, the sync layer asks the adapter. */
export function sourcePlansByDate(source: SourceId): boolean {
  return PLANS_BY_DATE_SOURCES.includes(source)
}

/** Whether the add form can create tasks in a source (and a task can be moved into it). */
export function sourceCanCreate(source: SourceId): boolean {
  return sourceCan(source, 'create')
}

/** i18n key of the delete label for a task of this source: Notion and Todoist say they delete upstream too, Local does not (#325). */
export function deleteLabelKey(source: SourceId): string {
  switch (source) {
    case 'notion': return 'task.delete.notion'
    case 'todoist': return 'task.delete.todoist'
    default: return 'task.delete.local'
  }
}

/** Display name of an integration: the source name key (`SOURCE_META`; the brand names Notion and Todoist read the same in both languages). */
export function integrationLabel(source: IntegrationSourceId): string {
  return translate(SOURCE_META[source].nameKey)
}

/**
 * The error context a source's setup or access failure is reported under (`SourceNotConfiguredError`, a revoked
 * permission): the context picks the localized message and marks the source `broken` (#319, #551).
 */
export const SETUP_ERROR_CONTEXTS: Record<IntegrationSourceId, ErrorContext> = {
  notion: 'notion_setup',
  todoist: 'todoist_setup',
  reminders: 'reminders_access',
}

/**
 * Where the user repairs a source's connection (the "Verbindung reparieren" entry of the sync popover, #319):
 * the Einstellungen page's Speicherorte tab (`/settings?tab=sources`, #324, #394, #691), whose source row offers the repair; null for a source without one.
 */
export function repairRouteOf(source: IntegrationSourceId): string | null {
  return source === 'notion' ? '/settings?tab=sources' : null
}

/** A fresh app-level id for a Local-born task, or for an external task whose `externalId` is already taken as an `id`. */
export function generateTaskId(): string {
  return `local_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}
