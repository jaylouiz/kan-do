/**
 * @composable useWhatsNew
 * @description "What's new" after a desktop update (#226, #390). Compares the stored last-seen version with
 * the running one and, once per start, shows a quiet toast "Aktualisiert auf Version X" (never during
 * onboarding). Its optional button opens `WhatsNewDialog` with the Highlights of every version in between;
 * a fix-only update gets the toast without the button. Last-seen is stored when the toast is shown.
 * The re-open (palette, /settings/updates) shows the newest versions and never touches last-seen.
 * State is module-level so the dialog, the palette and the page share it. Web: every action is a no-op.
 * @responsibility
 * - Last-seen lives in `localStorage` (`kando-last-seen-version`), per install: not in a Pinia store,
 *   because persisted stores move into the cloud-synced data file (#222). No storage = no toast.
 * - Missing last-seen = baseline: store the running version, show nothing. Downgrade: overwrite silently.
 */
import { hasInjectionContext, reactive } from 'vue'
import { getActiveLocale, translate } from '~/lib/i18n'
import { compareVersions } from '~/lib/releaseNotesFormat.mjs'
import { REOPEN_LIMIT, latestWithHighlights, loadBundledNotes, versionsToShow, type VersionNotes } from '~/lib/releaseNotes'
import { isTauri } from '~/utils/isTauri'
import { useAppUpdater } from '~/composables/useAppUpdater'
import { useNuxtApp, useToast } from '#imports'

export const LAST_SEEN_KEY = 'kando-last-seen-version'
export const GATE_POLL_MS = 400
export const TOAST_ID = 'whats-new-updated'

interface WhatsNewState {
  open: boolean
  entries: VersionNotes[]
  /** The automatic check ran (or is waiting for its turn): at most once per start. */
  autoStarted: boolean
}

const state = reactive<WhatsNewState>({ open: false, entries: [], autoStarted: false })

export function resetWhatsNewState(): void {
  state.open = false
  state.entries = []
  state.autoStarted = false
}

function readLastSeen(): string | null {
  try {
    return localStorage.getItem(LAST_SEEN_KEY)
  } catch {
    return null
  }
}

function writeLastSeen(version: string): boolean {
  try {
    localStorage.setItem(LAST_SEEN_KEY, version)
    return true
  } catch {
    return false
  }
}

export function useWhatsNew() {
  const available = isTauri()
  const updater = useAppUpdater()
  const toast = hasInjectionContext() ? useToast() : useNuxtApp().vueApp.runWithContext(() => useToast())

  /** The quiet "updated" notice; the button (only when there is something to read) opens the dialog. */
  function announceUpdated(version: string, entries: VersionNotes[]): void {
    toast.add({
      id: TOAST_ID,
      title: translate('whatsNew.toast.updated', { version }),
      icon: 'i-ph-sparkle',
      color: 'neutral',
      duration: 10000,
      actions: entries.length === 0
        ? []
        : [{
            label: translate('whatsNew.title'),
            color: 'neutral',
            variant: 'soft',
            onClick: () => {
              state.entries = entries
              state.open = true
            },
          }],
    })
  }

  /**
   * Desktop start-up check. Resolves when it decided: nothing to show, or the toast was shown.
   * @param isOnboarding true while the user is still in the first-run flow (`/welcome`)
   */
  async function checkAfterUpdate(isOnboarding: () => boolean = () => false): Promise<void> {
    if (!available || state.autoStarted) return
    state.autoStarted = true
    await updater.loadVersion()
    const current = updater.state.appVersion
    if (!current) return

    let storageWorks = true
    try {
      localStorage.getItem(LAST_SEEN_KEY)
    } catch {
      storageWorks = false
    }
    if (!storageWorks) return

    const lastSeen = readLastSeen()
    if (lastSeen === null || compareVersions(lastSeen, current) > 0) {
      writeLastSeen(current)
      return
    }
    if (compareVersions(lastSeen, current) === 0) return

    let entries: VersionNotes[]
    try {
      entries = versionsToShow(await loadBundledNotes(), lastSeen, current, getActiveLocale())
    } catch (error) {
      // Quiet: last-seen stays, so the next start retries.
      if (import.meta.dev) console.warn('[whats-new] release notes failed to load:', error)
      return
    }

    // A toast is not modal: only onboarding makes it wait.
    await new Promise<void>((resolve) => {
      const tryShow = () => {
        if (isOnboarding()) return
        clearInterval(timer)
        resolve()
      }
      const timer = setInterval(tryShow, GATE_POLL_MS)
      tryShow()
    })
    // Seen when announced, so a missed or dismissed toast never comes back.
    writeLastSeen(current)
    announceUpdated(current, entries)
  }

  /** Re-open from the palette or the settings page: the newest versions, last-seen untouched. */
  async function openReopen(): Promise<void> {
    if (!available) return
    await updater.loadVersion()
    let entries: VersionNotes[]
    try {
      entries = latestWithHighlights(await loadBundledNotes(), REOPEN_LIMIT, getActiveLocale(), updater.state.appVersion ?? undefined)
    } catch (error) {
      // Quiet: no dialog; the next open retries the load.
      if (import.meta.dev) console.warn('[whats-new] release notes failed to load:', error)
      return
    }
    state.entries = entries
    state.open = true
  }

  /** Escape, overlay click, X and the footer button all end here. */
  function close(): void {
    state.open = false
  }

  return { available, state, checkAfterUpdate, openReopen, close }
}
