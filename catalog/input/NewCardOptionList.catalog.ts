import type { CatalogEntry } from '../types'

const topics = ['Baustelle Müller', 'Angebote', 'Personal', 'Fuhrpark', 'Buchhaltung', 'Kunde Schmidt']

/** Description, usage and avoid come from the doc block of `components/board/NewCardOptionList.vue` (the manifest). */
export default {
  component: 'NewCardOptionList',
  source: 'app',
  alternatives: ['ChoiceChip', 'UInput'],
  screen: '/tasks',
  variants: [
    { id: 'topics', label: 'Thema, searchable with new values', fixture: 'plainOptionLabel', props: { values: topics.slice(3), all: topics, current: 'Angebote', searchable: true, newValues: { maxLength: 100, stripCommas: false }, showMark: true, label: 'Thema' } },
    { id: 'timebox', label: 'Timebox', fixture: 'minutesOptionLabel', props: { values: ['5', '10', '15', '30', '45', '60', '90', '120'], all: ['5', '10', '15', '30', '45', '60', '90', '120'], current: '30', searchable: false, newValues: null, showMark: false, label: 'Timebox' } },
  ],
  states: [
    { id: 'large', state: 'selected', label: 'drawer: bigger targets', fixture: 'plainOptionLabel', props: { values: topics.slice(3), all: topics, current: null, searchable: true, newValues: null, showMark: false, label: 'Aktivität', large: true } },
  ],
} satisfies CatalogEntry
