import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'StatsPatterns',
  source: 'app',
  alternatives: [],
  variants: [
    { id: 'default', props: { patterns: [{ id: 'a', kind: 'size', key: 'l', n: 5, median: 160, deviation: 60 }, { id: 'b', kind: 'time', key: 'am', n: 6, median: 80, deviation: -20 }], emptyText: 'Noch keine Muster' } },
  ],
  states: [
    { id: 'empty', state: 'empty', props: { patterns: [], emptyText: 'Noch keine Muster' } },
  ],
} satisfies CatalogEntry
