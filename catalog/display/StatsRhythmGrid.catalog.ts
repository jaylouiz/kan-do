import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'StatsRhythmGrid',
  source: 'app',
  alternatives: ['StatsRhythmBars'],
  screen: '/statistics',
  variants: [{ id: 'demo', label: 'work rhythm of the demo board', fixture: 'statsRhythmGrid' }],
  states: [],
} satisfies CatalogEntry
