import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'StatsWeekTable',
  source: 'app',
  alternatives: ['UTable', 'TasksTable'],
  screen: '/statistics',
  variants: [{ id: 'weeks', label: 'eight weeks of the demo board', fixture: 'statsWeeks' }],
  states: [],
} satisfies CatalogEntry
