import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'DayCloseDialog',
  source: 'app',
  alternatives: ['ResponsiveOverlay', 'UModal'],
  sampleNote: 'is an overlay: opened, it covers the page it is shown in, so it has no inline sample. It opens from its trigger in the app (it reads the board and the day-close state).',
  states: [],
} satisfies CatalogEntry
