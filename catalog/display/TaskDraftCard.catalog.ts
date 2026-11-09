import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'TaskDraftCard',
  source: 'app',
  alternatives: ['TaskCard'],
  sampleNote: 'mounts the add-task flow against the task store and the board drag context; the card look is TaskCard with draft.',
  states: [],
} satisfies CatalogEntry
