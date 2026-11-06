/**
 * @composable useWebDataTransfer
 * @description Web counterpart of `useDataFolder`'s export/import (#238, ADR 011): the same plain JSON file,
 * read from and written to the persisted `localStorage` blobs. Desktop uses the native dialogs instead.
 * @responsibility
 * - `exportData`: flush pending store writes, build the envelope (secrets stripped) and download it
 * - `pickImport`: file chooser, then `parseImport` before anything is written
 * - `applyImport`: optional safety download, replace only `PERSISTED_KEYS` (secrets of this browser kept), reload
 */
import { getActivePinia } from 'pinia'
import { nextTick, ref } from 'vue'
import { appStorage, PERSISTED_KEYS } from '~/lib/dataStorage'
import { buildExport, parseImport } from '~/utils/dataFile/exportImport'
import { commitReplace, planReplace, storesFromBlobs, WebTransferError, type StoredBlobs } from '~/utils/dataFile/webReplace'
import { reloadApp } from '~/utils/reloadApp'
import type { DataStores } from '~/types/dataFile'
import type { ImportPick, ImportPreview } from '~/composables/useDataFolder'

/** Stable envelope id of the browser build (desktop writes its device id). */
const WEB_DEVICE_ID = 'web'

/** Persists every store now: the plugin writes on a deferred subscription, so the latest edit may still be pending. */
async function flushStores(): Promise<void> {
  await nextTick()
  const pinia = getActivePinia() as (ReturnType<typeof getActivePinia> & { _s?: Map<string, { $persist?: () => void }> }) | undefined
  pinia?._s?.forEach(store => store.$persist?.())
}

function readBlobs(): StoredBlobs {
  const blobs: StoredBlobs = {}
  for (const key of PERSISTED_KEYS) blobs[key] = appStorage.getItem(key)
  return blobs
}

/** The persisted stores as they are in this browser right now (secrets included; exports strip them). */
export function readWebStores(): DataStores {
  return storesFromBlobs(readBlobs())
}

function download(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Opens the chooser; null when it was cancelled. */
function chooseFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true })
    input.addEventListener('cancel', () => resolve(null), { once: true })
    input.click()
  })
}

function appVersion(): string {
  try {
    return String(useRuntimeConfig().public.clientVersion ?? '')
  } catch {
    return ''
  }
}

export function describeWebError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function useWebDataTransfer() {
  /** Importing is always allowed on web: there is no data-file state that could block it. */
  const restoreBlock = ref<null>(null)

  async function buildCurrentExport() {
    await flushStores()
    return buildExport({ stores: readWebStores(), deviceId: WEB_DEVICE_ID, appVersion: appVersion() })
  }

  async function exportData(): Promise<'saved'> {
    const built = await buildCurrentExport()
    download(built.fileName, built.text)
    return 'saved'
  }

  async function pickImport(): Promise<ImportPick> {
    const file = await chooseFile()
    if (!file) return { kind: 'cancelled' }
    let text: string
    try {
      text = await file.text()
    } catch {
      return { kind: 'failed', reason: 'unreadable' }
    }
    const parsed = parseImport(text)
    if (!parsed.ok) return { kind: 'failed', reason: parsed.reason }
    const { taskCount, schemaVersion, writtenAt } = parsed
    return { kind: 'ready', preview: { text: parsed.text, fileName: file.name, taskCount, schemaVersion, writtenAt } }
  }

  /** Safety download first (when asked), then replace the blobs and reload before any store can write again. */
  async function applyImport(preview: ImportPreview, options: { safetyDownload?: boolean } = {}): Promise<void> {
    if (options.safetyDownload) {
      try {
        const built = await buildCurrentExport()
        download(built.fileName.replace('kan-do-export-', 'kan-do-backup-'), built.text)
      } catch (error) {
        // Nothing is replaced; the modal offers to go on without the safety copy.
        throw new WebTransferError('safety', error instanceof Error ? error.message : String(error))
      }
    } else {
      await flushStores()
    }
    // Re-parse: the text is what the user confirmed, and the stripped stores are all that is used from it.
    const parsed = parseImport(preview.text)
    if (!parsed.ok) throw new WebTransferError('write', parsed.reason)
    const envelope = JSON.parse(parsed.text) as { stores: DataStores }
    commitReplace(localStorage, planReplace(readBlobs(), envelope.stores))
    reloadApp()
  }

  return { restoreBlock, exportData, pickImport, applyImport, describeError: describeWebError }
}
