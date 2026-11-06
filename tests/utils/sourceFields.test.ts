import { describe, it, expect } from 'vitest'
import { fieldsForSource } from '~/utils/sourceFields'
import { SOURCE_IDS } from '~/types/taskSource'
import type { NotionPropertyMapping } from '~/types/notion'

const mapping = (overrides: Partial<NotionPropertyMapping> = {}): NotionPropertyMapping => ({
  title: 'Name',
  status: 'Status',
  ...overrides,
})

describe('fieldsForSource (#321)', () => {
  it('Local offers the four standard fields and no custom properties, whatever Notion maps', () => {
    const fields = fieldsForSource('local', mapping({ priority: 'Prio', customProperties: [{ key: 'k', name: 'K', type: 'text', enabled: true }] }))
    expect(fields).toEqual({ priority: true, timebox: true, activity: true, topic: true, customProperties: [] })
  })

  it('a board that was never set up behaves like Local', () => {
    expect(fieldsForSource(null)).toEqual(fieldsForSource('local'))
  })

  it('Notion offers only the standard fields its mapping names', () => {
    expect(fieldsForSource('notion', mapping({ priority: 'Prio', topic: 'Projekt' }))).toMatchObject({
      priority: true, timebox: false, activity: false, topic: true,
    })
    expect(fieldsForSource('notion', mapping({ timeBox: 'Dauer', activity: 'Art' }))).toMatchObject({
      priority: false, timebox: true, activity: true, topic: false,
    })
  })

  it('Notion without a mapping offers no standard field', () => {
    expect(fieldsForSource('notion', null)).toEqual({ priority: false, timebox: false, activity: false, topic: false, customProperties: [] })
    expect(fieldsForSource('notion')).toMatchObject({ priority: false, topic: false })
  })

  it('Notion offers the enabled custom properties only', () => {
    const on = { key: 'a', name: 'A', type: 'text' as const, enabled: true }
    const off = { key: 'b', name: 'B', type: 'text' as const, enabled: false }
    expect(fieldsForSource('notion', mapping({ customProperties: [on, off] })).customProperties).toEqual([on])
  })

  it('Todoist offers what its integration maps today: priority and topic', () => {
    expect(fieldsForSource('todoist', mapping({ priority: 'Prio' }))).toEqual({
      priority: true, timebox: false, activity: false, topic: true, customProperties: [],
    })
  })

  it('answers for every source id', () => {
    for (const source of SOURCE_IDS) expect(fieldsForSource(source, mapping())).toBeTruthy()
  })
})
