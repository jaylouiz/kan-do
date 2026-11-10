import { describe, expect, it } from 'vitest'
import {
  TOKEN_SECTIONS, areaTitle, filterGroups, groupOfRow, kitGroups, matchesSearch, neighbours, parseView, partGroups, searchWords, tilePreview, viewQuery,
} from '~/dev-tools/ui-catalog/catalogNav'
import type { ManifestRow, ThemeAxis } from '~/dev-tools/ui-catalog/catalogModel'
import type { CatalogEntry } from '~/catalog/types'

// The navigation model of /ui (kd#127): pure, so the views, the sidebar and the search are covered without a browser.

const row = (name: string, over: Partial<ManifestRow> = {}): ManifestRow => ({
  name, path: `components/task/${name}.vue`, source: 'app', kind: 'component', category: 'display', tier: 'feature', area: 'task',
  description: '', usage: '', avoid: '', responsibility: [], variants: [], states: [], usedBy: {}, ...over,
})

const rows = [
  row('UButton', { source: 'nuxt-ui', tier: 'kit', area: 'nuxt-ui', kind: 'primitive', category: 'action', description: 'The one button of the app' }),
  row('ListRow', { tier: 'kit', area: 'ui', kind: 'compound', category: 'display' }),
  row('TopicMark', { tier: 'kit', area: 'topic', kind: 'primitive', category: 'display' }),
  row('StatsTile', { area: 'statistics', kind: 'compound' }),
  row('StatsRing', { area: 'statistics', kind: 'primitive' }),
  row('TaskForm', { area: 'task', kind: 'block', category: 'input', usage: 'The add form of the task sheet' }),
  row('Gadget', { area: 'gadgets' }),
]

describe('parseView and viewQuery', () => {
  it('reads the view from the address and falls back to the overview', () => {
    expect(parseView({}, rows)).toEqual({ kind: 'overview' })
    expect(parseView({ v: 'nonsense' }, rows)).toEqual({ kind: 'overview' })
    expect(parseView({ v: 'tokens' }, rows)).toEqual({ kind: 'tokens', group: undefined })
    expect(parseView({ v: 'tokens.motion' }, rows)).toEqual({ kind: 'tokens', group: 'motion' })
    expect(parseView({ v: 'kit.action' }, rows)).toEqual({ kind: 'kit', category: 'action' })
    expect(parseView({ v: 'parts.statistics' }, rows)).toEqual({ kind: 'parts', area: 'statistics' })
    expect(parseView({ v: 'all' }, rows)).toEqual({ kind: 'all' })
  })

  it('an unknown category or area shows the whole tier, an unknown component the view behind it', () => {
    expect(parseView({ v: 'kit.keyboard' }, rows)).toEqual({ kind: 'kit', category: undefined })
    expect(parseView({ v: 'parts.nowhere' }, rows)).toEqual({ kind: 'parts', area: undefined })
    expect(parseView({ c: 'Nope', v: 'kit' }, rows)).toEqual({ kind: 'kit', category: undefined })
  })

  it('a component wins over the view, and every view round-trips through its query', () => {
    expect(parseView({ c: 'UButton', v: 'tokens' }, rows)).toEqual({ kind: 'component', name: 'UButton' })
    for (const query of [{}, { v: 'tokens' }, { v: 'tokens.motion' }, { v: 'kit' }, { v: 'kit.action' }, { v: 'parts' }, { v: 'parts.statistics' }, { v: 'all' }, { c: 'ListRow' }]) {
      expect(viewQuery(parseView(query, rows))).toEqual(query)
    }
  })
})

describe('groups', () => {
  it('the kit is grouped by category in page order, smallest kind first; feature parts stay out', () => {
    const groups = kitGroups(rows)
    expect(groups.map(group => [group.id, group.title, group.rows.map(r => r.name)])).toEqual([
      ['kit.action', 'Aktion', ['UButton']],
      ['kit.display', 'Darstellung', ['TopicMark', 'ListRow']],
    ])
  })

  it('the feature parts are grouped by area: named areas in their order, an unnamed folder last under its own name', () => {
    const groups = partGroups(rows)
    expect(groups.map(group => [group.id, group.title, group.rows.map(r => r.name)])).toEqual([
      ['parts.task', 'Task', ['TaskForm']],
      ['parts.statistics', 'Statistics', ['StatsRing', 'StatsTile']],
      ['parts.gadgets', 'gadgets', ['Gadget']],
    ])
    expect(areaTitle('nav')).toBe('App bar')
  })

  it('a row knows its group and its neighbours in it', () => {
    expect(groupOfRow(rows[0]!)).toEqual({ tier: 'kit', id: 'kit.action', title: 'Aktion' })
    expect(groupOfRow(rows[3]!)).toEqual({ tier: 'parts', id: 'parts.statistics', title: 'Statistics' })
    expect(neighbours(rows[3]!, rows).previous?.name).toBe('StatsRing')
    expect(neighbours(rows[3]!, rows).next).toBeUndefined()
    expect(neighbours(rows[0]!, rows)).toEqual({ previous: undefined, next: undefined })
  })
})

describe('search', () => {
  it('every word must match the name, the texts, the category title or the area', () => {
    expect(searchWords('  Task   form ')).toEqual(['task', 'form'])
    expect(matchesSearch(rows[5]!, ['task', 'sheet'])).toBe(true)
    expect(matchesSearch(rows[5]!, ['task', 'ring'])).toBe(false)
    expect(matchesSearch(rows[0]!, ['aktion'])).toBe(true)
    expect(matchesSearch(rows[4]!, ['statistics'])).toBe(true)
    expect(matchesSearch(rows[4]!, [])).toBe(true)
  })

  it('filters the rows of each group and drops the groups left empty', () => {
    const found = filterGroups([...kitGroups(rows), ...partGroups(rows)], ['stats'])
    expect(found.map(group => [group.id, group.rows.map(r => r.name)])).toEqual([['parts.statistics', ['StatsRing', 'StatsTile']]])
    expect(filterGroups(kitGroups(rows), [])).toEqual(kitGroups(rows))
  })
})

describe('tilePreview', () => {
  const entry = (over: Partial<CatalogEntry>): CatalogEntry => ({ component: 'X', source: 'app', alternatives: [], states: [], ...over })
  const axes: ThemeAxis[] = [
    { axis: 'color', values: [{ value: 'primary', isDefault: true }, { value: 'error', isDefault: false }] },
    { axis: 'size', values: [{ value: 'sm', isDefault: false }, { value: 'md', isDefault: true }] },
  ]

  it('a library matrix shows its default cell', () => {
    const preview = tilePreview(entry({ source: 'nuxt-ui', theme: 'button', matrix: { axes: ['color', 'size'], props: { block: false }, slot: 'Save' } }), axes)
    expect(preview).toEqual({ group: 'matrix', example: { id: 'default', props: { block: false, color: 'primary', size: 'md' }, slot: 'Save' } })
  })

  it('an app component shows its first variant, else its first state', () => {
    expect(tilePreview(entry({ variants: [{ id: 'a' }, { id: 'b' }], states: [{ id: 's', state: 'empty' }] }), [])).toEqual({ group: 'variant', example: { id: 'a' } })
    expect(tilePreview(entry({ states: [{ id: 's', state: 'empty' }] }), [])).toEqual({ group: 'state', example: { id: 's', state: 'empty' } })
  })

  it('nothing for a component without an entry, without samples, or that opens from a button', () => {
    expect(tilePreview(undefined, [])).toBeUndefined()
    expect(tilePreview(entry({ sampleNote: 'a whole page' }), [])).toBeUndefined()
    expect(tilePreview(entry({ launch: 'open', variants: [{ id: 'a' }] }), [])).toBeUndefined()
  })
})

describe('TOKEN_SECTIONS', () => {
  it('names each section once', () => {
    const ids = TOKEN_SECTIONS.map(section => section.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(expect.arrayContaining(['roles', 'palettes', 'colors', 'typography', 'zIndex', 'motion', 'components']))
  })
})
