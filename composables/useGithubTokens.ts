/**
 * @composable useGithubTokens
 * @description State and actions behind the GitHub access settings (#223): the `updates` and
 * `feedback` tokens in the Keychain. JS can only set, delete and ask for status; the checks go
 * through the pinned `github_request` command. State is module-level so an open undo toast keeps
 * working after the page has been left.
 * @responsibility
 * - Load status lazily (one Keychain read per entry when the page opens)
 * - The feedback row exists only for a token stored in the Keychain (`showRow`): nobody can add one any more, the developer's
 *   token comes from the GitHub CLI (#280)
 * - Save = check the new token against GitHub first, store it only when accepted ("nothing stored"
 *   otherwise, a working token stays in place)
 * - Test = re-run the check (also once per page visit for saved tokens, `checkOnOpen`); Remove = immediate, deferred Keychain delete behind an undo toast
 * - Upload probe (#247, feedback token only): `POST /git/blobs` with an empty body creates an unreferenced
 *   blob (Contents: write needed, no commit, no ref, nothing visible in the repo). The result lives in
 *   memory on the row, never in storage.
 */
import { hasInjectionContext, reactive, ref } from 'vue'
import { useNuxtApp, useToast } from '#imports'
import { translate } from '~/lib/i18n'
import { GITHUB_SECRET_ENTRIES, type GithubSecretEntry } from '~/lib/secrets'
import { toSecretError, useSecrets, type EntrySource } from '~/composables/useSecrets'
import { useErrorHandler } from '~/composables/useErrorHandler'
import { classifyUploadStatus } from '~/lib/feedback/uploadAccess'
import { clearUploadDenied } from '~/composables/useFeedback'

export const GITHUB_REPO = 'jaylouiz/kan-do'
export const REMOVE_UNDO_WINDOW_MS = 5000

/** Locale key segment per entry: `settings.github.<segment>.*`. */
export const GITHUB_ENTRY_KEY: Record<GithubSecretEntry, 'updates' | 'feedback'> = {
  'github-updates': 'updates',
  'github-feedback': 'feedback',
}

/** Read-only calls that prove a token works, per entry. Write scopes cannot be tested without writing. */
const CHECK_PATH: Record<GithubSecretEntry, string> = {
  'github-updates': `/repos/${GITHUB_REPO}/releases?per_page=1`,
  'github-feedback': `/repos/${GITHUB_REPO}/issues?per_page=1`,
}

/**
 * `rejected` = GitHub answered 401. `forbidden` = 403 (token lacks the permission), `notFound` = 404 (repository not
 * visible to the token). `unverified` = any other answer (5xx, 3xx, a 403 rate limit...): the token is not judged.
 */
export type CheckOutcome = 'valid' | 'rejected' | 'offline' | 'forbidden' | 'notFound' | 'unverified' | 'failed'
export type TokenProblem = 'rejected' | 'offline' | 'forbidden' | 'notFound' | 'unverified' | 'failed'
/** Result of the screenshot-upload probe of the feedback token. `denied`: GitHub answered 404, or a 403 that names the missing permission (not a rate limit). */
export type UploadProbe = 'idle' | 'checking' | 'allowed' | 'denied' | 'offline' | 'failed'

export interface TokenRow {
  present: boolean
  last4: string | null
  /** GitHub answered 401 for the stored token earlier in this session. */
  rejected: boolean
  /** The token passed a check in this session. */
  valid: boolean
  checking: boolean
  /** Inline error of the last save or test. */
  problem: TokenProblem | null
  /** Removed, undo toast still open: the UI shows the empty state, the Keychain still holds it. */
  removed: boolean
  /** Screenshot-upload probe (feedback entry only); in memory. */
  upload: UploadProbe
  /** Where the value comes from (the status of the Rust side). */
  source: EntrySource
}

const emptyRow = (): TokenRow => ({
  present: false, last4: null, rejected: false, valid: false, checking: false, problem: null, removed: false, upload: 'idle', source: 'keychain',
})

const rows = reactive<Record<GithubSecretEntry, TokenRow>>({
  'github-updates': emptyRow(),
  'github-feedback': emptyRow(),
})
const loaded = ref(false)
/** The Keychain could not be read: the page shows one sentence and no fields. */
const keychainUnavailable = ref(false)
const pendingRemovals = new Map<GithubSecretEntry, string>()

export function useGithubTokens() {
  const secrets = useSecrets()
  const { handleError } = useErrorHandler()
  const toast = hasInjectionContext()
    ? useToast()
    : useNuxtApp().vueApp.runWithContext(() => useToast())

  function applyStatus(entry: GithubSecretEntry, status: Awaited<ReturnType<typeof secrets.status>>[GithubSecretEntry]) {
    const row = rows[entry]
    if (!status) return
    if (status.state === 'error') {
      keychainUnavailable.value = true
      return
    }
    row.present = status.present
    row.last4 = status.last4
    row.rejected = status.rejected
    row.source = status.source ?? 'keychain'
    if (!status.present || status.rejected) row.valid = false
  }

  async function refresh(entries: readonly GithubSecretEntry[] = GITHUB_SECRET_ENTRIES) {
    const statuses = await secrets.status(entries)
    for (const entry of entries) applyStatus(entry, statuses[entry])
  }

  /** Reads the status of both entries. Idempotent; the Rust side caches after the first read. */
  async function load() {
    keychainUnavailable.value = false
    if (!secrets.available) {
      keychainUnavailable.value = true
      loaded.value = true
      return
    }
    try {
      await refresh()
    } catch {
      keychainUnavailable.value = true
    }
    loaded.value = true
  }

  /** Checks the stored token, or `candidate` when given (nothing is stored or flagged for a candidate). */
  async function check(entry: GithubSecretEntry, candidate?: string): Promise<CheckOutcome> {
    try {
      const response = await secrets.githubRequest(entry, 'GET', CHECK_PATH[entry], undefined, candidate)
      // Only a 401 (an `Err` from Rust) means the token is bad; 403/404 are named, every other answer says nothing about it.
      if (response.status >= 200 && response.status < 300) return 'valid'
      if (response.status === 404) return 'notFound'
      // A rate limit is a 403 too: it says nothing about the token.
      if (response.status === 403) return classifyUploadStatus(response.status, response.body) === 'rateLimited' ? 'unverified' : 'forbidden'
      return 'unverified'
    } catch (error) {
      const { kind } = toSecretError(error)
      if (kind === 'rejected') return 'rejected'
      if (kind === 'network' || kind === 'timeout') return 'offline'
      return 'failed'
    }
  }

  function cancelPendingRemoval(entry: GithubSecretEntry) {
    const toastId = pendingRemovals.get(entry)
    if (toastId === undefined) return
    pendingRemovals.delete(entry)
    rows[entry].removed = false
    toast.remove(toastId)
  }

  /**
   * Checks the new token first and stores it only when GitHub accepted it, so a failed check leaves
   * whatever is stored (a working token, or nothing) exactly as it was.
   */
  async function save(entry: GithubSecretEntry, token: string): Promise<boolean> {
    const row = rows[entry]
    const value = token.trim()
    if (!value || row.checking) return false
    row.checking = true
    row.problem = null
    try {
      const outcome = await check(entry, value)
      if (outcome !== 'valid') {
        row.problem = outcome
        return false
      }
      try {
        await secrets.set(entry, value)
      } catch (error) {
        row.problem = 'failed'
        handleError(error as Error, 'secrets')
        return false
      }
      // A removal still in its undo window is superseded by the new token.
      cancelPendingRemoval(entry)
      await refresh([entry])
      row.valid = true
      row.upload = 'idle'
      return true
    } finally {
      row.checking = false
    }
  }

  /** Re-runs the check on the stored token. */
  async function test(entry: GithubSecretEntry): Promise<void> {
    const row = rows[entry]
    if (row.checking) return
    row.checking = true
    row.problem = null
    try {
      const outcome = await check(entry)
      await refresh([entry]).catch(() => undefined)
      if (outcome === 'valid') {
        row.valid = true
      } else {
        row.valid = false
        // A 401 already shows as the rejected state through the Rust flag; keep other failures inline.
        if (!row.rejected) row.problem = outcome
      }
    } finally {
      row.checking = false
    }
  }

  /**
   * Quiet check of the saved tokens when the page opens (#241): `test()` for every row that is present, not rejected
   * and not removed. Offline or any non-401 answer only sets the calm inline line; only a definite 401 (the Rust
   * flag, re-read by `test()`) leads to the rejected state. Never throws, never blocks the page.
   */
  async function checkOnOpen(): Promise<void> {
    await Promise.all(GITHUB_SECRET_ENTRIES.map((entry) => {
      const row = rows[entry]
      // The developer's GitHub CLI token is not checked on a page visit: it has no row here.
      if (!row.present || row.rejected || row.removed || row.checking || row.source === 'gh_cli') return undefined
      return test(entry).catch(() => undefined)
    }))
  }

  /**
   * "Screenshot-Upload prüfen": an empty blob needs Contents: write and changes nothing visible. 2xx means
   * the token may upload; 403/404 means it may not (the feedback dialog then sends screenshots by clipboard).
   */
  async function probeUpload(entry: GithubSecretEntry): Promise<void> {
    const row = rows[entry]
    if (entry !== 'github-feedback' || row.upload === 'checking') return
    row.upload = 'checking'
    try {
      const response = await secrets.githubRequest(entry, 'POST', `/repos/${GITHUB_REPO}/git/blobs`, { content: '', encoding: 'utf-8' })
      if (response.status >= 200 && response.status < 300) {
        row.upload = 'allowed'
        clearUploadDenied()
      } else {
        // A rate limit is a 403 too: it says nothing about the token, so it is not "denied".
        row.upload = classifyUploadStatus(response.status, response.body) === 'denied' ? 'denied' : 'failed'
      }
    } catch (error) {
      const { kind } = toSecretError(error)
      if (kind === 'network' || kind === 'timeout') row.upload = 'offline'
      else {
        row.upload = 'failed'
        // A 401 already shows as the rejected state through the Rust flag.
        if (kind === 'rejected') row.rejected = true
      }
    }
  }

  async function commitRemoval(entry: GithubSecretEntry) {
    if (!pendingRemovals.delete(entry)) return
    const row = rows[entry]
    try {
      await secrets.remove(entry)
      Object.assign(row, emptyRow())
    } catch (error) {
      row.removed = false
      handleError(error as Error, 'secrets')
    }
  }

  /**
   * Removes at once (the UI shows the empty state) and deletes from the Keychain after the undo toast
   * has closed. `onUndo` runs after a restore so the caller can move focus back.
   */
  function remove(entry: GithubSecretEntry, onUndo?: () => void) {
    const row = rows[entry]
    if (!row.present || row.removed) return
    row.removed = true
    row.problem = null
    const toastId = `remove-${entry}`
    pendingRemovals.set(entry, toastId)
    toast.add({
      id: toastId,
      title: translate('settings.github.removedToast', { name: translate(`settings.github.${GITHUB_ENTRY_KEY[entry]}.title`) }),
      icon: 'i-ph-key',
      color: 'neutral',
      duration: REMOVE_UNDO_WINDOW_MS,
      'onUpdate:open': (open: boolean) => {
        if (!open) void commitRemoval(entry)
      },
      actions: [
        {
          label: translate('common.undo'),
          color: 'primary',
          variant: 'solid',
          // The action's own auto-close would report the toast as closed (= delete) before Undo runs.
          closeOnClick: false,
          onClick: () => {
            cancelPendingRemoval(entry)
            onUndo?.()
          },
        },
      ],
    })
  }

  return { rows, loaded, keychainUnavailable, load, save, test, checkOnOpen, remove, probeUpload, showRow }
}

/**
 * Whether `/settings/github` mounts the row. The updates row always does (the optional token); the feedback row only
 * while a token is stored in the Keychain, so it can be tested or deleted, never added (#280). A feedback row whose
 * removal waits for its undo stays mounted but hidden by the row itself (`GithubTokenRow`), so focus can return on Undo.
 */
export function showRow(entry: GithubSecretEntry): boolean {
  if (entry === 'github-updates') return true
  const row = rows[entry]
  return row.present && row.source === 'keychain'
}

/** Test helper: resets module state between tests. */
export function resetGithubTokensState(): void {
  rows['github-updates'] = emptyRow()
  rows['github-feedback'] = emptyRow()
  loaded.value = false
  keychainUnavailable.value = false
  pendingRemovals.clear()
}
