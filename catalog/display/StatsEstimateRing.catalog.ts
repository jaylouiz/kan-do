import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'StatsEstimateRing',
  source: 'app',
  alternatives: [],
  variants: [
    { id: 'default', props: { estimate: { n: 10, longer: 40, onTarget: 30, shorter: 30 } } },
    { id: 'stacked', props: { estimate: { n: 10, longer: 40, onTarget: 30, shorter: 30 }, stacked: true } },
  ],
  states: [
    { id: 'empty', state: 'empty', props: { estimate: { n: 0, longer: 0, onTarget: 0, shorter: 0 } } },
  ],
} satisfies CatalogEntry
