import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'NewDayRecap',
  source: 'app',
  alternatives: ['DayCloseDialog', 'ResponsiveOverlay'],
  screen: '/tasks',
  sampleNote: 'is the recap shown over the dimmed board on the first start of a new day: opened, it covers the page, and it reads the board and the recap state, so it has no inline sample.',
  states: [],
} satisfies CatalogEntry
