import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'BoardColumnYesterdayNote',
  source: 'app',
  alternatives: ['UCollapsible'],
  host: 'board',
  screen: '/tasks',
  variants: [{ id: 'yesterday', label: 'three tasks done yesterday', fixture: 'yesterdayNote' }],
  states: [],
} satisfies CatalogEntry
