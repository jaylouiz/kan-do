import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'StatsTrendBars',
  source: 'app',
  alternatives: ['StatsWeekTable'],
  screen: '/statistics',
  variants: [
    { id: 'weeks', label: 'eight weeks of the demo board', fixture: 'statsWeeks' },
    { id: 'labelled', label: 'labelled', fixture: 'statsWeeks', props: { labelled: true } },
  ],
  states: [],
} satisfies CatalogEntry
