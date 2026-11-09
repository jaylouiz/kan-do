import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'StatsTiles',
  source: 'app',
  alternatives: ['StatsTile'],
  sampleNote: 'takes the whole Review and rhythm objects of the Statistik page; its tile is StatsTile.',
  states: [],
} satisfies CatalogEntry
