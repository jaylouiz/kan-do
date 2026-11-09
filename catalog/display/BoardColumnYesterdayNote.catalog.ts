import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'BoardColumnYesterdayNote',
  source: 'app',
  alternatives: ['UCollapsible'],
  sampleNote: 'reads the board day and the archive actions; needs done tasks from earlier days of the task store.',
  states: [],
} satisfies CatalogEntry
