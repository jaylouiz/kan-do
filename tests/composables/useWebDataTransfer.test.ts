import { beforeEach, describe, expect, it, vi } from 'vitest'

const reloadApp = vi.fn()
vi.mock('~/utils/reloadApp', () => ({ reloadApp }))

const { useWebDataTransfer } = await import('~/composables/useWebDataTransfer')

const ENVELOPE = (stores: Record<string, unknown>) => JSON.stringify({
  schemaVersion: 1, writtenAt: '2026-01-02T10:00:00.000Z', writtenBy: 'x', appVersion: '1', stores,
})

describe('useWebDataTransfer', () => {
  beforeEach(() => {
    localStorage.clear()
    reloadApp.mockReset()
    vi.stubGlobal('useRuntimeConfig', () => ({ public: { clientVersion: '9.9.9' } }))
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }))
  })

  it('replaces persisted keys, keeps this browser\'s tokens and other keys, then reloads', async () => {
    localStorage.setItem('kando-locale', 'en')
    localStorage.setItem('notionConfig', JSON.stringify({ config: { token: 'mine' } }))
    localStorage.setItem('tasks-store', '{"tasks":[]}')
    const { applyImport } = useWebDataTransfer()
    const text = ENVELOPE({ 'tasks-store': { tasks: [{ id: 'a' }] }, notionConfig: { config: { token: 'evil', databaseId: 'd' } } })
    await applyImport({ text, fileName: 'f.json', taskCount: 1, schemaVersion: 1, writtenAt: null })
    expect(JSON.parse(localStorage.getItem('tasks-store') as string)).toEqual({ tasks: [{ id: 'a' }] })
    expect(JSON.parse(localStorage.getItem('notionConfig') as string)).toEqual({ config: { token: 'mine', databaseId: 'd' } })
    expect(localStorage.getItem('kando-locale')).toBe('en')
    expect(reloadApp).toHaveBeenCalledOnce()
  })

  it('leaves data intact and does not reload when the write fails', async () => {
    localStorage.setItem('tasks-store', 'old')
    const original = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (value.includes('"a"')) throw new DOMException('full', 'QuotaExceededError')
      original.call(this, key, value)
    })
    const { applyImport } = useWebDataTransfer()
    const text = ENVELOPE({ 'tasks-store': { tasks: [{ id: 'a' }] } })
    await expect(applyImport({ text, fileName: 'f.json', taskCount: 1, schemaVersion: 1, writtenAt: null })).rejects.toMatchObject({ kind: 'quota' })
    vi.restoreAllMocks()
    expect(localStorage.getItem('tasks-store')).toBe('old')
    expect(reloadApp).not.toHaveBeenCalled()
  })

  it('stops before the replace when the safety download fails', async () => {
    localStorage.setItem('tasks-store', 'old')
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => { throw new Error('blocked') }) }))
    const { applyImport } = useWebDataTransfer()
    const text = ENVELOPE({ 'tasks-store': { tasks: [{ id: 'a' }] } })
    await expect(applyImport({ text, fileName: 'f.json', taskCount: 1, schemaVersion: 1, writtenAt: null }, { safetyDownload: true }))
      .rejects.toMatchObject({ kind: 'safety' })
    expect(localStorage.getItem('tasks-store')).toBe('old')
    expect(reloadApp).not.toHaveBeenCalled()
  })

  it('exports without secrets', async () => {
    localStorage.setItem('notionConfig', JSON.stringify({ config: { token: 'secret', databaseId: 'd' } }))
    localStorage.setItem('tasks-store', '{"tasks":[]}')
    let blob: Blob | undefined
    vi.mocked(URL.createObjectURL).mockImplementation((b) => { blob = b as Blob; return 'blob:x' })
    await useWebDataTransfer().exportData()
    const text = await blob!.text()
    expect(text).not.toContain('secret')
    expect(JSON.parse(text).stores.notionConfig).toEqual({ config: { databaseId: 'd' } })
    expect(JSON.parse(text).appVersion).toBe('9.9.9')
  })
})
