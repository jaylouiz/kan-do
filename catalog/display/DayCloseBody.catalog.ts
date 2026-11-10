import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'DayCloseBody',
  source: 'app',
  alternatives: ['DayCloseTaskRow'],
  host: 'board',
  screen: '/tasks',
  variants: [{ id: 'demo', label: 'end of the day on the demo board' }],
  states: [],
} satisfies CatalogEntry
