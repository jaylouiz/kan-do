import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'TaskStack',
  source: 'app',
  alternatives: ['TaskCard', 'TaskStackHeader', 'TaskStackPill'],
  sampleNote: 'is a drag-and-drop sortable that needs the board drag context; its parts are TaskCard, TaskStackHeader and TaskStackPill.',
  states: [],
} satisfies CatalogEntry
