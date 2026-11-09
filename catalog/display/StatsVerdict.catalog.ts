import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'StatsVerdict',
  source: 'app',
  alternatives: ['StatsTile'],
  sampleNote: 'takes the whole Review object of the Statistik page (dates, baselines); shown on /statistics.',
  states: [],
} satisfies CatalogEntry
