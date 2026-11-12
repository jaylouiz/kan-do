/**
 * @composable useAppReset
 * @description "App zurücksetzen" (kd#227): erases everything the user created or connected and lands on the welcome
 * page. The confirmation is asked in place (`DataResetSection` on Einstellungen -> Daten & Speicher, like the trash's
 * "Papierkorb leeren"); the command palette goes there with the question open. This holds the state and does the work.
 * @responsibility
 * - Desktop: flush pending edits, then `importApply` of an empty envelope (Rust keeps the mandatory `pre-restore`
 *   backup first and aborts without erasing when it fails), freeze writes, then delete every Keychain entry
 * - Web: freeze writes, remove every persisted key (tokens included) with the rollback of `commitReplace`
 * - Reload onto `/welcome`, only when nothing is left behind; a failed Keychain deletion keeps the question open
 *   (the secrets bootstrap would put a lingering token back into the stores and skip the welcome flow). Closing it
 *   then (Abbrechen, Esc, leaving the page) reloads the current page from the already replaced file: the frozen
 *   old state must never stay on screen (edits dropped, Notion pushes still going out)
 * - Idempotent: the replace of the data file runs once, a retry after a Keychain failure only repeats the deletions
 * - Never during a data state that blocks replacing the file (conflict, newer schema, folder unavailable)
 */
import { computed, ref } from 'vue'
import { applyDataStatus, dataState, freezeWrites, getDataBackend, unfreezeWrites } from '~/lib/dataStorage'
import { DataError, toDataError } from '~/lib/dataBackendTauri'
import { useSecrets, type SecretError } from '~/composables/useSecrets'
import { clearWebviewCopy, commitReset, emptyEnvelopeText, RESET_SECRET_ENTRIES, secretLabels } from '~/utils/dataFile/resetApp'
import { restoreBlockedBy } from '~/utils/dataFile/restoreAvailability'
import { reloadApp } from '~/utils/reloadApp'
import { isTauri } from '~/utils/isTauri'
import type { SecretEntryName } from '~/lib/secrets'

export type ResetFailure =
  | { kind: 'backup' }
  | { kind: 'write' }
  | { kind: 'tokens'; entries: string[] }

/** What a step throws: the section shows `failure`. */
class ResetError extends Error {
  readonly failure: ResetFailure

  constructor(failure: ResetFailure) {
    super(`app reset: ${failure.kind}`)
    this.name = 'ResetError'
    this.failure = failure
  }
}

const isOpen = ref(false)
const busy = ref(false)
const failure = ref<ResetFailure | null>(null)
/** The data file was replaced in this page life: a retry skips it (another `pre-restore` backup could push the real one out). */
let dataReplaced = false

/** Test seam: a fresh page life. */
export function resetAppResetState(): void {
  isOpen.value = false
  busy.value = false
  failure.value = null
  dataReplaced = false
}

function appVersion(): string {
  try {
    return String(useRuntimeConfig().public.clientVersion ?? '')
  } catch {
    return ''
  }
}

async function resetDesktop(): Promise<void> {
  if (!dataReplaced) {
    const backend = getDataBackend()
    if (!backend) throw new DataError('unavailable')
    await backend.flush().catch(() => undefined)
    try {
      applyDataStatus(await backend.importApply(emptyEnvelopeText(dataState.deviceId, appVersion())))
    } catch (error) {
      throw new ResetError({ kind: toDataError(error).kind === 'backup_failed' ? 'backup' : 'write' })
    }
    // Replaced: from here on nothing of the old state may be written or pushed again
    freezeWrites()
    dataReplaced = true
    if (typeof localStorage !== 'undefined') clearWebviewCopy(localStorage)
  }
  const secrets = useSecrets()
  const failed: SecretEntryName[] = []
  for (const entry of RESET_SECRET_ENTRIES) {
    try {
      await secrets.remove(entry)
    } catch (error) {
      failed.push(entry)
      if (import.meta.dev) console.warn('[reset] secret delete failed:', entry, (error as SecretError).kind)
    }
  }
  if (failed.length > 0) throw new ResetError({ kind: 'tokens', entries: secretLabels(failed) })
}

function resetWeb(): void {
  freezeWrites()
  try {
    commitReset(localStorage)
  } catch {
    unfreezeWrites()
    throw new ResetError({ kind: 'write' })
  }
}

export function useAppReset() {
  /** Why resetting is not offered right now (desktop data states only), else null. */
  const block = computed(() => (isTauri() ? restoreBlockedBy(dataState.status) : null))

  function open(): void {
    if (isOpen.value) return
    failure.value = null
    isOpen.value = true
  }

  function close(): void {
    if (busy.value) return
    isOpen.value = false
    // The data file is already replaced and writes are frozen (a refused Keychain deletion): the page still shows the old
    // state and would drop every edit. Booting from the replaced file is the only way back to a working app.
    if (dataReplaced) {
      busy.value = true // the page is leaving: no second confirm, no second reload
      reloadApp()
    }
  }

  async function confirm(): Promise<void> {
    if (busy.value || block.value !== null) return
    busy.value = true
    failure.value = null
    try {
      if (isTauri()) await resetDesktop()
      else resetWeb()
    } catch (error) {
      failure.value = error instanceof ResetError ? error.failure : { kind: 'write' }
      busy.value = false
      return
    }
    // Busy stays on: the page is leaving
    reloadApp('/welcome')
  }

  return { isOpen, busy, failure, block, open, close, confirm }
}
