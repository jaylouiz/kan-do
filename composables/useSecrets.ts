/**
 * @composable useSecrets
 * @description Typed wrapper around the Rust secret commands (`secret_*`, `github_request`).
 * @responsibility
 * - `available` is true only in the desktop app; on web every other call rejects with `unsupported`
 * - Normalises Rust errors (`{ kind }`) into `SecretError`; token values never appear in messages
 * - GitHub entries can be set, removed and queried for status, never read back
 */
import { useKeychainStatus } from '~/composables/useKeychainStatus'
import {
  GITHUB_SECRET_ENTRIES,
  READABLE_SECRET_ENTRIES,
  type GithubSecretEntry,
  type ReadableSecretEntry,
  type SecretEntryName,
} from '~/lib/secrets'
import { isTauri } from '~/utils/isTauri'

export type SecretErrorKind =
  | 'invalid_entry'
  | 'read_forbidden'
  | 'empty_value'
  | 'keychain'
  | 'unsupported'
  | 'not_configured'
  | 'rejected'
  | 'invalid_request'
  | 'too_large'
  | 'network'
  | 'timeout'

export class SecretError extends Error {
  readonly kind: SecretErrorKind

  constructor(kind: SecretErrorKind) {
    super(`secret store: ${kind}`)
    this.name = 'SecretError'
    this.kind = kind
  }
}

export type EntryStatus =
  | { state: 'ok'; present: boolean; last4: string | null; rejected: boolean }
  | { state: 'error'; kind: SecretErrorKind }

export interface GithubResponse<T = unknown> {
  status: number
  body: T
}

/** Maps whatever `invoke` rejected with to a `SecretError`. */
export function toSecretError(error: unknown): SecretError {
  if (error instanceof SecretError) return error
  const kind = (error as { kind?: unknown } | null)?.kind
  return new SecretError(typeof kind === 'string' ? (kind as SecretErrorKind) : 'keychain')
}

async function invokeSecret<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new SecretError('unsupported')
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<T>(command, args)
  } catch (error) {
    throw toSecretError(error)
  }
}

function isReadable(entry: SecretEntryName): entry is ReadableSecretEntry {
  return (READABLE_SECRET_ENTRIES as readonly string[]).includes(entry)
}

export function useSecrets() {
  /** Notion and Todoist tokens; `null` means the entry is missing, a Keychain failure rejects. */
  async function get(entry: ReadableSecretEntry): Promise<string | null> {
    return invokeSecret<string | null>('secret_get', { entry })
  }

  async function set(entry: SecretEntryName, value: string): Promise<void> {
    await invokeSecret<undefined>('secret_set', { entry, value })
    // A Keychain call that succeeded proves the entry is reachable again (#245 L3).
    if (isReadable(entry)) useKeychainStatus().clearUnavailable(entry)
  }

  async function remove(entry: SecretEntryName): Promise<void> {
    await invokeSecret<undefined>('secret_delete', { entry })
    if (isReadable(entry)) useKeychainStatus().clearUnavailable(entry)
  }

  /** Status per entry. Pass only the entries needed: each first read can prompt for the Keychain. */
  async function status(
    entries: readonly SecretEntryName[] = GITHUB_SECRET_ENTRIES,
  ): Promise<Partial<Record<SecretEntryName, EntryStatus>>> {
    return invokeSecret('secret_status', { entries })
  }

  /**
   * The only GitHub access from JS: Rust pins host and repo and adds the token. With `candidateToken`
   * the request is made with that token instead of the stored one (to check it before it replaces a
   * working one); the stored token and its rejected flag stay untouched.
   */
  async function githubRequest<T = unknown>(
    entry: GithubSecretEntry,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    path: string,
    body?: unknown,
    candidateToken?: string,
  ): Promise<GithubResponse<T>> {
    return invokeSecret<GithubResponse<T>>('github_request', { entry, method, path, body, token: candidateToken })
  }

  return { available: isTauri(), get, set, remove, status, githubRequest }
}
