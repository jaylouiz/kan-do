/**
 * @module dataFile/migrations
 * @description Schema migrations for `kan-do-data.json` (#222, ADR 008). They run on the raw envelope
 * before any store hydrates, in order, from the file's `schemaVersion` to `CURRENT_SCHEMA_VERSION`.
 * A file with a higher version is never down-migrated: it hydrates read-only.
 *
 * To add one: bump `CURRENT_SCHEMA_VERSION` here and `SCHEMA_VERSION` in `src-tauri/src/data_file.rs`
 * (a Vitest guard compares them) and append `{ from, to, up }`. A step must change at least one store
 * value, because Rust only rewrites the file when a store differs. The Map-to-Record era is
 * pre-baseline: no migration for it exists. History: 1 is the baseline, 2 adds task sources (#326).
 */
import { CURRENT_SCHEMA_VERSION, type DataEnvelope } from './envelope'
import { legacyTaskSource, normalizeBoardConfig, normalizePendingDeletes, normalizeTasks } from '~/lib/taskSources'

export interface Migration {
  from: number
  to: number
  /** Receives a private copy of the envelope and returns the migrated one. */
  up: (envelope: DataEnvelope) => DataEnvelope
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 1 -> 2 (#326, epic #264 D2): `boardConfig.taskService` becomes `boardConfig.sources`, and every task
 * (and the snapshot of every pending delete) gets `source` + `externalId`. It runs the same normalisers
 * as the stores' hydrate-time path, so both give the same result. It always writes `board-store`, which
 * is what makes Rust rewrite the file at version 2 even for an otherwise empty one.
 */
export function migrateTaskSources(envelope: DataEnvelope): DataEnvelope {
  const stores = { ...envelope.stores }

  const board = isRecord(stores['board-store']) ? stores['board-store'] : {}
  const boardConfig = normalizeBoardConfig(board.boardConfig)
  stores['board-store'] = { ...board, boardConfig }

  const fallback = legacyTaskSource(boardConfig.sources)
  const tasksStore = stores['tasks-store']
  if (isRecord(tasksStore)) {
    const next: Record<string, unknown> = { ...tasksStore }
    if (Array.isArray(tasksStore.tasks)) next.tasks = normalizeTasks(tasksStore.tasks, fallback)
    if (isRecord(tasksStore.pendingDeletes)) next.pendingDeletes = normalizePendingDeletes(tasksStore.pendingDeletes, fallback)
    stores['tasks-store'] = next
  }
  return { ...envelope, stores }
}

export const MIGRATIONS: readonly Migration[] = [
  { from: 1, to: 2, up: migrateTaskSources },
]

export interface MigrationOptions {
  migrations?: readonly Migration[]
  current?: number
  /**
   * The mandatory pre-migration backup (#224): called once with the untouched file content before the
   * first step. A rejection stops the migration, so the file stays as it is. Required whenever a
   * migration is pending; `initDataStorage` passes `backend.backup('pre-migration')`.
   */
  beforeMigrate?: (raw: DataEnvelope) => void | Promise<void>
}

export type MigrationOutcome =
  | { kind: 'current'; envelope: DataEnvelope }
  | { kind: 'migrated'; envelope: DataEnvelope }
  /** Written by a newer app: hydrate as is, never write. */
  | { kind: 'read-only'; envelope: DataEnvelope }

export async function runMigrations(raw: DataEnvelope, options: MigrationOptions = {}): Promise<MigrationOutcome> {
  const steps = options.migrations ?? MIGRATIONS
  const current = options.current ?? CURRENT_SCHEMA_VERSION
  const hook = options.beforeMigrate

  if (raw.schemaVersion > current) return { kind: 'read-only', envelope: raw }
  if (raw.schemaVersion === current) return { kind: 'current', envelope: raw }

  let envelope = structuredClone(raw)
  let announced = false
  while (envelope.schemaVersion < current) {
    const step = steps.find(candidate => candidate.from === envelope.schemaVersion)
    if (!step || step.to <= step.from || step.to > current) {
      throw new Error(`No migration from schema ${envelope.schemaVersion}`)
    }
    if (!announced) {
      if (!hook) throw new Error('A migration needs a pre-migration backup hook')
      await hook(raw)
      announced = true
    }
    envelope = { ...step.up(structuredClone(envelope)), schemaVersion: step.to }
  }
  return { kind: 'migrated', envelope }
}
