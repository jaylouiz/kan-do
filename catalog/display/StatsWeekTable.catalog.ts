import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'StatsWeekTable',
  source: 'app',
  alternatives: ['UTable', 'TasksTable'],
  sampleNote: 'takes WeekPoint records with Date objects, which an entry (plain data) cannot hold; shown on /statistics.',
  states: [],
} satisfies CatalogEntry
