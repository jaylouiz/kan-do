import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'DayCloseBody',
  source: 'app',
  alternatives: ['DayCloseTaskRow'],
  sampleNote: 'reads the board stores of the end-of-day dialog; its rows are DayCloseTaskRow.',
  states: [],
} satisfies CatalogEntry
