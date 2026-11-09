import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'DataConflictCopies',
  source: 'app',
  alternatives: ['ListRow'],
  sampleNote: 'reads the data-folder composable (conflict copies) of /settings/data and renders nothing without copies; its rows are ListRow, shown there.',
  states: [],
} satisfies CatalogEntry
