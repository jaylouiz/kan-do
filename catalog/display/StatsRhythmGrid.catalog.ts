import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'StatsRhythmGrid',
  source: 'app',
  alternatives: ['StatsRhythmBars'],
  sampleNote: 'takes a WorkRhythm with a 7x24 grid of dates and counts; shown on /statistics.',
  states: [],
} satisfies CatalogEntry
