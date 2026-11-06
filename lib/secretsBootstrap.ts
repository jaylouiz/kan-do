/**
 * @module secretsBootstrap
 * @description Desktop start-up for the Keychain secret store (#223, ADR 007): loads the Notion and
 * Todoist tokens into the stores before the first render and migrates tokens that older builds left
 * in localStorage.
 *
 * Rules (the token is never deleted before a verified Keychain write):
 * - Keychain has a token: it wins, a stored copy is stripped.
 * - Keychain is empty, a stored copy exists: write it, read it back, compare, then strip the copy.
 * - Keychain fails: the stored copy stays in place and keeps working (its persist omission is never
 *   armed), the failure is reported once, and the next start retries. A missing entry is never
 *   confused with a failure.
 *
 * Unexpected throws (#245 N4, fail closed): each entry runs in its own `try/catch`. A throw arms the
 * omission for that entry, yields `error` (counts as failed), applies the legacy copy if one was read
 * (otherwise the entry is listed in `unavailable`), never deletes the legacy copy and never skips the
 * other entry. The writer in `appStorage` stays the primary guard; this is defence in depth.
 *
 * Ordering: the persist omission starts disarmed (see `persistOmitFor`), so a store write that happens
 * before this runs cannot strip a legacy token. Each entry arms its omission only after its outcome
 * is safe.
 */
import {
  omitFromStorage,
  SECRET_STATE_LOCATIONS,
  type ReadableSecretEntry,
  type SecretStateLocation,
} from '~/lib/secrets'

export interface BootstrapDeps {
  secrets: {
    get: (entry: ReadableSecretEntry) => Promise<string | null>
    set: (entry: ReadableSecretEntry, value: string) => Promise<void>
  }
  storage: Pick<Storage, 'getItem' | 'setItem'>
  /**
   * Puts a token into the in-memory store state (the ~12 existing call sites read it from there). May be
   * async: the plugin applies it inside `withoutPersistence` so the start-up apply is not persisted (#255 N1).
   */
  applyToken: (entry: ReadableSecretEntry, token: string) => void | Promise<void>
}

export type EntryOutcome = 'none' | 'loaded' | 'migrated' | 'stripped' | 'unavailable' | 'migration-failed' | 'error'

export interface BootstrapResult {
  outcomes: Record<ReadableSecretEntry, EntryOutcome>
  /** True when at least one entry could not reach the Keychain. */
  failed: boolean
  /** Entries whose Keychain read failed with nothing stored locally: not "missing", do not route to setup. */
  unavailable: ReadableSecretEntry[]
}

type Blob = Record<string, unknown>

function parseBlob(raw: string | null): Blob | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Blob) : null
  } catch {
    return null
  }
}

function readPath(blob: Blob, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (node, key) => (typeof node === 'object' && node !== null ? (node as Blob)[key] : undefined),
    blob,
  )
}

/** Removes the leaf at `path`; returns whether anything was removed. */
function deletePath(blob: Blob, path: string): boolean {
  const keys = path.split('.')
  const leaf = keys.pop() as string
  const parent = keys.reduce<unknown>(
    (node, key) => (typeof node === 'object' && node !== null ? (node as Blob)[key] : undefined),
    blob,
  )
  if (typeof parent !== 'object' || parent === null || !(leaf in parent)) return false
  return Reflect.deleteProperty(parent, leaf)
}

function stripFromStorage(storage: BootstrapDeps['storage'], location: SecretStateLocation): void {
  const blob = parseBlob(storage.getItem(location.storageKey))
  if (blob && deletePath(blob, location.statePath)) {
    storage.setItem(location.storageKey, JSON.stringify(blob))
  }
}

interface EntryRun {
  outcome: EntryOutcome
  /** True when no token reached the store and none can be told apart from "missing". */
  unavailable: boolean
}

/** Progress that survives an unexpected throw, so the catch knows what the store already holds. */
interface EntryProgress {
  legacy: string | null
  applied: boolean
}

async function bootstrapEntry(
  location: SecretStateLocation,
  deps: BootstrapDeps,
  progress: EntryProgress,
): Promise<EntryOutcome> {
  const { entry } = location
  const applyToken = async (token: string) => {
    await deps.applyToken(entry, token)
    progress.applied = true
  }
  const blob = parseBlob(deps.storage.getItem(location.storageKey))
  const stored = blob ? readPath(blob, location.statePath) : undefined
  const legacy = typeof stored === 'string' && stored ? stored : null
  progress.legacy = legacy

  let inKeychain: string | null
  try {
    inKeychain = await deps.secrets.get(entry)
  } catch {
    if (!legacy) {
      omitFromStorage(location)
      return 'unavailable'
    }
    await applyToken(legacy)
    return 'migration-failed'
  }

  if (inKeychain) {
    await applyToken(inKeychain)
    omitFromStorage(location)
    if (legacy === null) return 'loaded'
    stripFromStorage(deps.storage, location)
    return 'stripped'
  }

  if (!legacy) {
    omitFromStorage(location)
    return 'none'
  }

  // The omission is still disarmed, so applying the token rewrites the blob with it: the stored copy
  // survives until the Keychain write is verified.
  await applyToken(legacy)
  try {
    await deps.secrets.set(entry, legacy)
    if ((await deps.secrets.get(entry)) !== legacy) throw new Error('read-back mismatch')
  } catch {
    return 'migration-failed'
  }
  omitFromStorage(location)
  stripFromStorage(deps.storage, location)
  return 'migrated'
}

async function runEntry(location: SecretStateLocation, deps: BootstrapDeps): Promise<EntryRun> {
  const progress: EntryProgress = { legacy: null, applied: false }
  try {
    const outcome = await bootstrapEntry(location, deps, progress)
    return { outcome, unavailable: outcome === 'unavailable' }
  } catch {
    // Fail closed: stop persisting the secret, keep the app working with a legacy copy if there is one.
    omitFromStorage(location)
    if (!progress.applied && progress.legacy) {
      try {
        await deps.applyToken(location.entry, progress.legacy)
        progress.applied = true
      } catch {
        // The store stays without a token; reported as unavailable below.
      }
    }
    return { outcome: 'error', unavailable: !progress.applied }
  }
}

export async function bootstrapSecrets(deps: BootstrapDeps): Promise<BootstrapResult> {
  const outcomes = {} as Record<ReadableSecretEntry, EntryOutcome>
  const unavailable: ReadableSecretEntry[] = []
  for (const location of SECRET_STATE_LOCATIONS) {
    const run = await runEntry(location, deps)
    outcomes[location.entry] = run.outcome
    if (run.unavailable) unavailable.push(location.entry)
  }
  const values = Object.values(outcomes)
  return {
    outcomes,
    failed: values.includes('migration-failed') || values.includes('unavailable') || values.includes('error'),
    unavailable,
  }
}
