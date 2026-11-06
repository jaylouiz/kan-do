/**
 * @module dataFile/exportImport
 * @description Pure builders and parsers for the portable JSON export and import (#224, ADR 011). No
 * Tauri imports, so a web variant can reuse them. Both directions strip `SECRET_STATE_PATHS`
 * (lib/secrets.ts): an export never carries a token, and an edited file with a token never reaches
 * the data file. Keychain values are untouched.
 */
import { PERSISTED_KEYS } from '~/lib/dataStorage'
import type { DataStores } from '~/types/dataFile'
import { CURRENT_SCHEMA_VERSION, isDataEnvelope, type DataEnvelope } from './envelope'
import { stripSecretPaths } from './stripSecrets'

/** Returns a deep copy of `stores` without any secret leaf; the input is not modified. */
export function stripSecrets(stores: DataStores): DataStores {
  const clean = structuredClone(stores)
  for (const [key, state] of Object.entries(clean)) stripSecretPaths(key, state)
  return clean
}

export interface ExportSource {
  stores: DataStores
  /** This device's id, written as `writtenBy`. */
  deviceId: string
  appVersion: string
}

export interface BuiltExport {
  /** `kan-do-export-<yyyy-mm-dd>.json` in the user's local date. */
  fileName: string
  /** Pretty-printed envelope, newline terminated. */
  text: string
}

function localDate(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** The current state as a plain envelope without secrets. */
export function buildExport(source: ExportSource, now: Date = new Date()): BuiltExport {
  const envelope: DataEnvelope = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    writtenAt: now.toISOString(),
    writtenBy: source.deviceId,
    appVersion: source.appVersion,
    stores: stripSecrets(source.stores),
  }
  return { fileName: `kan-do-export-${localDate(now)}.json`, text: `${JSON.stringify(envelope, null, 2)}\n` }
}

export type ImportFailure = 'invalid' | 'not-kan-do' | 'newer-schema'

export type ParsedImport =
  | {
      ok: true
      /** Stripped, re-serialised envelope: this is what is handed to Rust. */
      text: string
      schemaVersion: number
      taskCount: number | null
      writtenAt: string | null
    }
  | { ok: false; reason: ImportFailure }

function taskCountOf(stores: DataStores): number | null {
  const tasks = (stores['tasks-store'] as { tasks?: unknown } | undefined)?.tasks
  return Array.isArray(tasks) ? tasks.length : null
}

/**
 * Validates an import file. Junk, non-envelopes and files without any of the app's stores are
 * rejected, a newer schema is refused (never down-migrated), unknown store keys are dropped and
 * secrets are stripped again. Older schemas pass and are migrated on load.
 */
export function parseImport(text: string, supportedSchema: number = CURRENT_SCHEMA_VERSION): ParsedImport {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  if (!isDataEnvelope(raw)) return { ok: false, reason: 'not-kan-do' }
  if (raw.schemaVersion > supportedSchema) return { ok: false, reason: 'newer-schema' }

  const known: DataStores = {}
  for (const key of PERSISTED_KEYS) if (key in raw.stores) known[key] = raw.stores[key]
  if (Object.keys(known).length === 0) return { ok: false, reason: 'not-kan-do' }

  const stores = stripSecrets(known)
  const envelope: DataEnvelope = {
    schemaVersion: raw.schemaVersion,
    writtenAt: typeof raw.writtenAt === 'string' ? raw.writtenAt : '',
    writtenBy: typeof raw.writtenBy === 'string' ? raw.writtenBy : '',
    appVersion: typeof raw.appVersion === 'string' ? raw.appVersion : '',
    stores,
  }
  return {
    ok: true,
    text: `${JSON.stringify(envelope, null, 2)}\n`,
    schemaVersion: raw.schemaVersion,
    taskCount: taskCountOf(stores),
    writtenAt: envelope.writtenAt || null,
  }
}
