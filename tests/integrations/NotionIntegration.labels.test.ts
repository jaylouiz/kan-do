/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: vi.fn() }),
}))

// eslint-disable-next-line import/first -- order-sensitive: the mock comes first
import { NotionIntegration, resetStatusTypeCache } from '~/integrations/NotionIntegration'
// eslint-disable-next-line import/first -- order-sensitive: the mock comes first
import { TaskStatus } from '~/types/taskStatus'

const propertyMapping = { title: 'Name', status: 'Status', topic: 'Thema', activity: 'Aktivität' }
const statusMapping = { today: 'Heute', doing: 'Jetzt', waiting: 'Wartet', done: 'Erledigt' }

type Held = Record<string, unknown>

/**
 * A Notion stub whose page holds `held` for Thema and Aktivität (raw Notion property values) and whose schema
 * reports the given property types. Records every PATCH body.
 */
function stubNotion(types: { Thema: string; 'Aktivität': string }, held: { Thema: Held; 'Aktivität': Held }) {
  const state = { patches: [] as any[] }
  vi.stubGlobal('fetch', vi.fn((url: string, init?: any) => {
    const json = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
    if (url.startsWith('/api/notion/database')) return json({ id: 'db1', title: [{ plain_text: 'DB' }], properties: {} })
    if (url.startsWith('/api/notion/data-sources?id=')) {
      return json({ id: 'ds-1', properties: { Thema: { type: types.Thema }, 'Aktivität': { type: types['Aktivität'] }, Status: { type: 'select' } } })
    }
    if (url === '/api/notion/update-task') {
      state.patches.push(JSON.parse(init.body).properties)
      return json({ id: 'n1' })
    }
    if (url.startsWith('/api/notion/pages')) {
      return json({
        id: 'n1',
        properties: { Name: { title: [{ plain_text: 'T' }] }, Status: { select: { name: statusMapping.today } }, ...held },
      })
    }
    return json({})
  }))
  return state
}

const update = (task: Record<string, unknown>) =>
  new NotionIntegration('tkn', 'db1', propertyMapping as any, statusMapping as any, undefined, 'ds-1')
    .updateTask({ id: 'n1', source: 'notion', externalId: 'n1', title: 'T', status: TaskStatus.Open, priority: 2, timerId: null, ...task } as any)

const sel = (name: string | null) => ({ select: name ? { name } : null })
const multi = (...names: string[]) => ({ multi_select: names.map(name => ({ name })) })
const text = (content: string) => ({ rich_text: content ? [{ plain_text: content, text: { content } }] : [] })

beforeEach(() => resetStatusTypeCache())
afterEach(() => vi.unstubAllGlobals())

describe('NotionIntegration.updateTask writes Thema and Aktivität (#39)', () => {
  it('writes a changed Thema (select) and Aktivität (multi_select) in the property type', async () => {
    const state = stubNotion({ Thema: 'select', 'Aktivität': 'multi_select' }, { Thema: sel('Alt'), 'Aktivität': multi('Alt') })
    await update({ topic: 'Neu', activity: 'Neu-Akt' })
    expect(state.patches[0].Thema).toEqual({ select: { name: 'Neu' } })
    expect(state.patches[0]['Aktivität']).toEqual({ multi_select: [{ name: 'Neu-Akt' }] })
  })

  it('writes rich_text properties as text', async () => {
    const state = stubNotion({ Thema: 'rich_text', 'Aktivität': 'rich_text' }, { Thema: text('Alt'), 'Aktivität': text('') })
    await update({ topic: 'Neu', activity: 'Akt' })
    expect(state.patches[0].Thema).toEqual({ rich_text: [{ text: { content: 'Neu' } }] })
    expect(state.patches[0]['Aktivität']).toEqual({ rich_text: [{ text: { content: 'Akt' } }] })
  })

  it('clears a label the user cleared', async () => {
    const state = stubNotion({ Thema: 'select', 'Aktivität': 'multi_select' }, { Thema: sel('Alt'), 'Aktivität': multi('Alt') })
    await update({ topic: null, activity: null })
    expect(state.patches[0].Thema).toEqual({ select: null })
    expect(state.patches[0]['Aktivität']).toEqual({ multi_select: [] })
  })

  it('leaves both alone when they match what Notion holds (case and spaces aside), also a multi-value Aktivität', async () => {
    const state = stubNotion({ Thema: 'select', 'Aktivität': 'multi_select' }, { Thema: sel('Garten'), 'Aktivität': multi('A', 'B') })
    await update({ topic: ' garten ', activity: 'A, B' })
    expect(state.patches[0].Thema).toBeUndefined()
    expect(state.patches[0]['Aktivität']).toBeUndefined()
  })

  it('writes nothing for a label with no value on either side', async () => {
    const state = stubNotion({ Thema: 'select', 'Aktivität': 'multi_select' }, { Thema: sel(null), 'Aktivität': multi() })
    await update({ topic: null, activity: undefined })
    expect(state.patches[0].Thema).toBeUndefined()
    expect(state.patches[0]['Aktivität']).toBeUndefined()
  })

  it('writes no label when the property is not mapped', async () => {
    const state = stubNotion({ Thema: 'select', 'Aktivität': 'multi_select' }, { Thema: sel('Alt'), 'Aktivität': multi('Alt') })
    await new NotionIntegration('tkn', 'db1', { title: 'Name', status: 'Status' } as any, statusMapping as any, undefined, 'ds-1')
      .updateTask({ id: 'n1', source: 'notion', externalId: 'n1', title: 'T', status: TaskStatus.Open, priority: 2, topic: 'Neu', timerId: null } as any)
    expect(state.patches[0].Thema).toBeUndefined()
  })

  it('returns the value Notion holds after the write', async () => {
    stubNotion({ Thema: 'select', 'Aktivität': 'multi_select' }, { Thema: sel('Neu'), 'Aktivität': multi('Neu-Akt') })
    const synced = await update({ topic: 'Neu', activity: 'Neu-Akt' })
    expect(synced.topic).toBe('Neu')
    expect(synced.activity).toBe('Neu-Akt')
  })
})
