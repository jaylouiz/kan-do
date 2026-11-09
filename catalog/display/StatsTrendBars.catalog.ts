import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'StatsTrendBars',
  source: 'app',
  alternatives: [],
  sampleNote: 'takes WeekPoint records with Date objects, which an entry (plain data) cannot hold; shown on /statistics.',
  states: [],
} satisfies CatalogEntry
