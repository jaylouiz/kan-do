import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createPersistedState } from 'pinia-plugin-persistedstate'
import { createApp } from 'vue'
import { useTrashStore } from '~/store/trash'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import type { TrashEntry } from '~/types/trash'
import { TRASH_MAX_ENTRIES, TRASH_RETENTION_DAYS } from '~/lib/trash'

const DAY = 86_400_000

const entry = (id: string, deletedAt = Date.now()): TrashEntry => ({
  taskId: id,
  deletedAt,
  fromStatus: TaskStatus.Waiting,
  carryOver: null,
  task: { id, source: 'local', externalId: null, title: id, status: TaskStatus.Waiting, activity: null, topic: null, topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null } as Task,
})

function freshPinia() {
  const pinia = createPinia()
  pinia.use(createPersistedState({ storage: localStorage }))
  createApp({}).use(pinia)
  setActivePinia(pinia)
}

describe('trash store (#422, D3)', () => {
  beforeEach(() => {
    localStorage.clear()
    freshPinia()
  })

  it('adds newest first and replaces an entry of the same task', () => {
    const trash = useTrashStore()
    const now = Date.now()
    trash.add(entry('a', now - 3000), now)
    trash.add(entry('b', now - 2000), now)
    trash.add(entry('a', now - 1000), now)
    expect(trash.entries.map(e => e.taskId)).toEqual(['a', 'b'])
    expect(trash.entries[0]?.deletedAt).toBe(now - 1000)
    expect(trash.count).toBe(2)
  })

  it('shows the 3 most recent in the sheet', () => {
    const trash = useTrashStore()
    const now = Date.now()
    for (const [i, id] of ['a', 'b', 'c', 'd'].entries()) trash.add(entry(id, now + i), now + 10)
    expect(trash.recent.map(e => e.taskId)).toEqual(['d', 'c', 'b'])
  })

  it('purges by age and by the 100 cap on add', () => {
    const trash = useTrashStore()
    const now = Date.now()
    trash.add(entry('old', now - (TRASH_RETENTION_DAYS * DAY + 1000)), now)
    expect(trash.count).toBe(0)
    for (let i = 0; i < TRASH_MAX_ENTRIES + 3; i++) trash.add(entry(`t${i}`, now - 1000 + i), now)
    expect(trash.count).toBe(TRASH_MAX_ENTRIES)
    expect(trash.entry('t0')).toBeUndefined()
    expect(trash.entry(`t${TRASH_MAX_ENTRIES + 2}`)).toBeDefined()
  })

  it('removes one entry and clears all', () => {
    const trash = useTrashStore()
    trash.add(entry('a'))
    trash.add(entry('b'))
    trash.remove('a')
    expect(trash.entries.map(e => e.taskId)).toEqual(['b'])
    trash.clear()
    expect(trash.entries).toEqual([])
  })

  it('hydrates an empty trash from a state without the key, and writes nothing', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    freshPinia()
    const trash = useTrashStore()
    expect(trash.entries).toEqual([])
    expect(setItem).not.toHaveBeenCalled()
    setItem.mockRestore()
  })

  it('hydrates what was stored, with the snapshot dates revived, and writes nothing when nothing was purged', () => {
    const stored = entry('a', Date.now() - 1000)
    localStorage.setItem('trash-store', JSON.stringify({ entries: [{ ...stored, task: { ...stored.task, createdAt: '2026-10-30T10:00:00.000Z' } }] }))
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    freshPinia()
    const trash = useTrashStore()
    expect(trash.entries).toHaveLength(1)
    expect(trash.entries[0]?.task.createdAt).toBeInstanceOf(Date)
    expect(setItem).not.toHaveBeenCalled()
    setItem.mockRestore()
  })

  it('reads a trashed task with the former 4th priority (urgent) as High, without writing (#617)', () => {
    const stored = entry('a', Date.now() - 1000)
    localStorage.setItem('trash-store', JSON.stringify({ entries: [{ ...stored, task: { ...stored.task, priority: 4 } }] }))
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    freshPinia()
    expect(useTrashStore().entries[0]?.task.priority).toBe(3)
    expect(setItem).not.toHaveBeenCalled()
    setItem.mockRestore()
  })

  it('drops malformed stored entries instead of throwing, and keeps the good ones', () => {
    localStorage.setItem('trash-store', JSON.stringify({ entries: [null, { taskId: 'x', deletedAt: Date.now() }, entry('ok', Date.now() - 1000)] }))
    freshPinia()
    const trash = useTrashStore()
    expect(trash.entries.map(e => e.taskId)).toEqual(['ok'])
  })

  it('purges expired entries on hydrate and persists only then', () => {
    const fresh = entry('fresh', Date.now() - 1000)
    const stale = entry('stale', Date.now() - (TRASH_RETENTION_DAYS * DAY + 5000))
    localStorage.setItem('trash-store', JSON.stringify({ entries: [fresh, stale] }))
    freshPinia()
    const trash = useTrashStore()
    expect(trash.entries.map(e => e.taskId)).toEqual(['fresh'])
    expect(JSON.parse(localStorage.getItem('trash-store') ?? '{}').entries).toHaveLength(1)
  })

  it('persists an add under trash-store', async () => {
    const trash = useTrashStore()
    trash.add(entry('a'))
    await Promise.resolve()
    expect(JSON.parse(localStorage.getItem('trash-store') ?? '{}').entries.map((e: TrashEntry) => e.taskId)).toEqual(['a'])
  })
})
