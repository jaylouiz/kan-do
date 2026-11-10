import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'TaskDraftCard',
  source: 'app',
  alternatives: ['TaskCard'],
  host: 'board',
  screen: '/tasks',
  variants: [{ id: 'draft', label: 'draft while the add sheet is open', fixture: 'draftTask' }],
  states: [],
} satisfies CatalogEntry
