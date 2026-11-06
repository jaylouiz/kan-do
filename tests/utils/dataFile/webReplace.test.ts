import { describe, expect, it } from 'vitest'
import { PERSISTED_KEYS } from '~/lib/dataStorage'
import { commitReplace, planReplace, storesFromBlobs, WebTransferError, type BlobStorage, type StoredBlobs } from '~/utils/dataFile/webReplace'

const none = (): StoredBlobs => Object.fromEntries(PERSISTED_KEYS.map(key => [key, null]))

function memoryStorage(initial: Record<string, string>, failOn?: { key: string, error: Error }): BlobStorage & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: key => data[key] ?? null,
    setItem: (key, value) => {
      if (failOn && failOn.key === key) throw failOn.error
      data[key] = value
    },
    removeItem: (key) => { Reflect.deleteProperty(data, key) },
  }
}

describe('planReplace', () => {
  it('replaces persisted keys with the file and removes keys the file lacks', () => {
    const current = { ...none(), 'tasks-store': '{"tasks":[1]}', propertyOptions: '{"a":1}' }
    const plan = planReplace(current, { 'tasks-store': { tasks: [1, 2] } })
    expect(plan['tasks-store']).toBe('{"tasks":[1,2]}')
    expect(plan.propertyOptions).toBeNull()
    expect(Object.keys(plan).sort()).toEqual([...PERSISTED_KEYS].sort())
  })

  it('re-applies this browser\'s secrets and ignores any token in the file', () => {
    const current = {
      ...none(),
      notionConfig: JSON.stringify({ config: { token: 'mine', databaseId: 'old' } }),
      'board-store': JSON.stringify({ boardConfig: { todoistApiToken: 'todo-mine' } }),
    }
    const plan = planReplace(current, {
      notionConfig: { config: { token: 'from-file', databaseId: 'new' } },
      'board-store': { boardConfig: { sources: { connected: [], default: 'local' } } },
    })
    expect(JSON.parse(plan.notionConfig as string)).toEqual({ config: { token: 'mine', databaseId: 'new' } })
    expect(JSON.parse(plan['board-store'] as string)).toEqual({ boardConfig: { sources: { connected: [], default: 'local' }, todoistApiToken: 'todo-mine' } })
  })

  it('keeps a secret even when the file has no blob for that store, and writes none when there is no secret', () => {
    const current = { ...none(), notionConfig: JSON.stringify({ config: { token: 'mine' } }) }
    const plan = planReplace(current, {})
    expect(JSON.parse(plan.notionConfig as string)).toEqual({ config: { token: 'mine' } })
    expect(plan['board-store']).toBeNull()
  })
})

describe('planReplace on a mixed board (#325)', () => {
  it('writes the file\'s tasks with their sources, and a browser without a Notion token gets none', () => {
    const imported = {
      'tasks-store': { tasks: [{ id: 'page-1', source: 'notion', externalId: 'page-1' }, { id: 'local_1', source: 'local', externalId: null }] },
      'board-store': { boardConfig: { sources: { connected: ['notion'], default: 'local' } } },
      notionConfig: { config: { databaseId: 'db-1' } },
    }
    const plan = planReplace(none(), imported)
    expect(JSON.parse(plan['tasks-store'] as string).tasks).toEqual(imported['tasks-store'].tasks)
    expect(JSON.parse(plan['board-store'] as string).boardConfig.sources).toEqual({ connected: ['notion'], default: 'local' })
    expect(JSON.parse(plan.notionConfig as string).config.token).toBeUndefined()
  })
})

describe('storesFromBlobs', () => {
  it('parses set keys and skips unset or corrupt ones', () => {
    expect(storesFromBlobs({ ...none(), 'tasks-store': '{"tasks":[]}', 'board-store': '{oops' })).toEqual({ 'tasks-store': { tasks: [] } })
  })
})

describe('commitReplace', () => {
  it('writes only persisted keys', () => {
    const storage = memoryStorage({ 'kando-locale': 'en', 'tasks-store': 'old' })
    commitReplace(storage, { ...none(), 'tasks-store': 'new' })
    expect(storage.data).toEqual({ 'kando-locale': 'en', 'tasks-store': 'new' })
  })

  it('rolls back and reports a quota failure', () => {
    const quota = new DOMException('full', 'QuotaExceededError')
    const storage = memoryStorage({ 'tasks-store': 'old', 'board-store': 'old-board' }, { key: 'board-store', error: quota })
    const plan = { ...none(), 'tasks-store': 'new', 'board-store': 'new-board' }
    expect(() => commitReplace(storage, plan)).toThrow(WebTransferError)
    try {
      commitReplace(storage, plan)
    } catch (error) {
      expect((error as WebTransferError).kind).toBe('quota')
    }
    expect(storage.data).toEqual({ 'tasks-store': 'old', 'board-store': 'old-board' })
  })
})
