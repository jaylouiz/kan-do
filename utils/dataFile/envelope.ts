/**
 * @module dataFile/envelope
 * @description The on-disk shape of `kan-do-data.json` (#222, ADR 008):
 * `{ schemaVersion, writtenAt, writtenBy, appVersion, stores: { "<persist key>": <parsed JSON> } }`.
 * Rust writes the header; this module reads it back and turns `stores` into the string mirror the
 * synchronous `pinia-plugin-persistedstate` adapter needs.
 */
import type { DataStores } from '~/types/dataFile'

/** Highest schema this build writes. Must equal `SCHEMA_VERSION` in `src-tauri/src/data_file.rs`. */
export const CURRENT_SCHEMA_VERSION = 2

export interface DataEnvelope {
  schemaVersion: number
  writtenAt: string
  writtenBy: string
  appVersion: string
  stores: DataStores
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** True for anything shaped like an envelope; `writtenAt`/`writtenBy`/`appVersion` are informative only. */
export function isDataEnvelope(raw: unknown): raw is DataEnvelope {
  return (
    isRecord(raw) &&
    Number.isInteger(raw.schemaVersion) &&
    (raw.schemaVersion as number) >= 1 &&
    isRecord(raw.stores)
  )
}

/** Serialises each store the way the persist plugin expects to read it back. */
export function storesToMirror(stores: DataStores): Map<string, string> {
  return new Map(Object.entries(stores).map(([key, value]) => [key, JSON.stringify(value)]))
}
