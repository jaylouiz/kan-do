/**
 * @module dataFile/webReplace
 * @description Pure core of the web import (#238, ADR 011): turns a parsed import into the localStorage
 * blobs that replace the current ones and writes them with a rollback. Only `PERSISTED_KEYS` are touched.
 * The browser's own secrets (`SECRET_STATE_LOCATIONS`) are re-applied from the current blobs, never taken
 * from the file, so an import cannot plant or wipe a token.
 */
import { PERSISTED_KEYS } from '~/lib/dataStorage'
import { SECRET_STATE_LOCATIONS } from '~/lib/secrets'
import type { DataStores } from '~/types/dataFile'

/** Raw `localStorage` string per persisted key; null: not set. */
export type StoredBlobs = Record<string, string | null>

export class WebTransferError extends Error {
  readonly kind: 'quota' | 'write' | 'safety'

  constructor(kind: 'quota' | 'write' | 'safety', message: string) {
    super(message)
    this.name = 'WebTransferError'
    this.kind = kind
  }
}

function parseBlob(raw: string | null | undefined): unknown {
  if (!raw) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

function readPath(state: unknown, path: string): unknown {
  let node = state
  for (const key of path.split('.')) {
    node = typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[key] : undefined
  }
  return node
}

function writePath(state: Record<string, unknown>, path: string, value: string): void {
  const keys = path.split('.')
  const leaf = keys.pop() as string
  let node = state
  for (const key of keys) {
    const next = node[key]
    node = typeof next === 'object' && next !== null ? (next as Record<string, unknown>) : (node[key] = {}) as Record<string, unknown>
  }
  node[leaf] = value
}

/** The current state as stores, with the secrets still in it: the caller strips them for an export. */
export function storesFromBlobs(current: StoredBlobs): DataStores {
  const stores: DataStores = {}
  for (const key of PERSISTED_KEYS) {
    const parsed = parseBlob(current[key])
    if (parsed !== undefined) stores[key] = parsed
  }
  return stores
}

/**
 * The blobs to write after an import: the file's stores (secret-free), each with this browser's current
 * secret put back. A store the file lacks is removed (null) unless it holds a secret of this browser.
 */
export function planReplace(current: StoredBlobs, imported: DataStores): StoredBlobs {
  const plan: StoredBlobs = {}
  for (const key of PERSISTED_KEYS) {
    let next: unknown = key in imported ? structuredClone(imported[key]) : undefined
    for (const location of SECRET_STATE_LOCATIONS) {
      if (location.storageKey !== key) continue
      const token = readPath(parseBlob(current[key]), location.statePath)
      if (typeof token !== 'string' || token === '') continue
      if (typeof next !== 'object' || next === null) next = {}
      writePath(next as Record<string, unknown>, location.statePath, token)
    }
    plan[key] = next === undefined ? null : JSON.stringify(next)
  }
  return plan
}

export interface BlobStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

function isQuota(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
}

/** Writes the plan; on any failure the previous blobs are put back and a `WebTransferError` is thrown. */
export function commitReplace(storage: BlobStorage, plan: StoredBlobs): void {
  const previous: StoredBlobs = {}
  for (const key of PERSISTED_KEYS) previous[key] = storage.getItem(key)
  try {
    for (const key of PERSISTED_KEYS) {
      const next = plan[key] ?? null
      if (next === null) storage.removeItem(key)
      else storage.setItem(key, next)
    }
  } catch (error) {
    for (const key of PERSISTED_KEYS) {
      try {
        const old = previous[key] ?? null
        if (old === null) storage.removeItem(key)
        else storage.setItem(key, old)
      } catch {
        // Best effort: restoring a value that was there before cannot normally exceed the quota.
      }
    }
    throw new WebTransferError(isQuota(error) ? 'quota' : 'write', error instanceof Error ? error.message : 'write failed')
  }
}
