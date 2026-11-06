/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: vi.fn() }),
}))

// eslint-disable-next-line import/first -- order-sensitive: the mock comes first
import { NotionIntegration, resetStatusTypeCache } from '~/integrations/NotionIntegration'
// eslint-disable-next-line import/first -- order-sensitive: the mock comes first
import { TaskStatus } from '~/types/taskStatus'

const propertyMapping = { title: 'Name', status: 'Status', priority: 'Priority' }
const statusMapping = { today: 'Heute', doing: 'Jetzt', waiting: 'Wartet', done: 'Erledigt' }

const NEW_SHAPE = { high: ['Hoch', 'Dringend'], regular: ['Mittel'], low: ['Niedrig'] }
const LEGACY_SHAPE = { urgent: 'Dringend', high: 'Hoch', medium: 'Mittel', low: 'Niedrig' }

const make = (mapping: unknown) =>
  new NotionIntegration('tkn', 'db1', propertyMapping as any, statusMapping as any, mapping as any, 'ds-1')

function page(id: string, priority: string | null) {
  return {
    id,
    properties: {
      Name: { title: [{ plain_text: id }] },
      Status: { select: { name: statusMapping.today } },
      Priority: { select: { name: priority } },
    },
  }
}

function stubQuery(pages: unknown[]) {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url.startsWith('/api/notion/database')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'db1', title: [{ plain_text: 'DB' }], properties: {} }) })
    if (url === '/api/notion/query-data-source') return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: pages }) })
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: pages, id: 'new', success: true, page: { id: 'new' } }) })
  }))
}

async function readPriorities(mapping: unknown, names: Array<string | null>) {
  stubQuery(names.map((name, i) => page(`p${i}`, name)))
  const tasks = await make(mapping).getActiveBoardTasks()
  return names.map((_, i) => tasks.find(task => task.id === `p${i}`)?.priority)
}

async function writtenName(mapping: unknown, priority: number) {
  stubQuery([])
  await make(mapping).createTask({ title: 'T', status: TaskStatus.Open, priority } as any)
  const [, init] = (fetch as any).mock.calls.find(([u]: [string]) => u.includes('/api/notion/create-task'))
  return JSON.parse(init.body).properties.Priority?.select?.name
}

beforeEach(() => resetStatusTypeCache())
afterEach(() => vi.unstubAllGlobals())

describe('NotionIntegration priority mapping (#617)', () => {
  it('reads every option of a level as that level (several options per level)', async () => {
    expect(await readPriorities(NEW_SHAPE, ['Hoch', 'Dringend', 'Mittel', 'Niedrig', 'dringend'])).toEqual([3, 3, 2, 1, 3])
  })

  it('an unlisted option falls back to the name defaults, an empty one to Normal (#653)', async () => {
    expect(await readPriorities(NEW_SHAPE, ['Urgent', 'Sehr Wichtig', null])).toEqual([3, 1, 2])
    expect(await readPriorities(undefined, ['High', 'Medium', 'Low'])).toEqual([3, 2, 1])
  })

  it('a board without a priority column reads every page as Normal and writes no priority (#653)', async () => {
    stubQuery([{ id: 'u1', properties: { Name: { title: [{ plain_text: 'u1' }] }, Status: { select: { name: statusMapping.today } } } }])
    const ni = new NotionIntegration('tkn', 'db1', { title: 'Name', status: 'Status' } as any, statusMapping as any, undefined, 'ds-1')
    expect((await ni.getActiveBoardTasks())[0]?.priority).toBe(2)
    await ni.createTask({ title: 'T', status: TaskStatus.Open, priority: 3 } as any)
    const [, init] = (fetch as any).mock.calls.find(([u]: [string]) => u.includes('/api/notion/create-task'))
    expect(JSON.parse(init.body).properties.Priority).toBeUndefined()
  })

  it('writes the first option of the level', async () => {
    expect(await writtenName(NEW_SHAPE, 3)).toBe('Hoch')
    expect(await writtenName(NEW_SHAPE, 2)).toBe('Mittel')
    expect(await writtenName(NEW_SHAPE, 1)).toBe('Niedrig')
  })

  it('writes a stored 4 (the former urgent) as High', async () => {
    expect(await writtenName(NEW_SHAPE, 4)).toBe('Hoch')
  })

  it('a level with no option falls back: regular → low → high', async () => {
    expect(await writtenName({ high: ['H'], regular: [], low: ['L'] }, 2)).toBe('L')
    expect(await writtenName({ high: ['H'], regular: [], low: [] }, 2)).toBe('H')
  })

  describe('updating an existing task (#678)', () => {
    /** A Notion stub holding `held` as the Priority select; records the PATCH body and counts page reads. */
    function stubPage(held: string | null, extra: Record<string, unknown> = {}) {
      const state = { name: held, reads: 0, patch: undefined as any }
      vi.stubGlobal('fetch', vi.fn((url: string, init?: any) => {
        if (url.startsWith('/api/notion/database')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'db1', title: [{ plain_text: 'DB' }], properties: {} }) })
        if (url === '/api/notion/update-task') {
          state.patch = JSON.parse(init.body)
          const written = state.patch.properties.Priority?.select?.name
          if (written !== undefined) state.name = written
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'n1' }) })
        }
        if (url.startsWith('/api/notion/pages')) {
          state.reads += 1
          return Promise.resolve({ ok: true, json: () => Promise.resolve({
            id: 'n1',
            properties: { Name: { title: [{ plain_text: 'T' }] }, Status: { select: { name: statusMapping.today } }, Priority: { select: { name: state.name } }, ...extra },
          }) })
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
      }))
      return state
    }
    const update = (mapping: unknown, priority: number, props = propertyMapping) =>
      new NotionIntegration('tkn', 'db1', props as any, statusMapping as any, mapping as any, 'ds-1')
        .updateTask({ id: 'n1', source: 'notion', externalId: 'n1', title: 'T', status: TaskStatus.Open, priority, timerId: null } as any)

    it('writes the first option of the new level and keeps it after the re-read', async () => {
      const state = stubPage('Niedrig')
      const synced = await update(NEW_SHAPE, 3)
      expect(state.patch.properties.Priority).toEqual({ select: { name: 'Hoch' } })
      expect(synced.priority).toBe(3)
    })

    it('Low → High → Regular ends on the picked level each time', async () => {
      const state = stubPage('Niedrig')
      expect((await update(NEW_SHAPE, 3)).priority).toBe(3)
      expect((await update(NEW_SHAPE, 2)).priority).toBe(2)
      expect(state.name).toBe('Mittel')
    })

    it('writes a stored 4 as High and uses the legacy mapping shape', async () => {
      const state = stubPage('Niedrig')
      await update(LEGACY_SHAPE, 4)
      expect(state.patch.properties.Priority).toEqual({ select: { name: 'Hoch' } })
    })

    it('leaves Notion alone when the level already matches (empty select is Normal)', async () => {
      const state = stubPage(null)
      await update(NEW_SHAPE, 2)
      expect(state.patch.properties.Priority).toBeUndefined()
    })

    it('leaves an unlisted option alone when the local level is what it reads as', async () => {
      const state = stubPage('Sehr Wichtig') // not in the mapping: reads as Low
      await update(NEW_SHAPE, 1)
      expect(state.patch.properties.Priority).toBeUndefined()
    })

    it('another option of the same level is not rewritten to the first one', async () => {
      const state = stubPage('Dringend')
      await update(NEW_SHAPE, 3)
      expect(state.patch.properties.Priority).toBeUndefined()
    })

    it('a board without a priority column writes nothing and reads no page for it', async () => {
      const state = stubPage('Niedrig')
      await update(NEW_SHAPE, 3, { title: 'Name', status: 'Status' } as any)
      expect(state.patch.properties.Priority).toBeUndefined()
      expect(state.reads).toBe(1) // only the re-read after the PATCH
    })

    it('a level whose mapping yields no option name writes nothing', async () => {
      const state = stubPage('Niedrig')
      await update({ high: [], regular: [], low: [] }, 3)
      expect(state.patch.properties.Priority).toBeUndefined()
    })

    it('shares one page read with the unplanned multi_select merge', async () => {
      const state = stubPage('Niedrig', { Tags: { type: 'multi_select', multi_select: [{ name: 'x' }] } })
      const props = { ...propertyMapping, unplanned: { mode: 'value', valuePropertyName: 'Tags', propertyType: 'multi_select', value: 'unplanned' } }
      await new NotionIntegration('tkn', 'db1', props as any, statusMapping as any, NEW_SHAPE as any, 'ds-1')
        .updateTask({ id: 'n1', source: 'notion', externalId: 'n1', title: 'T', status: TaskStatus.Open, priority: 3, isUnplanned: true, timerId: null } as any)
      expect(state.patch.properties.Priority).toEqual({ select: { name: 'Hoch' } })
      expect(state.reads).toBe(2) // one before the PATCH (merge and priority), one after
    })
  })

  describe('a mapping stored before #617 (urgent/high/medium/low)', () => {
    it('reads like the new shape, Urgent is High', async () => {
      expect(await readPriorities(LEGACY_SHAPE, ['Dringend', 'Hoch', 'Mittel', 'Niedrig'])).toEqual([3, 3, 2, 1])
    })

    it('writes the former High name for High, never the Urgent one', async () => {
      expect(await writtenName(LEGACY_SHAPE, 3)).toBe('Hoch')
      expect(await writtenName(LEGACY_SHAPE, 4)).toBe('Hoch')
      expect(await writtenName(LEGACY_SHAPE, 2)).toBe('Mittel')
      expect(await writtenName({ urgent: 'U', high: 'H', medium: null, low: null }, 1)).toBe('H')
    })
  })
})
