import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'StatsRhythmBars',
  source: 'app',
  alternatives: [],
  variants: [
    { id: 'peak', props: { hours: [1, 2, 4, 7, 9, 6, 3, 4, 6, 5, 3, 2, 1, 1, 0, 0], peak: { from: 10, to: 12 } } },
    { id: 'ghost', props: { ghost: true } },
  ],
  states: [
    { id: 'empty', state: 'empty', props: { hours: [] } },
  ],
} satisfies CatalogEntry
