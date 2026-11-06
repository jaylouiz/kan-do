/**
 * @module secrets
 * @description Names and persistence rules for the desktop Keychain secret store (#223, ADR 007).
 * `SECRET_STATE_PATHS` is the contract for everything that serialises app state (#222 data file,
 * #224 export/import): those paths hold secrets and must never be written outside the Keychain.
 */
/** Fixed Keychain accounts under service `com.julius.kan-do`. Mirrors `SecretEntry` in src-tauri. */
export const SECRET_ENTRIES = ['notion-token', 'todoist-token', 'github-updates', 'github-feedback'] as const
export type SecretEntryName = (typeof SECRET_ENTRIES)[number]

/** Entries the webview may read back. The GitHub entries are write-only for JS. */
export const READABLE_SECRET_ENTRIES = ['notion-token', 'todoist-token'] as const
export type ReadableSecretEntry = (typeof READABLE_SECRET_ENTRIES)[number]

export const GITHUB_SECRET_ENTRIES = ['github-updates', 'github-feedback'] as const
export type GithubSecretEntry = (typeof GITHUB_SECRET_ENTRIES)[number]

/** Where a readable secret lives in persisted store state. */
export interface SecretStateLocation {
  entry: ReadableSecretEntry
  /** localStorage key of the persisted blob (the store's persist key). */
  storageKey: string
  /** Dot path inside that blob. */
  statePath: string
}

export const SECRET_STATE_LOCATIONS: readonly SecretStateLocation[] = [
  { entry: 'notion-token', storageKey: 'notionConfig', statePath: 'config.token' },
  { entry: 'todoist-token', storageKey: 'board-store', statePath: 'boardConfig.todoistApiToken' },
]

/** `<storageKey>.<statePath>` of every secret kept in persisted state on web. */
export const SECRET_STATE_PATHS: readonly string[] = SECRET_STATE_LOCATIONS.map(
  ({ storageKey, statePath }) => `${storageKey}.${statePath}`,
)

/** Live `persist.omit` arrays handed to the stores; see {@link persistOmitFor}. */
const liveOmit = new Map<string, string[]>()

/**
 * `persist.omit` for the store persisted under `storageKey`. The array is live and starts empty on
 * every platform: on desktop the bootstrap arms the omission per secret with {@link omitFromStorage}
 * once the Keychain holds the token (or has nothing to migrate). Until then any store write keeps the
 * legacy token in localStorage, so no plugin or
 * store order can strip a token before the migration has read it.
 */
export function persistOmitFor(storageKey: string): string[] {
  const omit: string[] = []
  liveOmit.set(storageKey, omit)
  return omit
}

/** Stops persisting (and hydrating) the secret: the Keychain holds it. Desktop bootstrap only. */
export function omitFromStorage(location: SecretStateLocation): void {
  const omit = liveOmit.get(location.storageKey)
  if (omit && !omit.includes(location.statePath)) omit.push(location.statePath)
}

/** What the Notion settings field shows for a stored token: dots plus the last four characters. */
export function maskToken(token: string): string {
  return token ? `●●●● ${token.slice(-4)}` : ''
}
