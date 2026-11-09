import { nextTick } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'
import { EDITS_STORAGE_KEY } from '~/dev-tools/copy-editor/constants'
import { ALL_KEYS, baseValue, checkText, clearPublished, currentValue, edits, markPublished, needsTranslation, pendingEdits, revertEdit, saveEdit, setDraft } from '~/dev-tools/copy-editor/edits'
import { keysForElement } from '~/dev-tools/copy-editor/picker'
import { recordTranslation, resetRecorder } from '~/lib/copy-editor/recorder'

const KEY = 'board.columns.open'

beforeEach(() => {
  edits.value = {}
  resetRecorder()
  localStorage.clear()
})

describe('copy editor edits', () => {
  it('reads the real locale files as text, not compiled messages', () => {
    expect(baseValue(KEY, 'de')).toBe('Offen')
    expect(baseValue(KEY, 'en')).toBe('Open')
    expect(ALL_KEYS).toContain('common.cancel')
  })

  it('saves the written language, leaves the other for the agent, and reverts to the original', () => {
    expect(saveEdit({ key: KEY, written: 'de', text: 'Noch offen', other: { kind: 'agent' } }).blocking).toEqual([])
    expect(edits.value[KEY]).toMatchObject({ written: 'de', de: 'Noch offen', en: 'Open', other: 'agent' })
    expect(currentValue(KEY, 'de')).toBe('Noch offen')
    expect(needsTranslation.value.map(e => e.key)).toEqual([KEY])

    setDraft(KEY, 'Still open')
    expect(edits.value[KEY]).toMatchObject({ en: 'Still open', other: 'draft' })
    expect(needsTranslation.value).toEqual([])

    // writing the original text with the other language untouched removes the edit
    saveEdit({ key: KEY, written: 'de', text: 'Offen', other: { kind: 'agent' } })
    expect(edits.value[KEY]).toBeUndefined()
  })

  it('a rejected draft keeps the language as it was and records why', () => {
    saveEdit({ key: KEY, written: 'de', text: 'Noch offen', other: { kind: 'agent' } })
    setDraft(KEY, null, ['placeholders differ'])
    expect(edits.value[KEY]).toMatchObject({ en: 'Open', other: 'agent', draftProblems: ['placeholders differ'] })
  })

  it('blocks decided terms and parity problems, warns for proposed terms, and saves nothing then', () => {
    const blocked = saveEdit({ key: KEY, written: 'de', text: 'Quelle', other: { kind: 'agent' } })
    expect(blocked.blocking[0]).toContain('decided term')
    expect(edits.value[KEY]).toBeUndefined()
    expect(saveEdit({ key: KEY, written: 'de', text: 'Offen {x}', other: { kind: 'self', text: 'Open' } }).blocking.join()).toContain('placeholders differ')
    expect(saveEdit({ key: KEY, written: 'de', text: ' ', other: { kind: 'agent' } }).blocking).toContain('empty')
    expect(checkText(KEY, 'de', 'Ein Ticket', undefined).warnings.join()).toContain('proposed term')
  })

  it('keeps published edits visible but out of the next publish, and persists to localStorage', async () => {
    saveEdit({ key: KEY, written: 'en', text: 'Still open', other: { kind: 'self', text: 'Noch offen' } })
    await nextTick()
    expect(JSON.parse(localStorage.getItem(EDITS_STORAGE_KEY) ?? '{}')[KEY]).toMatchObject({ en: 'Still open', de: 'Noch offen', other: 'self' })
    markPublished([KEY], 'https://github.com/o/r/pull/1')
    expect(pendingEdits.value).toEqual([])
    expect(currentValue(KEY, 'en')).toBe('Still open')
    clearPublished()
    expect(edits.value).toEqual({})
    revertEdit(KEY)
  })
})

describe('copy editor picker', () => {
  const render = (html: string) => {
    document.body.innerHTML = html
    return document.body.firstElementChild as Element
  }

  it('finds the key from the rendered text, interpolation included, and from copy attributes', () => {
    recordTranslation('3 Aufgaben', 'board.count')
    recordTranslation('Suchen', 'search.placeholder')
    expect(keysForElement(render('<p>3  Aufgaben</p>'))?.keys).toEqual(['board.count'])
    expect(keysForElement(render('<input placeholder="Suchen">'))?.keys).toEqual(['search.placeholder'])
    expect(keysForElement(render('<button><svg></svg>Suchen</button>'))?.keys).toEqual(['search.placeholder'])
  })

  it('offers every key that rendered the same text', () => {
    recordTranslation('Heute', 'a.today')
    recordTranslation('Heute', 'b.today')
    expect(keysForElement(render('<h1>Heute</h1>'))?.keys).toEqual(['a.today', 'b.today'])
  })

  it('never offers user data or the tool itself', () => {
    recordTranslation('Heute', 'a.today')
    expect(keysForElement(render('<p data-private>Heute</p>'))).toBeNull()
    expect(keysForElement(render('<div data-private><span>Heute</span></div>').firstElementChild!)).toBeNull()
    expect(keysForElement(render('<div data-kando-copy-editor><span>Heute</span></div>').firstElementChild!)).toBeNull()
    expect(keysForElement(render('<p>unknown text</p>'))).toBeNull()
  })
})
