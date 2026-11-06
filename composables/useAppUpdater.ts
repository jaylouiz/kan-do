/**
 * @composable useAppUpdater
 * @description State and actions behind the desktop self-updater (#225, ADR 009). Wraps the Rust
 * commands `update_check`, `update_install` and `update_state` plus the `update://progress` event.
 * The token never reaches JS: Rust reads it from the Keychain, so "no token" is an answer of the check.
 * State is module-level so the page, the dialog, the palette and the launch check share it.
 * @responsibility
 * - `check` runs one check (never in parallel with another check or an install)
 * - `install` flushes the data first, then asks Rust to back up, download, install and restart
 * - Holds the dialog's open state and the once-per-session "update available" toast
 * - Web: every action is a no-op, `available` is false
 */
import { computed, hasInjectionContext, reactive } from 'vue'
import { navigateTo } from 'nuxt/app'
import { useNuxtApp, useToast } from '#imports'
import { translate } from '~/lib/i18n'
import { isTauri } from '~/utils/isTauri'
import { useDataFolder } from '~/composables/useDataFolder'
import type {
  AvailableUpdate,
  UpdateCheckResult,
  UpdateInstallFailure,
  UpdateProgress,
  UpdateStateSnapshot,
} from '~/types/updater'

export const PROGRESS_EVENT = 'update://progress'

interface UpdaterState {
  /** Version of the running app (`getVersion()`), null until read. */
  appVersion: string | null
  /** Last check result of this session; null = never checked. */
  result: UpdateCheckResult | null
  lastCheckedAt: string | null
  checking: boolean
  installing: boolean
  progress: UpdateProgress | null
  installError: UpdateInstallFailure | null
  dialogOpen: boolean
  toastShown: boolean
}

const initialState = (): UpdaterState => ({
  appVersion: null,
  result: null,
  lastCheckedAt: null,
  checking: false,
  installing: false,
  progress: null,
  installError: null,
  dialogOpen: false,
  toastShown: false,
})

const state = reactive<UpdaterState>(initialState())

const UNKNOWN_FAILURE: UpdateInstallFailure = { kind: 'install_failed' }

/** Normalises whatever `invoke` rejected with into a typed install failure. */
export function toInstallFailure(error: unknown): UpdateInstallFailure {
  const raw = error as { kind?: unknown; reason?: unknown } | null
  const kind = typeof raw?.kind === 'string' ? raw.kind : ''
  if (kind === 'data_blocked') {
    const reason = raw?.reason === 'unreadable' || raw?.reason === 'conflict' ? raw.reason : 'folder-unavailable'
    return { kind, reason }
  }
  if (kind === 'no_update' || kind === 'busy' || kind === 'flush_failed' || kind === 'backup_failed' || kind === 'install_failed') {
    return { kind }
  }
  return UNKNOWN_FAILURE
}

async function invokeUpdate<T>(command: string): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command)
}

function applyResult(result: UpdateCheckResult) {
  state.result = result
  state.lastCheckedAt = new Date().toISOString()
}

export function useAppUpdater() {
  const available = isTauri()
  const toast = hasInjectionContext() ? useToast() : useNuxtApp().vueApp.runWithContext(() => useToast())

  /** The pending update, or null unless the last check found one. */
  const update = computed<AvailableUpdate | null>(() => {
    const result = state.result
    if (result?.status !== 'available' || !result.version) return null
    return {
      version: result.version,
      currentVersion: result.currentVersion,
      notes: result.notes ?? null,
      publishedAt: result.publishedAt ?? null,
    }
  })

  const percent = computed(() => {
    const progress = state.progress
    if (!progress?.total) return null
    return Math.min(100, Math.floor((progress.downloaded / progress.total) * 100))
  })

  async function loadVersion(): Promise<void> {
    if (!available || state.appVersion) return
    try {
      const { getVersion } = await import('@tauri-apps/api/app')
      state.appVersion = await getVersion()
    } catch {
      state.appVersion = null
    }
  }

  /** Picks up what Rust already knows (a reload keeps the process, so the last check survives). */
  async function hydrate(): Promise<void> {
    if (!available || state.result) return
    try {
      const snapshot = await invokeUpdate<UpdateStateSnapshot>('update_state')
      if (snapshot.last && !state.result) {
        state.result = snapshot.last
        state.lastCheckedAt = snapshot.lastCheckedAt
      }
      // Rust reports `installing` for an install only (not while a check runs), so this cannot latch.
      if (snapshot.installing) state.installing = true
    } catch {
      // Nothing to hydrate; the next check answers.
    }
  }

  /** Runs one check. Returns null when none ran (web, or a check or install is already running). */
  async function check(): Promise<UpdateCheckResult | null> {
    if (!available || state.checking || state.installing) return null
    state.checking = true
    state.installError = null
    try {
      const result = await invokeUpdate<UpdateCheckResult>('update_check')
      applyResult(result)
      return result
    } catch (error) {
      // Rust is already checking or installing (e.g. after a webview reload): keep what we know.
      if (toInstallFailure(error).kind === 'busy') return null
      const failed: UpdateCheckResult = { status: 'error', currentVersion: state.appVersion ?? '', reason: 'unknown' }
      applyResult(failed)
      return failed
    } finally {
      state.checking = false
    }
  }

  function openDialog(): void {
    if (update.value) state.dialogOpen = true
  }

  /** The dialog cannot be closed while it downloads or installs. */
  function closeDialog(): void {
    if (state.installing) return
    state.dialogOpen = false
    // A failure belongs to one attempt: reopening the dialog starts clean.
    state.installError = null
  }

  /** Flushes the data, then lets Rust back up, download, install and restart. */
  async function install(): Promise<void> {
    if (!available || state.installing || !update.value) return
    state.installing = true
    state.installError = null
    state.progress = null
    let unlisten: (() => void) | null = null
    try {
      // Rust flushes too; this drains the writes still queued on the JS side first.
      try {
        await useDataFolder().flushNow()
      } catch {
        state.installError = { kind: 'flush_failed' }
        return
      }
      const { listen } = await import('@tauri-apps/api/event')
      unlisten = await listen<UpdateProgress>(PROGRESS_EVENT, (event) => {
        state.progress = { downloaded: event.payload.downloaded, total: event.payload.total ?? null }
      })
      // On success the app restarts and this call never settles.
      await invokeUpdate<null>('update_install')
    } catch (error) {
      state.installError = toInstallFailure(error)
    } finally {
      unlisten?.()
      state.installing = false
    }
  }

  /**
   * "Nach Updates suchen" from the palette: an update opens the dialog, "up to date" is one short toast,
   * and everything else (offline, rate limited, ...) is explained on /settings/updates.
   */
  async function checkManually(): Promise<void> {
    const result = await check()
    if (!result) return
    if (result.status === 'available') openDialog()
    else if (result.status === 'up-to-date') announceUpToDate()
    else await navigateTo('/settings/updates')
  }

  /** The start-up notice: once per session, only for an update, never for any other outcome. */
  function announceAvailable(): void {
    const found = update.value
    if (!found || state.toastShown) return
    state.toastShown = true
    toast.add({
      title: translate('updates.toast.available', { version: found.version }),
      icon: 'i-ph-arrow-circle-up',
      color: 'neutral',
      duration: 10000,
      actions: [
        {
          label: translate('updates.toast.details'),
          color: 'neutral',
          variant: 'soft',
          onClick: () => openDialog(),
        },
      ],
    })
  }

  /** The short "you are current" confirmation after a manual check from the palette. */
  function announceUpToDate(): void {
    toast.add({
      title: translate('updates.toast.upToDate'),
      icon: 'i-ph-check-circle',
      color: 'neutral',
      duration: 4000,
    })
  }

  return {
    state,
    available,
    update,
    percent,
    loadVersion,
    hydrate,
    check,
    checkManually,
    install,
    openDialog,
    closeDialog,
    announceAvailable,
    announceUpToDate,
  }
}

/** Test helper: resets module state between tests. */
export function resetAppUpdaterState(): void {
  Object.assign(state, initialState())
}
