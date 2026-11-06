import { describe, expect, it } from 'vitest'
import { restoreBlockedBy } from '~/utils/dataFile/restoreAvailability'
import type { DataStatus } from '~/types/dataFile'

describe('restoreBlockedBy', () => {
  it.each<[DataStatus, ReturnType<typeof restoreBlockedBy>]>([
    ['ok', null],
    ['write-failed', null],
    ['missing-file', null],
    // The recovery case: an unreadable file is kept verbatim as `pre-restore` and replaced (M4).
    ['read-only-corrupt', null],
    ['conflict', 'conflict'],
    ['read-only-newer-schema', 'newer-schema'],
    ['folder-unavailable', 'unavailable'],
  ])('%s -> %s', (status, expected) => {
    expect(restoreBlockedBy(status)).toBe(expected)
  })
})
