import type { DataStatusPayload } from '~/types/dataFile'

/**
 * The one source of the empty, healthy data-file status (#288): status `ok`, nothing configured, no
 * conflict, no cloud state. The app (initial and reset state), the unit-test fake backend and the E2E
 * Tauri stub all start from it, so a new `DataStatusPayload` field is added here and in the type only.
 */
export function emptyDataStatus(overrides: Partial<DataStatusPayload> = {}): DataStatusPayload {
  return {
    status: 'ok',
    folder: '',
    filePath: '',
    writtenAt: null,
    schemaVersion: null,
    deviceId: '',
    appVersion: '',
    error: null,
    conflict: null,
    conflictCopies: [],
    backupError: null,
    cloudSync: null,
    ...overrides,
  }
}
