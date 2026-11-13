import { describe, expect, it } from 'vitest'
import { PERSISTED_KEYS } from '~/lib/dataStorage'
import { SECRET_ENTRIES, SECRET_STATE_LOCATIONS } from '~/lib/secrets'
import { CURRENT_SCHEMA_VERSION, isDataEnvelope } from '~/utils/dataFile/envelope'
import { clearWebviewCopy, commitReset, emptyEnvelopeText, planReset, RESET_LOCAL_KEYS, RESET_SECRET_ENTRIES, secretLabels } from '~/utils/dataFile/resetApp'
import { buildDemoBoard } from '~/lib/demo-board'
import { TaskStatus } from '~/types/taskStatus'
import { WebTransferError, type BlobStorage } from '~/utils/dataFile/webReplace'

function memoryStorage(initial: Record<string, string>, failOn?: string): BlobStorage & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: key => data[key] ?? null,
    setItem: (key, value) => { data[key] = value },
    removeItem: (key) => {
      if (key === failOn) throw new Error('boom')
      Reflect.deleteProperty(data, key)
    },
  }
}

describe('what a reset erases', () => {
  it('plans every persisted key for removal, derived from PERSISTED_KEYS', () => {
    const plan = planReset()
    expect(Object.keys(plan).sort()).toEqual([...PERSISTED_KEYS].sort())
    expect(Object.values(plan).every(value => value === null)).toBe(true)
  })

  it('covers every Keychain entry, derived from SECRET_ENTRIES', () => {
    expect([...RESET_SECRET_ENTRIES]).toEqual([...SECRET_ENTRIES])
    expect(RESET_SECRET_ENTRIES).toHaveLength(4)
  })

  it('the blobs that carry a token on web are among the erased keys', () => {
    for (const location of SECRET_STATE_LOCATIONS) expect(PERSISTED_KEYS).toContain(location.storageKey)
  })
})

describe('commitReset (web)', () => {
  const full = () => ({
    ...Object.fromEntries(PERSISTED_KEYS.map(key => [key, `{"${key}":1}`])),
    notionConfig: '{"config":{"token":"secret_abc"}}',
    'board-store': '{"boardConfig":{"todoistApiToken":"tok"}}',
    'statistics-backfill-state': '{"done":true}',
    'kando-locale': 'en',
    'kando-last-seen-version': '0.14.0',
  })

  it('removes every persisted key (tokens inside the blobs go with them) and the backfill marker, keeps language and install facts', () => {
    const storage = memoryStorage(full())
    commitReset(storage)
    expect(Object.keys(storage.data).sort()).toEqual(['kando-last-seen-version', 'kando-locale'])
    for (const key of RESET_LOCAL_KEYS) expect(storage.getItem(key)).toBeNull()
  })

  it('rolls back and throws when a key cannot be removed', () => {
    const storage = memoryStorage(full(), 'trash-store')
    expect(() => commitReset(storage)).toThrow(WebTransferError)
    for (const key of PERSISTED_KEYS) expect(storage.getItem(key)).not.toBeNull()
  })

  it('is idempotent', () => {
    const storage = memoryStorage(full())
    commitReset(storage)
    commitReset(storage)
    expect(Object.keys(storage.data).sort()).toEqual(['kando-last-seen-version', 'kando-locale'])
  })
})

describe('commitReset after a samples start (#236)', () => {
  it('leaves nothing of the sample board: its tasks, topic styles, a statistic of a finished sample task, the trash and the recap', () => {
    const demo = buildDemoBoard()
    const done = demo.tasks.find(task => task.status === TaskStatus.Done)!
    const storage = memoryStorage({
      'tasks-store': JSON.stringify({ tasks: demo.tasks, carryOverByTaskId: demo.carryOverByTaskId }),
      'topic-styles': JSON.stringify({ styles: demo.topicStyles }),
      taskStatistics: JSON.stringify({ completionRecords: [{ taskId: done.id }] }),
      'trash-store': JSON.stringify({ entries: [{ task: demo.tasks[0] }] }),
      'day-recap-store': '{"lastSeen":"2026-11-13"}',
      'statistics-backfill-state': '{"done":true}',
      'kando-locale': 'de',
    })
    commitReset(storage)
    expect(Object.keys(storage.data)).toEqual(['kando-locale'])
  })

  it('every store that can hold sample data or a statistic is among the erased keys', () => {
    for (const key of ['tasks-store', 'taskStatistics', 'topic-styles', 'trash-store', 'day-recap-store']) {
      expect(PERSISTED_KEYS).toContain(key)
    }
  })
})

describe('desktop pieces', () => {
  it('the empty data file is a valid envelope without any store', () => {
    const text = emptyEnvelopeText('device-1', '0.14.0', new Date('2026-11-12T10:00:00Z'))
    const parsed = JSON.parse(text) as unknown
    expect(isDataEnvelope(parsed)).toBe(true)
    expect(parsed).toMatchObject({ schemaVersion: CURRENT_SCHEMA_VERSION, writtenBy: 'device-1', appVersion: '0.14.0', stores: {} })
  })

  it('clears the webview copy of the persisted keys and keeps the language', () => {
    const storage = memoryStorage({ 'tasks-store': '{}', 'statistics-backfill-state': '{}', 'kando-locale': 'de' })
    clearWebviewCopy(storage)
    expect(Object.keys(storage.data)).toEqual(['kando-locale'])
  })

  it('names the failed Keychain entries once each', () => {
    expect(secretLabels(['notion-token', 'github-updates', 'github-feedback'])).toEqual(['Notion', 'GitHub'])
  })
})
