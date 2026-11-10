import type { CatalogEntry } from '../types'

const customList = [
  { key: 'customer', name: 'Kunde', propType: 'text', value: { type: 'text', value: 'Familie Müller' }, isMissing: false },
  { key: 'budget', name: 'Budget', propType: 'number', value: { type: 'number', value: 4800 }, isMissing: false },
  { key: 'site', name: 'Baustelle', propType: 'url', value: { type: 'url', value: null }, isMissing: false },
  { key: 'confirmed', name: 'Bestätigt', propType: 'checkbox', value: { type: 'checkbox', value: true }, isMissing: false },
]

/** Description, usage and avoid come from the doc block of `components/task/TaskDetailCustomFields.vue` (the manifest). */
export default {
  component: 'TaskDetailCustomFields',
  source: 'app',
  alternatives: ['TaskPropertyRow'],
  screen: '/tasks',
  variants: [{ id: 'fields', label: 'text, number, empty URL and checkbox', props: { customList } }],
  states: [],
} satisfies CatalogEntry
